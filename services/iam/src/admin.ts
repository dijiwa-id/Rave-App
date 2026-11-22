import type { FastifyInstance } from 'fastify';
import { ADMIN_ROLES } from '@rave/domain/settings';
import { audit, badRequest, conflict, forbidden, nextCursor, notFound, pageParams, publish, requirePermission, requireRole, requireService, requireSuperAdmin, z, type ServiceContext } from '@rave/service-kit';
import { clearMfa } from './mfa.js';
import { anonymizeUser, buildMe, MEMBER_TYPES, orgOut, type MemberType } from './core.js';
import { kycOut } from './routes.js';

/**
 * Filter peran pengguna di dasbor admin (selaras dengan peran turunan di buildMe/deriveRoles):
 * fan = pendengar murni (tanpa org & bukan admin); artis/manajemen/label/promotor/kreator = anggota org bertipe itu.
 */
const orgOf = (types: string) => `EXISTS (SELECT 1 FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = users.id AND o.type IN (${types}))`;
const ROLE_SQL: Record<string, string> = {
  fan: `NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id) AND admin_role IS NULL AND NOT is_admin`,
  artist: orgOf(`'ARTIST'`),
  manager: orgOf(`'MANAGEMENT'`),
  label: orgOf(`'LABEL'`),
  promotor: orgOf(`'PROMOTOR','VENUE'`),
  creator: orgOf(`'CREATOR'`),
  admin: `(admin_role IS NOT NULL OR is_admin)`,
};

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

  // Internal (finance — royalti): anggota Premium untuk atribusi pendapatan langganan per pendengar.
  app.get('/internal/royalty/premium', { preHandler: requireService }, async () => {
    const rows = await db.query(
      `SELECT id AS user_id, member_type, member_updated_at, member_until FROM users WHERE deleted_at IS NULL AND member_type <> 'FREE'`,
    );
    return { data: rows };
  });

  // Internal (finance — royalti): email pihak split → akun RAVE (pihak yang belum terdaftar tidak dikembalikan).
  app.post('/internal/users/resolve-emails', { preHandler: requireService }, async (req) => {
    const b = z.object({ emails: z.array(z.string().email()).max(2000) }).parse(req.body);
    if (!b.emails.length) return { data: [] };
    const rows = await db.query(`SELECT id, lower(email) AS email, display_name FROM users WHERE deleted_at IS NULL AND lower(email) = ANY($1::text[])`, [b.emails.map((e) => e.toLowerCase())]);
    return { data: rows.map((r) => ({ email: r.email, user_id: r.id, name: r.display_name })) };
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

    // Cari organisasi (Back Office: pengguna & organisasi, langganan RAVE Pro).
    a.get('/v1/admin/iam/orgs', { preHandler: requirePermission(['users.view', 'billing.manage']) }, async (req) => {
      const q = req.query as { q?: string; type?: string };
      const rows = await db.query(
        `SELECT o.*, (SELECT count(*) FROM memberships m WHERE m.org_id = o.id)::int AS members FROM orgs o
          WHERE ($1::text IS NULL OR o.name ILIKE '%'||$1||'%' OR o.slug ILIKE '%'||$1||'%') AND ($2::text IS NULL OR o.type = $2)
          ORDER BY o.verified DESC, o.created_at DESC LIMIT 50`,
        [q.q?.trim() || null, q.type && /^[A-Z]{3,12}$/.test(q.type) ? q.type : null],
      );
      return { data: rows.map((o) => ({ ...orgOut(o), members: o.members })) };
    });

    a.get('/v1/admin/iam/users', { preHandler: requirePermission('users.view') }, async (req) => {
      const q = req.query as { q?: string; cursor?: string; limit?: string; role?: string };
      const { limit, offset } = pageParams(q);
      const role = q.role && q.role in ROLE_SQL ? q.role : null;
      const search = `($1::text IS NULL OR email ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%' OR full_name ILIKE '%'||$1||'%')`;
      const ids = await db.query(
        `SELECT id FROM users WHERE deleted_at IS NULL AND ${search} ${role ? `AND ${ROLE_SQL[role]}` : ''}
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [q.q || null, limit, offset],
      );
      // Jumlah per peran (mengikuti kata kunci pencarian) untuk chip filter di dasbor.
      const counts = await db.one(
        `SELECT count(*)::int AS all, ${Object.entries(ROLE_SQL)
          .map(([k, cond]) => `count(*) FILTER (WHERE ${cond})::int AS ${k}`)
          .join(', ')} FROM users WHERE deleted_at IS NULL AND ${search}`,
        [q.q || null],
      );
      // Satu koneksi, berurutan: Promise.all ratusan buildMe menguras pool IAM (login & refresh ikut tertahan).
      const data = await db.tx(async (tx) => {
        const out = [];
        for (const r of ids) out.push(await buildMe(tx, r.id));
        return out;
      });
      return { data, next_cursor: nextCursor(offset, limit, ids.length), role_counts: counts };
    });

    // Detail satu pengguna: profil, identitas login, org, sesi, KYC, riwayat verifikasi, persetujuan, aktivitas terakhir.
    a.get('/v1/admin/iam/users/:id', { preHandler: requirePermission('users.view') }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Pengguna');
      const user = await buildMe(db.pool as any, id);
      if (!user) throw notFound('Pengguna');
      const [identities, orgs, sessions, kyc, verifications, consents, activity] = await Promise.all([
        db.query(`SELECT provider, subject, created_at FROM identities WHERE user_id = $1 ORDER BY created_at`, [id]),
        db.query(
          `SELECT o.id, o.type, o.name, o.slug, o.city, o.verified, m.role, m.created_at AS joined_at,
                  (SELECT count(*)::int FROM memberships x WHERE x.org_id = o.id) AS members
             FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY m.created_at`,
          [id],
        ),
        db.one(
          `SELECT count(*) FILTER (WHERE revoked_at IS NULL AND rotated_at IS NULL AND expires_at > now())::int AS active,
                  max(created_at) AS last_seen_at
             FROM refresh_tokens WHERE user_id = $1`,
          [id],
        ),
        db.one(`SELECT id, level, status, full_name, id_number_masked, reason, created_at, decided_at FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]),
        db.query(`SELECT id, status, reason, created_at, decided_at FROM verification_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`, [id]),
        db.query(`SELECT purpose, granted, updated_at FROM consents WHERE user_id = $1 ORDER BY purpose`, [id]),
        db.query(
          `SELECT id, actor_id, action, entity, entity_id, data, created_at FROM audit_logs
            WHERE actor_id::text = $1 OR entity_id::text = $1 OR data->>'userId' = $1 ORDER BY created_at DESC LIMIT 20`,
          [id],
        ),
      ]);
      // Nama pelaku (admin/pengguna) untuk log aktivitas — bukan sekadar ID.
      const actorIds = [...new Set(activity.map((r: any) => r.actor_id).filter((x: string | null) => x && isUuid(x)))];
      const actors = actorIds.length ? await db.query(`SELECT id::text, display_name FROM users WHERE id = ANY($1::uuid[])`, [actorIds]) : [];
      const actorName = new Map(actors.map((r: any) => [r.id, r.display_name]));
      return {
        user,
        identities,
        orgs,
        sessions: { active: sessions?.active ?? 0, last_seen_at: sessions?.last_seen_at ?? null },
        kyc: kyc ?? null,
        verifications,
        consents,
        activity: activity.map((r: any) => ({ ...r, actor_name: r.actor_id ? (actorName.get(r.actor_id) ?? null) : null })),
      };
    });

    // Hapus akun pengguna (Super Admin, UU PDP): anonimkan seperti hapus mandiri. Tidak untuk diri sendiri, admin aktif
    // (cabut perannya dulu), atau OWNER organisasi (pindahkan kepemilikan dulu) — mencegah org tanpa pemilik.
    a.delete('/v1/admin/iam/users/:id', { preHandler: requireSuperAdmin }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Pengguna');
      const b = z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
      return db.tx(async (tx) => {
        const u = (await tx.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!u) throw notFound('Pengguna');
        if (u.id === req.user!.sub) throw forbidden('Tidak dapat menghapus akun sendiri dari back office');
        if (u.admin_role || u.is_admin) throw conflict('Cabut peran admin pengguna ini terlebih dahulu');
        const owned = (await tx.query(`SELECT o.name FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 AND m.role = 'OWNER'`, [id])).rows;
        if (owned.length) throw conflict(`Pengguna adalah OWNER organisasi: ${owned.map((o) => o.name).join(', ')}. Pindahkan kepemilikan terlebih dahulu.`);
        await tx.query(`DELETE FROM memberships WHERE user_id = $1`, [id]);
        await anonymizeUser(tx, id);
        await audit(tx, { actorId: req.user!.sub, action: 'user.delete.admin', entity: 'user', entityId: id, data: { reason: b.reason, email: u.email ? `${String(u.email).slice(0, 2)}***` : null } });
        return { deleted: true };
      });
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
          /** Jenis member (Free/Individu/Pelajar/Duo) + batas waktu opsional (ISO; null = tanpa batas). */
          member_type: z.enum(MEMBER_TYPES).optional(),
          member_until: z.string().datetime({ offset: true }).nullable().optional(),
          /** Reset verifikasi 2 langkah (pengguna kehilangan ponsel & kode pemulihan). */
          reset_mfa: z.literal(true).optional(),
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
          // Lisensi unduhan offline dicabut playback saat ditangguhkan (tidak dipulihkan otomatis saat penangguhan dicabut).
          if (b.suspended) await publish(tx, 'iam.user.suspended', u.id, { userId: u.id });
          await audit(tx, { actorId: req.user!.sub, action: b.suspended ? 'user.suspend' : 'user.unsuspend', entity: 'user', entityId: u.id, data: { reason: b.reason } });
        }
        if (b.member_type !== undefined || b.member_until !== undefined) {
          const type = b.member_type ?? (u.member_type as MemberType);
          // Free tidak punya masa berlaku; tanggal harus di masa depan.
          const until = type === 'FREE' ? null : b.member_until !== undefined ? b.member_until : u.member_until;
          if (until && new Date(until).getTime() <= Date.now()) throw badRequest('Tanggal berakhir member harus di masa depan');
          const prevUntil = u.member_until ? new Date(u.member_until).toISOString() : null;
          const nextUntil = until ? new Date(until).toISOString() : null;
          if (type !== u.member_type || nextUntil !== prevUntil) {
            await tx.query(
              `UPDATE users SET member_type = $2, member_until = $3, premium = $2 <> 'FREE', member_updated_at = now(), member_updated_by = $4, updated_at = now() WHERE id = $1`,
              [u.id, type, nextUntil, req.user!.sub],
            );
            await audit(tx, {
              actorId: req.user!.sub,
              action: 'user.member.change',
              entity: 'user',
              entityId: u.id,
              data: { from: { type: u.member_type, until: prevUntil }, to: { type, until: nextUntil }, reason: b.reason },
            });
            // Token akses lama (≤ 15 mnt) masih membawa status lama; refresh berikutnya memakai jenis member baru.
            await publish(tx, 'iam.user.member_changed', u.id, { userId: u.id, memberType: type, memberUntil: nextUntil, premium: type !== 'FREE', reason: 'ADMIN' });
          }
        }
        if (b.reset_mfa) {
          // Akun sendiri dikelola lewat Pengaturan → Keamanan (butuh kode) — sesi Super Admin yang dicuri tidak bisa melepas 2FA-nya.
          if (self) throw forbidden('Kelola verifikasi 2 langkah akun sendiri lewat Pengaturan → Keamanan');
          if (!u.totp_enabled_at) throw badRequest('Pengguna ini belum mengaktifkan verifikasi 2 langkah');
          await clearMfa(tx, u.id);
          await tx.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [u.id]);
          await audit(tx, { actorId: req.user!.sub, action: 'user.mfa.reset', entity: 'user', entityId: u.id, data: { reason: b.reason } });
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
