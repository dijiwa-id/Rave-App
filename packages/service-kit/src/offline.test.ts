import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createOflEncryptor,
  decryptOfl,
  fromB64u,
  licensePublicKey,
  OFL_CHUNK,
  oflEncryptedSize,
  openCek,
  parseDevicePublicKey,
  sealCek,
  signLicense,
  unwrapCek,
  verifyLicense,
  wrapAad,
  wrapCek,
} from './offline.js';

const device = () => {
  const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = (kp.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  const raw = (kp.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-65).toString('base64url');
  return { ...kp, spki, raw };
};

async function encrypt(plain: Buffer, cek: Buffer, pieces = 7777): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (let i = 0; i < plain.length; i += pieces) parts.push(plain.subarray(i, i + pieces));
  const out: Buffer[] = [];
  const enc = Readable.from(parts.length ? parts : []).pipe(createOflEncryptor(cek, plain.length));
  for await (const c of enc) out.push(c as Buffer);
  return Buffer.concat(out);
}

describe('kunci publik perangkat (ECDH P-256)', () => {
  it('menerima titik mentah 65 byte (base64url) & SPKI DER (base64) → sidik jari sama', () => {
    const d = device();
    const a = parseDevicePublicKey(d.raw)!;
    const b = parseDevicePublicKey(d.spki)!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.spki).toBe(d.spki);
  });

  it('menolak kurva lain, RSA, dan sampah', () => {
    const ed = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const k1 = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(parseDevicePublicKey(ed)).toBeNull();
    expect(parseDevicePublicKey(k1)).toBeNull();
    expect(parseDevicePublicKey('bukan-kunci!!')).toBeNull();
    expect(parseDevicePublicKey(randomBytes(65).toString('base64'))).toBeNull();
  });
});

describe('pembungkus CEK (ECDH-ES + HKDF-SHA256 + A256GCM)', () => {
  const aad = wrapAad('track', '0190a000-0000-7000-8000-000000000001');

  it('round-trip: dibuka dengan kunci privat perangkat', () => {
    const d = device();
    const cek = randomBytes(32);
    const w = wrapCek(cek, d.raw, aad);
    expect(w.alg).toBe('ECDH-ES+HKDF-SHA256+A256GCM');
    expect(unwrapCek(w, d.privateKey, aad).equals(cek)).toBe(true);
  });

  it('GAGAL dengan kunci privat perangkat lain', () => {
    const d = device();
    const other = device();
    const w = wrapCek(randomBytes(32), d.spki, aad);
    expect(() => unwrapCek(w, other.privateKey, aad)).toThrow();
  });

  it('GAGAL bila dipindah ke konten lain (AAD terikat konten)', () => {
    const d = device();
    const w = wrapCek(randomBytes(32), d.spki, aad);
    expect(() => unwrapCek(w, d.privateKey, wrapAad('track', '0190a000-0000-7000-8000-000000000002'))).toThrow();
  });

  it('interoperabel dengan WebCrypto (alur klien web/Tauri)', async () => {
    const subtle = globalThis.crypto.subtle;
    const kp = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const raw = Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url');
    const cek = randomBytes(32);
    const w = wrapCek(cek, raw, aad);
    // --- sisi klien, hanya WebCrypto ---
    const epkRaw = fromB64u(w.epk);
    const epk = await subtle.importKey('raw', epkRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await subtle.deriveBits({ name: 'ECDH', public: epk }, kp.privateKey, 256);
    const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const kek = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: epkRaw, info: new TextEncoder().encode('rave-offline-cek-v1') },
      hk,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const out = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(w.iv), additionalData: aad }, kek, fromB64u(w.ct));
    expect(Buffer.from(out).equals(cek)).toBe(true);
  });
});

