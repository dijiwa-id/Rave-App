import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { SignParty } from '@rave/domain';
import { HttpError, config, settings, uuidv7, unprocessable, type Db } from '@rave/service-kit';

export type SignMethod = 'OTP_NATIVE' | 'PRIVY' | 'VIDA';

export interface SignContext {
  contractId: string;
  party: SignParty;
  userId: string;
  destination: { channel: 'email' | 'whatsapp'; value: string };
  /** SHA-256 dokumen yang akan ditandatangani (PDF draf). */
  docSha256: string;
}
export interface SignatureRequest {
  challengeId: string;
  channel: 'email' | 'whatsapp';
  destination_masked: string;
  expires_in: number;
  /** Hanya NODE_ENV≠production: kode OTP dikembalikan agar bisa dites tanpa pengiriman nyata. */
  dev_code?: string;
}
export interface SignatureResult {
  method: SignMethod;
  providerRef: string;
  verifiedAt: Date;
}
export type ProviderStatus = 'NONE' | 'PENDING' | 'SIGNED' | 'FAILED';
export interface WebhookOutcome {
  handled: boolean;
  /** Dipakai idempotensi: event yang sama tidak diproses dua kali. */
  eventId?: string;
}

/** Abstraksi e-sign: native (OTP) sekarang; PrivyID/VIDA masuk lewat adapter dengan antarmuka yang sama. */
export interface SignatureProvider {
  readonly method: SignMethod;
  requestSignature(db: Db, ctx: SignContext): Promise<SignatureRequest>;
  /** Memverifikasi bukti penandatangan (kode OTP / callback). Melempar HttpError bila gagal; sekali pakai. */
  verify(db: Db, ctx: SignContext, proof: { code: string }): Promise<SignatureResult>;
  getStatus(db: Db, contractId: string, party: SignParty): Promise<ProviderStatus>;
  handleWebhook(headers: Record<string, unknown>, rawBody: string): Promise<WebhookOutcome>;
}

const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 30;

export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
/** HMAC (bukan hash polos): 6 digit mudah di-brute-force offline bila tabel bocor. Terikat ke kontrak, pihak, dan pengguna. */
export const otpHash = (ctx: Pick<SignContext, 'contractId' | 'party' | 'userId'>, code: string) =>
  createHmac('sha256', config.jwtSecret).update(`sign-otp:${ctx.contractId}:${ctx.party}:${ctx.userId}:${code}`).digest('hex');
