import { createReadStream, existsSync, mkdirSync, statfsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { brandingReferences } from './branding.js';
import {
  audit,
  callService,
  conflict,
  idempotent,
  nextCursor,
  notFound,
  pageParams,
  requireSuperAdmin,
  settings,
  z,
  type Db,
  type ServiceContext,
} from '@gema/service-kit';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Bucket lokal (dev). Produksi: object storage S3-compatible dengan kebijakan bucket yang sama. */
export const BUCKETS = {
  uploads: {
    path: process.env.UPLOAD_DIR ?? join(ROOT, 'storage', 'uploads'),
    description: 'Master audio & artwork dari Artist Studio (dilayani lewat /v1/catalog/media).',
    quotaKey: 'storage.quota_uploads_gb',
  },
  backups: {
    path: process.env.BACKUP_DIR ?? join(ROOT, 'storage', 'backups'),
    description: 'Dump database terkompresi (pg_dump + gzip).',
    quotaKey: 'storage.quota_backups_gb',
  },
  live: {
    path: process.env.LIVE_DIR ?? join(ROOT, 'storage', 'live'),
    description: 'Segmen HLS siaran live (sementara; dihapus 2 menit setelah siaran berakhir).',
    quotaKey: null,
  },
  branding: {
    path: process.env.BRANDING_DIR ?? join(ROOT, 'storage', 'branding'),
    description: 'Logo & ikon platform (SVG/PNG) — publik lewat /v1/platform/branding.',
    quotaKey: null,
  },
} as const satisfies Record<string, { path: string; description: string; quotaKey: string | null }>;
export type BucketName = keyof typeof BUCKETS;
for (const b of Object.values(BUCKETS)) mkdirSync(b.path, { recursive: true });

/** Schema Postgres → service pemilik. */
const SCHEMA_SERVICE: Record<string, string> = {
  iam: 'iam',
  catalog: 'catalog',
  library: 'library',
  playback: 'playback',
  booking: 'booking',
  finance: 'finance',
  ticketing: 'ticketing',
  notify: 'notification',
  platform: 'platform',
  live: 'live',
  ads: 'ads',
  bus: 'event bus',
};

const GB = 1024 ** 3;
const MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gz': 'application/gzip',
  '.svg': 'image/svg+xml',
  '.ts': 'video/mp2t',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.sql': 'application/sql',
};
const contentType = (name: string) => MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
const typeGroup = (ct: string) => (ct.startsWith('audio/') ? 'audio' : ct.startsWith('image/') ? 'image' : ct === 'application/gzip' ? 'backup' : 'lainnya');

export interface StoredFile {
  bucket: BucketName;
  key: string;
  size: number;
  content_type: string;
  modified_at: string;
  url: string | null;
  referenced: boolean | null;
}

async function scanBucket(bucket: BucketName): Promise<StoredFile[]> {
  const dir = BUCKETS[bucket].path;
  if (!existsSync(dir)) return [];
  // Bucket live berisi folder per siaran → telusuri satu tingkat (kunci "<stream>/<segmen>", hanya-baca).
  const top = await readdir(dir, { withFileTypes: true });
  const entries = (
    await Promise.all(
      top.map(async (d) =>
        d.isDirectory() && bucket === 'live'
          ? (await readdir(join(dir, d.name), { withFileTypes: true }).catch(() => [])).filter((x) => x.isFile()).map((x) => `${d.name}/${x.name}`)
          : d.isFile()
            ? [d.name]
            : [],
      ),
    )
  ).flat();
  const files = await Promise.all(
    entries
      .filter((k) => !k.split('/').pop()!.startsWith('.'))
      .map(async (key): Promise<StoredFile | null> => {
        try {
          const st = await stat(join(dir, key));
          return {
            bucket,
            key,
            size: st.size,
            content_type: contentType(key),
            modified_at: st.mtime.toISOString(),
            url: bucket === 'uploads' ? `/v1/catalog/media/${key}` : bucket === 'branding' ? `/v1/platform/branding/${key}` : null,
            referenced: null,
          };
        } catch {
          return null; // segmen HLS bisa terhapus di antara readdir & stat
        }
      }),
  );
  return files.filter((f): f is StoredFile => f !== null);
}

