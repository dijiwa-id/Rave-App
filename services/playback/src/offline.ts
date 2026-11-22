// Unduhan offline Premium (P-7, docs/adr/0004-unduhan-offline.md) — lisensi per perangkat.
// Sumber kebenaran: iam (member & perangkat), catalog (izin konten & artefak). Playback menandatangani lisensi Ed25519
// dan mencatat statusnya; pencabutan sampai ke klien lewat recheck.
import type { FastifyInstance } from 'fastify';
import {
  deviceDenial,
  licenseQuota,
  memberChangeRevokes,
  offlineAccess,
  offlineGate,
  offlinePolicy,
  OFFLINE_DENY,
  type OfflineContentKind,
  type OfflineDenyCode,
  type OfflineLicensePayload,
  type OfflineRevokeReason,
} from '@rave/domain/offline';
import {
  callService,
  HttpError,
  licensePublicKey,
  nextCursor,
  notFound,
  offlineDeny,
  pageParams,
  requireAuth,
  settings,
  signLicense,
  signMediaUrl,
  uuidv7,
  z,
  type Client,
  type Consumers,
  type Db,
  type Job,
} from '@rave/service-kit';

/** Masa berlaku URL unduhan berkas terenkripsi (berkas tanpa lisensi tidak berguna; URL hanya membatasi hotlink). */
export const DOWNLOAD_URL_TTL_SEC = 6 * 3600;
const policy = () => offlinePolicy((k) => settings.get(k));

// ---------------- Dependensi lintas service (bisa diganti di test) ----------------
export interface Entitlement {
  user: { id: string; member_type: string; member_until: string | null; premium_active: boolean; suspended: boolean };
  device: { id: string; user_id: string; platform: string; public_key: string; revoked_at: string | null } | null;
}
export type KeyResult =
  | { status: 'ready'; artifact: { id: string; version: number; format: 'RAVEOFL1'; rendition: string; codec_label: string; mime: string; size: number; plain_size: number; sha256: string; url: string }; wrapped_key: OfflineLicensePayload['key'] }
  | { status: 'preparing'; retry_after_s: number };
export interface OfflineDeps {
  entitlement(userId: string, deviceId: string): Promise<Entitlement>;
  contentKey(kind: OfflineContentKind, id: string, devicePublicKey: string): Promise<KeyResult>;
  contentStatus(tracks: string[], episodes: string[]): Promise<Record<string, boolean>>;
}

/** Galat catalog (403/404/409 + pesan dari OFFLINE_DENY) → kode penolakan yang sama ke klien. */
function mapUpstream(e: unknown): never {
  if (e instanceof HttpError && e.status < 500) {
    const code = (Object.keys(OFFLINE_DENY) as OfflineDenyCode[]).find((c) => OFFLINE_DENY[c].id === e.detail);
    if (code) throw offlineDeny(code);
    if (e.status === 404) throw offlineDeny('content_not_found');
    if (e.status === 409) throw offlineDeny('content_unavailable');
  }
  throw e;
}

export function serviceDeps(name: string): OfflineDeps {
  return {
    entitlement: (userId, deviceId) => callService<Entitlement>(name, 'iam', `/internal/offline/entitlement?user_id=${userId}&device_id=${deviceId}`),
    contentKey: (kind, id, pk) => callService<KeyResult>(name, 'catalog', '/internal/offline/key', { method: 'POST', body: { kind, id, device_public_key: pk } }).catch(mapUpstream),
    contentStatus: async (tracks, episodes) =>
      (await callService<{ available: Record<string, boolean> }>(name, 'catalog', '/internal/offline/status', { method: 'POST', body: { tracks, episodes } })).available,
  };
}

// ---------------- Lisensi ----------------
const iso = (d: unknown) => new Date(d as string).toISOString();

export function licensePayload(r: any): OfflineLicensePayload {
  return {
    v: 1,
    typ: 'rave.offline.license',
    license_id: r.id,
    user_id: r.user_id,
    device_id: r.device_id,
    track_id: r.track_id ?? null,
    episode_id: r.episode_id ?? null,
    artifact: r.artifact,
    key: r.wrapped_key,
    issued_at: iso(r.issued_at),
    expires_at: iso(r.expires_at),
    recheck_at: iso(r.recheck_at),
  };
}

