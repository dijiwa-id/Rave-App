// Kriptografi unduhan offline Premium (P-7, docs/adr/0004-unduhan-offline.md).
// SEMUA primitif di sini tersedia di node:crypto DAN WebCrypto (browser/Tauri) serta paket kripto Flutter, sehingga
// klien bisa mengimplementasikan ulang persis: Ed25519 (tanda tangan lisensi), ECDH P-256 + HKDF-SHA256 + AES-256-GCM
// (pembungkus content key ke perangkat), AES-256-GCM per potongan 64 KiB (berkas terenkripsi "RAVEOFL1").
// Ini perlindungan lisensi, BUKAN DRM penuh: perangkat yang sah memegang kunci yang bisa membuka berkasnya.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { OFFLINE_DENY, type OfflineDenyCode } from '@rave/domain/offline';
import { config } from './config.js';
import { HttpError } from './errors.js';

/** Problem Details penolakan unduhan offline: status & pesan ID (EN lewat localizeDetail) + `code` untuk klien. */
export function offlineDeny(code: OfflineDenyCode, extra?: Record<string, unknown>): HttpError {
  const m = OFFLINE_DENY[code];
  const title = m.status === 404 ? 'Not Found' : m.status === 409 ? 'Conflict' : m.status === 429 ? 'Too Many Requests' : m.status === 503 ? 'Service Unavailable' : 'Forbidden';
  return new HttpError(m.status, title, m.id, { type: `https://rave.id/problems/offline/${code.replace(/_/g, '-')}`, code, ...extra });
}

// ---------------- Kunci server ----------------
/**
 * Bahan kunci induk offline: `OFFLINE_KEY` (opsional, ≥ 32 karakter) → `KYC_KEY` (wajib di produksi) → JWT secret (dev).
 * Dari sini diturunkan dua kunci terpisah: enkripsi CEK at-rest & seed Ed25519 penanda tangan lisensi.
 * Mengganti bahan kunci = semua artefak harus dibuat ulang & lisensi lama gagal verifikasi (lihat ADR-0004).
 *
 * Nilai kosong/spasi diperlakukan TIDAK diset (env_file `OFFLINE_KEY=` menghasilkan string kosong — kunci turunan dari
 * string kosong bisa dihitung siapa pun). Di luar dev tidak pernah jatuh ke JWT secret: tanpa OFFLINE_KEY/KYC_KEY → galat.
 */
export function offlineBaseSecret(): string {
  const own = process.env.OFFLINE_KEY?.trim();
  if (own) return own;
  const kyc = process.env.KYC_KEY?.trim();
  if (kyc) return kyc;
  if (!config.isDev) throw new Error('OFFLINE_KEY/KYC_KEY wajib di-set di produksi (bahan kunci unduhan offline)');
  return `${config.jwtSecret}:dev-only-offline`;
}
const cekAtRestKey = () => createHash('sha256').update(`${offlineBaseSecret()}:offline-cek:v1`).digest();
/**
 * Id kunci segel CEK (16 hex pertama SHA-256 kunci turunan) — disimpan per artefak (`offline_artifacts.key_id`) agar
 * pergantian bahan kunci terdeteksi & artefak dibangun ulang, bukan 500 saat membuka CEK.
 */
export const cekKeyId = () => createHash('sha256').update(cekAtRestKey()).digest('hex').slice(0, 16);

