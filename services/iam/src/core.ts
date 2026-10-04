import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { config, signAccessToken, uuidv7, ACCESS_TOKEN_TTL_SEC, type OrgClaim, type PlatformRole } from '@gema/service-kit';

/** Pool atau client transaksi — keduanya punya .query() yang mengembalikan { rows }. */
export interface Q {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const POLICY_VERSION = 'v1-2026-10';
export const REFRESH_TTL_DAYS = 30;
export const OTP_TTL_SEC = 300;
export const OTP_MAX_ATTEMPTS = 5;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const randomToken = () => randomBytes(32).toString('base64url');

export function normalizeDestination(channel: string, dest: string): string {
  if (channel === 'email' || dest.includes('@')) return dest.trim().toLowerCase();
  let d = dest.replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return '+' + d;
}

// ---- Enkripsi kolom AES-256-GCM (TDD §11.5) ----
const kycKey = () => createHash('sha256').update(process.env.KYC_KEY ?? `${config.jwtSecret}:kyc`).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kycKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decrypt(enc: string): string {
  const b = Buffer.from(enc, 'base64');
  const d = createDecipheriv('aes-256-gcm', kycKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
export const mask = (s: string) => (s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4));

// ---- Org & klaim ----
export interface OrgRow {
  id: string;
  type: OrgClaim['type'];
  name: string;
  role: OrgClaim['role'];
  artist_id: string | null;
  direct: boolean;
}

/** Org langsung + org ARTIST yang dikelola org MANAGEMENT milik user (peran efektif ADMIN). */
export async function loadOrgs(q: Q, userId: string): Promise<OrgRow[]> {
  const direct = await q.query(
    `SELECT o.id, o.type, o.name, m.role, o.artist_id, true AS direct FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY m.created_at`,
    [userId],
  );
  const managed = await q.query(
    `SELECT DISTINCT a.id, a.type, a.name, 'ADMIN' AS role, a.artist_id, false AS direct
       FROM memberships m
       JOIN orgs mo ON mo.id = m.org_id AND mo.type = 'MANAGEMENT'
       JOIN management_artists ma ON ma.management_org_id = mo.id AND (ma.valid_to IS NULL OR ma.valid_to >= current_date)
       JOIN orgs a ON a.id = ma.artist_org_id
      WHERE m.user_id = $1`,
    [userId],
  );
  const seen = new Set(direct.rows.map((r) => r.id));
  return [...direct.rows, ...managed.rows.filter((r) => !seen.has(r.id))];
}

const ROLE_BY_ORG: Record<string, PlatformRole> = {
  ARTIST: 'artist',
  MANAGEMENT: 'manager',
  LABEL: 'label',
  PROMOTOR: 'promotor',
  CREATOR: 'creator',
  VENUE: 'promotor',
};

export function deriveRoles(isAdmin: boolean, orgs: OrgRow[]): PlatformRole[] {
  const roles = new Set<PlatformRole>(['fan']);
  for (const o of orgs) if (o.direct) roles.add(ROLE_BY_ORG[o.type]);
  if (isAdmin) roles.add('admin');
  return [...roles];
}

export async function kycStatus(q: Q, userId: string): Promise<string> {
  const r = await q.query(`SELECT status FROM kyc_submissions WHERE user_id = $1 ORDER BY (status='VERIFIED') DESC, created_at DESC LIMIT 1`, [userId]);
  return r.rows[0]?.status ?? 'NONE';
}

export async function buildMe(q: Q, userId: string) {
  const u = (await q.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId])).rows[0];
  if (!u) return null;
  const orgs = await loadOrgs(q, userId);
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    city: u.city,
    genres: u.genres,
    roles: deriveRoles(u.is_admin, orgs),
    orgs: orgs.map((o) => ({ id: o.id, type: o.type, name: o.name, role: o.role, artist_id: o.artist_id })),
    kyc_status: await kycStatus(q, userId),
    mfa_enabled: u.mfa_enabled,
    onboarded: u.onboarded,
    premium: u.premium,
    created_at: u.created_at,
  };
}
export type Me = NonNullable<Awaited<ReturnType<typeof buildMe>>>;

/** Terbitkan access token (JWT 15 mnt) + refresh token berotasi dalam family yang sama. */
export async function issueTokens(q: Q, me: Me, familyId: string = uuidv7()) {
  const access = await signAccessToken({
    sub: me.id,
    email: me.email ?? undefined,
    name: me.display_name,
    roles: me.roles,
    orgs: me.orgs.map((o) => ({ id: o.id, type: o.type, role: o.role, artistId: o.artist_id, artist_id: o.artist_id }) as any),
    city: me.city,
    kyc: me.kyc_status === 'VERIFIED',
    premium: me.premium,
  });
  const refresh = randomToken();
  await q.query(
    `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5))`,
    [uuidv7(), me.id, familyId, sha256(refresh), REFRESH_TTL_DAYS],
  );
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer' as const, expires_in: ACCESS_TOKEN_TTL_SEC, user: me };
}

export function orgOut(o: any) {
  return { id: o.id, type: o.type, name: o.name, slug: o.slug, city: o.city, verified: o.verified, artist_id: o.artist_id, created_at: o.created_at };
}