// Daftar bucket di-cache ~30 dtk (pemindaian disk mahal); di-invalidate saat hapus/cleanup/backup selesai.
const LIST_TTL_MS = 30_000;
const listCache = new Map<BucketName, { at: number; files: Promise<StoredFile[]> }>();

export function invalidateBucket(bucket?: BucketName) {
  if (bucket) listCache.delete(bucket);
  else listCache.clear();
}

/** Salinan daftar file (aman dimutasi pemanggil: sort/referenced). */
export async function listBucket(bucket: BucketName): Promise<StoredFile[]> {
  let hit = listCache.get(bucket);
  if (!hit || Date.now() - hit.at > LIST_TTL_MS) {
    const entry = { at: Date.now(), files: scanBucket(bucket) };
    entry.files.catch(() => listCache.get(bucket) === entry && listCache.delete(bucket));
    listCache.set(bucket, entry);
    hit = entry;
  }
  return (await hit.files).map((f) => ({ ...f }));
}

export const bucketBytes = async (bucket: BucketName) => (await listBucket(bucket)).reduce((s, f) => s + f.size, 0);

/** Path aman di dalam bucket (tolak traversal). */
export function filePath(bucket: string, key: string): string {
  if (!(bucket in BUCKETS)) throw notFound('Bucket');
  if (!/^[\w.-]+$/.test(key) || key.startsWith('.')) throw notFound('File');
  const base = resolve(BUCKETS[bucket as BucketName].path);
  const p = resolve(base, key);
  if (!p.startsWith(base + sep) || !existsSync(p)) throw notFound('File');
  return p;
}

export function disk() {
  const s = statfsSync(BUCKETS.uploads.path);
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  const used = total - free;
  return {
    path: resolve(ROOT, 'storage'),
    total_bytes: total,
    used_bytes: used,
    free_bytes: free,
    used_pct: total ? Math.round((used / total) * 1000) / 10 : 0,
    warn_pct: settings.num('storage.disk_warn_pct'),
  };
}

/** Nama file di bucket uploads yang masih dipakai katalog. null = katalog tak terjangkau (jangan hapus apa pun). */
async function references(): Promise<Set<string> | null> {
  try {
    const r = await callService<{ files: string[] }>('platform', 'catalog', '/internal/media/references');
    return new Set(r.files);
  } catch {
    return null;
  }
}

async function orphans() {
  const refs = await references();
  if (!refs) throw conflict('Service katalog tidak terjangkau — pemindaian file yatim dibatalkan demi keamanan');
  const files = (await listBucket('uploads')).filter((f) => !refs.has(f.key));
  return files.map((f) => ({ ...f, referenced: false }));
}

export async function databaseUsage(db: Db) {
  const total = (await db.one(`SELECT pg_database_size(current_database()) AS b`))!.b as number;
  const tables = await db.query(
    `SELECT n.nspname AS schema, c.relname AS "table", pg_total_relation_size(c.oid) AS bytes, greatest(c.reltuples, 0)::bigint AS rows_est
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname = ANY($1)`,
    [Object.keys(SCHEMA_SERVICE)],
  );
  const by = new Map<string, { schema: string; service: string; bytes: number; tables: number; rows_est: number }>();
  for (const t of tables) {
    const s = by.get(t.schema) ?? { schema: t.schema, service: SCHEMA_SERVICE[t.schema], bytes: 0, tables: 0, rows_est: 0 };
    s.bytes += t.bytes;
    s.tables += 1;
    s.rows_est += t.rows_est;
    by.set(t.schema, s);
  }
  return {
    total_bytes: total,
    schemas: [...by.values()].sort((a, b) => b.bytes - a.bytes),
    largest_tables: tables.sort((a, b) => b.bytes - a.bytes).slice(0, 10),
  };
}

