import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandedEmail, DeliveryError, messagingStatus, sendEmail, sendEmailWith, sendWhatsApp, setMessagingLogger } from './messaging.js';
import { invalidateIntegration, setIntegrationLoader } from './integrations.js';

const KEYS = ['EMAIL_PROVIDER', 'EMAIL_FROM', 'RESEND_API_KEY', 'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'POSTMARK_SERVER_TOKEN', 'EMAIL_WEBHOOK_URL', 'WHATSAPP_PROVIDER', 'WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'WHATSAPP_WEBHOOK_URL'];
const saved: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1', messages: [{ id: 'wamid.1' }] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  setMessagingLogger({ info: () => {}, warn: () => {} });
  // Tanpa konfigurasi dasbor → env.
  setIntegrationLoader(async () => null);
  invalidateIntegration();
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  vi.unstubAllGlobals();
});

describe('messaging', () => {
  it('default log: tidak memanggil jaringan dan dilaporkan belum siap', async () => {
    expect(await sendEmail({ to: 'a@b.co', subject: 's', text: 't' })).toEqual({ provider: 'log' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messagingStatus().ready).toBe(false);
  });

  it('resend: POST JSON dengan bearer key', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'RAVE <no-reply@x.id>', RESEND_API_KEY: 're_test' });
    expect(messagingStatus()).toMatchObject({ email: 'resend', ready: true, missing: [] });
    const r = await sendEmail({ to: 'fan@x.id', subject: 'Kode', text: '123456', tag: 'otp' });
    expect(r).toEqual({ provider: 'resend', id: 'msg_1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as any).authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'RAVE <no-reply@x.id>', to: ['fan@x.id'], subject: 'Kode' });
  });

  it('mailgun: form-encoded dengan basic auth ke domain', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'mailgun', EMAIL_FROM: 'x@y.id', MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.y.id' });
    await sendEmail({ to: 'fan@x.id', subject: 'S', text: 'T' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.mailgun.net/v3/mg.y.id/messages');
    expect((init.headers as any).authorization).toBe('Basic ' + Buffer.from('api:k').toString('base64'));
    expect(String(init.body)).toContain('to=fan%40x.id');
  });

  it('konfigurasi tidak lengkap terdeteksi', () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'postmark', WHATSAPP_PROVIDER: 'meta' });
    const s = messagingStatus();
    expect(s.ready).toBe(false);
    expect(s.missing).toEqual(expect.arrayContaining(['EMAIL_FROM', 'POSTMARK_SERVER_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN']));
  });

  it('HTTP 5xx/429 = dapat dicoba ulang; 4xx lain = permanen', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'x@y.id', RESEND_API_KEY: 'k' });
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 }));
    await expect(sendEmail({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toMatchObject({ retryable: true });
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 422 }));
    const e = await sendEmail({ to: 'a@b.co', subject: 's', text: 't' }).catch((x) => x);
    expect(e).toBeInstanceOf(DeliveryError);
    expect(e.retryable).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(sendEmail({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toMatchObject({ retryable: true });
  });

  it('whatsapp meta: OTP lewat templat autentikasi, nomor tanpa simbol', async () => {
    Object.assign(process.env, { WHATSAPP_PROVIDER: 'meta', WA_PHONE_NUMBER_ID: '123', WA_ACCESS_TOKEN: 'tok' });
    const r = await sendWhatsApp({ to: '+62 812-3456-7890', text: 'x', otpCode: '654321' });
    expect(r).toEqual({ provider: 'meta', id: 'wamid.1' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ to: '6281234567890', type: 'template' });
    expect(JSON.stringify(body)).toContain('654321');
  });

  it('webhook: body ditandatangani HMAC dengan timestamp', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'webhook', EMAIL_FROM: 'x@y.id', EMAIL_WEBHOOK_URL: 'https://relay.example/send' });
    await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    const h = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(h['x-rave-timestamp']).toMatch(/^\d+$/);
    expect(h['x-rave-signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('konfigurasi dasbor menang atas env', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'env@x.id', RESEND_API_KEY: 'env_key' });
    setIntegrationLoader(async () => ({ kind: 'email', provider: 'postmark', config: { EMAIL_FROM: 'dash@x.id' }, secrets: { POSTMARK_SERVER_TOKEN: 'pm_tok' }, updated_at: '' }));
    invalidateIntegration();
    await sendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init.headers as any)['x-postmark-server-token']).toBe('pm_tok');
    expect(JSON.parse(init.body as string).From).toBe('dash@x.id');
  });

  it('brandedEmail meng-escape HTML dan memuat kode', () => {
    const m = brandedEmail({ heading: '<b>Hai</b>', lines: ['a & b'], code: '123456' });
    expect(m.html).toContain('&lt;b&gt;Hai&lt;/b&gt;');
    expect(m.html).toContain('a &amp; b');
    expect(m.text).toContain('123456');
  });
});

describe('adapter email log', () => {
  it('tidak mencatat subjek/isi (kode OTP tidak boleh masuk log)', async () => {
    const logged: string[] = [];
    setMessagingLogger({ info: (o, m) => logged.push(JSON.stringify(o) + m), warn: (o, m) => logged.push(JSON.stringify(o) + m) });
    await sendEmailWith({ provider: 'log', get: () => undefined }, { to: 'user@example.com', subject: '482913 adalah kode masuk RAVE', text: 'kode 482913', html: '<b>482913</b>', tag: 'otp' });
    expect(logged.length).toBe(1);
    expect(logged.join('')).not.toContain('482913');
  });
});
