import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, verify as verifySig, type JsonWebKey } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { enabledSocialProviders, type SocialProvider } from '@rave/domain/integrations';
import { audit, badRequest, config, publicWebUrl, forbidden, getIntegration, HttpError, publish, settings, uuidv7, z, type Client, type ServiceContext } from '@rave/service-kit';
import { buildMe, sha256 } from './core.js';
import { completeLogin } from './mfa.js';

/**
 * Login sosial (TDD §IAM, identities.provider = google | facebook | apple).
 *
 *   GET  /v1/auth/oauth/providers            → provider aktif (publik) — tombol di halaman Masuk
 *   GET  /v1/auth/oauth/:provider/start      → 302 ke provider (state + PKCE + nonce, cookie pengikat browser)
 *   GET|POST /v1/auth/oauth/:provider/callback → tukar kode di server, cari/buat akun, 302 ke web
 *                                               /login?oauth_code=… (kode sekali pakai 60 dtk)
 *   POST /v1/auth/token {grant_type:'oauth_code'} → token (routes.ts)
 *   POST /v1/auth/oauth/:provider/app → peluncuran untuk aplikasi desktop/mobile (browser sistem + konfirmasi kode)
 *   POST /v1/auth/oauth/poll {poll_token} → 428 authorization_pending | 200 TokenResponse | 400 gagal | 410 kedaluwarsa
 *   POST /v1/auth/oauth/google/native {id_token} → login Google native aplikasi mobile (Credential Manager Android):
 *        ID token diverifikasi (tanda tangan JWKS Google, aud = Client ID web, iss, exp) → TokenResponse | tantangan 2FA
 *
 * Kredensial: Super Admin → Platform → Integrasi → "Login sosial" (rahasia terenkripsi), cadangan env dengan nama
 * field yang sama (GOOGLE_CLIENT_ID, …). Provider `dev` (simulasi, tanpa pihak ketiga) hanya ada di development.
 * Akun ditautkan lewat email TERVERIFIKASI dari provider; tanpa email terverifikasi dibuat akun baru.
 */

export type OAuthProvider = SocialProvider | 'dev';
const ALL: OAuthProvider[] = ['google', 'facebook', 'apple', 'dev'];
const FLOW_TTL_SEC = 600;
const CODE_TTL_SEC = 60;
const COOKIE = 'rave_oauth';
const COOKIE_PATH = '/v1/auth/oauth';

const webBase = publicWebUrl;
const redirectUri = (p: OAuthProvider) => `${webBase()}/v1/auth/oauth/${p}/callback`;
const devProviderOn = () => config.isDev && process.env.OAUTH_DEV_PROVIDER !== '0';
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const token = () => randomBytes(32).toString('base64url');

class OAuthFail extends Error {}

/** Pembaca kredensial: dasbor (bila provider "oauth" tersimpan) → env. */
async function credentials(): Promise<(k: string) => string | undefined> {
  const integ = await getIntegration('social');
  if (integ) {
    if (integ.provider !== 'oauth') return () => undefined; // "Nonaktif" di dasbor mengalahkan env
    return (k) => integ.secrets[k] || integ.config[k] || undefined;
  }
  return (k) => process.env[k] || undefined;
}

export async function enabledProviders(): Promise<OAuthProvider[]> {
  const get = await credentials();
  return [...enabledSocialProviders(get), ...(devProviderOn() ? (['dev'] as const) : [])];
}

/** Path tujuan setelah login: hanya path relatif di origin web (cegah open redirect). */
function safeNext(v: unknown): string | null {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.length > 500) return null;
  return v;
}

function cookieFlags(): string {
  // Apple mengirim callback lewat POST lintas situs (form_post) → butuh SameSite=None; Secure.
  // Browser menerima Secure di https dan di http://localhost / 127.0.0.1; selain itu (http LAN) pakai Lax.
  const u = new URL(webBase());
  const secureOk = u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return `Path=${COOKIE_PATH}; HttpOnly; ${secureOk ? 'SameSite=None; Secure' : 'SameSite=Lax'}`;
}
function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function toLogin(reply: FastifyReply, params: Record<string, string | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  reply.header('set-cookie', `${COOKIE}=; ${cookieFlags()}; Max-Age=0`);
  return reply.redirect(`${webBase()}/login?${qs}`, 302);
}

