import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { getIntegration } from './integrations.js';

/**
 * Pengiriman pesan keluar (GO-LIVE P0 #1): OTP login, OTP tanda tangan kontrak, dan notifikasi email/WhatsApp.
 * Provider dipilih lewat env — tanpa dependency tambahan (HTTP API via fetch):
 *
 *   EMAIL_PROVIDER = log | resend | mailgun | postmark | webhook      (default: log)
 *     EMAIL_FROM                         alamat pengirim, mis. "RAVE <no-reply@rave.id>"
 *     RESEND_API_KEY                     (resend)
 *     MAILGUN_API_KEY, MAILGUN_DOMAIN    (mailgun; MAILGUN_BASE_URL=https://api.eu.mailgun.net untuk region EU)
 *     POSTMARK_SERVER_TOKEN              (postmark)
 *     EMAIL_WEBHOOK_URL                  (webhook: relay sendiri/SES/SMTP gateway; body JSON ditandatangani HMAC MESSAGING_WEBHOOK_SECRET)
 *
 *   WHATSAPP_PROVIDER = log | meta | webhook                          (default: log)
 *     WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN (meta — WhatsApp Cloud API)
 *     WA_OTP_TEMPLATE                    nama templat autentikasi yang disetujui Meta (wajib untuk OTP; default "rave_otp")
 *     WA_TEMPLATE_LANG                   default "id"
 *     WHATSAPP_WEBHOOK_URL               (webhook: BSP lain)
 *
 * Email juga dapat diatur Super Admin di dasbor (Platform → Integrasi) — konfigurasi dasbor menang atas env;
 * kunci yang dipakai sama dengan nama env di atas.
 *
 * `log` hanya mencatat (tanpa isi kode) — di produksi berarti TIDAK ADA yang bisa login; preflight memblokirnya.
 */

export type EmailProvider = 'log' | 'resend' | 'mailgun' | 'postmark' | 'webhook';
export type WhatsAppProvider = 'log' | 'meta' | 'webhook';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Tag kategori untuk analitik provider (otp, notification, contract). */
  tag?: string;
}
export interface WhatsAppMessage {
  /** E.164, mis. +6281234567890. */
  to: string;
  text: string;
  /** Untuk OTP: kirim lewat templat autentikasi (pesan bebas hanya boleh dalam jendela 24 jam). */
  otpCode?: string;
}
export interface SendResult {
  provider: string;
  id?: string;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const env = (k: string) => process.env[k]?.trim() || undefined;
export const emailProvider = (): EmailProvider => (env('EMAIL_PROVIDER') as EmailProvider) ?? 'log';
export const whatsappProvider = (): WhatsAppProvider => (env('WHATSAPP_PROVIDER') as WhatsAppProvider) ?? 'log';

/** Ringkasan konfigurasi (tanpa secret) untuk /readyz, preflight, dan dasbor platform. */
export function messagingStatus() {
  const missing: string[] = [];
  const need = (...keys: string[]) => keys.forEach((k) => !env(k) && missing.push(k));
  const e = emailProvider();
  if (e !== 'log') need('EMAIL_FROM');
  if (e === 'resend') need('RESEND_API_KEY');
  if (e === 'mailgun') need('MAILGUN_API_KEY', 'MAILGUN_DOMAIN');
  if (e === 'postmark') need('POSTMARK_SERVER_TOKEN');
  if (e === 'webhook') need('EMAIL_WEBHOOK_URL');
  const w = whatsappProvider();
  if (w === 'meta') need('WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN');
  if (w === 'webhook') need('WHATSAPP_WEBHOOK_URL');
  return { email: e, whatsapp: w, missing, ready: e !== 'log' && missing.length === 0 };
}

const mask = (s: string) => (s.includes('@') ? s.replace(/^(.{2}).*(@.*)$/, '$1***$2') : s.replace(/.(?=.{4})/g, '*'));
let logger: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void } = {
  info: (o, m) => console.log(JSON.stringify({ level: 30, msg: m, ...o })),
  warn: (o, m) => console.warn(JSON.stringify({ level: 40, msg: m, ...o })),
};
export function setMessagingLogger(l: typeof logger) {
  logger = l;
}