export async function busUsage(db: Db) {
  const r = await db.one(
    `SELECT count(*)::bigint AS events, pg_total_relation_size('bus.events') AS bytes, min(published_at) AS oldest_at FROM bus.events`,
  );
  const prunable = await db.one(`SELECT count(*)::bigint AS n FROM bus.events e WHERE ${PRUNABLE}`, [settings.num('storage.bus_retention_days')]);
  return { events: r.events, bytes: r.bytes, oldest_at: r.oldest_at, prunable: prunable.n };
}

/** Event boleh dihapus: lebih tua dari retensi, sudah dikonsumsi semua group topiknya, dan bukan dead letter. */
const PRUNABLE = `e.published_at < now() - make_interval(days => $1)
  AND e.seq <= coalesce((SELECT min(o.last_seq) FROM bus.consumer_offsets o WHERE o.topic = e.topic), e.seq)
  AND NOT EXISTS (SELECT 1 FROM bus.dead_letters d WHERE d.event_id = e.id)`;

export async function sample(db: Db) {
  const d = disk();
  const dbBytes = (await db.one(`SELECT pg_database_size(current_database()) AS b`))!.b;
  await db.query(`INSERT INTO storage_samples (at, disk_used_bytes, db_bytes, uploads_bytes, backups_bytes) VALUES (now(),$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
    d.used_bytes,
    dbBytes,
    await bucketBytes('uploads'),
    await bucketBytes('backups'),
  ]);
  // Simpan 90 hari sampel.
  await db.query(`DELETE FROM storage_samples WHERE at < now() - interval '90 days'`);
}

/** Schema yang memiliki tabel infrastruktur kit (idempotency_keys, outbox, processed_events). */
async function kitSchemas(db: Db): Promise<string[]> {
  const r = await db.query(`SELECT table_schema FROM information_schema.tables WHERE table_name = 'idempotency_keys' ORDER BY 1`);
  return r.map((x) => x.table_schema).filter((s) => /^[a-z_]+$/.test(s));
}

const MAINT_ACTIONS = ['prune_bus', 'prune_idempotency', 'vacuum_analyze', 'snapshot'] as const;

async function maintenance(db: Db, action: (typeof MAINT_ACTIONS)[number], schema?: string | null): Promise<Record<string, unknown>> {
  switch (action) {
    case 'prune_bus': {
      const days = settings.num('storage.bus_retention_days');
      const r = await db.query(`DELETE FROM bus.events e WHERE ${PRUNABLE} RETURNING 1`, [days]);
      return { deleted_events: r.length, retention_days: days };
    }
    case 'prune_idempotency': {
      // Ops lintas schema: idempotency key & outbox terkirim di setiap service.
      const days = settings.num('storage.idempotency_retention_days');
      const busDays = settings.num('storage.bus_retention_days');
      const out: Record<string, { idempotency_keys: number; outbox: number; processed_events: number }> = {};
      for (const s of await kitSchemas(db)) {
        const ik = await db.query(`DELETE FROM ${s}.idempotency_keys WHERE created_at < now() - make_interval(days => $1) RETURNING 1`, [days]);
        const ob = await db.query(`DELETE FROM ${s}.outbox WHERE published_at IS NOT NULL AND published_at < now() - make_interval(days => $1) RETURNING 1`, [busDays]);
        const pe = await db.query(`DELETE FROM ${s}.processed_events WHERE processed_at < now() - make_interval(days => $1) RETURNING 1`, [busDays]);
        if (ik.length + ob.length + pe.length) out[s] = { idempotency_keys: ik.length, outbox: ob.length, processed_events: pe.length };
      }
      return { retention_days: days, schemas: out };
    }
    case 'vacuum_analyze': {
      const before = (await db.one(`SELECT pg_database_size(current_database()) AS b`))!.b;
      if (schema && !(schema in SCHEMA_SERVICE)) throw notFound('Schema');
      // VACUUM bisa lebih lama dari statement_timeout pool (30 dtk): pakai koneksi khusus tanpa batas, lalu kembalikan.
      const c = await db.pool.connect();
      try {
        await c.query(`SET statement_timeout = 0`);
        if (schema) {
          const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1`, [schema])).rows;
          for (const t of tables) await c.query(`VACUUM (ANALYZE) "${schema}"."${t.tablename}"`);
        } else await c.query(`VACUUM (ANALYZE)`);
      } finally {
        await c.query(`RESET statement_timeout`).catch(() => {});
        c.release();
      }
      const after = (await db.one(`SELECT pg_database_size(current_database()) AS b`))!.b;
      return { schema: schema ?? 'semua', db_bytes_before: before, db_bytes_after: after };
    }
    case 'snapshot':
      await sample(db);
      return { sampled_at: new Date().toISOString() };
  }
}