/** Enkripsi CEK (32 byte) untuk disimpan di DB: base64(iv12 ‖ tag16 ‖ ct). */
export function sealCek(cek: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cekAtRestKey(), iv);
  c.setAAD(Buffer.from('rave-cek-at-rest-v1'));
  const ct = Buffer.concat([c.update(cek), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function openCek(sealed: string): Buffer {
  const b = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', cekAtRestKey(), b.subarray(0, 12));
  d.setAAD(Buffer.from('rave-cek-at-rest-v1'));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
let signer: { priv: KeyObject; pub: KeyObject; raw: Buffer; kid: string } | null = null;
function licenseSigner() {
  if (signer) return signer;
  const seed = createHash('sha256').update(`${offlineBaseSecret()}:offline-license:v1`).digest();
  const priv = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const pub = createPublicKey(priv);
  const raw = (pub.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  signer = { priv, pub, raw, kid: createHash('sha256').update(raw).digest('hex').slice(0, 16) };
  return signer;
}
/** Hanya untuk test (mengganti env bahan kunci). */
export function resetOfflineKeysForTest() {
  signer = null;
}

export const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** Kunci publik verifikasi lisensi (GET /v1/offline/pubkey). */
export function licensePublicKey() {
  const s = licenseSigner();
  return {
    alg: 'Ed25519' as const,
    kid: s.kid,
    public_key: b64u(s.raw),
    spki_pem: s.pub.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

export interface SignedLicense {
  alg: 'Ed25519';
  kid: string;
  /** base64url dari byte JSON payload — klien memverifikasi tanda tangan atas BYTE INI, lalu JSON.parse. */
  payload: string;
  /** base64url tanda tangan Ed25519 (64 byte) atas byte payload. */
  sig: string;
}

/** Tanda tangani payload lisensi. Tidak ada kanonikalisasi JSON: yang ditandatangani adalah byte payload apa adanya. */
export function signLicense(payload: object): SignedLicense {
  const s = licenseSigner();
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return { alg: 'Ed25519', kid: s.kid, payload: b64u(bytes), sig: b64u(edSign(null, bytes, s.priv)) };
}

/** Verifikasi (referensi klien & test). Mengembalikan payload atau null bila tanda tangan/kid tidak cocok. */
export function verifyLicense<T = unknown>(lic: SignedLicense, publicKeyRaw?: Buffer): T | null {
  const raw = publicKeyRaw ?? licenseSigner().raw;
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  const bytes = fromB64u(lic.payload);
  if (lic.alg !== 'Ed25519' || !edVerify(null, bytes, pub, fromB64u(lic.sig))) return null;
  return JSON.parse(bytes.toString('utf8')) as T;
}

// ---------------- Kunci publik perangkat (ECDH P-256) ----------------
const P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

/**
 * Normalisasi kunci publik perangkat: diterima base64/base64url dari (a) titik mentah tak terkompresi 65 byte (0x04‖X‖Y,
 * WebCrypto `exportKey('raw')`) atau (b) SPKI DER (`exportKey('spki')`). Harus kurva P-256. Null bila tidak valid.
 */
export function parseDevicePublicKey(input: string): { raw: Buffer; spki: string; fingerprint: string } | null {
  const s = input.trim().replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(s) || s.length > 400) return null;
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  let der: Buffer;
  if (buf.length === 65 && buf[0] === 0x04) der = Buffer.concat([P256_SPKI_PREFIX, buf]);
  else der = buf;
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    const spki = key.export({ format: 'der', type: 'spki' }) as Buffer;
    // SPKI P-256 tak terkompresi selalu 91 byte (26 prefiks + 65 titik) — cek eksplisit sebelum memotong titik mentah.
    if (spki.length !== 91) return null;
    const raw = spki.subarray(-65);
    if (raw[0] !== 0x04) return null;
    return { raw, spki: spki.toString('base64'), fingerprint: createHash('sha256').update(raw).digest('hex') };
  } catch {
    return null;
  }
}

export interface WrappedKey {
  alg: 'ECDH-ES+HKDF-SHA256+A256GCM';
  /** Kunci publik efemeral server, titik P-256 mentah 65 byte (base64url). */
  epk: string;
  /** IV AES-GCM 12 byte (base64url). */
  iv: string;
  /** base64url(ciphertext 32 byte ‖ tag 16 byte). */
  ct: string;
}

const WRAP_INFO = Buffer.from('rave-offline-cek-v1');
/** AAD pembungkus CEK — mengikat kunci ke konten (kunci tidak bisa dipindah ke lisensi konten lain). */
export const wrapAad = (kind: 'track' | 'episode', contentId: string) => Buffer.from(`rave-ofl1:${kind}:${contentId}`);

/** Bungkus CEK ke kunci publik perangkat: ECDH(efemeral, perangkat) → HKDF-SHA256(salt = epk mentah) → AES-256-GCM. */
export function wrapCek(cek: Buffer, devicePublicKey: string, aad: Buffer): WrappedKey {
  const dev = parseDevicePublicKey(devicePublicKey);
  if (!dev) throw new Error('kunci publik perangkat tidak valid');
  const eph = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey({ key: Buffer.from(dev.spki, 'base64'), format: 'der', type: 'spki' }) });
  const epkRaw = (eph.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-65);
  const kek = Buffer.from(hkdfSync('sha256', shared, epkRaw, WRAP_INFO, 32));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(cek), c.final(), c.getAuthTag()]);
  return { alg: 'ECDH-ES+HKDF-SHA256+A256GCM', epk: b64u(epkRaw), iv: b64u(iv), ct: b64u(ct) };
}

/** Buka CEK dengan kunci privat perangkat (referensi implementasi klien; dipakai test). Melempar bila salah kunci/AAD. */
export function unwrapCek(w: WrappedKey, devicePrivateKey: KeyObject, aad: Buffer): Buffer {
  const epkRaw = fromB64u(w.epk);
  const epk = createPublicKey({ key: Buffer.concat([P256_SPKI_PREFIX, epkRaw]), format: 'der', type: 'spki' });
  const shared = diffieHellman({ privateKey: devicePrivateKey, publicKey: epk });
  const kek = Buffer.from(hkdfSync('sha256', shared, epkRaw, WRAP_INFO, 32));
  const all = fromB64u(w.ct);
  const d = createDecipheriv('aes-256-gcm', kek, fromB64u(w.iv));
  d.setAAD(aad);
  d.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]);
}

// ---------------- Berkas terenkripsi RAVEOFL1 ----------------
export const OFL_MAGIC = Buffer.from('RAVEOFL1', 'ascii');
export const OFL_HEADER_BYTES = 32;
export const OFL_CHUNK = 64 * 1024;
export const OFL_TAG = 16;

