import type { FastifyInstance } from 'fastify';
import { audit, conflict, nextCursor, notFound, pageParams, publish, requireRole, z, type ServiceContext } from '@gema/service-kit';
import { buildMe, type Q } from './core.js';
import { kycOut } from './routes.js';

/** Back office IAM (REQ-ADM-01, REQ-IAM-04). */
export async function adminRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.register(async (a) => {
    a.addHook('preHandler', requireRole('admin'));

    a.get('/v1/admin/iam/kyc', async (req) => {
      const q = req.query as { status?: string };
      const rows = await db.query(
        `SELECT k.*, u.email, u.display_name, o.name AS org_name FROM kyc_submissions k
         JOIN users u ON u.id = k.user_id LEFT JOIN orgs o ON o.id = k.org_id
         WHERE ($1::text IS NULL OR k.status = $1) ORDER BY k.created_at`,
        [q.status ?? null],
      );
      return { data: rows.map((r) => ({ ...kycOut(r), email: r.email, display_name: r.display_name, org_name: r.org_name })) };
    });

    a.post('/v1/admin/iam/kyc/:id/decision', async (req) => {
      const { id } = req.params as { id: string };
      const b = z.object({ approve: z.boolean(), reason: z.string().max(500).optional().nullable() }).parse(req.body);
      return db.tx(async (tx) => {
        const k = (await tx.query(`SELECT * FROM kyc_submissions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!k) throw notFound('Pengajuan KYC');
        if (k.status !== 'PENDING') throw conflict('Pengajuan sudah diputuskan');
        const status = b.approve ? 'VERIFIED' : 'REJECTED';
        const r = (
          await tx.query(`UPDATE kyc_submissions SET status = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1 RETURNING *`, [
            id,
            status,
            b.reason ?? null,
            req.user!.sub,
          ])
        ).rows[0];
        if (b.approve) {
          if (k.org_id) await tx.query(`UPDATE orgs SET verified = true WHERE id = $1`, [k.org_id]);
          await publish(tx, 'iam.kyc.verified', k.user_id, { userId: k.user_id, orgId: k.org_id, level: k.level });
        }
        await audit(tx, { actorId: req.user!.sub, action: `kyc.${status.toLowerCase()}`, entity: 'kyc', entityId: id, data: { reason: b.reason } });
        return kycOut(r);
      });
    });

    a.get('/v1/admin/iam/users', async (req) => {
      const q = req.query as { q?: string; cursor?: string; limit?: string };
      const { limit, offset } = pageParams(q);
      const ids = await db.query(
        `SELECT id FROM users WHERE deleted_at IS NULL AND ($1::text IS NULL OR email ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%')
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [q.q || null, limit, offset],
      );
      const data = await Promise.all(ids.map((r) => buildMe(db.pool as unknown as Q, r.id)));
      return { data, next_cursor: nextCursor(offset, limit, ids.length) };
    });

    a.get('/v1/admin/iam/audit-logs', async (req) => {
      const q = req.query as { cursor?: string; limit?: string; entity?: string };
      const { limit, offset } = pageParams(q);
      const rows = await db.query(
        `SELECT l.*, u.email AS actor_email FROM audit_logs l LEFT JOIN users u ON u.id::text = l.actor_id
         WHERE ($1::text IS NULL OR l.entity = $1) ORDER BY l.id DESC LIMIT $2 OFFSET $3`,
        [q.entity ?? null, limit, offset],
      );
      return { data: rows, next_cursor: nextCursor(offset, limit, rows.length) };
    });
  });
}
