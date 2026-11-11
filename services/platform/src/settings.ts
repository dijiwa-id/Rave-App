import type { FastifyInstance, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BRANDING_PUBLIC_PREFIX, SETTINGS, SETTINGS_BY_KEY, coerceSetting, settingDefaults } from '@rave/domain/settings';
import {
  audit,
  badRequest,
  publish,
  requireService,
  requireSuperAdmin,
  setSettingsLoader,
  settings,
  SETTINGS_CHANNEL,
  z,
  type Client,
  type Db,
  type ServiceContext,
} from '@rave/service-kit';
import { BUCKETS } from './storage.js';

/** Snapshot nilai efektif = default registri ditimpa baris tabel `settings`. */
export async function loadSettings(q: Db | Client) {
  // Db.query → rows[]; Client.query → { rows }.
  const rows = async (sql: string) => {
    const r: any = await (q as { query(s: string): Promise<unknown> }).query(sql);
    return (Array.isArray(r) ? r : r.rows) as any[];
  };
  const list = await rows(`SELECT key, value, updated_by, updated_at FROM settings`);
  const version: number = (await rows(`SELECT version FROM settings_state WHERE id = 1`))[0]?.version ?? 0;
  const values = settingDefaults();
  const meta: Record<string, { updated_by: string | null; updated_at: string }> = {};
  for (const r of list) {
    if (!(r.key in SETTINGS_BY_KEY)) continue; // kunci usang dari registri lama diabaikan
    values[r.key] = r.value;
    meta[r.key] = { updated_by: r.updated_by, updated_at: r.updated_at };
  }
  return { version, values, meta };
}

/** Versi pengaturan terkini (memori) — diperbarui saat start & setiap applyChanges; dipakai `/v1/platform/config`. */
let currentVersion = 0;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const actorName = (req: FastifyRequest) => req.user?.name ?? req.user?.email ?? req.user?.sub ?? null;

/**
 * Terapkan perubahan dalam satu transaksi: validasi registri → upsert → riwayat → versi+1 → event.
 * Nilai sama dengan default disimpan sebagai "hapus baris" agar default registri baru tetap berlaku.
 */