export async function storageRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.register(async (a) => {
    // Area Platform khusus Super Admin — termasuk membaca (tidak dapat didelegasikan lewat "Peran & Akses").
    a.addHook('preHandler', requireSuperAdmin);

    a.get('/v1/admin/platform/storage', async () => {
      const buckets = await Promise.all((Object.keys(BUCKETS) as BucketName[]).map(async (name) => {
        const files = await listBucket(name);
        const bytes = files.reduce((s, f) => s + f.size, 0);
        const qk = BUCKETS[name].quotaKey;
        const quota = qk ? settings.num(qk) * GB : null;
        const types = new Map<string, { type: string; files: number; bytes: number }>();
        for (const f of files) {
          const t = typeGroup(f.content_type);
          const e = types.get(t) ?? { type: t, files: 0, bytes: 0 };
          e.files += 1;
          e.bytes += f.size;
          types.set(t, e);
        }
        return {
          name,
          description: BUCKETS[name].description,
          path: BUCKETS[name].path,
          files: files.length,
          bytes,
          quota_bytes: quota,
          used_pct: quota ? Math.round((bytes / quota) * 1000) / 10 : null,
          by_type: [...types.values()].sort((x, y) => y.bytes - x.bytes),
        };
      }));
      const trend = await db.query(
        `SELECT at, disk_used_bytes, db_bytes, uploads_bytes, backups_bytes FROM storage_samples WHERE at > now() - interval '30 days' ORDER BY at`,
      );
      return {
        disk: disk(),
        buckets,
        database: await databaseUsage(db),
        bus: await busUsage(db),
        retention: { bus_days: settings.num('storage.bus_retention_days'), idempotency_days: settings.num('storage.idempotency_retention_days') },
        trend,
      };
    });

    a.get('/v1/admin/platform/storage/buckets/:bucket/files', async (req) => {
      const { bucket } = req.params as { bucket: string };
      if (!(bucket in BUCKETS)) throw notFound('Bucket');
      const q = req.query as { q?: string; sort?: string; order?: string; cursor?: string; limit?: string };
      const { limit, offset } = pageParams({ ...q, limit: q.limit ?? 50 });
      let files = await listBucket(bucket as BucketName);
      if (q.q) files = files.filter((f) => f.key.toLowerCase().includes(q.q!.toLowerCase()));
      const dir = q.order === 'asc' ? 1 : -1;
      const sort = q.sort ?? 'date';
      files.sort((x, y) => dir * (sort === 'size' ? x.size - y.size : sort === 'name' ? x.key.localeCompare(y.key) : x.modified_at.localeCompare(y.modified_at)));
      const page = files.slice(offset, offset + limit);
      if (bucket === 'uploads' && page.length) {
        const refs = await references();
        for (const f of page) f.referenced = refs ? refs.has(f.key) : null;
      }
      if (bucket === 'branding') {
        const refs = brandingReferences();
        for (const f of page) f.referenced = refs.has(f.key);
      }
      return { data: page, next_cursor: nextCursor(offset, limit, page.length), total_files: files.length, total_bytes: files.reduce((s, f) => s + f.size, 0) };
    });

    a.get('/v1/admin/platform/storage/buckets/:bucket/files/:key/download', async (req, reply) => {
      const { bucket, key } = req.params as { bucket: string; key: string };
      const p = filePath(bucket, key);
      reply.header('content-type', contentType(key));
      reply.header('content-length', (await stat(p)).size);
      reply.header('content-disposition', `attachment; filename="${key}"`);
      return reply.send(createReadStream(p));
    });

    a.delete('/v1/admin/platform/storage/buckets/:bucket/files/:key', { preHandler: requireSuperAdmin }, async (req) => {
      const { bucket, key } = req.params as { bucket: string; key: string };
      const force = (req.query as { force?: string }).force === 'true';
      const p = filePath(bucket, key);
      const size = (await stat(p)).size;
      if (bucket === 'uploads' && !force) {
        const refs = await references();
        if (!refs) throw conflict('Service katalog tidak terjangkau — tidak dapat memastikan file tidak dipakai. Gunakan force=true.');
        if (refs.has(key)) throw conflict('File masih direferensikan katalog. Gunakan force=true untuk tetap menghapus.', { referenced: true });
      }
      if (bucket === 'branding' && brandingReferences().has(key))
        throw conflict('File sedang dipakai sebagai logo/ikon platform. Ganti atau kosongkan pengaturannya dulu.', { referenced: true });
      await unlink(p);
      invalidateBucket(bucket as BucketName);
      if (bucket === 'backups') await db.query(`DELETE FROM backups WHERE filename = $1`, [key]);
      await audit(db, { actorId: req.user!.sub, action: 'storage.file.delete', entity: 'storage', entityId: `${bucket}/${key}`, data: { size, force } });
      return { deleted: true };
    });

    a.post('/v1/admin/platform/storage/buckets/uploads/orphans/scan', async () => {
      const list = await orphans();
      return { orphans: list, bytes: list.reduce((s, f) => s + f.size, 0) };
    });

    a.post('/v1/admin/platform/storage/buckets/uploads/orphans/cleanup', { preHandler: requireSuperAdmin }, async (req, reply) => {
      const b = z.object({ keys: z.array(z.string()).optional() }).parse(req.body ?? {});
      return idempotent(db, req, reply, 'storage.orphans.cleanup', async (tx) => {
        let list = await orphans();
        if (b.keys?.length) list = list.filter((f) => b.keys!.includes(f.key));
        let freed = 0;
        try {
          for (const f of list) {
            await unlink(filePath('uploads', f.key));
            freed += f.size;
          }
        } finally {
          invalidateBucket('uploads');
        }
        await audit(tx, { actorId: req.user!.sub, action: 'storage.orphans.cleanup', entity: 'storage', entityId: 'uploads', data: { files: list.map((f) => f.key), bytes: freed } });
        return { body: { deleted: list.length, bytes_freed: freed } };
      });
    });

    a.post('/v1/admin/platform/storage/maintenance', { preHandler: requireSuperAdmin }, async (req) => {
      const b = z.object({ action: z.enum(MAINT_ACTIONS), schema: z.string().optional().nullable() }).parse(req.body);
      const t = Date.now();
      const result = await maintenance(db, b.action, b.schema);
      const duration_ms = Date.now() - t;
      await audit(db, { actorId: req.user!.sub, action: `storage.maintenance.${b.action}`, entity: 'storage', data: { ...result, duration_ms } });
      return { action: b.action, result, duration_ms };
    });
  });
}

/** Job retensi otomatis (harian) + sampel tren (per jam). */
export const storageJobs = [
  { name: 'storage-sample', everyMs: 60 * 60_000, run: async ({ db }: ServiceContext) => sample(db) },
  {
    name: 'retention',
    everyMs: 6 * 60 * 60_000,
    run: async ({ db, log }: ServiceContext) => {
      const bus = await maintenance(db, 'prune_bus');
      const idem = await maintenance(db, 'prune_idempotency');
      log.info({ bus, idem }, 'retensi data dijalankan');
    },
  },
];
