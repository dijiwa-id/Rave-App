import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  audit,
  badRequest,
  brandedEmail,
  config,
  DeliveryError,
  conflict,
  forbidden,
  HttpError,
  notFound,
  publish,
  requireAuth,
  sendEmail,
  sendWhatsApp,
  settings,
  slugify,
  unauthorized,
  uuidv7,
  z,
  type Client,
  type ServiceContext,
} from '@rave/service-kit';
import {
  buildMe,
  decrypt,
  encrypt,
  issueTokens,
  mask,
  normalizeDestination,
  orgOut,
  otpCode,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SEC,
  POLICY_VERSION,
  randomToken,
  sha256,
  type Q,
} from './core.js';
import { consumeLoginCode } from './oauth.js';
import { checkSecondFactor, clearMfa, completeLogin, MFA_MAX_ATTEMPTS, recoveryRemaining, replaceRecoveryCodes, USER_MFA_COLS } from './mfa.js';
import { newTotpSecret, otpauthUri, TOTP_LOCK_MIN, verifyTotp } from './totp.js';

const otpBody = z.object({ channel: z.enum(['email', 'whatsapp']), destination: z.string().min(5).max(200) });
const tokenBody = z.discriminatedUnion('grant_type', [
  z.object({ grant_type: z.literal('otp'), destination: z.string().min(5), code: z.string().regex(/^\d{6}$/) }),
  z.object({ grant_type: z.literal('refresh_token'), refresh_token: z.string().min(20) }),
  z.object({ grant_type: z.literal('oauth_code'), code: z.string().min(20).max(200) }),
  // Langkah kedua (2FA): selesaikan challenge dari faktor pertama dengan kode authenticator ATAU kode pemulihan.
  z.object({
    grant_type: z.literal('mfa'),
    mfa_token: z.string().min(20).max(200),
    code: z.string().regex(/^\d{6}$/).optional(),
    recovery_code: z.string().min(8).max(40).optional(),
  }),
]);
/** Kode authenticator 6 digit atau kode pemulihan — salah satu wajib (konfirmasi aksi sensitif 2FA). */
const factorBody = z
  .object({ code: z.string().regex(/^\d{6}$/, 'Kode harus 6 digit').optional(), recovery_code: z.string().min(8).max(40).optional() })
  .refine((b) => !!b.code !== !!b.recovery_code, 'Isi kode authenticator atau kode pemulihan');
const totpCodeBody = z.object({ code: z.string().regex(/^\d{6}$/, 'Kode harus 6 digit') });
const MFA_LOCKED = `Terlalu banyak kode salah. Coba lagi dalam ${TOTP_LOCK_MIN} menit.`;
const ORG_TYPES = ['ARTIST', 'MANAGEMENT', 'LABEL', 'PROMOTOR'] as const;

const ip = (req: FastifyRequest) => (req.headers['x-forwarded-for'] as string) ?? req.ip;

export async function uniqueSlug(q: Q, base: string): Promise<string> {
  const s = slugify(base) || 'org';
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? s : `${s}-${i + 1}`;
    if (!(await q.query(`SELECT 1 FROM orgs WHERE slug = $1`, [cand])).rows.length) return cand;
  }
  return `${s}-${randomToken().slice(0, 6).toLowerCase()}`;
}

/** Peran user di org dari DB (bukan dari JWT yang mungkin basi setelah org dibuat). */
async function dbOrgRole(q: Q, orgId: string, userId: string): Promise<string | null> {
  const r = await q.query(`SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`, [orgId, userId]);
  return r.rows[0]?.role ?? null;
}

/** member_added untuk anggota org manajemen ke setiap org artis yang dikelola (agar notifikasi menjangkau manajer). */
async function publishManagerAccess(tx: Client, managementOrgId: string, artistOrgId?: string) {
  const rels = await tx.query(
    `SELECT a.id, a.artist_id FROM management_artists ma JOIN orgs a ON a.id = ma.artist_org_id WHERE ma.management_org_id = $1 ${artistOrgId ? 'AND a.id = $2' : ''}`,
    artistOrgId ? [managementOrgId, artistOrgId] : [managementOrgId],
  );
  const members = await tx.query(`SELECT user_id, role FROM memberships WHERE org_id = $1`, [managementOrgId]);
  for (const a of rels.rows)
    for (const m of members.rows)
      await publish(tx, 'iam.org.member_added', a.id, { orgId: a.id, type: 'ARTIST', userId: m.user_id, role: 'ADMIN', artistId: a.artist_id });
}