async function applyChanges(db: Db, req: FastifyRequest, changes: Record<string, unknown>, reason: string, action: string) {
  const errors: { path: string; message: string }[] = [];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    try {
      clean[k] = coerceSetting(k, v);
    } catch (e: any) {
      errors.push({ path: k, message: e.message });
    }
  }
  // Gambar branding: file harus sudah diunggah ke bucket branding.
  for (const [k, v] of Object.entries(clean))
    if (SETTINGS_BY_KEY[k].type === 'image' && v && !existsSync(join(BUCKETS.branding.path, String(v).slice(BRANDING_PUBLIC_PREFIX.length))))
      errors.push({ path: k, message: `${SETTINGS_BY_KEY[k].label}: file belum diunggah` });
  // Logo partner (CMS): setiap file wajib sudah ada di bucket branding.
  for (const [k, v] of Object.entries(clean))
    if (SETTINGS_BY_KEY[k].type === 'partners')
      (v as { name: string; logo: string }[]).forEach((pt, i) => {
        if (pt.logo && !existsSync(join(BUCKETS.branding.path, pt.logo.slice(BRANDING_PUBLIC_PREFIX.length))))
          errors.push({ path: `${k}.${i}.logo`, message: `${pt.name}: file logo belum diunggah` });
      });
  if (errors.length) throw badRequest('Sebagian pengaturan tidak valid', { type: 'https://rave.id/problems/validation', errors });

  await db.tx(async (tx) => {
    await tx.query(`SELECT version FROM settings_state WHERE id = 1 FOR UPDATE`);
    const cur = await loadSettings(tx);
    const diff: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(clean)) {
      if (same(cur.values[k], v)) continue;
      diff[k] = v;
      if (same(SETTINGS_BY_KEY[k].default, v)) await tx.query(`DELETE FROM settings WHERE key = $1`, [k]);
      else
        await tx.query(
          `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [k, JSON.stringify(v), actorName(req)],
        );
      await tx.query(`INSERT INTO settings_history (key, old_value, new_value, reason, by_user_id, by_name) VALUES ($1,$2,$3,$4,$5,$6)`, [
        k,
        JSON.stringify(cur.values[k]),
        JSON.stringify(v),
        reason,
        req.user!.sub,
        actorName(req),
      ]);
    }
    if (!Object.keys(diff).length) return diff;
    const version = (await tx.query(`UPDATE settings_state SET version = version + 1 WHERE id = 1 RETURNING version`)).rows[0].version;
    await publish(tx, 'platform.settings.updated', 'settings', { changes: diff, version, byUserId: req.user!.sub });
    // Fan-out ke SEMUA replika semua service (dikirim Postgres saat COMMIT; consumer group bus hanya mencapai satu replika).
    await tx.query(`SELECT pg_notify($1, $2)`, [SETTINGS_CHANNEL, String(version)]);
    await audit(tx, { actorId: req.user!.sub, action, entity: 'settings', entityId: String(version), data: { changes: diff, reason } });
    return diff;
  });
  const fresh = await loadSettings(db);
  settings.applyVersioned(fresh.values, fresh.version);
  currentVersion = Math.max(currentVersion, fresh.version);
  return fresh;
}

export async function settingsRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // Platform tidak memanggil HTTP ke dirinya sendiri: refreshSettings (start, NOTIFY, berkala) memuat langsung dari DB.
  // Replika platform lain ikut segar lewat NOTIFY `rave_settings`, termasuk versi untuk /v1/platform/config.
  setSettingsLoader(async () => {
    const s = await loadSettings(db);
    currentVersion = Math.max(currentVersion, s.version);
    return { version: s.version, values: s.values };
  });
  const initial = await loadSettings(db);
  settings.applyVersioned(initial.values, initial.version);
  currentVersion = initial.version;

  app.get('/internal/settings', { preHandler: requireService }, async () => {
    const s = await loadSettings(db);
    return { version: s.version, values: s.values };
  });

  // Publik (tanpa login): hanya kunci bertanda `public` — banner, maintenance, modul, batas upload.
  // Dilayani dari memori (settings.all + versi ter-cache) — endpoint ini dipanggil setiap klien, tanpa query DB.
  app.get('/v1/platform/config', async (_req, reply) => {
    const values = settings.all();
    reply.header('cache-control', 'public, max-age=15');
    return { version: currentVersion, settings: Object.fromEntries(SETTINGS.filter((d) => d.public).map((d) => [d.key, values[d.key]])) };
  });

  app.register(async (a) => {
    // Area Platform khusus Super Admin — termasuk membaca (tidak dapat didelegasikan lewat "Peran & Akses").
    a.addHook('preHandler', requireSuperAdmin);

    a.get('/v1/admin/platform/settings', async () => loadSettings(db));

    a.put('/v1/admin/platform/settings', { preHandler: requireSuperAdmin }, async (req) => {
      const b = z.object({ changes: z.record(z.unknown()), reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
      if (!Object.keys(b.changes).length) throw badRequest('Tidak ada perubahan');
      return applyChanges(db, req, b.changes, b.reason, 'settings.update');
    });

    a.post('/v1/admin/platform/settings/reset', { preHandler: requireSuperAdmin }, async (req) => {
      const b = z.object({ keys: z.array(z.string()).min(1), reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
      const changes: Record<string, unknown> = {};
      for (const k of b.keys) {
        if (!(k in SETTINGS_BY_KEY)) throw badRequest(`Pengaturan tidak dikenal: ${k}`);
        changes[k] = SETTINGS_BY_KEY[k].default;
      }
      return applyChanges(db, req, changes, b.reason, 'settings.reset');
    });

    a.get('/v1/admin/platform/settings/history', async (req) => {
      const q = req.query as { key?: string; limit?: string };
      const rows = await db.query(
        `SELECT id, key, old_value, new_value, reason, by_user_id, by_name, created_at FROM settings_history
         WHERE ($1::text IS NULL OR key = $1) ORDER BY id DESC LIMIT $2`,
        [q.key || null, Math.min(Number(q.limit) || 100, 500)],
      );
      return { data: rows };
    });
  });
}
