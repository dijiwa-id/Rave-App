import type { FastifyInstance } from 'fastify';
import { ADMIN_ROLES } from '@rave/domain/settings';
import { audit, badRequest, conflict, forbidden, nextCursor, notFound, pageParams, publish, requirePermission, requireRole, requireService, requireSuperAdmin, z, type ServiceContext } from '@rave/service-kit';
import { buildMe } from './core.js';
import { kycOut } from './routes.js';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Back office IAM (REQ-ADM-01, REQ-IAM-04). */
export async function adminRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // Internal: profil org untuk service lain (mis. live menyimpan nama org pemilik siaran).
  app.get('/internal/orgs/:id', { preHandler: requireService }, async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Organisasi');
    const o = await db.one(`SELECT id, type, name, slug, verified, artist_id FROM orgs WHERE id = $1`, [id]);
    if (!o) throw notFound('Organisasi');
    return o;
  });

  // Internal: kontak pengguna untuk worker notifikasi (email/WhatsApp). Tidak diteruskan gateway (/internal/*).
  app.get('/internal/users/:id/contact', { preHandler: requireService }, async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Pengguna');
    const u = await db.one(`SELECT email, phone, display_name, locale, deleted_at, suspended_at FROM users WHERE id = $1`, [id]);
    if (!u || u.deleted_at) throw notFound('Pengguna');
    return { email: u.email, phone: u.phone, display_name: u.display_name, locale: u.locale, suspended: !!u.suspended_at };
  });

  // Internal: persetujuan pengguna (service iklan memeriksa consent `ads` untuk penargetan — UU PDP).
  app.get('/internal/users/:id/consents', { preHandler: requireService }, async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Pengguna');
    const rows = await db.query(`SELECT purpose, granted FROM consents WHERE user_id = $1`, [id]);
    return { consents: Object.fromEntries(rows.map((r) => [r.purpose, r.granted])) };
  });

  app.register(async (a) => {
    a.addHook('preHandler', requireRole('admin'));

    a.get('/v1/admin/iam/kyc', { preHandler: requirePermission('kyc.review') }, async (req) => {
      const q = req.query as { status?: string };
      const rows = await db.query(
        `SELECT k.*, u.email, u.display_name, o.name AS org_name FROM kyc_submissions k
         JOIN users u ON u.id = k.user_id LEFT JOIN orgs o ON o.id = k.org_id
         WHERE ($1::text IS NULL OR k.status = $1) ORDER BY k.created_at`,
        [q.status ?? null],
      );
      return { data: rows.map((r) => ({ ...kycOut(r), email: r.email, display_name: r.display_name, org_name: r.org_name })) };
    });

    a.post('/v1/admin/iam/kyc/:id/decision', { preHandler: requirePermission('kyc.review') }, async (req) => {
      const { id } = req.params as { id: string };
      const b = z.object({ approve: z.boolean(), reason: z.string().max(500).optional().nullable() }).parse(req.body);
      return db.tx(async (tx) => {
        const k = (await tx.query(`SELECT * FROM kyc_submissions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!k) throw notFound('Pengajuan KYC');
        if (k.status !== 'PENDING') throw conflict('Pengajuan sudah diputuskan');
        // Empat mata: admin tidak boleh memutuskan KYC miliknya sendiri; penolakan wajib beralasan (REQ-ADM-07).
        if (k.user_id === req.user!.sub) throw forbidden('Anda tidak dapat memutuskan pengajuan KYC milik sendiri');
        if (!b.approve && (b.reason ?? '').trim().length < 5) throw badRequest('Alasan penolakan wajib diisi (min. 5 karakter)');
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

    a.get('/v1/admin/iam/users', { preHandler: requirePermission('users.view') }, async (req) => {
      const q = req.query as { q?: string; cursor?: string; limit?: string };
      const { limit, offset } = pageParams(q);
      const ids = await db.query(
        `SELECT id FROM users WHERE deleted_at IS NULL AND ($1::text IS NULL OR email ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%')
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [q.q || null, limit, offset],
      );
      // Satu koneksi, berurutan: Promise.all ratusan buildMe menguras pool IAM (login & refresh ikut tertahan).
      const data = await db.tx(async (tx) => {
        const out = [];
        for (const r of ids) out.push(await buildMe(tx, r.id));
        return out;
      });
      return { data, next_cursor: nextCursor(offset, limit, ids.length) };
    });

    // ---- Tim admin (Super Admin) ----
    a.get('/v1/admin/iam/admins', { preHandler: requireSuperAdmin }, async () => {
      const ids = await db.query(`SELECT id FROM users WHERE deleted_at IS NULL AND (admin_role IS NOT NULL OR is_admin) ORDER BY admin_role = 'SUPER_ADMIN' DESC, created_at LIMIT 500`);
      const data = await db.tx(async (tx) => {
        const out = [];
        for (const r of ids) out.push(await buildMe(tx, r.id));
        return out;
      });
      return { data };
    });

    a.patch('/v1/admin/iam/users/:id', { preHandler: requireSuperAdmin }, async (req) => {
      const { id } = req.params as { id: string };
      const b = z
        .object({
          admin_role: z.enum(ADMIN_ROLES).nullable().optional(),
          suspended: z.boolean().optional(),
          reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500),
        })
        .parse(req.body);
      if (!isUuid(id)) throw notFound('Pengguna');
      return db.tx(async (tx) => {
        const u = (await tx.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!u) throw notFound('Pengguna');
        const self = u.id === req.user!.sub;
        if (b.admin_role !== undefined && b.admin_role !== u.admin_role) {
          if (u.admin_role === 'SUPER_ADMIN') {
            if (self) throw forbidden('Tidak dapat mengubah peran Super Admin milik sendiri');
            // Kunci SEMUA Super Admin dulu: dua Super Admin yang saling mencabut bersamaan tidak sama-sama lolos cek.
            await tx.query(`SELECT id FROM users WHERE admin_role = 'SUPER_ADMIN' AND deleted_at IS NULL ORDER BY id FOR UPDATE`);
            const others = (await tx.query(`SELECT count(*)::int AS n FROM users WHERE admin_role = 'SUPER_ADMIN' AND suspended_at IS NULL AND deleted_at IS NULL AND id <> $1`, [u.id])).rows[0].n;
            if (!others) throw conflict('Tidak dapat mencabut Super Admin terakhir');
          }
          await tx.query(`UPDATE users SET admin_role = $2::text, is_admin = $2::text IS NOT NULL, updated_at = now() WHERE id = $1`, [u.id, b.admin_role]);
          await audit(tx, { actorId: req.user!.sub, action: 'admin.role.change', entity: 'user', entityId: u.id, data: { from: u.admin_role, to: b.admin_role, reason: b.reason } });
        }
        if (b.suspended !== undefined && b.suspended !== !!u.suspended_at) {
          if (self) throw forbidden('Tidak dapat menangguhkan akun sendiri');
          await tx.query(`UPDATE users SET suspended_at = ${b.suspended ? 'now()' : 'NULL'}, updated_at = now() WHERE id = $1`, [u.id]);
          // Tangguhkan = cabut semua sesi; access token yang tersisa kedaluwarsa ≤ 15 menit.
          if (b.suspended) await tx.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [u.id]);
          await audit(tx, { actorId: req.user!.sub, action: b.suspended ? 'user.suspend' : 'user.unsuspend', entity: 'user', entityId: u.id, data: { reason: b.reason } });
        }
        return buildMe(tx, u.id);
      });
    });

    a.get('/v1/admin/iam/audit-logs', { preHandler: requirePermission('audit.view') }, async (req) => {
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
