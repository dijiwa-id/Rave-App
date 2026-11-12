// Kode identifikasi rekaman & rilis (REQ-STU-01): ISRC (ISO 3901) dan UPC/EAN (GTIN-12/13).
// Fungsi di sini murni (tanpa I/O) dan diuji unit — lihat codes.test.ts.

/**
 * Normalisasi ISRC ISO 3901 → `CC-XXX-YY-NNNNN` (huruf besar, bertanda hubung), atau null bila tidak valid.
 * Diterima dengan/tanpa tanda hubung (12 karakter tanpa tanda hubung): CC = kode negara (2 huruf),
 * XXX = kode pendaftar (3 alfanumerik), YY = 2 digit tahun, NNNNN = 5 digit kode desainasi.
 */
export function normalizeIsrc(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  const m = /^([A-Z]{2})-?([A-Z0-9]{3})-?(\d{2})-?(\d{5})$/.exec(s);
  // Tanda hubung harus lengkap (CC-XXX-YY-NNNNN) atau tidak ada sama sekali (12 karakter).
  if (!m || (s.includes('-') && s.split('-').length !== 4)) return null;
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
}

/** Kode pendaftar ISRC dari pengaturan (`CC-XXX` / `CCXXX`) → `CC-XXX`, atau null bila kosong/tidak valid. */
export function normalizeRegistrant(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  const m = /^([A-Z]{2})-?([A-Z0-9]{3})$/.exec(s);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Batas kode desainasi per tahun (5 digit). Tidak pernah berputar ulang — habis = galat. */
export const ISRC_MAX_DESIGNATION = 99_999;

/** Susun ISRC dari kode pendaftar, tahun (4 digit) dan nomor urut 1..99999. */
export function formatIsrc(registrant: string, year: number, n: number): string {
  const reg = normalizeRegistrant(registrant);
  if (!reg) throw new Error(`Kode pendaftar ISRC tidak valid: ${registrant}`);
  if (!Number.isInteger(n) || n < 1 || n > ISRC_MAX_DESIGNATION) throw new Error(`Nomor urut ISRC di luar rentang: ${n}`);
  return `${reg}-${String(year % 100).padStart(2, '0')}-${String(n).padStart(5, '0')}`;
}

/** Digit periksa GTIN (UPC-A/EAN-13): bobot 3,1,3,… dari digit paling kanan sebelum digit periksa. */
function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** UPC-A (12 digit) atau EAN-13 (13 digit) dengan digit periksa valid → string digit; selain itu null. Spasi/tanda hubung diabaikan. */
export function normalizeUpc(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[\s-]/g, '');
  if (!/^\d{12,13}$/.test(s)) return null;
  return gtinCheckDigit(s.slice(0, -1)) === Number(s[s.length - 1]) ? s : null;
}
