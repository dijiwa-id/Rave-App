import type { FastifyBaseLogger } from 'fastify';
import { brandedEmail, DeliveryError, HttpError, sendEmail, sendWhatsApp, settings, type Db } from '@rave/service-kit';
import { mask, otpCode, OTP_TTL_SEC, sha256 } from './core.js';

/** Isi pesan OTP per tujuan pemakaian: masuk akun, atau menautkan & memverifikasi kontak di akun yang sedang masuk. */
const COPY = {
  login: {
    heading: 'Kode masuk RAVE',
    intro: (mins: number) => `Masukkan kode berikut untuk masuk ke RAVE. Berlaku ${mins} menit.`,
    subject: (code: string) => `${code} adalah kode masuk RAVE`,
    wa: (code: string, mins: number) => `${code} adalah kode masuk RAVE. Berlaku ${mins} menit. Jangan bagikan kode ini.`,
  },
  link: {
    heading: 'Verifikasi kontak RAVE',
    intro: (mins: number) => `Masukkan kode berikut untuk menautkan & memverifikasi kontak ini di akun RAVE-mu. Berlaku ${mins} menit.`,
    subject: (code: string) => `${code} adalah kode verifikasi RAVE`,
    wa: (code: string, mins: number) => `${code} adalah kode verifikasi kontak RAVE. Berlaku ${mins} menit. Jangan bagikan kode ini.`,
  },
} as const;

/**
 * Terbitkan & kirim OTP ke `dest` (sudah dinormalisasi). Batas per jendela waktu (pengaturan `security.otp_*`) dihitung
 * di bawah kunci per tujuan agar permintaan paralel tidak bisa melewatinya. Kode tidak pernah dicatat ke log; kode yang
 * gagal terkirim dihapus agar tidak memakan kuota. Mengembalikan kode (hanya untuk respons dev).
 */
export async function issueOtp(
  db: Db,
  log: FastifyBaseLogger,
  o: { dest: string; channel: 'email' | 'whatsapp'; purpose: keyof typeof COPY; bypassLimit?: boolean },
): Promise<string> {
  const { dest, channel } = o;
  const provider = channel === 'email' || dest.includes('@') ? 'email' : 'whatsapp';
  const windowMin = settings.num('security.otp_window_minutes');
  const code = otpCode();
  await db.tx(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('otp:' || $1::text))`, [dest]);
    const recent = (await tx.query(`SELECT count(*)::int AS n FROM otp_codes WHERE destination = $1 AND created_at > now() - make_interval(mins => $2)`, [dest, windowMin])).rows[0];
    if (!o.bypassLimit && (recent?.n ?? 0) >= settings.num('security.otp_max_per_window'))
      throw new HttpError(429, 'Too Many Requests', `Terlalu banyak permintaan OTP. Coba lagi dalam ${windowMin} menit.`);
    await tx.query(`INSERT INTO otp_codes (destination, channel, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`, [
      dest,
      channel,
      sha256(`${dest}:${code}`),
      OTP_TTL_SEC,
    ]);
  });
  // Kirim lewat adapter email / WhatsApp Business API (§11.9, EMAIL_PROVIDER / WHATSAPP_PROVIDER).
  const c = COPY[o.purpose];
  try {
    const mins = Math.round(OTP_TTL_SEC / 60);
    if (provider === 'email') {
      const m = brandedEmail({
        heading: c.heading,
        lines: [c.intro(mins), 'Jangan bagikan kode ini kepada siapa pun, termasuk tim RAVE.'],
        code,
        footer: 'Tidak merasa meminta kode? Abaikan email ini — akunmu tetap aman.',
      });
      await sendEmail({ to: dest, subject: c.subject(code), ...m, tag: 'otp' });
    } else {
      await sendWhatsApp({ to: dest, text: c.wa(code, mins), otpCode: code });
    }
  } catch (e) {
    log.error({ dest: mask(dest), channel: provider, err: (e as Error).message }, 'OTP gagal dikirim');
    await db.query(`DELETE FROM otp_codes WHERE destination = $1 AND consumed_at IS NULL AND code_hash = $2`, [dest, sha256(`${dest}:${code}`)]);
    throw new HttpError(
      e instanceof DeliveryError && !e.retryable ? 502 : 503,
      e instanceof DeliveryError && !e.retryable ? 'Bad Gateway' : 'Service Unavailable',
      'Kode belum dapat dikirim. Coba lagi sebentar lagi.',
    );
  }
  log.info({ dest: mask(dest), channel, purpose: o.purpose }, 'OTP diterbitkan');
  return code;
}
