import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { adminPermissions } from '@rave/domain/settings';
import { config, settings, signAccessToken, uuidv7, ACCESS_TOKEN_TTL_SEC, type OrgClaim, type PlatformRole } from '@rave/service-kit';

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

export function deriveRoles(adminRole: string | null, orgs: OrgRow[]): PlatformRole[] {
  const roles = new Set<PlatformRole>(['fan']);
  for (const o of orgs) if (o.direct) roles.add(ROLE_BY_ORG[o.type]);
  if (adminRole) roles.add('admin');
  if (adminRole === 'SUPER_ADMIN') roles.add('superadmin');
  return [...roles];
}

export async function kycStatus(q: Q, userId: string): Promise<string> {
  const r = await q.query(`SELECT status FROM kyc_submissions WHERE user_id = $1 ORDER BY (status='VERIFIED') DESC, created_at DESC LIMIT 1`, [userId]);
  return r.rows[0]?.status ?? 'NONE';
}

export const MEMBER_TYPES = ['FREE', 'INDIVIDUAL', 'STUDENT', 'DUO'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

/** Premium efektif: jenis member berbayar yang belum kedaluwarsa (fallback kolom lama `premium`). */
export function memberActive(u: { member_type?: string | null; member_until?: string | Date | null; premium?: boolean }): boolean {
  const type = u.member_type ?? (u.premium ? 'INDIVIDUAL' : 'FREE');
  if (type === 'FREE') return false;
  return !u.member_until || new Date(u.member_until).getTime() > Date.now();
}

// ---- Verifikasi akun (badge "Verified") — tidak memengaruhi tier/fitur ----
export const GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;
export const VERIFY_MIN_AGE = 13;
export const BIO_MIN = 20;
export const VERIFY_KEYS = ['full_name', 'birth_date', 'id_number', 'gender', 'bio', 'socials', 'avatar', 'city', 'email', 'phone'] as const;
export type VerifyKey = (typeof VERIFY_KEYS)[number];
export type VerificationStatus = 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';

/** Umur (tahun penuh) dari tanggal lahir YYYY-MM-DD. */
export function ageOf(birth: string | Date, now = new Date()): number {
  const b = new Date(`${typeof birth === 'string' ? birth.slice(0, 10) : isoDate(birth)}T00:00:00Z`);
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
/** Kolom `date` → 'YYYY-MM-DD'. node-pg mengurai `date` sebagai tengah malam WAKTU LOKAL → pakai komponen lokal
 *  (toISOString() akan menggeser sehari di zona UTC+). */
export const isoDate = (d: unknown): string | null => {
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return d ? String(d).slice(0, 10) : null;
};

/**
 * Daftar periksa data wajib verifikasi. Email & WhatsApp dianggap terverifikasi bila terhubung sebagai identitas login
 * (dibuktikan lewat OTP) — email juga sah bila akun masuk lewat Google/Apple/Facebook (email dari penyedia).
 */
export async function verificationChecklist(q: Q, u: any): Promise<Record<VerifyKey, boolean>> {
  const ids = (await q.query(`SELECT provider, subject FROM identities WHERE user_id = $1`, [u.id])).rows as { provider: string; subject: string }[];
  // NIK: tersimpan di profil, atau sudah tercatat lewat KYC lama yang disetujui.
  const hasNik = !!u.id_number_enc || (await identityVerified(q, u.id));
  const socials = Array.isArray(u.socials) ? (u.socials as string[]) : [];
  const birth = isoDate(u.birth_date);
  return {
    full_name: (u.full_name ?? '').trim().length >= 3,
    birth_date: !!birth && ageOf(birth) >= VERIFY_MIN_AGE,
    id_number: hasNik,
    gender: GENDERS.includes(u.gender),
    bio: (u.bio ?? '').trim().length >= BIO_MIN,
    socials: socials.some((x) => /^https?:\/\/\S+\.\S+/i.test(x)),
    avatar: !!u.avatar_url,
    city: !!(u.city ?? '').trim(),
    email: !!u.email && ids.some((i) => (i.provider === 'email' && i.subject === u.email) || ['google', 'apple', 'facebook'].includes(i.provider)),
    phone: !!u.phone && ids.some((i) => i.provider === 'whatsapp' && i.subject === u.phone),
  };
}

/** Identitas sudah terverifikasi (KYC disetujui — dari verifikasi akun, KYC lama, atau KYB) → syarat tarik dana & event. */
export async function identityVerified(q: Q, userId: string): Promise<boolean> {
  return (await q.query(`SELECT 1 FROM kyc_submissions WHERE user_id = $1 AND status = 'VERIFIED' LIMIT 1`, [userId])).rows.length > 0;
}

/**
 * Satu status verifikasi (verifikasi akun = KYC identitas): VERIFIED (disetujui; badge tampil bila `verified_at`, yaitu
 * data diri lengkap) › PENDING (menunggu review) › REJECTED (pengajuan terakhir ditolak) › NONE.
 * Pengguna dengan KYC lama yang disetujui otomatis VERIFIED — badge muncul setelah melengkapi data diri.
 */
export async function verificationStatus(q: Q, u: { id: string; verified_at?: unknown }): Promise<VerificationStatus> {
  if (u.verified_at || (await identityVerified(q, u.id))) return 'VERIFIED';
  const r = (await q.query(`SELECT status FROM verification_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [u.id])).rows[0];
  return r?.status === 'PENDING' ? 'PENDING' : r?.status === 'REJECTED' ? 'REJECTED' : 'NONE';
}

/**
 * Hapus akun (UU PDP): lepas semua identitas login, cabut sesi, anonimkan data pribadi (termasuk data verifikasi),
 * hapus persetujuan, batalkan pengajuan verifikasi yang menunggu. Baris `users` tetap ada (deleted_at) agar riwayat
 * transaksi/royalti tetap konsisten. Dipakai hapus mandiri (/v1/me) & hapus oleh Super Admin.
 */
export async function anonymizeUser(q: Q, id: string) {
  await q.query(`DELETE FROM identities WHERE user_id = $1`, [id]);
  await q.query(`UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [id]);
  await q.query(
    `UPDATE users SET email = NULL, phone = NULL, display_name = 'Akun dihapus', avatar_url = NULL, city = NULL, genres = '{}',
       full_name = NULL, birth_date = NULL, gender = NULL, bio = NULL, socials = '[]'::jsonb, verified_at = NULL, verified_by = NULL,
       id_number_enc = NULL, id_number_masked = NULL,
       totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = 0,
       totp_failures = 0, totp_locked_until = NULL, mfa_enabled = false,
       deleted_at = now(), updated_at = now()
     WHERE id = $1`,
    [id],
  );
  await q.query(`DELETE FROM consents WHERE user_id = $1`, [id]);
  await q.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [id]);
  await q.query(`DELETE FROM mfa_challenges WHERE user_id = $1`, [id]);
  await q.query(`UPDATE verification_requests SET status = 'CANCELLED', decided_at = now() WHERE user_id = $1 AND status = 'PENDING'`, [id]);
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
    /** Data profil lengkap (verifikasi akun). */
    full_name: (u.full_name as string | null) ?? null,
    birth_date: isoDate(u.birth_date),
    gender: (u.gender as (typeof GENDERS)[number] | null) ?? null,
    bio: (u.bio as string | null) ?? null,
    socials: (Array.isArray(u.socials) ? u.socials : []) as string[],
    /** NIK tersamar (nilai asli terenkripsi, tidak pernah dikirim ke klien). */
    id_number_masked: (u.id_number_masked as string | null) ?? (await q.query(`SELECT id_number_masked FROM kyc_submissions WHERE user_id = $1 AND status = 'VERIFIED' ORDER BY created_at DESC LIMIT 1`, [u.id])).rows[0]?.id_number_masked ?? null,
    /** Badge "Verified" — penanda identitas saja, tidak mengubah tier/fitur. */
    verified: !!u.verified_at,
    verified_at: (u.verified_at as string | null) ?? null,
    verification_status: await verificationStatus(q, u),
    /** Bahasa antarmuka pilihan ('id' | 'en'); null = ikuti perangkat / default platform. */
    locale: (u.locale as 'id' | 'en' | null) ?? null,
    /** Tema aplikasi dengar pilihan pengguna ('light' | 'dark' | 'system'); null = default platform (appearance.player_theme). */
    theme: (u.theme as 'light' | 'dark' | 'system' | null) ?? null,
    genres: u.genres,
    roles: deriveRoles(u.admin_role ?? (u.is_admin ? 'OPS' : null), orgs),
    orgs: orgs.map((o) => ({ id: o.id, type: o.type, name: o.name, role: o.role, artist_id: o.artist_id })),
    kyc_status: await kycStatus(q, userId),
    mfa_enabled: u.mfa_enabled,
    /** Aplikasi authenticator (TOTP) aktif — bisa masuk dengan email + kode authenticator. */
    totp_enabled: !!u.totp_enabled_at,
    onboarded: u.onboarded,
    premium: memberActive(u),
    /** Jenis member (diatur Super Admin): FREE | INDIVIDUAL | STUDENT | DUO; `member_until` null = tanpa batas. */
    member_type: (u.member_type as MemberType | undefined) ?? (u.premium ? 'INDIVIDUAL' : 'FREE'),
    member_until: (u.member_until as string | null) ?? null,
    admin_role: (u.admin_role as string | null) ?? null,
    /** Izin back office efektif (matriks "Peran & Akses", dibaca terkini) — untuk menu & halaman di web. */
    admin_permissions: adminPermissions(u.admin_role ?? (u.is_admin ? 'OPS' : null), (k) => settings.get(k)),
    suspended_at: u.suspended_at as string | null,
    created_at: u.created_at,
  };
}
export type Me = NonNullable<Awaited<ReturnType<typeof buildMe>>>;

/**
 * Catat sesi login baru. Onboarding hanya wajib pada login pertama: bila akun sudah pernah login sebelumnya
 * (`last_login_at` terisi), `onboarded` ditandai true walau onboarding dulu tidak diselesaikan.
 */
async function recordLogin(q: Q, me: Me): Promise<Me> {
  const r = (
    await q.query(`UPDATE users SET onboarded = onboarded OR last_login_at IS NOT NULL, last_login_at = now() WHERE id = $1 RETURNING onboarded`, [me.id])
  ).rows[0];
  return r ? { ...me, onboarded: r.onboarded } : me;
}

/**
 * Terbitkan access token (JWT 15 mnt) + refresh token berotasi dalam family yang sama.
 * Tanpa `familyId` = sesi baru (login) → dicatat sebagai login; dengan `familyId` = rotasi refresh.
 */
export async function issueTokens(q: Q, me: Me, familyId?: string) {
  if (!familyId) {
    me = await recordLogin(q, me);
    familyId = uuidv7();
  }
  const access = await signAccessToken({
    sub: me.id,
    email: me.email ?? undefined,
    name: me.display_name,
    roles: me.roles,
    orgs: me.orgs.map((o) => ({ id: o.id, type: o.type, role: o.role, artistId: o.artist_id, artist_id: o.artist_id }) as any),
    city: me.city,
    kyc: me.kyc_status === 'VERIFIED',
    premium: me.premium,
    admin_role: me.admin_role,
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