export async function routes(app: FastifyInstance, { db }: ServiceContext) {
  const pool = db.pool as unknown as Q;

  // ---------------- Auth ----------------
  app.post('/v1/auth/otp', async (req) => {
    const b = otpBody.parse(req.body);
    const dest = normalizeDestination(b.channel, b.destination);
    if (b.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) throw badRequest('Email tidak valid');
    // Batas & kebijakan dari pengaturan platform (Super Admin).
    const provider = b.channel === 'email' || dest.includes('@') ? 'email' : 'whatsapp';
    const existing = await db.one(
      `SELECT u.suspended_at, u.admin_role FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = $1 AND i.subject = $2 AND u.deleted_at IS NULL`,
      [provider, dest],
    );
    if (existing?.suspended_at) throw forbidden('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
    if (!existing && !settings.bool('general.registrations_open')) throw forbidden('Pendaftaran akun baru sedang ditutup');
    const windowMin = settings.num('security.otp_window_minutes');
    const code = otpCode();
    // Hitung + terbitkan di bawah kunci per tujuan: permintaan paralel tidak bisa melewati batas per jendela.
    await db.tx(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('otp:' || $1::text))`, [dest]);
      const recent = (await tx.query(`SELECT count(*)::int AS n FROM otp_codes WHERE destination = $1 AND created_at > now() - make_interval(mins => $2)`, [dest, windowMin])).rows[0];
      // Khusus dev (NODE_ENV ≠ production): Super Admin tidak terkena batas OTP per jendela (mis. 15 menit) agar uji
      // Back Office tidak terkunci. Batas salah tebak kode (OTP_MAX_ATTEMPTS) & rate limit gateway tetap berlaku.
      const devSuperAdmin = config.isDev && existing?.admin_role === 'SUPER_ADMIN';
      if (!devSuperAdmin && (recent?.n ?? 0) >= settings.num('security.otp_max_per_window'))
        throw new HttpError(429, 'Too Many Requests', `Terlalu banyak permintaan OTP. Coba lagi dalam ${windowMin} menit.`);
      await tx.query(`INSERT INTO otp_codes (destination, channel, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`, [
        dest,
        b.channel,
        sha256(`${dest}:${code}`),
        OTP_TTL_SEC,
      ]);
    });
    // Kirim lewat adapter email / WhatsApp Business API (§11.9, EMAIL_PROVIDER / WHATSAPP_PROVIDER). Kode tidak pernah dicatat ke log.
    try {
      const mins = Math.round(OTP_TTL_SEC / 60);
      if (provider === 'email') {
        const m = brandedEmail({
          heading: 'Kode masuk RAVE',
          lines: [`Masukkan kode berikut untuk masuk ke RAVE. Berlaku ${mins} menit.`, 'Jangan bagikan kode ini kepada siapa pun, termasuk tim RAVE.'],
          code,
          footer: 'Tidak merasa meminta kode? Abaikan email ini — akunmu tetap aman.',
        });
        await sendEmail({ to: dest, subject: `${code} adalah kode masuk RAVE`, ...m, tag: 'otp' });
      } else {
        await sendWhatsApp({ to: dest, text: `${code} adalah kode masuk RAVE. Berlaku ${mins} menit. Jangan bagikan kode ini.`, otpCode: code });
      }
    } catch (e) {
      req.log.error({ dest: mask(dest), channel: provider, err: (e as Error).message }, 'OTP gagal dikirim');
      // Kode yang tidak terkirim dihapus agar tidak memakan kuota permintaan OTP pengguna.
      await db.query(`DELETE FROM otp_codes WHERE destination = $1 AND consumed_at IS NULL AND code_hash = $2`, [dest, sha256(`${dest}:${code}`)]);
      throw new HttpError(e instanceof DeliveryError && !e.retryable ? 502 : 503, e instanceof DeliveryError && !e.retryable ? 'Bad Gateway' : 'Service Unavailable', 'Kode belum dapat dikirim. Coba lagi sebentar lagi.');
    }
    req.log.info({ dest: mask(dest), channel: b.channel }, 'OTP diterbitkan');
    return { sent: true, expires_in: OTP_TTL_SEC, ...(config.isDev ? { dev_code: code } : {}) };
  });

  app.post('/v1/auth/token', async (req) => {
    const b = tokenBody.parse(req.body);
    if (b.grant_type === 'otp') {
      const dest = normalizeDestination(b.destination.includes('@') ? 'email' : 'whatsapp', b.destination);
      const otp = await db.one(
        `SELECT * FROM otp_codes WHERE destination = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
        [dest],
      );
      if (!otp) throw unauthorized('Kode OTP tidak ditemukan atau kedaluwarsa');
      // Pesan satu percobaan secara atomik SEBELUM membandingkan kode: tebakan paralel tidak bisa melewati batas.
      const reserved = await db.query(
        `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL RETURNING id`,
        [otp.id, OTP_MAX_ATTEMPTS],
      );
      if (!reserved.length) throw unauthorized('Terlalu banyak percobaan. Minta kode baru.');
      if (otp.code_hash !== sha256(`${dest}:${b.code}`)) throw unauthorized('Kode OTP salah');
      return db.tx(async (tx) => {
        // Klaim kode secara atomik (cegah pemakaian ganda paralel)
        const claimed = await tx.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [otp.id]);
        if (!claimed.rowCount) throw unauthorized('Kode OTP sudah dipakai');
        const provider = dest.includes('@') ? 'email' : 'whatsapp';
        let userId: string | undefined = (await tx.query(`SELECT user_id FROM identities WHERE provider = $1 AND subject = $2`, [provider, dest])).rows[0]?.user_id;
        if (!userId) {
          userId = uuidv7();
          const name = provider === 'email' ? dest.split('@')[0] : `Pengguna ${dest.slice(-4)}`;
          await tx.query(`INSERT INTO users (id, email, phone, display_name) VALUES ($1,$2,$3,$4)`, [
            userId,
            provider === 'email' ? dest : null,
            provider === 'whatsapp' ? dest : null,
            name,
          ]);
          await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ($1,$2,$3)`, [provider, dest, userId]);
          await publish(tx, 'iam.user.registered', userId, { userId, email: provider === 'email' ? dest : '', displayName: name });
          await audit(tx, { actorId: userId, action: 'user.register', entity: 'user', entityId: userId, ip: ip(req) });
        }
        const me = await buildMe(tx, userId);
        if (!me) throw forbidden('Akun telah dihapus');
        if (me.suspended_at) throw forbidden('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
        return completeLogin(tx, me);
      });
    }
    if (b.grant_type === 'mfa') {
      if (!!b.code === !!b.recovery_code) throw badRequest('Isi kode authenticator atau kode pemulihan');
      // Challenge & baris user dikunci: tebakan paralel diproses berurutan (batas salah kode & anti-replay tidak bisa dilewati).
      // Kegagalan dikembalikan (bukan dilempar) agar penghitung salah kode ikut ter-commit.
      const out = await db.tx(async (tx) => {
        const ch = (await tx.query(`SELECT * FROM mfa_challenges WHERE token_hash = $1 FOR UPDATE`, [sha256(b.mfa_token)])).rows[0];
        if (!ch || ch.consumed_at || new Date(ch.expires_at) < new Date() || ch.attempts >= MFA_MAX_ATTEMPTS) return { fail: 'expired' as const };
        await tx.query(`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
        const u = (await tx.query(`SELECT ${USER_MFA_COLS} FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [ch.user_id])).rows[0];
        if (!u?.totp_secret_enc) return { fail: 'expired' as const }; // 2FA dimatikan/di-reset di tengah jalan → masuk ulang
        const r = await checkSecondFactor(tx, u, b);
        if (!r.ok) {
          if (r.locked) req.log.warn({ userId: u.id }, '2FA dikunci sementara — terlalu banyak kode salah');
          return { fail: r.locked ? ('locked' as const) : ('bad' as const) };
        }
        await tx.query(`UPDATE mfa_challenges SET consumed_at = now() WHERE id = $1`, [ch.id]);
        if (r.method === 'recovery')
          await audit(tx, { actorId: u.id, action: 'user.mfa.recovery_used', entity: 'user', entityId: u.id, data: { remaining: await recoveryRemaining(tx, u.id) }, ip: ip(req) });
        const me = await buildMe(tx, u.id);
        if (!me) throw forbidden('Akun telah dihapus');
        if (me.suspended_at) throw forbidden('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
        return { tokens: await issueTokens(tx, me) };
      });
      if ('fail' in out) {
        if (out.fail === 'locked') throw new HttpError(429, 'Too Many Requests', MFA_LOCKED);
        // Judul khusus → klien kembali ke langkah faktor pertama.
        if (out.fail === 'expired') throw new HttpError(401, 'MFA Expired', 'Sesi verifikasi kedaluwarsa. Silakan masuk lagi.');
        throw unauthorized(b.code ? 'Kode authenticator salah' : 'Kode pemulihan salah atau sudah dipakai');
      }
      return out.tokens;
    }
    if (b.grant_type === 'oauth_code') {
      // Kode sekali pakai dari callback login sosial (oauth.ts) — diklaim atomik, berlaku 60 dtk.
      return db.tx(async (tx) => {
        const userId = await consumeLoginCode(tx, b.code);
        if (!userId) throw unauthorized('Kode masuk tidak valid atau kedaluwarsa. Coba masuk lagi.');
        const me = await buildMe(tx, userId);
        if (!me) throw forbidden('Akun telah dihapus');
        if (me.suspended_at) throw forbidden('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
        return completeLogin(tx, me);
      });
    }
    // refresh_token: rotasi + deteksi reuse (revoke seluruh family)
    const rt = await db.one(`SELECT * FROM refresh_tokens WHERE token_hash = $1`, [sha256(b.refresh_token)]);
    if (!rt) throw unauthorized('Refresh token tidak valid');
    const revokeFamily = async () => {
      await db.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`, [rt.family_id]);
      req.log.warn({ family: rt.family_id }, 'refresh token reuse terdeteksi — family dicabut');
      return unauthorized('Sesi tidak valid, silakan masuk lagi');
    };
    // Rotasi + penerbitan token baru dalam SATU transaksi: bila penerbitan gagal, token lama tetap berlaku
    // (retry klien bukan "reuse"). Baris dikunci → permintaan paralel berurutan; yang kalah terdeteksi sebagai reuse.
    const out = await db.tx(async (tx) => {
      const row = (await tx.query(`SELECT * FROM refresh_tokens WHERE id = $1 FOR UPDATE`, [rt.id])).rows[0];
      if (!row || row.rotated_at || row.revoked_at) return { reuse: true as const };
      if (new Date(row.expires_at) < new Date()) throw unauthorized('Sesi kedaluwarsa');
      await tx.query(`UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1`, [rt.id]);
      const me = await buildMe(tx, rt.user_id);
      if (!me) throw unauthorized('Akun tidak aktif');
      if (me.suspended_at) throw forbidden('Akun ini ditangguhkan');
      return { tokens: await issueTokens(tx, me, rt.family_id) };
    });
    if ('reuse' in out) throw await revokeFamily();
    return out.tokens;
  });

  app.post('/v1/auth/logout', async (req) => {
    const b = z.object({ refresh_token: z.string().optional().nullable() }).parse(req.body ?? {});
    if (b.refresh_token) {
      const rt = await db.one(`SELECT family_id FROM refresh_tokens WHERE token_hash = $1`, [sha256(b.refresh_token)]);
      if (rt) await db.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`, [rt.family_id]);
    }
    return { ok: true };
  });

  // ---------------- Waitlist (REQ-WEB-02) ----------------
  app.post('/v1/waitlist', async (req) => {
    const b = z
      .object({
        email: z.string().email(),
        name: z.string().max(120).optional(),
        segment: z.enum(['fan', 'artist', 'management', 'label', 'promotor']),
        city: z.string().max(80).optional().nullable(),
        consent_marketing: z.boolean(),
        referral_code: z.string().max(20).optional().nullable(),
      })
      .parse(req.body);
    const email = b.email.toLowerCase();
    return db.tx(async (tx) => {
      // Pendaftaran paralel dengan email sama: dikunci per email (bukan 500 karena unique violation).
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('waitlist:' || $1::text))`, [email]);
      const existing = (await tx.query(`SELECT * FROM waitlist WHERE email = $1`, [email])).rows[0];
      let row = existing;
      if (!row) {
        let code = '';
        for (let i = 0; i < 5; i++) {
          code = 'RAVE-' + randomToken().replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
          if (!(await tx.query(`SELECT 1 FROM waitlist WHERE referral_code = $1`, [code])).rows.length) break;
        }
        const referrer = b.referral_code ? (await tx.query(`SELECT referral_code FROM waitlist WHERE referral_code = $1`, [b.referral_code.toUpperCase()])).rows[0] : null;
        row = (
          await tx.query(
            `INSERT INTO waitlist (email, name, segment, city, consent_marketing, referral_code, referred_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [email, b.name ?? null, b.segment, b.city ?? null, b.consent_marketing, code, referrer?.referral_code ?? null],
          )
        ).rows[0];
        await publish(tx, 'iam.waitlist.joined', email, { email, segment: b.segment, city: b.city ?? null });
      }
      // Prioritas: tiap referral sukses memajukan 10 posisi.
      const pos = (await tx.query(`SELECT count(*)::int AS n FROM waitlist WHERE id <= $1`, [row.id])).rows[0].n;
      const refs = (await tx.query(`SELECT count(*)::int AS n FROM waitlist WHERE referred_by = $1`, [row.referral_code])).rows[0].n;
      return { position: Math.max(1, pos - refs * 10), referral_code: row.referral_code, referrals: refs };
    });
  });

  // ---------------- Me ----------------
  app.register(async (authed) => {
    authed.addHook('preHandler', requireAuth);

    authed.get('/v1/me', async (req) => {
      const me = await buildMe(pool, req.user!.sub);
      if (!me) throw notFound('Pengguna');
      return me;
    });

    authed.patch('/v1/me', async (req) => {
      const b = z
        .object({
          display_name: z.string().min(1).max(80).optional(),
          avatar_url: z.string().url().nullable().optional(),
          city: z.string().max(80).nullable().optional(),
          locale: z.enum(['id', 'en']).nullable().optional(),
          theme: z.enum(['light', 'dark', 'system']).nullable().optional(),
        })
        .parse(req.body);
      await db.query(
        `UPDATE users SET display_name = coalesce($2, display_name),
           avatar_url = CASE WHEN $3::boolean THEN $4 ELSE avatar_url END,
           city = CASE WHEN $5::boolean THEN $6 ELSE city END,
           locale = CASE WHEN $7::boolean THEN $8 ELSE locale END,
           theme = CASE WHEN $9::boolean THEN $10 ELSE theme END, updated_at = now() WHERE id = $1`,
        [req.user!.sub, b.display_name ?? null, 'avatar_url' in b, b.avatar_url ?? null, 'city' in b, b.city ?? null, 'locale' in b, b.locale ?? null, 'theme' in b, b.theme ?? null],
      );
      return buildMe(pool, req.user!.sub);
    });

    // ---------------- Verifikasi 2 langkah (2FA, aplikasi authenticator) ----------------
    authed.get('/v1/me/totp', async (req) => {
      const u = await db.one(`SELECT totp_enabled_at FROM users WHERE id = $1`, [req.user!.sub]);
      return {
        enabled: !!u?.totp_enabled_at,
        enabled_at: u?.totp_enabled_at ?? null,
        recovery_remaining: u?.totp_enabled_at ? await recoveryRemaining(pool, req.user!.sub) : 0,
      };
    });

    // Langkah 1: buat secret baru (disimpan sebagai "pending" sampai dikonfirmasi dengan kode dari aplikasi).
    authed.post('/v1/me/totp/setup', async (req) => {
      const u = await db.one(`SELECT email, phone, display_name, totp_enabled_at FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.user!.sub]);
      if (!u) throw notFound('Pengguna');
      if (u.totp_enabled_at) throw conflict('Verifikasi 2 langkah sudah aktif. Nonaktifkan dulu untuk mendaftarkan ulang.');
      const secret = newTotpSecret();
      await db.query(`UPDATE users SET totp_pending_enc = $2, updated_at = now() WHERE id = $1`, [req.user!.sub, encrypt(secret)]);
      return { secret, otpauth_uri: otpauthUri(secret, u.email ?? u.phone ?? u.display_name) };
    });

    // Langkah 2: konfirmasi dengan kode dari aplikasi → aktif + kode pemulihan (ditampilkan sekali).
    // Semua sesi lain dicabut (mis. sesi penyusup); perangkat ini menerima sesi baru di `session`.
    authed.post('/v1/me/totp/enable', async (req) => {
      const b = totpCodeBody.parse(req.body);
      return db.tx(async (tx) => {
        const u = (await tx.query(`SELECT totp_pending_enc, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE`, [req.user!.sub])).rows[0];
        if (u?.totp_enabled_at) throw conflict('Verifikasi 2 langkah sudah aktif');
        if (!u?.totp_pending_enc) throw badRequest('Mulai pendaftaran dulu (pindai kode QR)');
        const step = verifyTotp(decrypt(u.totp_pending_enc), b.code);
        if (step === null) throw badRequest('Kode tidak cocok. Pastikan jam ponsel otomatis lalu coba kode terbaru.');
        await tx.query(
          `UPDATE users SET totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_enabled_at = now(), totp_last_step = $2,
             totp_failures = 0, totp_locked_until = NULL, mfa_enabled = true, updated_at = now() WHERE id = $1`,
          [req.user!.sub, step],
        );
        const recovery_codes = await replaceRecoveryCodes(tx, req.user!.sub);
        await tx.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [req.user!.sub]);
        await audit(tx, { actorId: req.user!.sub, action: 'user.mfa.enable', entity: 'user', entityId: req.user!.sub, ip: ip(req) });
        const me = await buildMe(tx, req.user!.sub);
        if (!me) throw notFound('Pengguna');
        return { enabled: true, recovery_codes, session: await issueTokens(tx, me) };
      });
    });

    /** Konfirmasi aksi sensitif 2FA dengan kode authenticator / kode pemulihan (memakai batas salah kode yang sama). */
    async function confirmFactor(tx: Client, userId: string, body: unknown) {
      const b = factorBody.parse(body);
      const u = (await tx.query(`SELECT ${USER_MFA_COLS} FROM users WHERE id = $1 FOR UPDATE`, [userId])).rows[0];
      if (!u?.totp_secret_enc) return { error: badRequest('Verifikasi 2 langkah belum aktif') };
      const r = await checkSecondFactor(tx, u, b);
      if (!r.ok) return { error: r.locked ? new HttpError(429, 'Too Many Requests', MFA_LOCKED) : badRequest(b.code ? 'Kode authenticator salah' : 'Kode pemulihan salah atau sudah dipakai') };
      return { method: r.method };
    }

    // Buat ulang kode pemulihan (yang lama tidak berlaku lagi).
    authed.post('/v1/me/totp/recovery-codes', async (req) => {
      const out = await db.tx(async (tx) => {
        const c = await confirmFactor(tx, req.user!.sub, req.body);
        if ('error' in c) return c;
        const recovery_codes = await replaceRecoveryCodes(tx, req.user!.sub);
        await audit(tx, { actorId: req.user!.sub, action: 'user.mfa.recovery_regenerate', entity: 'user', entityId: req.user!.sub, ip: ip(req) });
        return { recovery_codes };
      });
      if ('error' in out) throw out.error;
      return out;
    });

    // Nonaktifkan: wajib kode authenticator / kode pemulihan (sesi yang dicuri saja tidak cukup).
    authed.post('/v1/me/totp/disable', async (req) => {
      const out = await db.tx(async (tx) => {
        const c = await confirmFactor(tx, req.user!.sub, req.body);
        if ('error' in c) return c;
        await clearMfa(tx, req.user!.sub);
        await audit(tx, { actorId: req.user!.sub, action: 'user.mfa.disable', entity: 'user', entityId: req.user!.sub, data: { method: c.method }, ip: ip(req) });
        return { enabled: false };
      });
      if ('error' in out) throw out.error;
      return out;
    });

    authed.post('/v1/me/onboarding', async (req) => {
      const b = z
        .object({
          city: z.string().min(2).max(80),
          genres: z.array(z.string().max(40)).max(20),
          artist_ids: z.array(z.string().uuid()).min(3, 'Pilih minimal 3 artis').max(50),
        })
        .parse(req.body);
      return db.tx(async (tx) => {
        await tx.query(`UPDATE users SET city = $2, genres = $3, onboarded = true, updated_at = now() WHERE id = $1`, [req.user!.sub, b.city, b.genres]);
        await publish(tx, 'iam.user.onboarded', req.user!.sub, { userId: req.user!.sub, city: b.city, genres: b.genres, artistIds: b.artist_ids });
        return buildMe(tx, req.user!.sub);
      });
    });

    // Hak subjek data: penghapusan akun mandiri (UU PDP)
    authed.delete('/v1/me', async (req) => {
      const id = req.user!.sub;
      await db.tx(async (tx) => {
        await tx.query(`DELETE FROM identities WHERE user_id = $1`, [id]);
        await tx.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [id]);
        await tx.query(
          `UPDATE users SET email = NULL, phone = NULL, display_name = 'Akun dihapus', avatar_url = NULL, city = NULL, genres = '{}',
           deleted_at = now() WHERE id = $1`,
          [id],
        );
        await clearMfa(tx, id);
        await tx.query(`DELETE FROM consents WHERE user_id = $1`, [id]);
        await audit(tx, { actorId: id, action: 'user.delete', entity: 'user', entityId: id, ip: ip(req) });
      });
      return { deleted: true };
    });

    authed.get('/v1/me/consents', async (req) => ({
      data: await db.query(`SELECT purpose, policy_version, granted, updated_at FROM consents WHERE user_id = $1 ORDER BY purpose`, [req.user!.sub]),
    }));
    authed.put('/v1/me/consents', async (req) => {
      const b = z.object({ purpose: z.enum(['marketing', 'personalization', 'ads', 'aggregate_sharing']), granted: z.boolean() }).parse(req.body);
      await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO consents (user_id, purpose, policy_version, granted) VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, purpose) DO UPDATE SET granted = $4, policy_version = $3, updated_at = now()`,
          [req.user!.sub, b.purpose, POLICY_VERSION, b.granted],
        );
        await audit(tx, { actorId: req.user!.sub, action: 'consent.update', entity: 'consent', entityId: b.purpose, data: b, ip: ip(req) });
      });
      return { data: await db.query(`SELECT purpose, policy_version, granted, updated_at FROM consents WHERE user_id = $1 ORDER BY purpose`, [req.user!.sub]) };
    });

    // ---------------- KYC (REQ-IAM-04) ----------------
    authed.post('/v1/me/kyc', async (req) => {
      const b = z
        .object({
          level: z.enum(['INDIVIDUAL', 'BUSINESS']),
          full_name: z.string().min(3).max(120),
          id_number: z.string().min(8).max(32),
          org_id: z.string().uuid().optional().nullable(),
          business_name: z.string().max(160).optional().nullable(),
          nib: z.string().max(40).optional().nullable(),
        })
        .parse(req.body);
      if (b.level === 'BUSINESS' && (!b.org_id || !b.nib)) throw badRequest('KYB memerlukan org_id dan NIB');
      if (b.org_id && !['OWNER', 'ADMIN'].includes((await dbOrgRole(pool, b.org_id, req.user!.sub)) ?? '')) throw forbidden('Hanya OWNER/ADMIN org');
      const pending = await db.one(`SELECT id FROM kyc_submissions WHERE user_id = $1 AND status = 'PENDING'`, [req.user!.sub]);
      if (pending) throw conflict('Masih ada pengajuan KYC yang menunggu review');
      return db.tx(async (tx) => {
        const id = uuidv7();
        const idn = b.id_number.replace(/\s/g, '');
        const r = (
          await tx.query(
            `INSERT INTO kyc_submissions (id, user_id, org_id, level, full_name, id_number_enc, id_number_masked, business_name, nib)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [id, req.user!.sub, b.org_id ?? null, b.level, b.full_name, encrypt(idn), mask(idn), b.business_name ?? null, b.nib ?? null],
          )
        ).rows[0];
        await audit(tx, { actorId: req.user!.sub, action: 'kyc.submit', entity: 'kyc', entityId: id, ip: ip(req) });
        return kycOut(r);
      });
    });
    authed.get('/v1/me/kyc', async (req) => {
      const r = await db.one(`SELECT * FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user!.sub]);
      return r ? kycOut(r) : null;
    });

    // ---------------- Organisasi (REQ-IAM-03) ----------------
    authed.post('/v1/orgs', async (req, reply) => {
      const b = z
        .object({
          type: z.enum(ORG_TYPES),
          name: z.string().min(2).max(120),
          city: z.string().max(80).optional().nullable(),
          genres: z.array(z.string().max(40)).max(10).optional(),
        })
        .parse(req.body);
      const org = await db.tx(async (tx) => {
        const id = uuidv7();
        const artistId = b.type === 'ARTIST' ? uuidv7() : null;
        const slug = await uniqueSlug(tx, b.name);
        const o = (
          await tx.query(`INSERT INTO orgs (id, type, name, slug, city, genres, artist_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
            id,
            b.type,
            b.name,
            slug,
            b.city ?? null,
            b.genres ?? [],
            artistId,
          ])
        ).rows[0];
        await tx.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'OWNER')`, [id, req.user!.sub]);
        await publish(tx, 'iam.org.created', id, { orgId: id, type: b.type, name: b.name, ownerUserId: req.user!.sub, artistId });
        await audit(tx, { actorId: req.user!.sub, action: 'org.create', entity: 'org', entityId: id, data: { type: b.type, name: b.name }, ip: ip(req) });
        return o;
      });
      reply.status(201);
      return orgOut(org);
    });

    authed.get('/v1/orgs/:id', async (req) => {
      const { id } = req.params as { id: string };
      const o = await db.one(`SELECT * FROM orgs WHERE id = $1`, [id]);
      if (!o) throw notFound('Organisasi');
      const isAdmin = req.user!.roles.includes('admin');
      const role = await dbOrgRole(pool, id, req.user!.sub);
      const managed = await db.one(
        `SELECT 1 FROM management_artists ma JOIN memberships m ON m.org_id = ma.management_org_id WHERE ma.artist_org_id = $1 AND m.user_id = $2`,
        [id, req.user!.sub],
      );
      if (!isAdmin && !role && !managed) throw forbidden('Bukan anggota organisasi ini');
      const members = await db.query(
        `SELECT u.id AS user_id, u.display_name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at`,
        [id],
      );
      const managedArtists = await db.query(
        `SELECT a.id, a.name, a.artist_id FROM management_artists ma JOIN orgs a ON a.id = ma.artist_org_id WHERE ma.management_org_id = $1`,
        [id],
      );
      const managers = await db.query(
        `SELECT mo.id, mo.name FROM management_artists ma JOIN orgs mo ON mo.id = ma.management_org_id WHERE ma.artist_org_id = $1`,
        [id],
      );
      return { ...orgOut(o), members, managed_artists: managedArtists, managed_by: managers };
    });

    authed.post('/v1/orgs/:id/members', async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'FINANCE', 'MEMBER', 'VIEWER']) }).parse(req.body);
      const myRole = await dbOrgRole(pool, id, req.user!.sub);
      // Admin back office tidak menambah anggota org (mencegah menyusup ke wallet org — audit go-live A1).
      if (!['OWNER', 'ADMIN'].includes(myRole ?? '')) throw forbidden('Hanya OWNER/ADMIN yang dapat mengundang anggota');
      const member = await db.tx(async (tx) => {
        const org = (await tx.query(`SELECT * FROM orgs WHERE id = $1`, [id])).rows[0];
        if (!org) throw notFound('Organisasi');
        const email = b.email.toLowerCase();
        let user = (await tx.query(`SELECT id, display_name, email FROM users WHERE email = $1 AND deleted_at IS NULL`, [email])).rows[0];
        if (!user) {
          // Undangan: buat akun bayangan; pemilik email cukup login OTP untuk mengaktifkan.
          const uid = uuidv7();
          user = (await tx.query(`INSERT INTO users (id, email, display_name) VALUES ($1,$2,$3) RETURNING id, display_name, email`, [uid, email, email.split('@')[0]])).rows[0];
          await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ('email',$1,$2)`, [email, uid]);
        }
        // Undangan tidak boleh menurunkan/menaikkan pihak yang setara atau lebih tinggi: OWNER tidak pernah diubah lewat sini,
        // dan ADMIN org hanya boleh mengubah peran anggota di bawahnya (admin platform dikecualikan).
        const current = (await tx.query(`SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 FOR UPDATE`, [id, user.id])).rows[0];
        if (current?.role === 'OWNER') throw forbidden('Peran OWNER tidak dapat diubah lewat undangan');
        if (current?.role === 'ADMIN' && myRole !== 'OWNER' && !req.user!.roles.includes('admin')) throw forbidden('Hanya OWNER yang dapat mengubah peran ADMIN lain');
        const ins = await tx.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO UPDATE SET role = $3 RETURNING created_at`, [
          id,
          user.id,
          b.role,
        ]);
        await publish(tx, 'iam.org.member_added', id, { orgId: id, type: org.type, userId: user.id, role: b.role, artistId: org.artist_id });
        if (org.type === 'MANAGEMENT') {
          const rels = await tx.query(`SELECT a.id, a.artist_id FROM management_artists ma JOIN orgs a ON a.id = ma.artist_org_id WHERE ma.management_org_id = $1`, [id]);
          for (const a of rels.rows)
            await publish(tx, 'iam.org.member_added', a.id, { orgId: a.id, type: 'ARTIST', userId: user.id, role: 'ADMIN', artistId: a.artist_id });
        }
        await audit(tx, { actorId: req.user!.sub, action: 'org.member.add', entity: 'org', entityId: id, data: { user_id: user.id, role: b.role }, ip: ip(req) });
        return { user_id: user.id, display_name: user.display_name, email: user.email, role: b.role, created_at: ins.rows[0].created_at };
      });
      reply.status(201);
      return member;
    });

    // Manajemen mengelola artis: requester harus OWNER/ADMIN di kedua org (persetujuan pihak artis).
    authed.post('/v1/orgs/:id/manage-artist', async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = z.object({ artist_org_id: z.string().uuid() }).parse(req.body);
      const isAdmin = req.user!.roles.includes('superadmin'); // relasi manajemen↔artis memberi akses wallet: hanya Super Admin yang boleh melewati persetujuan
      const out = await db.tx(async (tx) => {
        const mgmt = (await tx.query(`SELECT * FROM orgs WHERE id = $1`, [id])).rows[0];
        const art = (await tx.query(`SELECT * FROM orgs WHERE id = $1`, [b.artist_org_id])).rows[0];
        if (!mgmt || mgmt.type !== 'MANAGEMENT') throw badRequest('Org bukan MANAGEMENT');
        if (!art || art.type !== 'ARTIST') throw badRequest('Org target bukan ARTIST');
        if (!isAdmin) {
          if ((await dbOrgRole(tx, id, req.user!.sub)) !== 'OWNER') throw forbidden('Hanya OWNER manajemen');
          if (!['OWNER', 'ADMIN'].includes((await dbOrgRole(tx, b.artist_org_id, req.user!.sub)) ?? ''))
            throw forbidden('Persetujuan OWNER/ADMIN org artis diperlukan');
        }
        await tx.query(`INSERT INTO management_artists (management_org_id, artist_org_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, b.artist_org_id]);
        await publishManagerAccess(tx, id, b.artist_org_id);
        await audit(tx, { actorId: req.user!.sub, action: 'org.manage_artist', entity: 'org', entityId: id, data: b, ip: ip(req) });
        return { management_org_id: id, artist_org_id: b.artist_org_id, artist_id: art.artist_id };
      });
      reply.status(201);
      return out;
    });
  });
}

export function kycOut(r: any) {
  return {
    id: r.id,
    user_id: r.user_id,
    org_id: r.org_id,
    level: r.level,
    full_name: r.full_name,
    id_number_masked: r.id_number_masked,
    business_name: r.business_name,
    nib: r.nib,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}
