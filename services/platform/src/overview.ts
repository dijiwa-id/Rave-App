import type { FastifyInstance } from 'fastify';
import { audit, config, requireSuperAdmin, serviceHeaders, serviceUrl, settings, z, type Db, type ServiceContext } from '@rave/service-kit';
import { lastBackupAt } from './backups.js';
import { bucketBytes, disk } from './storage.js';

/** Lag dihitung per (group, topik) via indeks (topic, seq), dibatasi agar biaya tetap kecil saat consumer sangat tertinggal. */
const LAG_CAP = 10_000;
const LAG_SQL = `SELECT o.group_id, o.topic, l.n AS lag FROM bus.consumer_offsets o
  CROSS JOIN LATERAL (SELECT count(*)::bigint AS n FROM (SELECT 1 FROM bus.events e WHERE e.topic = o.topic AND e.seq > o.last_seq LIMIT ${LAG_CAP}) x) l`;

const SERVICES = ['iam', 'catalog', 'library', 'playback', 'booking', 'finance', 'ticketing', 'notification', 'live', 'ads', 'platform'] as const;

const KPI_KEYS = [
  'users_total',
  'users_7d',
  'artists',
  'orgs',
  'tracks_live',
  'releases_in_review',
  'streams_today',
  'streams_28d',
  'bookings_active',
  'bookings_settled',
  'gmv_offair',
  'escrow_held',
  'tickets_sold',
  'ticket_gmv',
  'kyc_pending',
  'disputes_open',
  'streams_live',
  'live_viewers',
] as const;

interface ServiceStat {
  name: string;
  ok: boolean;
  latency_ms: number;
  uptime_s: number | null;
  memory_mb: number | null;
  settings_loaded_at: string | null;
  metrics: Record<string, number | string>;
}

