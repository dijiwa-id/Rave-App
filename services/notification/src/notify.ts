import type { Client } from '@gema/service-kit';
import { uuidv7 } from '@gema/service-kit';

export interface NewNotification {
  category: 'booking' | 'payment' | 'event' | 'release' | 'system' | 'social';
  title: string;
  body: string;
  link?: string;
}

/** Simpan notifikasi in-app (dedupe per event+user) dan antrekan kanal luar sesuai preferensi. */
export async function notifyUsers(tx: Client, userIds: string[], sourceEventId: string, n: NewNotification) {
  const unique = [...new Set(userIds)];
  for (const userId of unique) {
    const id = uuidv7();
    const r = await tx.query(
      `INSERT INTO notifications (id, user_id, category, title, body, link, source_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, source_event_id) DO NOTHING`,
      [id, userId, n.category, n.title, n.body, n.link ?? null, sourceEventId],
    );
    if (r.rowCount === 0) continue;
    const pref = await tx.query(`SELECT push, email, whatsapp FROM preferences WHERE user_id=$1 AND category=$2`, [userId, n.category]);
    const p = pref.rows[0] ?? { push: true, email: n.category === 'booking' || n.category === 'payment', whatsapp: false };
    for (const ch of ['push', 'email', 'whatsapp'] as const) {
      if (p[ch]) await tx.query(`INSERT INTO deliveries (notification_id, channel) VALUES ($1,$2)`, [id, ch]);
    }
  }
}

export async function artistRecipients(tx: Client, artistId: string): Promise<string[]> {
  const r = await tx.query(`SELECT user_id FROM org_members WHERE artist_id=$1`, [artistId]);
  return r.rows.map((x) => x.user_id);
}

export async function orgRecipients(tx: Client, orgId: string): Promise<string[]> {
  const r = await tx.query(`SELECT user_id FROM org_members WHERE org_id=$1`, [orgId]);
  return r.rows.map((x) => x.user_id);
}

export const rupiah = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
