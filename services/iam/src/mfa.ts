import { randomBytes } from 'node:crypto';
import { decrypt, issueTokens, randomToken, sha256, type Me, type Q } from './core.js';
import { base32Encode, TOTP_LOCK_MIN, TOTP_MAX_FAILURES, verifyTotp } from './totp.js';

/**
 * Verifikasi 2 langkah (2FA).
 *
 * Faktor pertama (OTP email, login sosial web, atau peluncuran aplikasi desktop/mobile) memanggil `completeLogin`:
 * akun tanpa 2FA langsung menerima token; akun ber-2FA menerima challenge sekali pakai yang diselesaikan lewat
 * POST /v1/auth/token {grant_type:'mfa', mfa_token, code | recovery_code}.
 */
export const MFA_TTL_SEC = 300;
/** Percobaan per challenge (batas per akun ada di users.totp_failures). */
export const MFA_MAX_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

export type MfaChallenge = { mfa_required: true; mfa_token: string; methods: ('totp' | 'recovery')[]; expires_in: number };

/** Kode pemulihan: 10 karakter base32 huruf kecil (50 bit), ditampilkan sebagai `xxxxx-xxxxx`. */
export function newRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const c = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}
/** Abaikan spasi, tanda hubung & huruf besar saat pengguna mengetik ulang kode. */
export const normalizeRecoveryCode = (s: string) => s.toLowerCase().replace(/[^a-z2-7]/g, '');
export const hashRecoveryCode = (userId: string, code: string) => sha256(`recovery:${userId}:${normalizeRecoveryCode(code)}`);

/** Ganti seluruh kode pemulihan akun; mengembalikan teks asli (ditampilkan sekali). */
export async function replaceRecoveryCodes(q: Q, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await q.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await q.query(`INSERT INTO mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`, [userId, codes.map((c) => hashRecoveryCode(userId, c))]);
  return codes;
}

export async function recoveryRemaining(q: Q, userId: string): Promise<number> {
  return (await q.query(`SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId])).rows[0].n;
}

/** Matikan 2FA sepenuhnya (dipakai: nonaktifkan oleh pemilik, reset oleh Super Admin, hapus akun). */
export async function clearMfa(q: Q, userId: string) {
  await q.query(
    `UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = 0,
       totp_failures = 0, totp_locked_until = NULL, mfa_enabled = false, updated_at = now() WHERE id = $1`,
    [userId],
  );
  await q.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await q.query(`DELETE FROM mfa_challenges WHERE user_id = $1`, [userId]);
}

/** Akhir faktor pertama: token langsung, atau challenge 2FA bila akun mengaktifkannya. */
export async function completeLogin(q: Q, me: Me): Promise<Awaited<ReturnType<typeof issueTokens>> | MfaChallenge> {
  if (!me.totp_enabled) return issueTokens(q, me);
  const token = randomToken();
  // Challenge lama yang belum selesai dibuang — hanya satu yang berlaku per akun.
  await q.query(`DELETE FROM mfa_challenges WHERE user_id = $1`, [me.id]);
  await q.query(`INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))`, [sha256(token), me.id, MFA_TTL_SEC]);
  return { mfa_required: true, mfa_token: token, methods: ['totp', 'recovery'], expires_in: MFA_TTL_SEC };
}

export type FactorCheck = { ok: true; method: 'totp' | 'recovery' } | { ok: false; locked: boolean };

/**
 * Periksa faktor kedua untuk akun yang barisnya SUDAH dikunci (FOR UPDATE) oleh pemanggil.
 * Kode authenticator memajukan `totp_last_step` (anti-replay); kode pemulihan ditandai terpakai.
 * Salah → penghitung per akun naik; mencapai batas → terkunci `TOTP_LOCK_MIN` menit.
 */
export async function checkSecondFactor(
  q: Q,
  u: { id: string; totp_secret_enc: string | null; totp_last_step: string | number; totp_failures: number; totp_locked_until: string | Date | null },
  input: { code?: string; recovery_code?: string },
): Promise<FactorCheck> {
  if (!u.totp_secret_enc) return { ok: false, locked: false };
  if (u.totp_locked_until && new Date(u.totp_locked_until) > new Date()) return { ok: false, locked: true };
  let method: 'totp' | 'recovery' | null = null;
  if (input.code) {
    const step = verifyTotp(decrypt(u.totp_secret_enc), input.code, { lastStep: Number(u.totp_last_step) });
    if (step !== null) {
      await q.query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [u.id, step]);
      method = 'totp';
    }
  } else if (input.recovery_code) {
    const used = await q.query(`UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`, [
      u.id,
      hashRecoveryCode(u.id, input.recovery_code),
    ]);
    if (used.rowCount) method = 'recovery';
  }
  if (method) {
    await q.query(`UPDATE users SET totp_failures = 0, totp_locked_until = NULL WHERE id = $1`, [u.id]);
    return { ok: true, method };
  }
  const failures = u.totp_failures + 1;
  const lock = failures >= TOTP_MAX_FAILURES;
  await q.query(
    `UPDATE users SET totp_failures = $2, totp_locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4) ELSE totp_locked_until END WHERE id = $1`,
    [u.id, lock ? 0 : failures, lock, TOTP_LOCK_MIN],
  );
  return { ok: false, locked: lock };
}

export const USER_MFA_COLS = `id, totp_secret_enc, totp_last_step, totp_failures, totp_locked_until`;