/** Header 32 byte: magic(8) ‖ versi u8 = 1 ‖ 3 byte nol ‖ chunk_size u32 BE ‖ plaintext_size u64 BE ‖ nonce_prefix(8). */
export function oflHeader(plainSize: number, noncePrefix: Buffer, chunk = OFL_CHUNK): Buffer {
  const h = Buffer.alloc(OFL_HEADER_BYTES);
  OFL_MAGIC.copy(h, 0);
  h[8] = 1;
  h.writeUInt32BE(chunk, 12);
  h.writeBigUInt64BE(BigInt(plainSize), 16);
  noncePrefix.copy(h, 24);
  return h;
}
const chunkNonce = (prefix: Buffer, i: number) => {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0);
  n.writeUInt32BE(i, 8);
  return n;
};
/** AAD potongan ke-i: header(32) ‖ i u32 BE ‖ final u8 (1 = potongan terakhir) — mencegah tukar urutan & pemotongan berkas. */
const chunkAad = (header: Buffer, i: number, final: boolean) => {
  const a = Buffer.alloc(OFL_HEADER_BYTES + 5);
  header.copy(a, 0);
  a.writeUInt32BE(i, OFL_HEADER_BYTES);
  a[OFL_HEADER_BYTES + 4] = final ? 1 : 0;
  return a;
};
/** Ukuran berkas terenkripsi untuk plaintext `n` byte. */
export const oflEncryptedSize = (n: number, chunk = OFL_CHUNK) => OFL_HEADER_BYTES + n + Math.max(1, Math.ceil(n / chunk)) * OFL_TAG;

/**
 * Transform streaming: plaintext → RAVEOFL1. Memori ≈ satu potongan (64 KiB); ukuran plaintext wajib diketahui
 * (dari stat) karena ditulis di header & menentukan potongan terakhir. Jumlah byte tidak cocok → error.
 */
export function createOflEncryptor(cek: Buffer, plainSize: number, noncePrefix: Buffer = randomBytes(8), chunk = OFL_CHUNK): Transform {
  if (cek.length !== 32) throw new Error('CEK harus 32 byte');
  const header = oflHeader(plainSize, noncePrefix, chunk);
  const last = Math.max(1, Math.ceil(plainSize / chunk)) - 1;
  let idx = 0;
  let seen = 0;
  let pending: Buffer[] = [];
  let pendingLen = 0;
  let headerSent = false;
  const seal = (data: Buffer): Buffer => {
    const c = createCipheriv('aes-256-gcm', cek, chunkNonce(noncePrefix, idx));
    c.setAAD(chunkAad(header, idx, idx === last));
    const out = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
    idx++;
    return out;
  };
  return new Transform({
    transform(buf: Buffer, _enc, cb: TransformCallback) {
      if (!headerSent) {
        this.push(header);
        headerSent = true;
      }
      seen += buf.length;
      if (seen > plainSize) return cb(new Error('berkas sumber lebih besar dari ukuran yang dinyatakan'));
      pending.push(buf);
      pendingLen += buf.length;
      while (pendingLen >= chunk && idx < last) {
        const all = Buffer.concat(pending);
        this.push(seal(all.subarray(0, chunk)));
        const rest = all.subarray(chunk);
        pending = rest.length ? [rest] : [];
        pendingLen = rest.length;
      }
      cb();
    },
    flush(cb: TransformCallback) {
      if (seen !== plainSize) return cb(new Error('berkas sumber lebih kecil dari ukuran yang dinyatakan'));
      if (!headerSent) this.push(header);
      this.push(seal(Buffer.concat(pending)));
      cb();
    },
  });
}

/** Dekripsi penuh RAVEOFL1 (referensi klien & test; klien sungguhan mendekripsi per potongan untuk seek). */
export function decryptOfl(file: Buffer, cek: Buffer): Buffer {
  const header = file.subarray(0, OFL_HEADER_BYTES);
  if (!header.subarray(0, 8).equals(OFL_MAGIC) || header[8] !== 1) throw new Error('bukan berkas RAVEOFL1');
  const chunk = header.readUInt32BE(12);
  const size = Number(header.readBigUInt64BE(16));
  const prefix = header.subarray(24, 32);
  const n = Math.max(1, Math.ceil(size / chunk));
  if (file.length !== oflEncryptedSize(size, chunk)) throw new Error('ukuran berkas tidak cocok (terpotong?)');
  const out: Buffer[] = [];
  let off = OFL_HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const len = Math.min(chunk, size - i * chunk);
    const ct = file.subarray(off, off + len);
    const tag = file.subarray(off + len, off + len + OFL_TAG);
    const d = createDecipheriv('aes-256-gcm', cek, chunkNonce(prefix, i));
    d.setAAD(chunkAad(header, i, i === n - 1));
    d.setAuthTag(tag);
    out.push(d.update(ct), d.final());
    off += len + OFL_TAG;
  }
  return Buffer.concat(out);
}
