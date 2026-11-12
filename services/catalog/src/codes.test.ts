import { describe, expect, it } from 'vitest';
import { isPublicMediaFile, signMediaUrl, signProtectedMediaUrl, verifyMediaSig } from '@rave/service-kit';
import { formatIsrc, normalizeIsrc, normalizeRegistrant, normalizeUpc } from './codes.js';

describe('ISRC (ISO 3901)', () => {
  it('menerima format bertanda hubung & 12 karakter, menormalkan ke CC-XXX-YY-NNNNN', () => {
    expect(normalizeIsrc('ID-A1B-26-00001')).toBe('ID-A1B-26-00001');
    expect(normalizeIsrc('ida1b2600001')).toBe('ID-A1B-26-00001');
    expect(normalizeIsrc(' usrc17607839 ')).toBe('US-RC1-76-07839');
  });
  it('menolak format salah', () => {
    for (const bad of ['', 'ID-A1B-26-0001', 'I1-A1B-26-00001', 'ID-A1B2600001', 'ID-A1B-2A-00001', 'ID-A1B-26-000011', 'ID-A_B-26-00001']) expect(normalizeIsrc(bad)).toBeNull();
    expect(normalizeIsrc(null)).toBeNull();
  });
  it('kode pendaftar dari pengaturan', () => {
    expect(normalizeRegistrant('')).toBeNull();
    expect(normalizeRegistrant(undefined)).toBeNull();
    expect(normalizeRegistrant('id-r4v')).toBe('ID-R4V');
    expect(normalizeRegistrant('IDR4V')).toBe('ID-R4V');
    expect(normalizeRegistrant('ID-GM')).toBeNull();
  });
  it('menyusun ISRC dengan nomor urut tanpa berputar ulang', () => {
    expect(formatIsrc('ID-R4V', 2026, 1)).toBe('ID-R4V-26-00001');
    expect(formatIsrc('IDR4V', 2030, 99_999)).toBe('ID-R4V-30-99999');
    expect(normalizeIsrc(formatIsrc('ID-R4V', 2026, 42))).toBe('ID-R4V-26-00042');
    expect(() => formatIsrc('ID-R4V', 2026, 100_000)).toThrow();
    expect(() => formatIsrc('ID-R4V', 2026, 0)).toThrow();
    expect(() => formatIsrc('', 2026, 1)).toThrow();
  });
});

describe('UPC/EAN (GTIN-12/13)', () => {
  it('menerima kode dengan digit periksa benar', () => {
    expect(normalizeUpc('036000291452')).toBe('036000291452'); // UPC-A
    expect(normalizeUpc('4006381333931')).toBe('4006381333931'); // EAN-13
    expect(normalizeUpc('400-6381 333931')).toBe('4006381333931');
  });
  it('menolak digit periksa salah / panjang salah / bukan angka', () => {
    for (const bad of ['036000291453', '4006381333932', '89917630000', '12345678901234', 'abcdefghijkl', '']) expect(normalizeUpc(bad)).toBeNull();
    // Format UPC palsu lama: 899 + 9 digit Date.now() — hampir selalu digit periksanya salah.
    expect(normalizeUpc('899000000001')).toBeNull();
  });
});

describe('akses media publik vs bertanda tangan', () => {
  const id = '01a1ca30-c5f9-7312-b506-4a7a1499546e';
  it('publik: rendisi gratis & gambar', () => {
    for (const f of [`${id}.low.m4a`, `${id}.normal.m4a`, `${id}.jpg`, `${id}.JPEG`, `${id}.png`, `${id}.webp`]) expect(isPublicMediaFile(f)).toBe(true);
  });
  it('wajib tanda tangan: master apa pun ekstensinya & rendisi Premium', () => {
    for (const ext of ['flac', 'wav', 'aif', 'aiff', 'alac', 'mp3', 'aac', 'ogg', 'opus', 'm4a', 'high.m4a', 'lossless.flac', 'normal.m4a.part', 'bin'])
      expect(isPublicMediaFile(`${id}.${ext}`)).toBe(false);
    expect(isPublicMediaFile(`${id}`)).toBe(false);
  });
  it('signProtectedMediaUrl hanya menandatangani berkas yang tidak publik', () => {
    expect(signProtectedMediaUrl(`/v1/catalog/media/${id}.normal.m4a`, 60)).toBe(`/v1/catalog/media/${id}.normal.m4a`);
    expect(signProtectedMediaUrl('https://cdn.example.com/demo.mp3', 60)).toBe('https://cdn.example.com/demo.mp3');
    const signed = signProtectedMediaUrl(`/v1/catalog/media/${id}.flac`, 60);
    const u = new URL(signed, 'http://x');
    expect(u.pathname).toBe(`/v1/catalog/media/${id}.flac`);
    expect(verifyMediaSig(u.pathname, u.searchParams.get('exp'), u.searchParams.get('sig'))).toBe(true);
    expect(verifyMediaSig(`/v1/catalog/media/${id}.wav`, u.searchParams.get('exp'), u.searchParams.get('sig'))).toBe(false);
  });
  it('tanda tangan kedaluwarsa ditolak', () => {
    const u = new URL(signMediaUrl(`/v1/catalog/media/${id}.wav`, -10), 'http://x');
    expect(verifyMediaSig(u.pathname, u.searchParams.get('exp'), u.searchParams.get('sig'))).toBe(false);
  });
});