async function serviceStats(name: string): Promise<ServiceStat> {
  const t = Date.now();
  try {
    const r = await fetch(serviceUrl(name as any) + '/internal/stats', {
      headers: await serviceHeaders('platform'),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const b = (await r.json()) as any;
    return { name, ok: true, latency_ms: Date.now() - t, uptime_s: b.uptime_s, memory_mb: b.memory_mb, settings_loaded_at: b.settings_loaded_at, metrics: b.metrics ?? {} };
  } catch {
    return { name, ok: false, latency_ms: Date.now() - t, uptime_s: null, memory_mb: null, settings_loaded_at: null, metrics: {} };
  }
}

async function gatewayStat(): Promise<ServiceStat> {
  const t = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${config.ports.gateway}/healthz`, { signal: AbortSignal.timeout(2000) });
    return { name: 'gateway', ok: r.ok, latency_ms: Date.now() - t, uptime_s: null, memory_mb: null, settings_loaded_at: null, metrics: {} };
  } catch {
    return { name: 'gateway', ok: false, latency_ms: Date.now() - t, uptime_s: null, memory_mb: null, settings_loaded_at: null, metrics: {} };
  }
}

export async function busOverview(db: Db) {
  const topics = await db.query(`SELECT topic, count(*)::bigint AS events, max(published_at) AS last_at, max(seq) AS head FROM bus.events GROUP BY topic ORDER BY topic`);
  const head = new Map(topics.map((t) => [t.topic, Number(t.head)]));
  const offsets = await db.query(`SELECT group_id, topic, last_seq FROM bus.consumer_offsets ORDER BY group_id, topic`);
  // Lag = jumlah event topik yang belum dikonsumsi group (bukan selisih seq global).
  const lags = await db.query(LAG_SQL);
  const lagOf = new Map(lags.map((l) => [`${l.group_id}|${l.topic}`, Number(l.lag)]));
  const dead = await db.query(
    `SELECT group_id AS "group", event_id, topic, error, attempts, failed_at, retry_requested_at FROM bus.dead_letters ORDER BY failed_at DESC LIMIT 200`,
  );
  return {
    topics: topics.map((t) => ({ topic: t.topic, events: t.events, last_at: t.last_at })),
    consumers: offsets.map((o) => ({ group: o.group_id, topic: o.topic, last_seq: o.last_seq, head_seq: head.get(o.topic) ?? 0, lag: lagOf.get(`${o.group_id}|${o.topic}`) ?? 0 })),
    dead_letters: dead,
  };
}

export async function overviewRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.register(async (a) => {
    // Area Platform khusus Super Admin — termasuk membaca (tidak dapat didelegasikan lewat "Peran & Akses").
    a.addHook('preHandler', requireSuperAdmin);

    a.get('/v1/admin/platform/overview', async () => {
      const services = await Promise.all([gatewayStat(), ...SERVICES.map(serviceStats)]);
      const kpis = Object.fromEntries(KPI_KEYS.map((k) => [k, 0])) as Record<(typeof KPI_KEYS)[number], number>;
      for (const s of services) for (const k of KPI_KEYS) if (typeof s.metrics[k] === 'number') kpis[k] = s.metrics[k] as number;

      // events_total = estimasi planner (pg_class.reltuples) — hindari count(*) penuh atas bus.events di setiap muat dasbor.
      const bus = await db.one(
        `SELECT (SELECT greatest(c.reltuples, 0)::bigint FROM pg_class c WHERE c.oid = 'bus.events'::regclass) AS events_total,
                (SELECT count(*) FROM bus.dead_letters)::bigint AS dead_letters,
                (SELECT coalesce(max(lag), 0) FROM (${LAG_SQL}) x)::bigint AS max_lag`,
      );
      const d = disk();
      const dbBytes = (await db.one(`SELECT pg_database_size(current_database()) AS b`))!.b;
      const lastBackup = await lastBackupAt(db);
      const storage = {
        disk_used_pct: d.used_pct,
        disk_free_bytes: d.free_bytes,
        db_bytes: dbBytes,
        uploads_bytes: await bucketBytes('uploads'),
        backups_bytes: await bucketBytes('backups'),
        last_backup_at: lastBackup,
        warning: d.used_pct >= d.warn_pct,
      };

      const alerts: { level: 'info' | 'warning' | 'critical'; message: string; href: string }[] = [];
      for (const s of services.filter((x) => !x.ok)) alerts.push({ level: 'critical', message: `Service ${s.name} tidak merespons`, href: '/admin/platform' });
      if (settings.bool('maintenance.enabled')) alerts.push({ level: 'warning', message: 'Mode pemeliharaan aktif — transaksi pengguna ditolak', href: '/admin/platform/settings?group=maintenance' });
      for (const m of ['booking', 'ticketing'] as const)
        if (!settings.bool(`modules.${m}`)) alerts.push({ level: 'warning', message: `Modul ${m} dimatikan`, href: '/admin/platform/settings?group=modules' });
      if (storage.warning) alerts.push({ level: 'critical', message: `Disk terpakai ${d.used_pct}% (ambang ${d.warn_pct}%)`, href: '/admin/platform/storage' });
      if (bus.dead_letters > 0) alerts.push({ level: 'warning', message: `${bus.dead_letters} event gagal diproses (dead letter)`, href: '/admin/platform/bus' });
      if (bus.max_lag > 100) alerts.push({ level: 'warning', message: `Consumer tertinggal ${bus.max_lag} event`, href: '/admin/platform/bus' });
      const backupHours = settings.num('storage.backup_interval_hours');
      if (settings.bool('storage.backup_enabled') && (!lastBackup || Date.now() - new Date(lastBackup).getTime() > 2 * backupHours * 3600_000))
        alerts.push({ level: 'warning', message: lastBackup ? 'Backup terakhir sudah melewati 2× interval' : 'Belum ada backup database', href: '/admin/platform/backups' });
      if (kpis.disputes_open) alerts.push({ level: 'warning', message: `${kpis.disputes_open} dispute menunggu keputusan`, href: '/admin/disputes' });
      if (kpis.kyc_pending) alerts.push({ level: 'info', message: `${kpis.kyc_pending} pengajuan KYC menunggu verifikasi`, href: '/admin/kyc' });
      if (kpis.releases_in_review) alerts.push({ level: 'info', message: `${kpis.releases_in_review} rilis menunggu QC`, href: '/admin/qc' });

      const version = (await db.one(`SELECT version FROM settings_state WHERE id = 1`))?.version ?? 0;
      return {
        generated_at: new Date().toISOString(),
        services,
        kpis,
        bus,
        storage,
        alerts,
        settings_version: version,
        maintenance: settings.bool('maintenance.enabled'),
      };
    });

    a.get('/v1/admin/platform/bus', async () => busOverview(db));

    a.post('/v1/admin/platform/bus/dead-letters/retry', { preHandler: requireSuperAdmin }, async (req) => {
      const b = z.union([z.object({ all: z.literal(true) }), z.object({ group: z.string(), event_id: z.string().uuid() })]).parse(req.body);
      const r =
        'all' in b
          ? await db.query(`UPDATE bus.dead_letters SET retry_requested_at = now() RETURNING 1`)
          : await db.query(`UPDATE bus.dead_letters SET retry_requested_at = now() WHERE group_id = $1 AND event_id = $2 RETURNING 1`, [b.group, b.event_id]);
      await audit(db, { actorId: req.user!.sub, action: 'bus.dead_letter.retry', entity: 'bus', data: b });
      return { requested: r.length };
    });

    a.delete('/v1/admin/platform/bus/dead-letters', { preHandler: requireSuperAdmin }, async (req) => {
      const b = z.object({ group: z.string(), event_id: z.string().uuid() }).parse(req.body);
      const r = await db.query(`DELETE FROM bus.dead_letters WHERE group_id = $1 AND event_id = $2 RETURNING 1`, [b.group, b.event_id]);
      await audit(db, { actorId: req.user!.sub, action: 'bus.dead_letter.delete', entity: 'bus', data: b });
      return { deleted: r.length };
    });
  });
}
