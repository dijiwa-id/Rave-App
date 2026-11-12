import { brandedEmail, callService, DeliveryError, sendEmail, sendWhatsApp, wakeJob, type Job } from '@rave/service-kit';

/**
 * Worker kanal luar (REQ-NTF-01: pesan transaksional terkirim ≤ 60 detik).
 * - email / whatsapp → adapter EMAIL_PROVIDER / WHATSAPP_PROVIDER (service-kit/messaging). Default `log` di dev.
 * - push → belum ada provider & registrasi perangkat (aplikasi mobile) → SKIPPED, notifikasi in-app tetap tersimpan.
 * Alur: klaim batch (PENDING → SENDING) dalam transaksi singkat, kirim di luar transaksi, lalu tandai hasil.
 * Gagal sementara (timeout, 429, 5xx) dijadwalkan ulang dengan backoff eksponensial; gagal permanen → FAILED.
 */
const MAX_ATTEMPTS = 5;
const BATCH = 50;
const STALE_SENDING_MIN = 5;

const webUrl = () => (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');

type Row = { id: string; channel: string; attempts: number; user_id: string; title: string; body: string; link: string | null };
type Contact = { email: string | null; phone: string | null; suspended: boolean } | null;

export const deliveryJob: Job = {
  name: 'deliveries',
  everyMs: 15_000,
  wake: true,
  async run({ db, log }) {
    // Worker yang mati di tengah pengiriman meninggalkan SENDING → kembalikan ke antrean.
    await db.query(`UPDATE deliveries SET status='PENDING', claimed_at=NULL WHERE status='SENDING' AND claimed_at < now() - make_interval(mins => $1)`, [STALE_SENDING_MIN]);

    const rows = await db.tx(async (c) => {
      const r = await c.query(
        `SELECT d.id, d.channel, d.attempts, n.user_id, n.title, n.body, n.link FROM deliveries d JOIN notifications n ON n.id = d.notification_id
         WHERE d.status='PENDING' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
         ORDER BY d.created_at LIMIT ${BATCH} FOR UPDATE OF d SKIP LOCKED`,
      );
      if (r.rows.length) await c.query(`UPDATE deliveries SET status='SENDING', claimed_at=now() WHERE id = ANY($1::bigint[])`, [r.rows.map((x: Row) => x.id)]);
      return r.rows as Row[];
    });
    if (!rows.length) return;

    const contacts = new Map<string, Contact>();
    const contactOf = async (userId: string): Promise<Contact> => {
      if (!contacts.has(userId)) contacts.set(userId, await callService<Contact>('notification', 'iam', `/internal/users/${userId}/contact`).catch(() => null));
      return contacts.get(userId)!;
    };
    const finish = (id: string, status: string, extra: { error?: string; provider?: string; ref?: string } = {}) =>
      db.query(
        `UPDATE deliveries SET status=$2, attempts=attempts+1, claimed_at=NULL, last_error=$3, provider=$4, provider_ref=$5, sent_at = CASE WHEN $2='SENT' THEN now() ELSE sent_at END WHERE id=$1`,
        [id, status, extra.error ?? null, extra.provider ?? null, extra.ref ?? null],
      );

    for (const d of rows) {
      try {
        if (d.channel === 'push') {
          await finish(d.id, 'SKIPPED', { error: 'push belum tersedia (aplikasi mobile & registrasi perangkat)' });
          continue;
        }
        const contact = await contactOf(d.user_id);
        if (!contact || contact.suspended) {
          await finish(d.id, 'SKIPPED', { error: contact ? 'akun ditangguhkan' : 'kontak pengguna tidak tersedia' });
          continue;
        }
        const link = d.link ? (d.link.startsWith('http') ? d.link : webUrl() + d.link) : undefined;
        if (d.channel === 'email') {
          if (!contact.email) {
            await finish(d.id, 'SKIPPED', { error: 'pengguna tidak punya email' });
            continue;
          }
          const m = brandedEmail({ heading: d.title, lines: [d.body], cta: link ? { label: 'Buka di RAVE', url: link } : undefined, footer: 'Atur email notifikasi di Pengaturan akun RAVE.' });
          const r = await sendEmail({ to: contact.email, subject: d.title, ...m, tag: 'notification' });
          await finish(d.id, 'SENT', { provider: r.provider, ref: r.id });
        } else if (d.channel === 'whatsapp') {
          if (!contact.phone) {
            await finish(d.id, 'SKIPPED', { error: 'pengguna tidak punya nomor WhatsApp' });
            continue;
          }
          const r = await sendWhatsApp({ to: contact.phone, text: `${d.title}\n${d.body}${link ? `\n${link}` : ''}` });
          await finish(d.id, 'SENT', { provider: r.provider, ref: r.id });
        } else {
          await finish(d.id, 'SKIPPED', { error: `kanal tidak dikenal: ${d.channel}` });
        }
      } catch (e: any) {
        const retry = (e instanceof DeliveryError ? e.retryable : true) && d.attempts + 1 < MAX_ATTEMPTS;
        log.warn({ id: d.id, channel: d.channel, attempt: d.attempts + 1, retry, err: e?.message }, 'pengiriman notifikasi gagal');
        if (retry)
          await db.query(
            `UPDATE deliveries SET status='PENDING', attempts=attempts+1, claimed_at=NULL, last_error=$2, next_attempt_at = now() + make_interval(secs => $3) WHERE id=$1`,
            [d.id, String(e?.message ?? e).slice(0, 500), 30 * 2 ** d.attempts],
          );
        else await finish(d.id, 'FAILED', { error: String(e?.message ?? e).slice(0, 500) });
      }
    }
    // Batch penuh → kemungkinan masih ada antrean; lanjutkan segera tanpa menunggu interval cadangan.
    if (rows.length === BATCH) await wakeJob(db, 'deliveries');
  },
};
