import type { FastifyInstance } from 'fastify';
import {
  audit,
  badRequest,
  config,
  conflict,
  forbidden,
  notFound,
  publish,
  requireAuth,
  requirePermission,
  requireRole,
  requireService,
  unauthorized,
  uuidv7,
  z,
  type ServiceContext,
} from '@rave/service-kit';
import { buildMe, identityVerified, isoDate, normalizeDestination, OTP_MAX_ATTEMPTS, OTP_TTL_SEC, sha256, VERIFY_KEYS, verificationChecklist, verificationStatus, type Q } from './core.js';
import { issueOtp } from './otp.js';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const contactBody = z.object({ channel: z.enum(['email', 'whatsapp']), destination: z.string().min(5).max(200) });

/** Data profil yang disalin ke pengajuan (yang ditinjau admin). */
function snapshotOf(u: any) {
  return {
    display_name: u.display_name,
    full_name: u.full_name,
    birth_date: isoDate(u.birth_date),
    gender: u.gender,
    bio: u.bio,
    socials: u.socials ?? [],
    avatar_url: u.avatar_url,
    city: u.city,
    email: u.email,
    phone: u.phone,
    id_number_masked: u.id_number_masked ?? null,
  };
}

function requestOut(r: any) {
  return { id: r.id, status: r.status, reason: r.reason ?? null, created_at: r.created_at, decided_at: r.decided_at ?? null };
}

/**
 * Akun terverifikasi (badge "Verified"). Murni penanda identitas — tidak mengubah tier, kuota, atau fitur apa pun.
 * Alur: lengkapi data → tautkan email & WhatsApp (OTP) → ajukan → admin `users.verify` setujui/tolak → bisa dicabut.
 */