/** Bentuk lisensi di API. `license` (token bertanda tangan) hanya untuk lisensi ACTIVE yang belum kedaluwarsa. */
export function licenseOut(r: any) {
  const live = r.status === 'ACTIVE' && new Date(r.expires_at).getTime() > Date.now();
  return {
    id: r.id,
    status: live || r.status !== 'ACTIVE' ? r.status : 'EXPIRED',
    device_id: r.device_id,
    track_id: r.track_id ?? null,
    episode_id: r.episode_id ?? null,
    issued_at: iso(r.issued_at),
    expires_at: iso(r.expires_at),
    recheck_at: iso(r.recheck_at),
    revoked_at: r.revoked_at ? iso(r.revoked_at) : null,
    revoke_reason: r.revoke_reason ?? null,
    artifact: { id: r.artifact.id, version: r.artifact.version, size: r.artifact.size, sha256: r.artifact.sha256, codec_label: r.artifact.codec_label },
    license: live ? signLicense(licensePayload(r)) : null,
  };
}

function windows(now = Date.now()) {
  const ttlMs = settings.num('download.license_ttl_days') * 86400_000;
  const recheckMs = Math.min(settings.num('download.recheck_hours') * 3600_000, ttlMs);
  return { issued: new Date(now), expires: new Date(now + ttlMs), recheck: new Date(now + recheckMs) };
}

/** Cabut lisensi ACTIVE yang cocok (idempoten: baris yang sudah dicabut/kedaluwarsa tidak disentuh). */
export async function revokeLicenses(tx: Client | Db, where: string, params: unknown[], reason: OfflineRevokeReason): Promise<string[]> {
  const sql = `UPDATE offline_licenses SET status = 'REVOKED', revoked_at = now(), revoke_reason = $1, updated_at = now()
                WHERE status = 'ACTIVE' AND ${where} RETURNING id`;
  const r: any = await (tx as any).query(sql, [reason, ...params]);
  return (Array.isArray(r) ? r : r.rows).map((x: { id: string }) => x.id);
}

const issueBody = z
  .object({ device_id: z.string().uuid(), track_id: z.string().uuid().optional(), episode_id: z.string().uuid().optional() })
  .refine((b) => !!b.track_id !== !!b.episode_id, 'Isi salah satu: track_id atau episode_id');
const recheckBody = z.object({ device_id: z.string().uuid(), license_ids: z.array(z.string().uuid()).max(2000) });