describe('berkas RAVEOFL1 (AES-256-GCM per potongan 64 KiB)', () => {
  it.each([0, 1, OFL_CHUNK - 1, OFL_CHUNK, OFL_CHUNK + 1, 3 * OFL_CHUNK + 123])('round-trip %i byte, ukuran sesuai rumus', async (n) => {
    const cek = randomBytes(32);
    const plain = randomBytes(n);
    const enc = await encrypt(plain, cek);
    expect(enc.length).toBe(oflEncryptedSize(n));
    expect(enc.subarray(0, 8).toString()).toBe('RAVEOFL1');
    expect(decryptOfl(enc, cek).equals(plain)).toBe(true);
  });

  it('kunci salah, byte diubah, atau berkas terpotong → gagal', async () => {
    const cek = randomBytes(32);
    const enc = await encrypt(randomBytes(2 * OFL_CHUNK + 10), cek);
    expect(() => decryptOfl(enc, randomBytes(32))).toThrow();
    const bad = Buffer.from(enc);
    bad[100] ^= 1;
    expect(() => decryptOfl(bad, cek)).toThrow();
    expect(() => decryptOfl(enc.subarray(0, enc.length - 16), cek)).toThrow();
  });

  it('potongan bisa didekripsi acak (seek) dengan WebCrypto', async () => {
    const cek = randomBytes(32);
    const plain = randomBytes(2 * OFL_CHUNK + 500);
    const enc = await encrypt(plain, cek);
    const i = 1;
    const header = enc.subarray(0, 32);
    const off = 32 + i * (OFL_CHUNK + 16);
    const iv = Buffer.concat([header.subarray(24, 32), Buffer.from([0, 0, 0, i])]);
    const aad = Buffer.concat([header, Buffer.from([0, 0, 0, i, 0])]);
    const key = await globalThis.crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const out = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.subarray(off, off + OFL_CHUNK + 16));
    expect(Buffer.from(out).equals(plain.subarray(OFL_CHUNK, 2 * OFL_CHUNK))).toBe(true);
  });

  it('ukuran sumber tidak sesuai yang dinyatakan → error (berkas tidak pernah setengah jadi)', async () => {
    const enc = Readable.from([randomBytes(10)]).pipe(createOflEncryptor(randomBytes(32), 20));
    await expect((async () => {
      for await (const _ of enc);
    })()).rejects.toThrow();
  });
});

describe('CEK at-rest & lisensi Ed25519', () => {
  it('CEK tersegel bisa dibuka & tidak sama dengan plaintext', () => {
    const cek = randomBytes(32);
    const s = sealCek(cek);
    expect(s).not.toContain(cek.toString('base64'));
    expect(openCek(s).equals(cek)).toBe(true);
  });

  it('tanda tangan diverifikasi dengan kunci publik dari /v1/offline/pubkey; perubahan payload ditolak', () => {
    const lic = signLicense({ license_id: 'x', expires_at: '2030-01-01T00:00:00Z' });
    const pk = licensePublicKey();
    expect(pk.kid).toBe(lic.kid);
    expect(verifyLicense<{ license_id: string }>(lic, fromB64u(pk.public_key))?.license_id).toBe('x');
    const forged = { ...lic, payload: Buffer.from(JSON.stringify({ license_id: 'x', expires_at: '2099-01-01T00:00:00Z' })).toString('base64url') };
    expect(verifyLicense(forged)).toBeNull();
    expect(verifyLicense(lic, randomBytes(32))).toBeNull();
  });

  it('kid = 16 hex pertama SHA-256 kunci publik mentah', () => {
    const pk = licensePublicKey();
    expect(pk.kid).toBe(createHash('sha256').update(fromB64u(pk.public_key)).digest('hex').slice(0, 16));
  });

  it('tanda tangan bisa diverifikasi WebCrypto Ed25519', async () => {
    const lic = signLicense({ a: 1 });
    const key = await globalThis.crypto.subtle.importKey('raw', fromB64u(licensePublicKey().public_key), { name: 'Ed25519' }, false, ['verify']);
    expect(await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64u(lic.sig), fromB64u(lic.payload))).toBe(true);
  });
});