export async function verificationRoutes(app: FastifyInstance, { db }: ServiceContext) {
  const pool = db.pool as unknown as Q;

  // Internal: foto profil yang dipakai (bucket uploads catalog) — agar panel Storage tidak menganggapnya file yatim.
  app.get('/internal/media/references', { preHandler: requireService }, async () => {
    const rows = await db.query<{ u: string }>(`SELECT DISTINCT avatar_url AS u FROM users WHERE avatar_url LIKE '/v1/catalog/media/%' AND deleted_at IS NULL`);
    return { files: rows.map((r) => r.u.split('/v1/catalog/media/')[1].split(/[?#]/)[0]) };
  });

  app.register(async (me) => {
    me.addHook('preHandler', requireAuth);

    // ---- Tautkan & verifikasi kontak (email / WhatsApp) lewat OTP ----
    me.post('/v1/me/contact/otp', async (req) => {
      const b = contactBody.parse(req.body);
      const dest = normalizeDestination(b.channel, b.destination);
      if (b.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) throw badRequest('Email tidak valid');
      if (b.channel === 'whatsapp' && !/^\+\d{9,15}$/.test(dest)) throw badRequest('Nomor WhatsApp tidak valid');
      const provider = b.channel === 'email' ? 'email' : 'whatsapp';
      const owner = await db.one(`SELECT user_id FROM identities WHERE provider = $1 AND subject = $2`, [provider, dest]);
      if (owner && owner.user_id !== req.user!.sub) throw conflict(b.channel === 'email' ? 'Email ini sudah dipakai akun RAVE lain' : 'Nomor ini sudah dipakai akun RAVE lain');
      if (owner) return { sent: false, already_verified: true };
      const code = await issueOtp(db, req.log, { dest, channel: b.channel, purpose: 'link' });
      return { sent: true, expires_in: OTP_TTL_SEC, ...(config.isDev ? { dev_code: code } : {}) };
    });

    me.post('/v1/me/contact/verify', async (req) => {
      const b = contactBody.extend({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
      const dest = normalizeDestination(b.channel, b.destination);
      const provider = b.channel === 'email' ? 'email' : 'whatsapp';
      const otp = await db.one(`SELECT * FROM otp_codes WHERE destination = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [dest]);
      if (!otp) throw unauthorized('Kode OTP tidak ditemukan atau kedaluwarsa');
      // Pesan satu percobaan atomik SEBELUM membandingkan kode (sama dengan login): tebakan paralel tidak lolos batas.
      const reserved = await db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL RETURNING id`, [otp.id, OTP_MAX_ATTEMPTS]);
      if (!reserved.length) throw unauthorized('Terlalu banyak percobaan. Minta kode baru.');
      if (otp.code_hash !== sha256(`${dest}:${b.code}`)) throw unauthorized('Kode OTP salah');
      return db.tx(async (tx) => {
        const claimed = await tx.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [otp.id]);
        if (!claimed.rowCount) throw unauthorized('Kode OTP sudah dipakai');
        const uid = req.user!.sub;
        const u = (await tx.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [uid])).rows[0];
        if (!u) throw notFound('Pengguna');
        const owner = (await tx.query(`SELECT user_id FROM identities WHERE provider = $1 AND subject = $2`, [provider, dest])).rows[0];
        if (owner && owner.user_id !== uid) throw conflict('Kontak ini sudah dipakai akun RAVE lain');
        const col = provider === 'email' ? 'email' : 'phone';
        const taken = (await tx.query(`SELECT 1 FROM users WHERE ${col} = $1 AND id <> $2`, [dest, uid])).rows[0];
        if (taken) throw conflict('Kontak ini sudah dipakai akun RAVE lain');
        const prev = u[col] as string | null;
        if (!owner) await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ($1,$2,$3)`, [provider, dest, uid]);
        // Kontak lama (bila diganti) dilepas dari login: satu email & satu nomor per akun.
        if (prev && prev !== dest) await tx.query(`DELETE FROM identities WHERE provider = $1 AND subject = $2 AND user_id = $3`, [provider, prev, uid]);
        await tx.query(`UPDATE users SET ${col} = $2, updated_at = now() WHERE id = $1`, [uid, dest]);
        await audit(tx, { actorId: uid, action: `contact.verify.${provider}`, entity: 'user', entityId: uid, data: { changed: !!prev && prev !== dest } });
        return buildMe(tx, uid);
      });
    });

    // ---- Status & pengajuan verifikasi ----
    me.get('/v1/me/verification', async (req) => {
      const u = (await pool.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.user!.sub])).rows[0];
      if (!u) throw notFound('Pengguna');
      const checklist = await verificationChecklist(pool, u);
      const last = (await pool.query(`SELECT * FROM verification_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [u.id])).rows[0];
      return {
        status: await verificationStatus(pool, u),
        verified_at: u.verified_at ?? null,
        checklist,
        complete: VERIFY_KEYS.every((k) => checklist[k]),
        request: last ? requestOut(last) : null,
      };
    });

    me.post('/v1/me/verification', async (req) => {
      const uid = req.user!.sub;
      return db.tx(async (tx) => {
        const u = (await tx.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [uid])).rows[0];
        if (!u) throw notFound('Pengguna');
        if (u.verified_at) throw conflict('Akun sudah terverifikasi');
        const pending = (await tx.query(`SELECT id FROM verification_requests WHERE user_id = $1 AND status = 'PENDING'`, [uid])).rows[0];
        if (pending) throw conflict('Pengajuan verifikasi masih menunggu review');
        const checklist = await verificationChecklist(tx, u);
        const missing = VERIFY_KEYS.filter((k) => !checklist[k]);
        if (missing.length) throw badRequest(`Data belum lengkap: ${missing.join(', ')}`);
        const id = uuidv7();
        // Identitas sudah terverifikasi lewat KYC lama → tanpa review ulang: badge langsung aktif setelah data lengkap.
        if (await identityVerified(tx, uid)) {
          const r = (
            await tx.query(
              `INSERT INTO verification_requests (id, user_id, snapshot, status, reason, decided_at) VALUES ($1,$2,$3,'APPROVED',$4, now()) RETURNING *`,
              [id, uid, JSON.stringify(snapshotOf(u)), 'Otomatis: identitas sudah terverifikasi (KYC)'],
            )
          ).rows[0];
          await tx.query(`UPDATE users SET verified_at = now(), updated_at = now() WHERE id = $1`, [uid]);
          await publish(tx, 'iam.verification.decided', uid, { userId: uid, outcome: 'APPROVED', reason: null });
          await audit(tx, { actorId: uid, action: 'verification.auto_approved', entity: 'verification', entityId: id });
          return requestOut(r);
        }
        const r = (await tx.query(`INSERT INTO verification_requests (id, user_id, snapshot) VALUES ($1,$2,$3) RETURNING *`, [id, uid, JSON.stringify(snapshotOf(u))])).rows[0];
        await audit(tx, { actorId: uid, action: 'verification.submit', entity: 'verification', entityId: id });
        return requestOut(r);
      });
    });

    // Batalkan pengajuan yang masih menunggu (mis. ingin memperbaiki data dulu).
    me.delete('/v1/me/verification', async (req) => {
      const r = await db.query(`UPDATE verification_requests SET status = 'CANCELLED', decided_at = now() WHERE user_id = $1 AND status = 'PENDING' RETURNING id`, [req.user!.sub]);
      if (!r.length) throw notFound('Pengajuan verifikasi');
      return { cancelled: true };
    });
  });

  // ---- Back office ----
  app.register(async (a) => {
    a.addHook('preHandler', requireRole('admin'));

    a.get('/v1/admin/iam/verifications', { preHandler: requirePermission('users.verify') }, async (req) => {
      const q = req.query as { status?: string };
      const status = q.status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED'].includes(q.status) ? q.status : null;
      const rows = await db.query(
        `SELECT v.*, u.display_name AS current_name, u.email AS current_email, u.verified_at
           FROM verification_requests v JOIN users u ON u.id = v.user_id
          WHERE ($1::text IS NULL OR v.status = $1) AND u.deleted_at IS NULL
          ORDER BY v.status = 'PENDING' DESC, v.created_at ${status === 'PENDING' ? 'ASC' : 'DESC'} LIMIT 300`,
        [status],
      );
      return {
        data: rows.map((r) => ({ ...requestOut(r), user_id: r.user_id, snapshot: r.snapshot, display_name: r.current_name, email: r.current_email, verified: !!r.verified_at })),
      };
    });

    a.post('/v1/admin/iam/verifications/:id/decision', { preHandler: requirePermission('users.verify') }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Pengajuan verifikasi');
      const b = z.object({ approve: z.boolean(), reason: z.string().max(500).optional().nullable() }).parse(req.body);
      return db.tx(async (tx) => {
        const v = (await tx.query(`SELECT * FROM verification_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!v) throw notFound('Pengajuan verifikasi');
        if (v.status !== 'PENDING') throw conflict('Pengajuan sudah diputuskan');
        // Empat mata: admin tidak memutuskan pengajuan miliknya sendiri; penolakan wajib beralasan.
        if (v.user_id === req.user!.sub) throw forbidden('Anda tidak dapat memutuskan pengajuan verifikasi milik sendiri');
        const reason = (b.reason ?? '').trim() || null;
        if (!b.approve && (reason ?? '').length < 5) throw badRequest('Alasan penolakan wajib diisi (min. 5 karakter)');
        const u = (await tx.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [v.user_id])).rows[0];
        if (!u) throw notFound('Pengguna');
        if (b.approve) {
          // Data bisa berubah sejak diajukan → periksa ulang kelengkapan saat ini.
          const checklist = await verificationChecklist(tx, u);
          const missing = VERIFY_KEYS.filter((k) => !checklist[k]);
          if (missing.length) throw conflict(`Data pengguna kini tidak lengkap (${missing.join(', ')}) — tolak dengan alasan agar pengguna melengkapi.`);
          await tx.query(`UPDATE users SET verified_at = now(), verified_by = $2, updated_at = now() WHERE id = $1`, [u.id, req.user!.sub]);
          // Satu verifikasi: persetujuan ini sekaligus KYC identitas (syarat tarik dana, booking & event bertiket).
          if (!(await identityVerified(tx, u.id)) && u.id_number_enc)
            await tx.query(
              `INSERT INTO kyc_submissions (id, user_id, level, full_name, id_number_enc, id_number_masked, status, reason, decided_by, decided_at)
               VALUES ($1,$2,'INDIVIDUAL',$3,$4,$5,'VERIFIED','Verifikasi akun',$6, now())`,
              [uuidv7(), u.id, u.full_name, u.id_number_enc, u.id_number_masked, req.user!.sub],
            );
        }
        const status = b.approve ? 'APPROVED' : 'REJECTED';
        const r = (await tx.query(`UPDATE verification_requests SET status = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1 RETURNING *`, [id, status, reason, req.user!.sub])).rows[0];
        await publish(tx, 'iam.verification.decided', u.id, { userId: u.id, outcome: status, reason });
        await audit(tx, { actorId: req.user!.sub, action: `verification.${status.toLowerCase()}`, entity: 'verification', entityId: id, data: { userId: u.id, reason } });
        return requestOut(r);
      });
    });

    a.post('/v1/admin/iam/users/:id/verification/revoke', { preHandler: requirePermission('users.verify') }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Pengguna');
      const b = z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
      return db.tx(async (tx) => {
        const u = (await tx.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!u) throw notFound('Pengguna');
        if (!u.verified_at && !(await identityVerified(tx, id))) throw conflict('Akun ini tidak terverifikasi');
        await tx.query(`UPDATE users SET verified_at = NULL, verified_by = NULL, updated_at = now() WHERE id = $1`, [id]);
        // Satu verifikasi: mencabut verifikasi juga mencabut KYC identitas (tarik dana & event terkunci lagi).
        await tx.query(`UPDATE kyc_submissions SET status = 'REJECTED', reason = $2, decided_by = $3, decided_at = now() WHERE user_id = $1 AND status = 'VERIFIED'`, [
          id,
          `Dicabut: ${b.reason}`,
          req.user!.sub,
        ]);
        await tx.query(
          `UPDATE verification_requests SET status = 'REVOKED', reason = $2, decided_by = $3, decided_at = now()
            WHERE id = (SELECT id FROM verification_requests WHERE user_id = $1 AND status = 'APPROVED' ORDER BY decided_at DESC NULLS LAST LIMIT 1)`,
          [id, b.reason, req.user!.sub],
        );
        await publish(tx, 'iam.verification.decided', id, { userId: id, outcome: 'REVOKED', reason: b.reason });
        await audit(tx, { actorId: req.user!.sub, action: 'verification.revoke', entity: 'user', entityId: id, data: { reason: b.reason } });
        return buildMe(tx, id);
      });
    });
  });
}
