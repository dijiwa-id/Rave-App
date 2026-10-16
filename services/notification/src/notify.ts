import type { Client, Job } from '@gema/service-kit';
import { uuidv7 } from '@gema/service-kit';

export interface NewNotification {
  category: 'booking' | 'payment' | 'event' | 'release' | 'system' | 'social';
  title: string;
  body: string;
  link?: string;
}

/** UUIDv7 di sisi SQL (Postgres 16 belum punya uuidv7()): 48-bit epoch ms + acak, versi 7 — urut waktu seperti uuidv7() service-kit. */
const SQL_UUIDV7 = `encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid`;

/** Ukuran batch fan-out pengikut per statement (keyset pada user_id). */
const FOLLOWER_CHUNK = 5000;

/**
 * Fan-out set-based dalam SATU statement: CTE `r(id, user_id)` = penerima (sudah unik) →
 * INSERT notifikasi (dedupe per user+event) → INSERT deliveries per kanal sesuai preferensi.
 * Default tanpa baris preferensi: push=true, email hanya booking/payment, whatsapp=false.
 * Param tetap: $1 category, $2 title, $3 body, $4 link, $5 source_event_id, $6 default email; sisanya milik `recipients`.
 * Hasil: n = jumlah penerima di batch, last = user_id terbesar (kursor keyset).
 */
function fanoutSql(recipients: string) {
  return `WITH r AS (${recipients}),
    ins AS (
      INSERT INTO notifications (id, user_id, category, title, body, link, source_event_id)
      SELECT r.id, r.user_id, $1::text, $2::text, $3::text, $4::text, $5::uuid FROM r
      ON CONFLICT (user_id, source_event_id) DO NOTHING
      RETURNING id, user_id
    ),
    dlv AS (
      INSERT INTO deliveries (notification_id, channel)
      SELECT ins.id, ch.channel FROM ins
      LEFT JOIN preferences p ON p.user_id = ins.user_id AND p.category = $1::text
      CROSS JOIN LATERAL (VALUES (1, 'push', coalesce(p.push, true)), (2, 'email', coalesce(p.email, $6::boolean)), (3, 'whatsapp', coalesce(p.whatsapp, false))) AS ch(ord, channel, enabled)
      WHERE ch.enabled
      ORDER BY ins.id, ch.ord
    )
    SELECT (SELECT count(*) FROM r)::int AS n, (SELECT user_id FROM r ORDER BY user_id DESC LIMIT 1) AS last`;
}

const baseParams = (sourceEventId: string, n: NewNotification) => [
  n.category,
  n.title,
  n.body,
  n.link ?? null,
  sourceEventId,
  n.category === 'booking' || n.category === 'payment',
];

/** Simpan notifikasi in-app (dedupe per event+user) dan antrekan kanal luar sesuai preferensi — satu round trip untuk semua user. */
export async function notifyUsers(tx: Client, userIds: string[], sourceEventId: string, n: NewNotification) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await tx.query(fanoutSql(`SELECT * FROM unnest($7::uuid[], $8::uuid[]) AS r(id, user_id)`), [
    ...baseParams(sourceEventId, n),
    unique.map(() => uuidv7()),
    unique,
  ]);
}

/**
 * Fan-out ke pengikut artis: consumer hanya MENCATAT pekerjaan (idempoten per event) — jutaan baris notifikasi
 * untuk artis populer tidak ditulis di dalam transaksi consumer (yang memegang offset topik). `fanoutJob` mengerjakannya.
 * `city` (bila ada key-nya): hanya pengikut di kota itu atau yang kotanya belum diketahui (REQ-EVT-02).
 */
export async function notifyFollowers(tx: Client, filter: { artistIds: string[]; city?: string | null }, sourceEventId: string, n: NewNotification) {
  if (!filter.artistIds?.length) return;
  await tx.query(
    `INSERT INTO fanout_jobs (source_event_id, artist_ids, by_city, city, category, title, body, link)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (source_event_id) DO NOTHING`,
    [sourceEventId, filter.artistIds, 'city' in filter, filter.city ?? null, n.category, n.title, n.body, n.link ?? null],
  );
}

/** Satu potongan fan-out (keyset user_id, memakai PK (artist_id, user_id)); mengembalikan kursor berikutnya atau null bila selesai. */
async function fanoutChunk(tx: Client, job: any): Promise<string | null> {
  const sql = fanoutSql(
    `SELECT ${SQL_UUIDV7} AS id, s.user_id FROM (
       SELECT DISTINCT f.user_id FROM artist_followers f
       ${job.by_city ? 'LEFT JOIN user_cities c ON c.user_id = f.user_id' : ''}
       WHERE f.artist_id = ANY($7::uuid[]) AND f.user_id > $8::uuid
       ${job.by_city ? 'AND (c.city IS NULL OR lower(c.city) = lower($10::text))' : ''}
       ORDER BY f.user_id LIMIT $9::int
     ) s`,
  );
  const n: NewNotification = { category: job.category, title: job.title, body: job.body, link: job.link ?? undefined };
  const params = [...baseParams(job.source_event_id, n), job.artist_ids, job.cursor_user, FOLLOWER_CHUNK];
  if (job.by_city) params.push(job.city);
  const r = await tx.query(sql, params);
  const { n: count, last } = r.rows[0];
  return count < FOLLOWER_CHUNK || !last ? null : last;
}

/**
 * Kerjakan fan-out tertunda: tiap potongan di transaksi pendeknya sendiri (gagal = hanya potongan itu diulang;
 * dedupe (user_id, source_event_id) membuat pengulangan aman). Pekerjaan dikunci SKIP LOCKED → aman multi-replika.
 */
export const fanoutJob: Job = {
  name: 'follower-fanout',
  everyMs: 2000,
  async run({ db }) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const progressed = await db.tx(async (tx) => {
        const job = (await tx.query(`SELECT * FROM fanout_jobs WHERE done_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
        if (!job) return false;
        const next = await fanoutChunk(tx, job);
        await tx.query(`UPDATE fanout_jobs SET cursor_user = coalesce($2::uuid, cursor_user), done_at = CASE WHEN $2::uuid IS NULL THEN now() END WHERE id = $1`, [
          job.id,
          next,
        ]);
        return true;
      });
      if (!progressed) break;
    }
    // Pekerjaan selesai disimpan 7 hari untuk diagnosis.
    await db.query(`DELETE FROM fanout_jobs WHERE done_at < now() - interval '7 days'`);
  },
};

export async function artistRecipients(tx: Client, artistId: string): Promise<string[]> {
  const r = await tx.query(`SELECT user_id FROM org_members WHERE artist_id=$1`, [artistId]);
  return r.rows.map((x) => x.user_id);
}

export async function orgRecipients(tx: Client, orgId: string): Promise<string[]> {
  const r = await tx.query(`SELECT user_id FROM org_members WHERE org_id=$1`, [orgId]);
  return r.rows.map((x) => x.user_id);
}

export const rupiah = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
