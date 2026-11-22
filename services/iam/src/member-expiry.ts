import { publish, type Db, type Job } from '@rave/service-kit';
import type { MemberType } from './core.js';

/** Baris per transaksi: kecil agar kunci baris users singkat & outbox tidak membengkak dalam satu commit. */
export const MEMBER_EXPIRY_BATCH = 200;
/** Batas batch per putaran job (sisa diambil putaran berikutnya) — job tidak memonopoli pool. */
const MAX_BATCHES_PER_RUN = 25;

/**
 * S1 (P-7): masa Premium yang berakhir alami (`member_until <= now()`) diumumkan SEKALI lewat
 * `iam.user.member_changed` (payload sama dengan jalur Super Admin + `reason: 'EXPIRED'`, `premium: false` = efektif),
 * agar playback mencabut lisensi offline di sumbernya (`MEMBERSHIP`) tanpa menunggu recheck klien.
 *
 * - Idempoten: penanda `member_expiry_announced_until` = member_until yang diumumkan, ditulis di transaksi yang sama
 *   dengan outbox. Perpanjangan (member_until baru) → masa berikutnya diumumkan lagi saat berakhir.
 * - Aman multi-replika: `FOR UPDATE SKIP LOCKED` (replika lain / PATCH admin yang sedang memegang baris dilewati;
 *   kondisi dicek ulang setelah kunci didapat).
 * - Rencana query: indeks parsial `users_member_expiry_due_idx` (migrasi 018) + PK via `ANY(ARRAY(...))` (bukan IN —
 *   IN memilih hash join + seq scan users).
 * - Tidak menyentuh FREE, Premium tanpa batas (member_until NULL), masa yang belum lewat, atau akun terhapus.
 *   Kolom users.premium tidak diubah (token memakai `memberActive`, sudah memperhitungkan masa berlaku).
 */
export async function announceExpiredMembers(db: Db): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const n = await db.tx(async (tx) => {
      const rows = (
        await tx.query(
          `UPDATE users u SET member_expiry_announced_until = u.member_until
            WHERE u.id = ANY(ARRAY(
              SELECT id FROM users
               WHERE member_until IS NOT NULL AND member_type <> 'FREE' AND deleted_at IS NULL
                 AND member_expiry_announced_until IS DISTINCT FROM member_until
                 AND member_until <= now()
               ORDER BY member_until LIMIT $1 FOR UPDATE SKIP LOCKED))
            RETURNING u.id, u.member_type, u.member_until`,
          [MEMBER_EXPIRY_BATCH],
        )
      ).rows;
      for (const r of rows) {
        await publish(tx, 'iam.user.member_changed', r.id, {
          userId: r.id,
          memberType: r.member_type as MemberType,
          memberUntil: new Date(r.member_until).toISOString(),
          premium: false,
          reason: 'EXPIRED',
        });
      }
      return rows.length;
    });
    total += n;
    if (n < MEMBER_EXPIRY_BATCH) break;
  }
  return total;
}

export const memberExpiryJob: Job = {
  name: 'member-expiry',
  everyMs: 10 * 60_000,
  async run({ db, log }) {
    const n = await announceExpiredMembers(db);
    if (n) log.info({ announced: n }, 'masa member berakhir diumumkan');
  },
};
