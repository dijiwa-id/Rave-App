import type { FastifyInstance } from 'fastify';
import { DEVICE_PLATFORMS } from '@rave/domain/offline';
import { audit, notFound, offlineDeny, parseDevicePublicKey, publish, requireAuth, requireService, settings, unprocessable, uuidv7, z, type Client, type Db } from '@rave/service-kit';
import { memberActive } from './core.js';

/**
 * Perangkat unduhan offline Premium (P-7, ADR-0004). Batas perangkat aktif = `subscription.download_devices`.
 * Mendaftar butuh `download.enabled`; melihat & mencabut selalu boleh (pengguna harus bisa membersihkan perangkat lama).
 */

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const deviceBody = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  name: z.string().trim().min(1).max(80),
  /** Kunci publik ECDH P-256: titik mentah 65 byte (base64/base64url) atau SPKI DER (base64). */
  public_key: z.string().trim().min(80).max(400),
  app_version: z.string().trim().max(40).optional(),
});

export const deviceOut = (d: any) => ({
  id: d.id,
  platform: d.platform,
  name: d.name,
  app_version: d.app_version ?? null,
  key_fingerprint: d.key_fingerprint,
  created_at: d.created_at,
  last_seen_at: d.last_seen_at,
  revoked_at: d.revoked_at ?? null,
});

const COLS = `id, platform, name, app_version, key_fingerprint, created_at, last_seen_at, revoked_at`;

async function activeDevices(q: Client | Db, userId: string) {
  const r: any = await (q as any).query(`SELECT ${COLS} FROM user_devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`, [userId]);
  return (Array.isArray(r) ? r : r.rows).map(deviceOut);
}

export async function deviceRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.get('/v1/me/devices', async (req) => {
      const data = await activeDevices(db, req.user!.sub);
      return { data, limit: settings.num('subscription.download_devices'), active: data.length };
    });

    /** Daftar / perbarui perangkat (upsert berdasarkan kunci publik). 201 = perangkat baru, 200 = sudah terdaftar. */
    s.post('/v1/me/devices', async (req, reply) => {
      if (!settings.bool('download.enabled')) throw offlineDeny('offline_disabled');
      const b = deviceBody.parse(req.body ?? {});
      const key = parseDevicePublicKey(b.public_key);
      if (!key) throw unprocessable('Kunci publik perangkat harus ECDH P-256 (titik mentah 65 byte atau SPKI, base64)', { code: 'invalid_public_key' });
      const userId = req.user!.sub;
      const limit = settings.num('subscription.download_devices');
      const out = await db.tx(async (tx) => {
        // Serialkan pendaftaran per akun agar dua permintaan paralel tidak melampaui batas.
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext('iam.devices'), hashtext($1))`, [userId]);
        const same = (
          await tx.query(
            `UPDATE user_devices SET platform = $3, name = $4, app_version = coalesce($5, app_version), last_seen_at = now()
              WHERE user_id = $1 AND key_fingerprint = $2 AND revoked_at IS NULL RETURNING ${COLS}`,
            [userId, key.fingerprint, b.platform, b.name, b.app_version ?? null],
          )
        ).rows[0];
        if (same) return { status: 200, device: deviceOut(same) };
        const active = await activeDevices(tx, userId);
        if (active.length >= limit) throw offlineDeny('device_limit', { limit, devices: active });
        const id = uuidv7();
        const row = (
          await tx.query(
            `INSERT INTO user_devices (id, user_id, platform, name, public_key, key_fingerprint, app_version)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
            [id, userId, b.platform, b.name, key.spki, key.fingerprint, b.app_version ?? null],
          )
        ).rows[0];
        await audit(tx, { actorId: userId, action: 'device.register', entity: 'user_device', entityId: id, data: { platform: b.platform }, ip: req.ip });
        return { status: 201, device: deviceOut(row) };
      });
      reply.status(out.status);
      return out.device;
    });

    /** Cabut perangkat milik sendiri → semua lisensi offline-nya dicabut (event iam.device.revoked). Idempoten. */
    s.delete('/v1/me/devices/:id', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Perangkat');
      const userId = req.user!.sub;
      return db.tx(async (tx) => {
        const cur = (await tx.query(`SELECT ${COLS} FROM user_devices WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId])).rows[0];
        if (!cur) throw notFound('Perangkat');
        if (cur.revoked_at) return deviceOut(cur);
        const row = (await tx.query(`UPDATE user_devices SET revoked_at = now(), revoked_by = $2 WHERE id = $1 RETURNING ${COLS}`, [id, userId])).rows[0];
        await audit(tx, { actorId: userId, action: 'device.revoke', entity: 'user_device', entityId: id, ip: req.ip });
        await publish(tx, 'iam.device.revoked', userId, { deviceId: id, userId, reason: 'USER' });
        return deviceOut(row);
      });
    });
  });

  /**
   * Internal (playback): status member + perangkat untuk penerbitan/cek ulang lisensi offline — satu panggilan per
   * permintaan. Perangkat milik akun lain dikembalikan `null` (pemanggil menjawab 404). Memperbarui last_seen_at (≤ 1×/jam).
   */
  app.get('/internal/offline/entitlement', { preHandler: requireService }, async (req) => {
    const q = z.object({ user_id: z.string().uuid(), device_id: z.string().uuid().optional() }).parse(req.query ?? {});
    const u = await db.one(`SELECT id, member_type, member_until, premium, suspended_at, deleted_at FROM users WHERE id = $1`, [q.user_id]);
    if (!u) throw notFound('Pengguna');
    let device = null;
    if (q.device_id) {
      device = await db.one(
        `UPDATE user_devices SET last_seen_at = CASE WHEN last_seen_at < now() - interval '1 hour' THEN now() ELSE last_seen_at END
          WHERE id = $1 AND user_id = $2 RETURNING id, user_id, platform, public_key, revoked_at`,
        [q.device_id, q.user_id],
      );
    }
    return {
      user: {
        id: u.id,
        member_type: u.member_type,
        member_until: u.member_until,
        premium_active: !u.deleted_at && memberActive(u),
        suspended: !!u.suspended_at || !!u.deleted_at,
      },
      device,
    };
  });
}