export function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d ?? ''}`;
}
const tooMany = (detail: string) => new HttpError(429, 'Too Many Requests', detail);

export class NativeOtpProvider implements SignatureProvider {
  readonly method = 'OTP_NATIVE' as const;

  async requestSignature(db: Db, ctx: SignContext): Promise<SignatureRequest> {
    if (ctx.destination.channel !== 'email') throw unprocessable('Saat ini OTP tanda tangan hanya dikirim lewat email');
    const ttl = settings.num('contract.sign_otp_ttl_sec');
    const windowMin = settings.num('contract.sign_otp_window_minutes');
    const max = settings.num('contract.sign_otp_max_per_window');
    const code = otpCode();
    const id = uuidv7();
    await db.tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('signotp:' || $1::text))`, [`${ctx.contractId}:${ctx.party}:${ctx.userId}`]);
      const r = (
        await c.query(
          `SELECT count(*)::int AS n, max(created_at) AS last FROM signature_otps
            WHERE contract_id=$1 AND party=$2 AND user_id=$3 AND created_at > now() - make_interval(mins => $4)`,
          [ctx.contractId, ctx.party, ctx.userId, windowMin],
        )
      ).rows[0];
      if (r.n >= max) throw tooMany(`Terlalu banyak permintaan OTP. Coba lagi dalam ${windowMin} menit.`);
      if (r.last && Date.now() - new Date(r.last).getTime() < RESEND_COOLDOWN_SEC * 1000)
        throw tooMany(`Tunggu ${RESEND_COOLDOWN_SEC} detik sebelum meminta OTP lagi.`);
      // OTP lama yang belum dipakai dibatalkan: hanya kode terbaru yang berlaku.
      await c.query(`UPDATE signature_otps SET consumed_at = now() WHERE contract_id=$1 AND party=$2 AND user_id=$3 AND consumed_at IS NULL`, [ctx.contractId, ctx.party, ctx.userId]);
      await c.query(
        `INSERT INTO signature_otps (id, contract_id, party, user_id, channel, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7))`,
        [id, ctx.contractId, ctx.party, ctx.userId, ctx.destination.channel, otpHash(ctx, code), ttl],
      );
    });
    return {
      challengeId: id,
      channel: ctx.destination.channel,
      destination_masked: maskEmail(ctx.destination.value),
      expires_in: ttl,
      ...(config.isDev ? { dev_code: code } : {}),
    };
  }

  async verify(db: Db, ctx: SignContext, proof: { code: string }): Promise<SignatureResult> {
    // Percobaan dihitung di luar transaksi penandatanganan agar tetap tercatat saat gagal.
    const otp = await db.one<{ id: string; code_hash: string; attempts: number }>(
      `UPDATE signature_otps SET attempts = attempts + 1
        WHERE id = (SELECT id FROM signature_otps WHERE contract_id=$1 AND party=$2 AND user_id=$3 AND consumed_at IS NULL AND expires_at > now()
                    ORDER BY created_at DESC LIMIT 1 FOR UPDATE)
          AND attempts < $4
        RETURNING id, code_hash, attempts`,
      [ctx.contractId, ctx.party, ctx.userId, OTP_MAX_ATTEMPTS],
    );
    if (!otp) {
      const any = await db.one(`SELECT 1 FROM signature_otps WHERE contract_id=$1 AND party=$2 AND user_id=$3 AND consumed_at IS NULL AND expires_at > now() AND attempts >= $4`, [ctx.contractId, ctx.party, ctx.userId, OTP_MAX_ATTEMPTS]);
      if (any) throw tooMany('Terlalu banyak percobaan. Minta OTP baru.');
      throw unprocessable('OTP tidak ditemukan atau sudah kedaluwarsa. Minta OTP baru.');
    }
    const a = Buffer.from(otp.code_hash);
    const b = Buffer.from(otpHash(ctx, proof.code));
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw unprocessable(`Kode OTP salah (sisa ${OTP_MAX_ATTEMPTS - otp.attempts} percobaan)`);
    // Sekali pakai: klaim atomik.
    const claimed = await db.one(`UPDATE signature_otps SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [otp.id]);
    if (!claimed) throw unprocessable('OTP sudah dipakai');
    return { method: 'OTP_NATIVE', providerRef: `otp-${otp.id}`, verifiedAt: new Date() };
  }

  async getStatus(db: Db, contractId: string, party: SignParty): Promise<ProviderStatus> {
    const s = await db.one(`SELECT status FROM signatures WHERE contract_id=$1 AND party=$2`, [contractId, party]);
    if (s) return s.status;
    const o = await db.one(`SELECT 1 FROM signature_otps WHERE contract_id=$1 AND party=$2 AND consumed_at IS NULL AND expires_at > now()`, [contractId, party]);
    return o ? 'PENDING' : 'NONE';
  }

  async handleWebhook(): Promise<WebhookOutcome> {
    return { handled: false }; // provider native tidak memakai webhook
  }
}

const providers: Record<SignMethod, SignatureProvider | undefined> = { OTP_NATIVE: new NativeOtpProvider(), PRIVY: undefined, VIDA: undefined };
/** Provider aktif dari env ESIGN_PROVIDER (default OTP_NATIVE). Adapter Privy/Vida didaftarkan di Tahap 8. */
export function getProvider(method = (process.env.ESIGN_PROVIDER as SignMethod | undefined) ?? 'OTP_NATIVE'): SignatureProvider {
  const p = providers[method];
  if (!p) throw new HttpError(501, 'Not Implemented', `Provider e-sign ${method} belum dikonfigurasi`);
  return p;
}
