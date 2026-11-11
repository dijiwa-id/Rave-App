import type { FastifyInstance } from 'fastify';
import { nextCursor, notFound, pageParams, requireAuth, z, type ServiceContext } from '@rave/service-kit';

const prefSchema = z.object({
  category: z.enum(['booking', 'payment', 'event', 'release', 'system', 'social']),
  push: z.boolean(),
  email: z.boolean(),
  whatsapp: z.boolean(),
  quiet_start: z.number().int().min(0).max(23).nullable().optional(),
  quiet_end: z.number().int().min(0).max(23).nullable().optional(),
});

export async function routes(app: FastifyInstance, { db }: ServiceContext) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/notifications', async (req) => {
    const q = req.query as { cursor?: string; limit?: string; unread?: string };
    const { limit, offset } = pageParams(q);
    const rows = await db.query(
      `SELECT id, category, title, body, link, read_at, created_at FROM notifications
       WHERE user_id=$1 ${q.unread === 'true' ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.sub, limit, offset],
    );
    return { data: rows, next_cursor: nextCursor(offset, limit, rows.length) };
  });

  app.get('/v1/notifications/unread-count', async (req) => {
    const r = await db.one(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [req.user!.sub]);
    return { unread: r?.n ?? 0 };
  });

  app.post('/v1/notifications/:id/read', async (req) => {
    const { id } = req.params as { id: string };
    const r = await db.one(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id=$1 AND user_id=$2 RETURNING id, read_at`, [
      id,
      req.user!.sub,
    ]);
    if (!r) throw notFound('Notifikasi');
    return r;
  });

  app.post('/v1/notifications/read-all', async (req) => {
    const r = await db.query(`UPDATE notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL RETURNING id`, [req.user!.sub]);
    return { updated: r.length };
  });

  app.get('/v1/notifications/preferences', async (req) => {
    return { data: await db.query(`SELECT * FROM preferences WHERE user_id=$1`, [req.user!.sub]) };
  });

  app.put('/v1/notifications/preferences', async (req) => {
    const p = prefSchema.parse(req.body);
    return db.one(
      `INSERT INTO preferences (user_id, category, push, email, whatsapp, quiet_start, quiet_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, category) DO UPDATE SET push=$3, email=$4, whatsapp=$5, quiet_start=$6, quiet_end=$7
       RETURNING *`,
      [req.user!.sub, p.category, p.push, p.email, p.whatsapp, p.quiet_start ?? null, p.quiet_end ?? null],
    );
  });
}
