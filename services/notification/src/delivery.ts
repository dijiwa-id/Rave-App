import type { Job } from '@rave/service-kit';

/**
 * Worker kanal luar (push FCM/APNs, email, WhatsApp Business API).
 * Adapter provider belum dipilih (§11.9) → di dev hanya dicatat ke log lalu ditandai SENT.
 * Target: pesan transaksional terkirim ≤ 60 detik (REQ-NTF-01).
 */
export const deliveryJob: Job = {
  name: 'deliveries',
  everyMs: 3000,
  async run({ db, log }) {
    await db.tx(async (c) => {
      const r = await c.query(
        `SELECT d.id, d.channel, n.user_id, n.title FROM deliveries d JOIN notifications n ON n.id = d.notification_id
         WHERE d.status='PENDING' ORDER BY d.created_at LIMIT 50 FOR UPDATE OF d SKIP LOCKED`,
      );
      for (const d of r.rows) {
        log.debug({ channel: d.channel, user: d.user_id, title: d.title }, 'deliver (dev adapter)');
        await c.query(`UPDATE deliveries SET status='SENT', attempts=attempts+1, sent_at=now() WHERE id=$1`, [d.id]);
      }
    });
  },
};