export async function offlineRoutes(app: FastifyInstance, { db, name }: { db: Db; name: string }, deps: OfflineDeps = serviceDeps(name)) {
  /** Kunci publik verifikasi tanda tangan lisensi (publik, boleh di-cache klien; `kid` menandai rotasi). */
  app.get('/v1/offline/pubkey', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return licensePublicKey();
  });

  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    /**
     * Terbitkan / perpanjang lisensi. 201 = baru, 200 = lisensi aktif yang sama diperbarui (idempoten),
     * 202 = berkas terenkripsi sedang disiapkan (ulangi setelah retry_after_s).
     */
    s.post('/v1/offline/licenses', async (req, reply) => {
      const userId = req.user!.sub;
      const p = policy();
      const gate = offlineGate(p, userId);
      if (gate) throw offlineDeny(gate);
      const b = issueBody.parse(req.body ?? {});
      const kind: OfflineContentKind = b.track_id ? 'track' : 'episode';
      const contentId = (b.track_id ?? b.episode_id)!;

      const ent = await deps.entitlement(userId, b.device_id);
      const deny =
        offlineAccess(p, { userId, memberType: ent.user.member_type, premiumActive: ent.user.premium_active, suspended: ent.user.suspended }, kind) ??
        deviceDenial(ent.device, userId);
      if (deny) throw offlineDeny(deny, deny === 'premium_required' ? { upgrade_url: '/premium' } : undefined);

      // Pra-cek kuota (tanpa kunci) agar permintaan yang pasti ditolak tidak memicu pembuatan artefak.
      const quotaArgs = async (q: Client | Db) => {
        const r: any = await (q as any).query(
          `SELECT (SELECT count(*) FROM offline_licenses WHERE device_id = $1 AND status = 'ACTIVE')::int AS active,
                  (SELECT count(*) FROM offline_licenses WHERE user_id = $2 AND created_at > now() - interval '1 hour')::int AS recent,
                  (SELECT id FROM offline_licenses WHERE device_id = $1 AND coalesce(track_id, episode_id) = $3 AND status = 'ACTIVE') AS existing`,
          [b.device_id, userId, contentId],
        );
        const row = (Array.isArray(r) ? r : r.rows)[0];
        const quota = licenseQuota({
          activeOnDevice: row.active,
          maxPerDevice: settings.num('download.max_tracks_per_device'),
          createdLastHour: row.recent,
          ratePerHour: settings.num('download.rate_per_user_hour'),
        });
        return { existing: row.existing as string | null, quota };
      };
      const pre = await quotaArgs(db);
      if (!pre.existing && pre.quota) throw offlineDeny(pre.quota, pre.quota === 'rate_limited' ? { retry_after_s: 3600 } : { limit: settings.num('download.max_tracks_per_device') });

      const key = await deps.contentKey(kind, contentId, ent.device!.public_key);
      if (key.status === 'preparing') {
        reply.status(202).header('retry-after', String(key.retry_after_s));
        return { status: 'preparing', retry_after_s: key.retry_after_s };
      }
      const { url, ...artifact } = key.artifact;
      const w = windows();
      const out = await db.tx(async (tx) => {
        // Serialkan per pengguna: kuota & keunikan dihitung ulang di bawah kunci.
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext('playback.offline'), hashtext($1))`, [userId]);
        const again = await quotaArgs(tx);
        if (again.existing) {
          const row = (
            await tx.query(
              `UPDATE offline_licenses SET artifact_id = $2, artifact = $3, wrapped_key = $4, issued_at = $5, expires_at = $6, recheck_at = $7, updated_at = now()
                WHERE id = $1 RETURNING *`,
              [again.existing, artifact.id, JSON.stringify(artifact), JSON.stringify(key.wrapped_key), w.issued, w.expires, w.recheck],
            )
          ).rows[0];
          return { status: 200, row };
        }
        if (again.quota) throw offlineDeny(again.quota, again.quota === 'rate_limited' ? { retry_after_s: 3600 } : { limit: settings.num('download.max_tracks_per_device') });
        const row = (
          await tx.query(
            `INSERT INTO offline_licenses (id, user_id, device_id, track_id, episode_id, artifact_id, artifact, wrapped_key, issued_at, expires_at, recheck_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [uuidv7(), userId, b.device_id, b.track_id ?? null, b.episode_id ?? null, artifact.id, JSON.stringify(artifact), JSON.stringify(key.wrapped_key), w.issued, w.expires, w.recheck],
          )
        ).rows[0];
        return { status: 201, row };
      });
      reply.status(out.status).header('cache-control', 'private, no-store');
      return {
        ...licenseOut(out.row),
        download: { url: signMediaUrl(url, DOWNLOAD_URL_TTL_SEC), expires_at: new Date(Date.now() + DOWNLOAD_URL_TTL_SEC * 1000).toISOString(), size: artifact.size, sha256: artifact.sha256 },
      };
    });

    s.get('/v1/offline/licenses', async (req, reply) => {
      const gate = offlineGate(policy(), req.user!.sub);
      if (gate) throw offlineDeny(gate);
      const q = z
        .object({ device_id: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED', 'all']).default('ACTIVE'), cursor: z.string().optional(), limit: z.coerce.number().optional() })
        .parse(req.query ?? {});
      const { limit, offset } = pageParams(q);
      const rows = await db.query(
        `SELECT * FROM offline_licenses
          WHERE user_id = $1 AND ($2::uuid IS NULL OR device_id = $2) AND ($3 = 'all' OR status = $3)
          ORDER BY created_at DESC, id LIMIT $4 OFFSET $5`,
        [req.user!.sub, q.device_id ?? null, q.status, limit, offset],
      );
      reply.header('cache-control', 'private, no-store');
      return { data: rows.map(licenseOut), next_cursor: nextCursor(offset, limit, rows.length) };
    });

    /** Hapus unduhan: lisensi milik sendiri → REVOKED (USER_REMOVED). Selalu boleh (juga saat fitur dimatikan). Idempoten. */
    s.delete('/v1/offline/licenses/:id', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const row = await db.tx(async (tx) => {
        const cur = (await tx.query(`SELECT * FROM offline_licenses WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, req.user!.sub])).rows[0];
        if (!cur) throw notFound('Lisensi');
        if (cur.status !== 'ACTIVE') return cur;
        await revokeLicenses(tx, 'id = $2', [id], 'USER_REMOVED');
        return (await tx.query(`SELECT * FROM offline_licenses WHERE id = $1`, [id])).rows[0];
      });
      return licenseOut(row);
    });

    /**
     * Cek ulang berkala dari perangkat: perpanjang yang masih berhak, kembalikan yang dicabut/kedaluwarsa/tidak dikenal.
     * Lisensi EXPIRED tidak dihidupkan lagi (klien meminta lisensi baru lewat POST /v1/offline/licenses).
     */
    s.post('/v1/offline/recheck', async (req, reply) => {
      const userId = req.user!.sub;
      const p = policy();
      if (!p.enabled) throw offlineDeny('offline_disabled');
      const b = recheckBody.parse(req.body ?? {});
      const ent = await deps.entitlement(userId, b.device_id);
      const dev = deviceDenial(ent.device, userId);
      if (dev === 'device_not_found') throw offlineDeny(dev);
      const member = offlineGate(p, userId) ?? offlineAccess(p, { userId, memberType: ent.user.member_type, premiumActive: ent.user.premium_active, suspended: ent.user.suspended });

      const ids = [...new Set(b.license_ids)];
      const result = await db.tx(async (tx) => {
        // Hak hilang → cabut di sumbernya (seluruh perangkat pengguna / perangkat ini), lalu laporkan.
        if (dev === 'device_revoked') await revokeLicenses(tx, 'device_id = $2', [b.device_id], 'DEVICE_REVOKED');
        else if (member) await revokeLicenses(tx, 'user_id = $2', [userId], member === 'account_suspended' ? 'ACCOUNT_SUSPENDED' : 'MEMBERSHIP');
        await tx.query(`UPDATE offline_licenses SET status = 'EXPIRED', updated_at = now() WHERE id = ANY($1::uuid[]) AND user_id = $2 AND status = 'ACTIVE' AND expires_at <= now()`, [ids, userId]);
        const rows = ids.length ? (await tx.query(`SELECT * FROM offline_licenses WHERE id = ANY($1::uuid[]) AND user_id = $2 AND device_id = $3`, [ids, userId, b.device_id])).rows : [];
        return rows;
      });

      const active = result.filter((r: any) => r.status === 'ACTIVE');
      let available: Record<string, boolean> = {};
      if (active.length) {
        available = await deps.contentStatus(
          active.filter((r: any) => r.track_id).map((r: any) => r.track_id),
          active.filter((r: any) => r.episode_id).map((r: any) => r.episode_id),
        );
      }
      const withdrawnSet = new Set<string>(active.filter((r: any) => !available[r.track_id ?? r.episode_id] || (r.episode_id && !p.podcastEnabled)).map((r: any) => r.id));
      const withdrawn = [...withdrawnSet];
      const keep = active.filter((r: any) => !withdrawnSet.has(r.id)).map((r: any) => r.id);
      const w = windows();
      const renewed = await db.tx(async (tx) => {
        if (withdrawn.length) await revokeLicenses(tx, 'id = ANY($2::uuid[])', [withdrawn], 'CONTENT_WITHDRAWN');
        if (!keep.length) return [];
        return (
          await tx.query(
            `UPDATE offline_licenses SET expires_at = $2, recheck_at = $3, updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' RETURNING *`,
            [keep, w.expires, w.recheck],
          )
        ).rows;
      });
      const byId = new Map(result.map((r: any) => [r.id, r]));
      const renewedIds = new Set(renewed.map((r: any) => r.id));
      const revoked: { license_id: string; reason: string }[] = [];
      const expired: string[] = [];
      for (const r of result as any[]) {
        if (renewedIds.has(r.id)) continue;
        if (r.status === 'EXPIRED') expired.push(r.id);
        else revoked.push({ license_id: r.id, reason: withdrawnSet.has(r.id) ? 'CONTENT_WITHDRAWN' : (r.revoke_reason ?? 'MEMBERSHIP') });
      }
      reply.header('cache-control', 'private, no-store');
      return {
        checked_at: new Date().toISOString(),
        next_recheck_at: w.recheck.toISOString(),
        renewed: renewed.map((r: any) => ({ license_id: r.id, expires_at: iso(r.expires_at), recheck_at: iso(r.recheck_at), license: signLicense(licensePayload(r)) })),
        revoked,
        expired,
        unknown: ids.filter((id) => !byId.has(id)),
      };
    });
  });
}