// ---------------- Adapter provider ----------------

interface Profile {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

function decodeJwt(jwt: string): Record<string, any> {
  const part = jwt.split('.')[1];
  if (!part) throw new OAuthFail('id_token tidak valid');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new OAuthFail(`Penukaran kode gagal (${r.status}${j?.error ? `: ${j.error}` : ''})`);
  return j;
}

/** p8 Apple boleh ditempel satu baris / tanpa header → bangun ulang PEM. */
export function normalizePem(raw: string): string {
  const body = raw
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END PRIVATE KEY-----\n`;
}

/** client_secret Apple = JWT ES256 yang ditandatangani kunci .p8 (berlaku 5 menit). */
export function appleClientSecret(get: (k: string) => string | undefined): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: get('APPLE_KEY_ID') }));
  const payload = b64url(JSON.stringify({ iss: get('APPLE_TEAM_ID'), iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: get('APPLE_SERVICES_ID') }));
  const key = createPrivateKey(normalizePem(get('APPLE_PRIVATE_KEY') ?? ''));
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

function devSign(payload: string) {
  return createHmac('sha256', `${config.jwtSecret}:oauth-dev`).update(payload).digest('base64url');
}

function authorizeUrl(p: OAuthProvider, get: (k: string) => string | undefined, f: { state: string; nonce: string; verifier: string }): string {
  const challenge = b64url(createHash('sha256').update(f.verifier).digest());
  const u = (base: string, q: Record<string, string>) => `${base}?${new URLSearchParams(q)}`;
  switch (p) {
    case 'google':
      return u('https://accounts.google.com/o/oauth2/v2/auth', {
        client_id: get('GOOGLE_CLIENT_ID')!,
        redirect_uri: redirectUri(p),
        response_type: 'code',
        scope: 'openid email profile',
        state: f.state,
        nonce: f.nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
    case 'facebook':
      return u('https://www.facebook.com/v19.0/dialog/oauth', {
        client_id: get('FACEBOOK_APP_ID')!,
        redirect_uri: redirectUri(p),
        response_type: 'code',
        scope: 'email,public_profile',
        state: f.state,
      });
    case 'apple':
      return u('https://appleid.apple.com/auth/authorize', {
        client_id: get('APPLE_SERVICES_ID')!,
        redirect_uri: redirectUri(p),
        response_type: 'code',
        response_mode: 'form_post',
        scope: 'name email',
        state: f.state,
        nonce: f.nonce,
      });
    case 'dev':
      // Relatif: browser tetap di host yang dipakai memulai (localhost web, IP LAN dari ponsel, …).
      return `/v1/auth/oauth/dev/authorize?${new URLSearchParams({ state: f.state })}`;
  }
}

async function exchange(p: OAuthProvider, get: (k: string) => string | undefined, code: string, flow: { verifier: string; nonce: string }, extra: Record<string, any>): Promise<Profile> {
  if (p === 'google') {
    const t = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: get('GOOGLE_CLIENT_ID')!,
      client_secret: get('GOOGLE_CLIENT_SECRET')!,
      redirect_uri: redirectUri(p),
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    });
    // id_token diterima langsung dari endpoint token Google lewat TLS (OIDC Core §3.1.3.7) → klaim tepercaya; cek aud/iss/nonce/exp.
    const c = decodeJwt(t.id_token ?? '');
    if (c.aud !== get('GOOGLE_CLIENT_ID') || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss)) throw new OAuthFail('id_token Google tidak cocok');
    if (c.nonce !== flow.nonce) throw new OAuthFail('Nonce tidak cocok');
    if (c.exp * 1000 < Date.now()) throw new OAuthFail('id_token kedaluwarsa');
    return { sub: String(c.sub), email: c.email, emailVerified: c.email_verified === true || c.email_verified === 'true', name: c.name, picture: c.picture };
  }
  if (p === 'facebook') {
    const secret = get('FACEBOOK_APP_SECRET')!;
    const q = new URLSearchParams({ client_id: get('FACEBOOK_APP_ID')!, client_secret: secret, redirect_uri: redirectUri(p), code });
    const tr = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${q}`, { signal: AbortSignal.timeout(10_000) });
    const t: any = await tr.json().catch(() => ({}));
    if (!tr.ok || !t.access_token) throw new OAuthFail(`Penukaran kode Facebook gagal (${tr.status})`);
    const proof = createHmac('sha256', secret).update(t.access_token).digest('hex');
    const mr = await fetch(`https://graph.facebook.com/v19.0/me?${new URLSearchParams({ fields: 'id,name,email,picture.type(large)', access_token: t.access_token, appsecret_proof: proof })}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const m: any = await mr.json().catch(() => ({}));
    if (!mr.ok || !m.id) throw new OAuthFail('Profil Facebook tidak dapat dibaca');
    // Graph API hanya mengembalikan email yang sudah dikonfirmasi pemilik akun.
    return { sub: String(m.id), email: m.email, emailVerified: !!m.email, name: m.name, picture: m.picture?.data?.url };
  }
  if (p === 'apple') {
    const t = await postForm('https://appleid.apple.com/auth/token', {
      code,
      client_id: get('APPLE_SERVICES_ID')!,
      client_secret: appleClientSecret(get),
      redirect_uri: redirectUri(p),
      grant_type: 'authorization_code',
    });
    const c = decodeJwt(t.id_token ?? '');
    if (c.aud !== get('APPLE_SERVICES_ID') || c.iss !== 'https://appleid.apple.com') throw new OAuthFail('id_token Apple tidak cocok');
    if (c.nonce && c.nonce !== flow.nonce) throw new OAuthFail('Nonce tidak cocok');
    // Nama hanya dikirim Apple pada login PERTAMA, sebagai field form `user` (JSON).
    let name: string | undefined;
    try {
      const u = typeof extra.user === 'string' ? JSON.parse(extra.user) : extra.user;
      name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(' ') || undefined;
    } catch {
      /* abaikan */
    }
    return { sub: String(c.sub), email: c.email, emailVerified: c.email_verified === true || c.email_verified === 'true', name };
  }
  // dev: kode = payload JSON bertanda tangan HMAC dari halaman simulasi.
  const [payload, sig] = code.split('.');
  const want = devSign(payload ?? '');
  if (!payload || !sig || sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw new OAuthFail('Kode simulasi tidak valid');
  const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return { sub: `dev:${d.email}`, email: d.email, emailVerified: true, name: d.name || undefined };
}

// ---------------- Login Google native (aplikasi mobile) ----------------

/**
 * ID token dari perangkat (Credential Manager Android / Google Sign-In) TIDAK datang dari endpoint token Google lewat
 * TLS server-ke-server, jadi tanda tangannya wajib diverifikasi dengan kunci publik Google (JWKS, di-cache sesuai
 * Cache-Control). Aplikasi meminta token dengan `serverClientId` = Client ID web → aud = GOOGLE_CLIENT_ID.
 */
type Jwks = { keys: (JsonWebKey & { kid?: string; alg?: string })[] };
let jwksCache: { at: number; maxAge: number; jwks: Jwks } | null = null;
export async function googleJwks(fetcher: typeof fetch = fetch): Promise<Jwks> {
  if (jwksCache && Date.now() - jwksCache.at < jwksCache.maxAge) return jwksCache.jwks;
  const r = await fetcher('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new OAuthFail(`Kunci publik Google tidak dapat diambil (${r.status})`);
  const jwks = (await r.json()) as Jwks;
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '')?.[1] ?? 3600) * 1000;
  jwksCache = { at: Date.now(), maxAge: Math.min(Math.max(maxAge, 60_000), 24 * 3600_000), jwks };
  return jwks;
}

export async function verifyGoogleIdToken(idToken: string, audiences: string[], jwks: Jwks, now = Date.now()): Promise<Profile> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OAuthFail('ID token Google tidak valid');
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256') throw new OAuthFail('Algoritma ID token Google tidak didukung');
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new OAuthFail('Kunci ID token Google tidak dikenal — coba lagi');
  const ok = verifySig('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) throw new OAuthFail('Tanda tangan ID token Google tidak sah');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(c.iss)) throw new OAuthFail('Penerbit ID token bukan Google');
  if (!audiences.filter(Boolean).includes(c.aud)) throw new OAuthFail('ID token bukan untuk aplikasi RAVE');
  if (typeof c.exp !== 'number' || c.exp * 1000 < now - 60_000) throw new OAuthFail('ID token Google kedaluwarsa');
  if (typeof c.iat === 'number' && c.iat * 1000 > now + 5 * 60_000) throw new OAuthFail('ID token Google belum berlaku');
  return { sub: String(c.sub), email: c.email, emailVerified: c.email_verified === true || c.email_verified === 'true', name: c.name, picture: c.picture };
}

// ---------------- Akun ----------------

/** Cari / tautkan / buat akun untuk profil provider. Mengembalikan user id. */
export async function resolveUser(tx: Client, provider: OAuthProvider, p: Profile, ip: string): Promise<string> {
  const subject = p.sub;
  const email = p.email?.trim().toLowerCase();
  const byIdentity = (await tx.query(`SELECT user_id FROM identities WHERE provider = $1 AND subject = $2`, [provider, subject])).rows[0]?.user_id as string | undefined;
  if (byIdentity) return byIdentity;

  if (email && p.emailVerified) {
    const existing = (
      await tx.query(
        `SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND (u.email = $1 OR u.id IN (SELECT user_id FROM identities WHERE provider = 'email' AND subject = $1)) LIMIT 1`,
        [email],
      )
    ).rows[0]?.id as string | undefined;
    if (existing) {
      await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [provider, subject, existing]);
      await audit(tx, { actorId: existing, action: 'identity.link', entity: 'user', entityId: existing, data: { provider }, ip });
      return existing;
    }
  }

  if (!settings.bool('general.registrations_open')) throw new OAuthFail('Pendaftaran akun baru sedang ditutup');
  const userId = uuidv7();
  // Email belum terverifikasi tidak disimpan sebagai email akun (bisa milik orang lain).
  const verifiedEmail = email && p.emailVerified ? email : null;
  const name = (p.name?.trim() || verifiedEmail?.split('@')[0] || 'Pendengar RAVE').slice(0, 80);
  const avatar = p.picture && /^https:\/\//.test(p.picture) ? p.picture : null;
  await tx.query(`INSERT INTO users (id, email, display_name, avatar_url) VALUES ($1,$2,$3,$4)`, [userId, verifiedEmail, name, avatar]);
  await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ($1,$2,$3)`, [provider, subject, userId]);
  // Email terverifikasi juga jadi identitas OTP → akun yang sama bisa masuk lewat kode email.
  if (verifiedEmail) await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ('email',$1,$2) ON CONFLICT DO NOTHING`, [verifiedEmail, userId]);
  await publish(tx, 'iam.user.registered', userId, { userId, email: verifiedEmail ?? '', displayName: name });
  await audit(tx, { actorId: userId, action: 'user.register', entity: 'user', entityId: userId, data: { provider }, ip });
  return userId;
}

/** Tukar kode sekali pakai → user id (dipakai grant_type=oauth_code). */
export async function consumeLoginCode(tx: Client, code: string): Promise<string | null> {
  const r = await tx.query(
    `UPDATE oauth_login_codes SET consumed_at = now() WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING user_id`,
    [sha256(code)],
  );
  return (r.rows[0]?.user_id as string | undefined) ?? null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAGE_CSS = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a0c;color:#ededed;font:15px/1.5 system-ui,sans-serif}
.c{width:min(380px,calc(100vw - 32px));border:2px solid #ededed;padding:24px;box-shadow:6px 6px 0 #f4c21f;background:#181818;text-align:center}
h1{margin:0 0 6px;font-size:20px;letter-spacing:.04em;text-transform:uppercase}p{margin:0 0 14px;color:#a7a39b;font-size:14px}
.code{display:inline-block;margin:6px 0 16px;padding:8px 14px;border:2px dashed #f4c21f;font:700 22px/1 ui-monospace,monospace;letter-spacing:.18em;color:#f4c21f}
a.b{display:block;padding:11px;border:2px solid #0b0a0c;background:#f4c21f;color:#181818;font-weight:800;text-decoration:none}
a.x{display:block;margin-top:12px;color:#a7a39b;font-size:13px}`;
function page(reply: FastifyReply, title: string, body: string, status = 200) {
  reply.code(status).type('text/html; charset=utf-8').header('cache-control', 'no-store');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · RAVE</title><style>${PAGE_CSS}</style></head><body><div class="c">${body}</div></body></html>`;
}
const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: 'Google', facebook: 'Facebook', apple: 'Apple', dev: 'Simulasi (dev)' };
const CLIENT_LABEL: Record<string, string> = { desktop: 'RAVE Desktop', mobile: 'RAVE Mobile' };
const APP_TTL_SEC = 600;
/** Kode pencocokan 8 karakter tanpa huruf/angka yang mirip (0/O, 1/I). */
function userCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  const c = [...b].map((x) => A[x % A.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Status peluncuran aplikasi untuk polling. `done` → diklaim sekali menjadi `consumed`. */
export async function pollAppLaunch(tx: Client, pollToken: string): Promise<{ status: 'pending' | 'error' | 'expired' | 'invalid'; error?: string } | { status: 'done'; userId: string }> {
  const r = (await tx.query(`SELECT * FROM oauth_app_launches WHERE poll_hash = $1 FOR UPDATE`, [sha256(pollToken)])).rows[0];
  if (!r || r.status === 'consumed') return { status: 'invalid' };
  if (r.status === 'error') {
    await tx.query(`DELETE FROM oauth_app_launches WHERE poll_hash = $1`, [r.poll_hash]);
    return { status: 'error', error: r.error ?? 'Login sosial gagal' };
  }
  if (new Date(r.expires_at) < new Date()) return { status: 'expired' };
  if (r.status === 'pending') return { status: 'pending' };
  await tx.query(`UPDATE oauth_app_launches SET status = 'consumed' WHERE poll_hash = $1`, [r.poll_hash]);
  return { status: 'done', userId: r.user_id };
}

export async function oauthRoutes(app: FastifyInstance, { db }: ServiceContext) {
  const providerParam = z.object({ provider: z.enum(ALL as [OAuthProvider, ...OAuthProvider[]]) });
  const clientIp = (req: FastifyRequest) => (req.headers['x-forwarded-for'] as string) ?? req.ip;

  app.get('/v1/auth/oauth/providers', async () => {
    const providers = await enabledProviders();
    // Client ID web (publik) = `serverClientId` login Google native di aplikasi mobile.
    const googleClientId = providers.includes('google') ? (await credentials())('GOOGLE_CLIENT_ID') ?? null : null;
    return { providers, google_client_id: googleClientId };
  });

  /** Login Google native (aplikasi mobile): ID token dari lembar akun Google sistem → sesi RAVE (atau tantangan 2FA). */
  app.post('/v1/auth/oauth/google/native', async (req) => {
    const b = z.object({ id_token: z.string().min(100).max(8000), client: z.enum(['mobile']).default('mobile') }).parse(req.body ?? {});
    if (!(await enabledProviders()).includes('google')) throw new HttpError(404, 'Not Found', 'Login Google belum diaktifkan.');
    const get = await credentials();
    let profile: Profile;
    try {
      profile = await verifyGoogleIdToken(b.id_token, [get('GOOGLE_CLIENT_ID')!, ...(get('GOOGLE_ANDROID_CLIENT_IDS') ?? '').split(',').map((x) => x.trim())], await googleJwks());
    } catch (e) {
      if (e instanceof OAuthFail) throw new HttpError(401, 'Unauthorized', e.message);
      throw e;
    }
    return db.tx(async (tx) => {
      let userId: string;
      try {
        userId = await resolveUser(tx, 'google', profile, clientIp(req));
      } catch (e) {
        if (e instanceof OAuthFail) throw forbidden(e.message);
        throw e;
      }
      const me = await buildMe(tx, userId);
      if (!me) throw forbidden('Akun telah dihapus');
      if (me.suspended_at) throw forbidden('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
      await audit(tx, { actorId: userId, action: 'user.login.social', entity: 'user', entityId: userId, data: { provider: 'google', client: b.client, native: true }, ip: clientIp(req) });
      return completeLogin(tx, me);
    });
  });

  /**
   * Aplikasi desktop/mobile: buat peluncuran → buka `start_path` (relatif ke server yang dipakai aplikasi) di browser
   * sistem → polling POST /v1/auth/oauth/poll {poll_token} tiap `interval` detik.
   */
  app.post('/v1/auth/oauth/:provider/app', async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    const { client } = z.object({ client: z.enum(['desktop', 'mobile']) }).parse(req.body ?? {});
    if (!(await enabledProviders()).includes(provider)) return reply.code(404).send({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Metode masuk ini belum diaktifkan.' });
    const launch = token();
    const poll = token();
    const code = userCode();
    await db.query(
      `INSERT INTO oauth_app_launches (launch_hash, poll_hash, provider, client, user_code, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))`,
      [sha256(launch), sha256(poll), provider, client, code, APP_TTL_SEC],
    );
    return { start_path: `/v1/auth/oauth/${provider}/start?${new URLSearchParams({ app: launch })}`, poll_token: poll, user_code: code, expires_in: APP_TTL_SEC, interval: 2 };
  });

  // Polling aplikasi (gaya RFC 8628 §3.5) — endpoint terpisah dari /v1/auth/token agar tidak terkena rate limit kelas OTP.
  app.post('/v1/auth/oauth/poll', async (req) => {
    const { poll_token } = z.object({ poll_token: z.string().min(20).max(200) }).parse(req.body ?? {});
    const out = await db.tx(async (tx) => {
      const r = await pollAppLaunch(tx, poll_token);
      if (r.status !== 'done') return r;
      const me = await buildMe(tx, r.userId);
      if (!me) throw forbidden('Akun telah dihapus');
      if (me.suspended_at) throw forbidden('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
      // Akun ber-2FA: aplikasi menerima challenge {mfa_required, mfa_token} → selesaikan via /v1/auth/token grant_type=mfa.
      return { status: 'done' as const, tokens: await completeLogin(tx, me) };
    });
    if (out.status === 'done') return out.tokens;
    if (out.status === 'pending') throw new HttpError(428, 'authorization_pending', 'Menunggu login di browser');
    if (out.status === 'error') throw badRequest(out.error ?? 'Login sosial gagal');
    throw new HttpError(410, 'expired_token', 'Sesi masuk kedaluwarsa. Mulai lagi dari aplikasi.');
  });

  app.get('/v1/auth/oauth/:provider/start', async (req, reply) => {
    const parsed = providerParam.safeParse(req.params);
    const q = req.query as Record<string, string | undefined>;
    const next = safeNext(q.next);
    const intent = typeof q.intent === 'string' && /^[a-z]{2,20}$/.test(q.intent) ? q.intent : null;
    if (!parsed.success || !(await enabledProviders()).includes(parsed.data.provider)) return toLogin(reply, { oauth_error: 'Metode masuk ini belum diaktifkan.', next });
    const provider = parsed.data.provider;
    const get = await credentials();
    const f = { state: token(), nonce: token(), verifier: token() };
    // Peluncuran dari aplikasi: konfirmasi dulu di browser (kode pencocokan) — cegah tautan masuk yang dikirim orang lain.
    let appLaunch: string | null = null;
    if (typeof q.app === 'string') {
      const l = (await db.query(`SELECT * FROM oauth_app_launches WHERE launch_hash = $1`, [sha256(q.app)]))[0];
      if (!l || l.provider !== provider || l.status !== 'pending' || new Date(l.expires_at) < new Date())
        return page(reply, 'Tautan kedaluwarsa', `<h1>Tautan kedaluwarsa</h1><p>Mulai lagi dari aplikasi RAVE.</p>`, 410);
      if (q.confirm !== '1') {
        const go = `/v1/auth/oauth/${provider}/start?${new URLSearchParams({ app: q.app, confirm: '1' })}`;
        return page(
          reply,
          'Masuk ke aplikasi',
          `<h1>Masuk ke ${esc(CLIENT_LABEL[l.client] ?? 'aplikasi RAVE')}</h1><p>Pastikan kode ini sama dengan yang tampil di aplikasi:</p><div class="code">${esc(l.user_code)}</div><a class="b" href="${esc(go)}">Lanjutkan dengan ${esc(PROVIDER_LABEL[provider])}</a><p style="margin-top:14px;font-size:12px">Tidak memulai dari aplikasimu sendiri? Tutup halaman ini.</p>`,
        );
      }
      appLaunch = l.launch_hash;
    }
    const bind = token();
    await db.query(
      `INSERT INTO oauth_flows (state_hash, provider, verifier, nonce, bind_hash, next_path, intent, app_launch, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(secs => $9))`,
      [sha256(f.state), provider, f.verifier, f.nonce, sha256(bind), next, intent, appLaunch, FLOW_TTL_SEC],
    );
    if (!appLaunch) reply.header('set-cookie', `${COOKIE}=${bind}; ${cookieFlags()}; Max-Age=${FLOW_TTL_SEC}`);
    reply.header('cache-control', 'no-store');
    return reply.redirect(authorizeUrl(provider, get, f), 302);
  });

  // Halaman "provider" simulasi (dev saja): pilih email & nama → kembali ke callback seperti provider sungguhan.
  app.get('/v1/auth/oauth/dev/authorize', async (req, reply) => {
    if (!devProviderOn()) return reply.code(404).send({ title: 'Not Found', status: 404 });
    const q = req.query as Record<string, string | undefined>;
    if (q.email) {
      const email = String(q.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ title: 'Bad Request', status: 400, detail: 'Email tidak valid' });
      const payload = b64url(JSON.stringify({ email, name: String(q.name ?? '').slice(0, 80) }));
      return reply.redirect(`/v1/auth/oauth/dev/callback?${new URLSearchParams({ code: `${payload}.${devSign(payload)}`, state: String(q.state ?? '') })}`, 302);
    }
    const state = esc(String(q.state ?? ''));
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login simulasi · RAVE dev</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a0c;color:#ededed;font:15px/1.5 system-ui,sans-serif}
form{width:min(360px,calc(100vw - 32px));border:2px solid #ededed;padding:24px;box-shadow:6px 6px 0 #f4c21f;background:#181818}
h1{margin:0 0 4px;font-size:20px;letter-spacing:.04em;text-transform:uppercase}p{margin:0 0 16px;color:#a7a39b;font-size:13px}
label{display:block;margin:12px 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
input{box-sizing:border-box;width:100%;padding:10px;border:2px solid #3a3740;background:#0b0a0c;color:#ededed;font:inherit}
button{margin-top:18px;width:100%;padding:11px;border:2px solid #0b0a0c;background:#f4c21f;color:#181818;font-weight:800;cursor:pointer}
.x{display:block;margin-top:12px;text-align:center;color:#a7a39b;font-size:13px}</style></head><body>
<form method="get" action="/v1/auth/oauth/dev/authorize"><h1>Login simulasi</h1><p>Provider tiruan khusus development — meniru Google/Apple tanpa pihak ketiga.</p>
<input type="hidden" name="state" value="${state}"><label for="e">Email</label><input id="e" name="email" type="email" required value="sosial.dev@rave.test" autofocus>
<label for="n">Nama tampilan</label><input id="n" name="name" value="Pendengar Sosial"><button type="submit">Lanjutkan</button>
<a class="x" href="/v1/auth/oauth/dev/callback?error=access_denied&amp;state=${state}">Batal</a></form></body></html>`;
  });

  // Callback: GET (Google/Facebook/dev) atau POST form (Apple, response_mode=form_post).
  await app.register(async (cb) => {
    cb.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_r, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(body as string))),
    );
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = providerParam.safeParse(req.params);
      const p: Record<string, any> = { ...(req.query as object), ...((req.body as object) ?? {}) };
      const state = typeof p.state === 'string' ? p.state : '';
      // State sekali pakai: diambil & dihapus sekaligus.
      const flow = state ? (await db.query(`DELETE FROM oauth_flows WHERE state_hash = $1 RETURNING *`, [sha256(state)]))[0] : null;
      const next = flow?.next_path ?? null;
      const intent = flow?.intent ?? null;
      try {
        if (!parsed.success || !flow || flow.provider !== parsed.data.provider) throw new OAuthFail('Sesi masuk tidak valid atau sudah dipakai. Coba lagi.');
        if (new Date(flow.expires_at) < new Date()) throw new OAuthFail('Sesi masuk kedaluwarsa. Coba lagi.');
        // Alur web: callback harus dari browser yang memulai (cookie). Alur aplikasi diikat token peluncuran + konfirmasi kode.
        const bind = readCookie(req, COOKIE);
        if (!flow.app_launch && (!bind || sha256(bind) !== flow.bind_hash)) throw new OAuthFail('Sesi masuk tidak cocok dengan browser ini. Coba lagi.');
        if (p.error) throw new OAuthFail(p.error === 'access_denied' || p.error === 'user_cancelled_authorize' ? 'Masuk dibatalkan.' : `Provider menolak: ${String(p.error).slice(0, 80)}`);
        if (typeof p.code !== 'string' || !p.code) throw new OAuthFail('Kode otorisasi tidak ada');
        const provider = parsed.data.provider;
        if (!(await enabledProviders()).includes(provider)) throw new OAuthFail('Metode masuk ini belum diaktifkan.');
        const profile = await exchange(provider, await credentials(), p.code, flow, p);
        const code = token();
        let appUser: string | null = null;
        await db.tx(async (tx) => {
          const userId = await resolveUser(tx, provider, profile, clientIp(req));
          const me = await buildMe(tx, userId);
          if (!me) throw new OAuthFail('Akun telah dihapus');
          if (me.suspended_at) throw new OAuthFail('Akun ini ditangguhkan. Hubungi dukungan RAVE.');
          if (profile.picture && /^https:\/\//.test(profile.picture))
            await tx.query(`UPDATE users SET avatar_url = $2 WHERE id = $1 AND avatar_url IS NULL`, [userId, profile.picture]);
          if (flow.app_launch) {
            const u = await tx.query(`UPDATE oauth_app_launches SET status = 'done', user_id = $2 WHERE launch_hash = $1 AND status = 'pending' AND expires_at > now()`, [flow.app_launch, userId]);
            if (!u.rowCount) throw new OAuthFail('Sesi aplikasi kedaluwarsa. Mulai lagi dari aplikasi.');
            appUser = userId;
            return;
          }
          await tx.query(`INSERT INTO oauth_login_codes (code_hash, user_id, provider, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`, [
            sha256(code),
            userId,
            provider,
            CODE_TTL_SEC,
          ]);
        });
        req.log.info({ provider, app: !!flow.app_launch }, 'login sosial berhasil');
        if (appUser) return page(reply, 'Berhasil masuk', `<h1>Berhasil masuk</h1><p>Kembali ke aplikasi RAVE — kamu sudah masuk. Halaman ini boleh ditutup.</p>`);
        return toLogin(reply, { oauth_code: code, next, intent });
      } catch (e) {
        const msg = e instanceof OAuthFail ? e.message : 'Login sosial gagal. Coba lagi sebentar lagi.';
        if (!(e instanceof OAuthFail)) req.log.error({ err: (e as Error).message, provider: parsed.success ? parsed.data.provider : '?' }, 'login sosial error');
        else req.log.warn({ reason: msg }, 'login sosial ditolak');
        if (flow?.app_launch) {
          await db.query(`UPDATE oauth_app_launches SET status = 'error', error = $2 WHERE launch_hash = $1 AND status = 'pending'`, [flow.app_launch, msg]);
          return page(reply, 'Gagal masuk', `<h1>Gagal masuk</h1><p>${esc(msg)}</p><p>Kembali ke aplikasi RAVE dan coba lagi.</p>`, 400);
        }
        return toLogin(reply, { oauth_error: msg, next, intent });
      }
    };
    cb.get('/v1/auth/oauth/:provider/callback', handler);
    cb.post('/v1/auth/oauth/:provider/callback', handler);
  });
}