async function http(url: string, init: RequestInit & { timeoutMs?: number }): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 10_000) });
  } catch (e: any) {
    throw new DeliveryError(`provider tidak terjangkau: ${e?.message ?? e}`, true);
  }
  const text = await res.text();
  if (!res.ok) {
    // 429 & 5xx dapat dicoba ulang; 4xx lain = konfigurasi/alamat salah.
    throw new DeliveryError(`provider HTTP ${res.status}: ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function signedWebhook(url: string, payload: unknown, secretOverride?: string) {
  const body = JSON.stringify(payload);
  const secret = secretOverride ?? env('MESSAGING_WEBHOOK_SECRET') ?? config.internalSecret;
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return http(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rave-timestamp': ts, 'x-rave-signature': sig }, body });
}

/** Konfigurasi email efektif: dasbor Super Admin bila sudah diatur, selain itu env. */
export async function emailSettings(): Promise<{ source: 'dashboard' | 'env'; provider: EmailProvider; get: (k: string) => string | undefined }> {
  const i = await getIntegration('email');
  if (i) return { source: 'dashboard', provider: i.provider as EmailProvider, get: (k) => i.secrets[k] || i.config[k] || undefined };
  return { source: 'env', provider: emailProvider(), get: env };
}

export async function sendEmail(m: EmailMessage): Promise<SendResult> {
  return sendEmailWith(await emailSettings(), m);
}

/** Kirim dengan konfigurasi tertentu (dipakai juga oleh "Kirim email uji" sebelum konfigurasi disimpan). */
export async function sendEmailWith(s: { provider: string; get: (k: string) => string | undefined }, m: EmailMessage): Promise<SendResult> {
  const p = s.provider;
  const env = s.get;
  const from = env('EMAIL_FROM') ?? 'RAVE <no-reply@rave.local>';
  switch (p) {
    case 'log':
      // Subjek & isi TIDAK dicatat: subjek OTP memuat kodenya ("123456 adalah kode masuk RAVE") — log produksi tidak boleh berisi kode.
      logger.info({ channel: 'email', to: mask(m.to), tag: m.tag }, 'email (adapter log — tidak dikirim)');
      return { provider: 'log' };
    case 'resend': {
      const r = await http('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html, tags: m.tag ? [{ name: 'category', value: m.tag }] : undefined }),
      });
      return { provider: p, id: r.id };
    }
    case 'mailgun': {
      const base = env('MAILGUN_BASE_URL') ?? 'https://api.mailgun.net';
      const form = new URLSearchParams({ from, to: m.to, subject: m.subject, text: m.text });
      if (m.html) form.set('html', m.html);
      if (m.tag) form.set('o:tag', m.tag);
      const r = await http(`${base}/v3/${env('MAILGUN_DOMAIN')}/messages`, {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(`api:${env('MAILGUN_API_KEY')}`).toString('base64') },
        body: form,
      });
      return { provider: p, id: r.id };
    }
    case 'postmark': {
      const r = await http('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'x-postmark-server-token': env('POSTMARK_SERVER_TOKEN')!, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ From: from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, Tag: m.tag, MessageStream: 'outbound' }),
      });
      return { provider: p, id: r.MessageID };
    }
    case 'webhook': {
      const r = await signedWebhook(env('EMAIL_WEBHOOK_URL')!, { type: 'email', from, ...m }, env('MESSAGING_WEBHOOK_SECRET'));
      return { provider: p, id: r.id };
    }
    default:
      throw new DeliveryError(`EMAIL_PROVIDER tidak dikenal: ${p}`, false);
  }
}

export async function sendWhatsApp(m: WhatsAppMessage): Promise<SendResult> {
  const p = whatsappProvider();
  const to = m.to.replace(/[^\d]/g, '');
  switch (p) {
    case 'log':
      logger.info({ channel: 'whatsapp', to: mask(m.to), otp: !!m.otpCode }, 'whatsapp (adapter log — tidak dikirim)');
      return { provider: 'log' };
    case 'meta': {
      const url = `https://graph.facebook.com/v21.0/${env('WA_PHONE_NUMBER_ID')}/messages`;
      const lang = env('WA_TEMPLATE_LANG') ?? 'id';
      const payload = m.otpCode
        ? {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: env('WA_OTP_TEMPLATE') ?? 'rave_otp',
              language: { code: lang },
              components: [
                { type: 'body', parameters: [{ type: 'text', text: m.otpCode }] },
                { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.otpCode }] },
              ],
            },
          }
        : { messaging_product: 'whatsapp', to, type: 'text', text: { body: m.text } };
      const r = await http(url, { method: 'POST', headers: { authorization: `Bearer ${env('WA_ACCESS_TOKEN')}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return { provider: p, id: r.messages?.[0]?.id };
    }
    case 'webhook': {
      const r = await signedWebhook(env('WHATSAPP_WEBHOOK_URL')!, { type: 'whatsapp', ...m, to });
      return { provider: p, id: r.id };
    }
    default:
      throw new DeliveryError(`WHATSAPP_PROVIDER tidak dikenal: ${p}`, false);
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Email sederhana bermerek RAVE (teks + HTML inline-style, aman untuk klien email). */
export function brandedEmail(opts: { heading: string; lines: string[]; code?: string; cta?: { label: string; url: string }; footer?: string }) {
  const text = [opts.heading, '', ...opts.lines, ...(opts.code ? ['', opts.code] : []), ...(opts.cta ? ['', `${opts.cta.label}: ${opts.cta.url}`] : []), '', opts.footer ?? 'RAVE — Rolliemonkie Audio Visual Experiment'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#181818">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-top:4px solid #f4c21f;border-bottom:4px solid #5b2a6e">
<tr><td style="padding:28px 28px 8px;font-size:22px;font-weight:800;letter-spacing:.04em">RAVE</td></tr>
<tr><td style="padding:8px 28px;font-size:18px;font-weight:700">${esc(opts.heading)}</td></tr>
${opts.lines.map((l) => `<tr><td style="padding:4px 28px;font-size:14px;line-height:1.5;color:#3b3640">${esc(l)}</td></tr>`).join('')}
${opts.code ? `<tr><td style="padding:20px 28px"><div style="display:inline-block;background:#181818;color:#f4c21f;font-size:30px;font-weight:800;letter-spacing:.3em;padding:12px 18px">${esc(opts.code)}</div></td></tr>` : ''}
${opts.cta ? `<tr><td style="padding:16px 28px"><a href="${esc(opts.cta.url)}" style="background:#5b2a6e;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;display:inline-block">${esc(opts.cta.label)}</a></td></tr>` : ''}
<tr><td style="padding:20px 28px 28px;font-size:12px;color:#6b6570">${esc(opts.footer ?? 'RAVE — Rolliemonkie Audio Visual Experiment')}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
