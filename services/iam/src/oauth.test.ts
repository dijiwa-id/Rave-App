import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { enabledSocialProviders, validateIntegration } from '@rave/domain/integrations';
import { appleClientSecret, normalizePem, verifyGoogleIdToken } from './oauth.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('login sosial — Apple', () => {
  it('normalizePem: .p8 satu baris / tanpa header / dengan \\n literal menjadi PEM yang sama', () => {
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    expect(normalizePem(pem)).toBe(normalizePem(body));
    expect(normalizePem(pem.replace(/\n/g, ' '))).toBe(normalizePem(pem));
    expect(normalizePem(pem.replace(/\n/g, '\\n'))).toBe(normalizePem(pem));
    expect(() => createPublicKey(normalizePem(body))).not.toThrow();
  });

  it('client_secret = JWT ES256 (kid, iss=team, sub=services id, aud Apple, exp 5 menit) yang terverifikasi kunci publik', () => {
    const cfg: Record<string, string> = { APPLE_KEY_ID: 'KEY123', APPLE_TEAM_ID: 'TEAM99', APPLE_SERVICES_ID: 'id.rave.web', APPLE_PRIVATE_KEY: pem.replace(/\n/g, ' ') };
    const jwt = appleClientSecret((k) => cfg[k]);
    const [h, p, s] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(payload).toMatchObject({ iss: 'TEAM99', sub: 'id.rave.web', aud: 'https://appleid.apple.com' });
    expect(payload.exp - payload.iat).toBe(300);
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'))).toBe(true);
  });
});

describe('login sosial — konfigurasi', () => {
  it('provider aktif hanya bila semua field kredensialnya terisi', () => {
    const env: Record<string, string> = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', FACEBOOK_APP_ID: 'z' };
    expect(enabledSocialProviders((k) => env[k])).toEqual(['google']);
  });
  it('validasi: minimal satu provider lengkap; provider setengah diisi ditandai field yang kurang', () => {
    expect(validateIntegration('social', 'oauth', {}, new Set()).length).toBeGreaterThan(0);
    expect(validateIntegration('social', 'oauth', { GOOGLE_CLIENT_ID: 'a' }, new Set(['GOOGLE_CLIENT_SECRET']))).toEqual([]);
    const half = validateIntegration('social', 'oauth', { GOOGLE_CLIENT_ID: 'a', FACEBOOK_APP_ID: 'b' }, new Set(['GOOGLE_CLIENT_SECRET']));
    expect(half.map((e) => e.path)).toEqual(['FACEBOOK_APP_SECRET']);
    expect(validateIntegration('social', 'off', {}, new Set())).toEqual([]);
  });
});

describe('login Google native (mobile) — verifikasi ID token', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const jwks = { keys: [jwk] };
  const AUD = 'web-client.apps.googleusercontent.com';
  const mk = (claims: Record<string, unknown>, kid = 'k1', key = rsa.privateKey) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const s = sign('sha256', Buffer.from(`${h}.${p}`), key).toString('base64url');
    return `${h}.${p}.${s}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://accounts.google.com', aud: AUD, sub: '1234', email: 'a@gmail.com', email_verified: true, name: 'A', iat: now, exp: now + 3600 };

  it('token sah → profil (sub, email terverifikasi, nama)', async () => {
    const p = await verifyGoogleIdToken(mk(good), [AUD], jwks);
    expect(p).toMatchObject({ sub: '1234', email: 'a@gmail.com', emailVerified: true, name: 'A' });
  });
  it('menolak tanda tangan palsu, aud lain, penerbit lain, kedaluwarsa, kid tak dikenal', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyGoogleIdToken(mk(good, 'k1', other), [AUD], jwks)).rejects.toThrow(/Tanda tangan/);
    await expect(verifyGoogleIdToken(mk({ ...good, aud: 'evil' }), [AUD], jwks)).rejects.toThrow(/bukan untuk aplikasi/);
    await expect(verifyGoogleIdToken(mk({ ...good, iss: 'https://evil.example' }), [AUD], jwks)).rejects.toThrow(/Penerbit/);
    await expect(verifyGoogleIdToken(mk({ ...good, exp: now - 3600 }), [AUD], jwks)).rejects.toThrow(/kedaluwarsa/);
    await expect(verifyGoogleIdToken(mk(good, 'k9'), [AUD], jwks)).rejects.toThrow(/tidak dikenal/);
  });
});
