import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { OrgType } from '@gema/domain';
import { config } from './config.js';
import { forbidden, unauthorized } from './errors.js';

export type PlatformRole = 'fan' | 'artist' | 'manager' | 'label' | 'promotor' | 'creator' | 'admin' | 'superadmin' | 'service';
export type OrgRole = 'OWNER' | 'ADMIN' | 'FINANCE' | 'MEMBER' | 'VIEWER';

export interface OrgClaim {
  id: string;
  type: OrgType;
  role: OrgRole;
  artistId?: string | null; // untuk org ARTIST: id artis di katalog
  artist_id?: string | null; // alias sesuai kontrak API
}

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  roles: PlatformRole[];
  orgs: OrgClaim[];
  city?: string | null;
  kyc?: boolean;
  premium?: boolean;
  /** Peran internal back office (REQ-ADM-01): SUPER_ADMIN | OPS | CONTENT_QC | FINANCE | LEGAL | SUPPORT | EDITORIAL */
  admin_role?: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const key = () => new TextEncoder().encode(config.jwtSecret);
export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // REQ-IAM-01: ≤ 15 menit

export async function signAccessToken(u: AuthUser, ttlSec = ACCESS_TOKEN_TTL_SEC): Promise<string> {
  return new SignJWT({ email: u.email, name: u.name, roles: u.roles, orgs: u.orgs, city: u.city, kyc: u.kyc, premium: u.premium, admin_role: u.admin_role ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(u.sub)
    .setIssuer('gema-iam')
    .setAudience('gema')
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, key(), { issuer: 'gema-iam', audience: 'gema' });
  return {
    sub: payload.sub!,
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    roles: (payload.roles as PlatformRole[]) ?? [],
    // Kontrak API memakai `artist_id`; kode internal memakai `artistId` — terima keduanya.
    orgs: ((payload.orgs as any[]) ?? []).map((o) => ({ ...o, artistId: o.artistId ?? o.artist_id ?? null, artist_id: o.artist_id ?? o.artistId ?? null })),
    city: (payload.city as string | null) ?? null,
    kyc: Boolean(payload.kyc),
    premium: Boolean(payload.premium),
    admin_role: (payload.admin_role as string | null) ?? null,
  };
}

/** Token service-to-service (least privilege: role "service"). */
let svcToken: { token: string; exp: number } | null = null;
export async function serviceToken(name: string): Promise<string> {
  const now = Date.now() / 1000;
  if (svcToken && svcToken.exp - 60 > now) return svcToken.token;
  const token = await signAccessToken({ sub: `svc:${name}`, roles: ['service'], orgs: [] }, 600);
  svcToken = { token, exp: now + 600 };
  return token;
}

/** Header panggilan antar-service: token role "service" + shared secret (token saja tidak cukup). */
export async function serviceHeaders(name: string): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await serviceToken(name)}`, 'x-internal-secret': config.internalSecret };
}

function internalSecretOk(v: string | string[] | undefined) {
  const got = Buffer.from(typeof v === 'string' ? v : '');
  const want = Buffer.from(config.internalSecret);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * onRequest hook: isi req.user bila ada Bearer token valid (tidak menolak).
 * Token role "service" hanya diakui bersama `x-internal-secret` yang cocok — bocornya JWT secret saja
 * tidak cukup untuk memanggil /internal/*, dan klien di balik gateway tidak pernah tahu secret ini.
 */
export async function attachUser(req: FastifyRequest) {
  req.user = null;
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return;
  try {
    const u = await verifyAccessToken(h.slice(7));
    req.user = u.roles.includes('service') && !internalSecretOk(req.headers['x-internal-secret']) ? null : u;
  } catch {
    req.user = null;
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.user) throw unauthorized();
}

export function requireRole(...roles: PlatformRole[]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (req.user.roles.includes('admin') || req.user.roles.includes('service')) return;
    if (!roles.some((r) => req.user!.roles.includes(r))) throw forbidden(`Memerlukan peran: ${roles.join(', ')}`);
  };
}

export function isSuperAdmin(u: AuthUser | null): boolean {
  return !!u && u.roles.includes('superadmin');
}

/** Hanya Super Admin (admin biasa TIDAK lolos — beda dengan requireRole). */
export async function requireSuperAdmin(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  if (!isSuperAdmin(req.user)) throw forbidden('Hanya Super Admin');
}

/** Endpoint /internal/*: hanya token service (atau superadmin untuk diagnosis). */
export async function requireService(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  if (!req.user.roles.includes('service') && !isSuperAdmin(req.user)) throw forbidden('Khusus antar-service');
}

export function isAdmin(u: AuthUser | null): boolean {
  return !!u && (u.roles.includes('admin') || u.roles.includes('service'));
}

/** Pemeriksaan ABAC berbasis kepemilikan org (TDD §11.5). */
export function orgMembership(u: AuthUser | null, orgId: string, roles?: OrgRole[]): OrgClaim | null {
  if (!u) return null;
  const m = u.orgs.find((o) => o.id === orgId);
  if (!m) return null;
  if (roles && !roles.includes(m.role)) return null;
  return m;
}

export function assertOrg(u: AuthUser | null, orgId: string, roles?: OrgRole[]): OrgClaim {
  if (isAdmin(u)) return { id: orgId, type: 'ARTIST', role: 'OWNER' };
  const m = orgMembership(u, orgId, roles);
  if (!m) throw forbidden('Bukan anggota organisasi ini');
  return m;
}

/** ID artis yang dapat dikelola user (org ARTIST miliknya). Manajemen/label mendapat akses via orgs[].artistId juga. */
export function managedArtistIds(u: AuthUser | null): string[] {
  if (!u) return [];
  return u.orgs.filter((o) => o.artistId).map((o) => o.artistId!) as string[];
}
