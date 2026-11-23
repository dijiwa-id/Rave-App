import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AlertMessage, buildMime, describeChannels, emailBody, redact, sendAlert, smtpOptsFrom, subjectOf, webhookFormat, webhookPayload } from './alert-channels.js';

const env = (o: Record<string, string>) => (k: string) => o[k];
const msg: AlertMessage = { kind: 'problem', env: 'prod', level: 'CRITICAL', title: 'prod CRITICAL: http.status (vps)', lines: ['[CRITICAL] http.status: HTTP 502'] };

describe('format webhook', () => {
  it('mengenali Slack/Discord/Telegram dari host, selain itu generik', () => {
    expect(webhookFormat('https://hooks.slack.com/services/A/B/C')).toBe('slack');
    expect(webhookFormat('https://discord.com/api/webhooks/1/x')).toBe('discord');
    expect(webhookFormat('https://api.telegram.org/bot123:abc/sendMessage')).toBe('telegram');
    expect(webhookFormat('https://n8n.example/hook')).toBe('generic');
    expect(webhookFormat('https://hooks.slack.com/x', 'generic')).toBe('generic');
  });
  it('payload sesuai kanal', () => {
    expect(Object.keys(webhookPayload('slack', msg, env({})))).toEqual(['text']);
    expect(Object.keys(webhookPayload('discord', msg, env({})))).toEqual(['content']);
    expect(webhookPayload('telegram', msg, env({ ALERT_TELEGRAM_CHAT_ID: '42' }))).toMatchObject({ chat_id: '42' });
    const g = webhookPayload('generic', msg, env({}));
    expect(g).toMatchObject({ source: 'rave-monitor', kind: 'problem', level: 'CRITICAL', subject: '[RAVE ALERT] prod CRITICAL: http.status (vps)' });
  });
});

describe('subjek & isi email', () => {
  it('awalan sesuai jenis, isi tanpa secret', () => {
    expect(subjectOf(msg)).toBe('[RAVE ALERT] prod CRITICAL: http.status (vps)');
    expect(subjectOf({ ...msg, kind: 'recovered' })).toMatch(/^\[RAVE PULIH\]/);
    expect(subjectOf({ ...msg, kind: 'test' })).toMatch(/^\[RAVE UJI\]/);
    expect(emailBody(msg)).toContain('- [CRITICAL] http.status: HTTP 502');
  });
  it('MIME base64 UTF-8, subjek non-ASCII di-encode RFC 2047', () => {
    const m = buildMime('RAVE <ops@rave.test>', ['a@x.test'], 'RAVE — pulih', 'baris\n.titik');
    expect(m).toContain('Subject: =?UTF-8?B?');
    expect(m).toContain('Content-Transfer-Encoding: base64');
    expect(m).toMatch(/Message-ID: <[^@]+@rave\.test>/);
  });
});

describe('penyamaran secret', () => {
  it('menghapus URL webhook, path token, dan password SMTP', () => {
    const get = env({ ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/SECRETTOKEN', ALERT_SMTP_URL: 'smtps://u%40x.test:p%40ss%20word@smtp.x.test:465' });
    const out = redact('gagal https://hooks.slack.com/services/T000/B000/SECRETTOKEN dan p@ss word dan /services/T000/B000/SECRETTOKEN', get);
    expect(out).not.toContain('SECRETTOKEN');
    expect(out).not.toContain('p@ss word');
  });
  it('deskripsi kanal tidak memuat password / token', () => {
    const d = describeChannels(
      env({ ALERT_EMAIL_TO: 'dijiwa@example.test', ALERT_SMTP_URL: 'smtps://ops%40x.test:hunter2secret@smtp.x.test:465', ALERT_WEBHOOK_URL: 'https://api.telegram.org/bot123:TOKENxyz/sendMessage' }),
    ).join('\n');
    expect(d).not.toMatch(/hunter2secret|TOKENxyz/);
    expect(d).toContain('smtp TLS smtp.x.test:465');
    expect(d).toContain('d***@example.test');
  });
});

describe('konfigurasi SMTP', () => {
  it('URL smtps/smtp + variabel terpisah', () => {
    expect(smtpOptsFrom(env({ ALERT_SMTP_URL: 'smtps://a%40b.c:x%20y@h:465' }))).toMatchObject({ host: 'h', port: 465, secure: true, user: 'a@b.c', pass: 'x y' });
    expect(smtpOptsFrom(env({ ALERT_SMTP_URL: 'smtp://h' }))).toMatchObject({ port: 587, secure: false });
    expect(smtpOptsFrom(env({ ALERT_SMTP_HOST: 'h', ALERT_SMTP_PORT: '465', ALERT_SMTP_PASS: 'a b' }))).toMatchObject({ secure: true, pass: 'a b' });
    expect(() => smtpOptsFrom(env({ ALERT_SMTP_URL: 'http://h' }))).toThrow();
  });
  it('email tanpa penyedia → kanal ditandai tidak aktif, bukan diam-diam hilang', async () => {
    const get = env({ ALERT_EMAIL_TO: 'a@x.test' });
    expect(describeChannels(get)[0]).toMatch(/TIDAK AKTIF/);
    const [r] = await sendAlert(msg, get);
    expect(r.ok).toBe(false);
  });
});

describe('SMTP ujung ke ujung (server tiruan loopback)', () => {
  let server: net.Server;
  let port = 0;
  const got: { auth?: string; rcpt: string[]; data: string } = { rcpt: [], data: '' };
  beforeAll(async () => {
    server = net.createServer((s) => {
      let buf = '';
      let inData = false;
      s.write('220 test\r\n');
      s.on('data', (d) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              s.write('250 queued\r\n');
            } else got.data += line + '\n';
          } else if (line.startsWith('EHLO')) s.write('250-test\r\n250 AUTH PLAIN\r\n');
          else if (line.startsWith('AUTH PLAIN ')) {
            got.auth = Buffer.from(line.slice(11), 'base64').toString();
            s.write('235 ok\r\n');
          } else if (line.startsWith('RCPT TO:')) {
            got.rcpt.push(line.slice(8));
            s.write('250 ok\r\n');
          } else if (line === 'DATA') {
            inData = true;
            s.write('354 go\r\n');
          } else if (line === 'QUIT') s.end('221 bye\r\n');
          else s.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as net.AddressInfo).port;
  });
  afterAll(() => server.close());

  it('mengirim ke semua penerima dengan AUTH (loopback boleh tanpa TLS)', async () => {
    const get = env({ ALERT_EMAIL_TO: 'a@x.test, b@x.test', ALERT_EMAIL_FROM: 'RAVE <ops@x.test>', ALERT_SMTP_URL: `smtp://ops%40x.test:s3cret@127.0.0.1:${port}` });
    const [r] = await sendAlert(msg, get);
    expect(r).toMatchObject({ channel: 'email', ok: true, detail: 'SMTP 250' });
    expect(got.auth).toBe('\0ops@x.test\0s3cret');
    expect(got.rcpt).toEqual(['<a@x.test>', '<b@x.test>']);
    const body = Buffer.from(got.data.split('\n\n')[1].replace(/\n/g, ''), 'base64').toString();
    expect(body).toContain('[RAVE ALERT] prod CRITICAL');
  });
});