// ---------------- Konsumen pencabutan (T5) — efek di tx handler, idempoten ----------------
export function offlineConsumers(): Consumers {
  return {
    'iam.user.member_changed': async (e, tx) => {
      if (memberChangeRevokes(policy(), e.payload)) await revokeLicenses(tx, 'user_id = $2', [e.payload.userId], 'MEMBERSHIP');
    },
    'iam.device.revoked': async (e, tx) => {
      await revokeLicenses(tx, 'device_id = $2', [e.payload.deviceId], 'DEVICE_REVOKED');
    },
    'catalog.offline.revoked': async (e, tx) => {
      const col = e.payload.contentKind === 'track' ? 'track_id' : 'episode_id';
      await revokeLicenses(tx, `${col} = ANY($2::uuid[])`, [e.payload.contentIds], 'CONTENT_WITHDRAWN');
    },
  };
}

/** Tandai lisensi yang lewat expires_at sebagai EXPIRED (kecil: indeks parsial, batch 5000; aman paralel). */
export const offlineExpireJob: Job = {
  name: 'offline-expire',
  everyMs: 3600_000,
  async run({ db, log }) {
    const r = await db.query(
      `UPDATE offline_licenses SET status = 'EXPIRED', updated_at = now()
        WHERE id IN (SELECT id FROM offline_licenses WHERE status = 'ACTIVE' AND expires_at <= now() LIMIT 5000 FOR UPDATE SKIP LOCKED)
        RETURNING id`,
    );
    if (r.length) log.info({ expired: r.length }, 'lisensi offline kedaluwarsa');
  },
};
