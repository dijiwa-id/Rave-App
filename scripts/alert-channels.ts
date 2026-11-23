// Kanal alert operasional RAVE: webhook (generik/Slack/Discord/Telegram) dan email (SMTP atau Resend HTTP API).
//
// Sengaja TANPA dependensi (hanya modul bawaan Node) dan hanya memakai sintaks TypeScript yang bisa di-"strip" Node
// (≥ 22.18) agar bisa dijalankan langsung oleh workflow uptime GitHub Actions tanpa `npm ci`:
//
//   node scripts/alert-channels.ts --kind test                     # kirim alert uji ke semua kanal yang dikonfigurasi
//   node scripts/alert-channels.ts --kind problem --title "…" --line "…" [--line "…"]
//   node scripts/alert-channels.ts --describe                      # tampilkan kanal (tersamar), tanpa mengirim
//
// Dipakai juga oleh scripts/monitor.ts. Alert TIDAK bergantung pada service RAVE (notification/platform) — alert justru
// paling dibutuhkan saat service itu mati — sehingga kredensial kanal dibaca langsung dari env (lihat docs/OPERATIONS.md §2).
//
// Env:
//   ALERT_WEBHOOK_URL            webhook; format otomatis dari host (Slack/Discord/Telegram) atau ALERT_WEBHOOK_FORMAT
//   ALERT_WEBHOOK_FORMAT         auto | generic | slack | discord | telegram
//   ALERT_TELEGRAM_CHAT_ID       wajib untuk format telegram (URL = https://api.telegram.org/bot<token>/sendMessage)
//   ALERT_EMAIL_TO               penerima email, dipisah koma — mengaktifkan kanal email
//   ALERT_EMAIL_FROM             pengirim (default: user SMTP bila berupa alamat email, selain itu EMAIL_FROM)
//   ALERT_EMAIL_PROVIDER         auto | smtp | resend (auto: smtp bila ALERT_SMTP_URL/HOST ada, selain itu resend bila ada key)
//   ALERT_SMTP_URL               smtps://user:pass@smtp.gmail.com:465 (TLS langsung) atau smtp://user:pass@host:587 (STARTTLS)
//   ALERT_SMTP_HOST/PORT/USER/PASS/SECURE   alternatif URL (PASS tidak perlu di-URL-encode)
//   ALERT_RESEND_API_KEY         default RESEND_API_KEY; ALERT_RESEND_BASE_URL hanya untuk uji
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

export type AlertKind = 'problem' | 'recovered' | 'test';
export interface AlertMessage {
  kind: AlertKind;
  /** Mis. "prod" / "uptime". */
  env: string;
  /** OK | WARN | CRITICAL | DOWN … */
  level: string;
  /** Judul satu baris TANPA emoji, mis. "prod CRITICAL: http.status, svc.iam". */
  title: string;
  /** Rincian (satu masalah per baris). */
  lines: string[];
  /** Data terstruktur tambahan untuk webhook generik. */
  data?: Record<string, unknown>;
}
export type Getter = (k: string) => string | undefined;
export interface ChannelResult {
  channel: string;
  ok: boolean;
  detail: string;
}
interface Channel {
  name: string;
  /** Deskripsi tersamar (aman dicetak). */
  describe: string;
  send(m: AlertMessage): Promise<string>;
}

const PREFIX: Record<AlertKind, string> = { problem: '[RAVE ALERT]', recovered: '[RAVE PULIH]', test: '[RAVE UJI]' };
const ICON: Record<AlertKind, string> = { problem: '\u{1F534}', recovered: '✅', test: '\u{1F9EA}' };

export const subjectOf = (m: AlertMessage) => `${PREFIX[m.kind]} ${m.title}`.slice(0, 200);
export const chatText = (m: AlertMessage) =>
  [`${m.kind === 'problem' && m.level === 'WARN' ? '\u{1F7E0}' : ICON[m.kind]} ${PREFIX[m.kind]} ${m.title}`, ...m.lines.map((l) => `• ${l}`)].join('\n');
export function emailBody(m: AlertMessage): string {
  const head =
    m.kind === 'recovered'
      ? 'Status kembali normal.'
      : m.kind === 'test'
        ? 'Ini alert UJI — kanal alert berfungsi. Tidak perlu tindakan.'
        : 'Ada masalah yang perlu ditindaklanjuti.';
  return [
    `${PREFIX[m.kind]} ${m.title}`,
    '',
    head,
    '',
    ...(m.lines.length ? [...m.lines.map((l) => `- ${l}`), ''] : []),
    `Waktu   : ${new Date().toISOString()}`,
    `Dikirim : ${hostname()} (${m.env})`,
    'Runbook : docs/OPERATIONS.md §2 "Menindaklanjuti alert"',
  ].join('\n');
}

// ---------------- Penyamaran secret ----------------
const SECRET_KEYS = ['ALERT_WEBHOOK_URL', 'ALERT_SMTP_URL', 'ALERT_SMTP_PASS', 'ALERT_RESEND_API_KEY', 'RESEND_API_KEY'];
/** Hapus nilai secret (dan bagian-bagiannya yang sering muncul di pesan galat) dari teks sebelum dicetak/dikirim. */
export function redact(s: string, get: Getter): string {
  const needles = new Set<string>();
  for (const k of SECRET_KEYS) {
    const v = get(k);
    if (!v) continue;
    needles.add(v);
    try {
      const u = new URL(v);
      if (u.password) needles.add(decodeURIComponent(u.password)).add(u.password);
      if (u.pathname.length > 8) needles.add(u.pathname); // token di path webhook (Slack/Discord/Telegram)
    } catch {
      /* bukan URL */
    }
  }
  let out = s;
  for (const n of [...needles].filter((n) => n.length >= 6).sort((a, b) => b.length - a.length)) out = out.split(n).join('***');
  return out;
}

const maskEmail = (a: string) => a.replace(/^(.)[^@]*(@.*)$/, '$1***$2');
const addrOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();

// ---------------- Webhook ----------------
type WebhookFormat = 'generic' | 'slack' | 'discord' | 'telegram';
export function webhookFormat(url: string, forced?: string): WebhookFormat {
  const f = (forced ?? 'auto').toLowerCase();
  if (f === 'generic' || f === 'slack' || f === 'discord' || f === 'telegram') return f;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* URL tidak valid → generic; galat muncul saat kirim */
  }
  if (host === 'hooks.slack.com') return 'slack';
  if (host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) return 'discord';
  if (host === 'api.telegram.org') return 'telegram';
  return 'generic';
}
export function webhookPayload(fmt: WebhookFormat, m: AlertMessage, get: Getter): Record<string, unknown> {
  const text = chatText(m);
  if (fmt === 'slack') return { text };
  if (fmt === 'discord') return { content: text.slice(0, 1900) };
  if (fmt === 'telegram') return { chat_id: get('ALERT_TELEGRAM_CHAT_ID'), text: text.slice(0, 4000), disable_web_page_preview: true };
  // Generik: `text` dipahami Slack/Mattermost/Google Chat, `content` oleh Discord; sisanya untuk n8n/Zapier/relay.
  return { text, content: text.slice(0, 1900), subject: subjectOf(m), source: 'rave-monitor', kind: m.kind, env: m.env, level: m.level, ...(m.data ?? {}) };
}

function webhookChannel(get: Getter): Channel | null {
  const url = get('ALERT_WEBHOOK_URL');
  if (!url) return null;
  const fmt = webhookFormat(url, get('ALERT_WEBHOOK_FORMAT'));
  let host = '?';
  try {
    host = new URL(url).host;
  } catch {
    host = 'URL tidak valid';
  }
  return {
    name: 'webhook',
    describe: `webhook ${fmt} → ${host}`,
    async send(m) {
      if (fmt === 'telegram' && !get('ALERT_TELEGRAM_CHAT_ID')) throw new Error('ALERT_TELEGRAM_CHAT_ID belum di-set');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'rave-monitor' },
        body: JSON.stringify(webhookPayload(fmt, m, get)),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return `HTTP ${res.status}`;
    },
  };
}

// ---------------- Email ----------------
function b64wrap(s: string) {
  return (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

export function buildMime(from: string, to: string[], subject: string, text: string): string {
  const domain = addrOf(from).split('@')[1] ?? 'rave.local';
  return [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    'X-Mailer: rave-monitor',
    '',
    b64wrap(text.replace(/\r?\n/g, '\r\n')),
  ].join('\r\n');
}

interface SmtpOpts {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  timeoutMs?: number;
}
export function smtpOptsFrom(get: Getter): SmtpOpts | null {
  const raw = get('ALERT_SMTP_URL');
  if (raw) {
    const u = new URL(raw);
    if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('ALERT_SMTP_URL harus smtp:// atau smtps://');
    const secure = u.protocol === 'smtps:';
    return {
      host: u.hostname,
      port: Number(u.port || (secure ? 465 : 587)),
      secure,
      user: get('ALERT_SMTP_USER') ?? (u.username ? decodeURIComponent(u.username) : undefined),
      pass: get('ALERT_SMTP_PASS') ?? (u.password ? decodeURIComponent(u.password) : undefined),
    };
  }
  const host = get('ALERT_SMTP_HOST');
  if (!host) return null;
  const port = Number(get('ALERT_SMTP_PORT') || 587);
  const sec = (get('ALERT_SMTP_SECURE') ?? '').toLowerCase();
  return { host, port, secure: sec ? sec === '1' || sec === 'true' : port === 465, user: get('ALERT_SMTP_USER'), pass: get('ALERT_SMTP_PASS') };
}

const isLoopback = (h: string) => h === 'localhost' || h === '::1' || /^127\./.test(h);

/** Klien SMTP minimal: TLS langsung (465) atau STARTTLS (587), AUTH PLAIN/LOGIN. Kredensial tidak pernah dikirim tanpa TLS
 *  kecuali ke relay loopback (mis. postfix lokal). Sertifikat server SELALU diverifikasi. */
export async function smtpSend(o: SmtpOpts, from: string, to: string[], mime: string): Promise<string> {
  let sock: net.Socket = o.secure ? tls.connect({ host: o.host, port: o.port, servername: o.host }) : net.connect({ host: o.host, port: o.port });
  let buf = '';
  let waiter: ((v: { code: number; text: string }) => void) | null = null;
  let failer: ((e: Error) => void) | null = null;
  let failure: Error | null = null;
  const replies: { code: number; text: string }[] = [];
  let acc: string[] = [];
  const onData = (d: Buffer) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      acc.push(line.slice(4));
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const r = { code: Number(line.slice(0, 3)), text: acc.join('\n') };
        acc = [];
        if (waiter) {
          const w = waiter;
          waiter = failer = null;
          w(r);
        } else replies.push(r);
      }
    }
  };
  const onErr = (e: Error) => {
    failure = e;
    if (failer) {
      const f = failer;
      waiter = failer = null;
      f(e);
    }
  };
  const attach = (s: net.Socket) => {
    s.on('data', onData);
    s.on('error', onErr);
    s.on('close', () => onErr(new Error('koneksi SMTP ditutup server')));
  };
  attach(sock);
  const timer = setTimeout(() => {
    onErr(new Error(`SMTP timeout ${o.timeoutMs ?? 20_000} ms`));
    sock.destroy();
  }, o.timeoutMs ?? 20_000);
  const read = () =>
    new Promise<{ code: number; text: string }>((res, rej) => {
      if (replies.length) return res(replies.shift()!);
      if (failure) return rej(failure);
      waiter = res;
      failer = rej;
    });
  const cmd = async (line: string | null, expect: number[], label = line?.split(' ')[0] ?? 'greeting') => {
    if (line !== null) sock.write(line + '\r\n');
    const r = await read();
    if (!expect.includes(r.code)) throw new Error(`SMTP ${label} ditolak: ${r.code} ${r.text.split('\n')[0]}`);
    return r;
  };
  try {
    await cmd(null, [220]);
    const helo = `EHLO ${hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'rave-monitor'}`;
    let ehlo = await cmd(helo, [250]);
    let secure = o.secure;
    if (!secure && /^STARTTLS\b/im.test(ehlo.text)) {
      await cmd('STARTTLS', [220]);
      sock.removeAllListeners('data');
      sock.removeAllListeners('error');
      sock.removeAllListeners('close');
      const plain = sock;
      sock = await new Promise<tls.TLSSocket>((res, rej) => {
        const t = tls.connect({ socket: plain, servername: o.host }, () => res(t));
        t.once('error', rej);
      });
      attach(sock);
      secure = true;
      ehlo = await cmd(helo, [250]);
    }
    if (o.user) {
      if (!secure && !isLoopback(o.host)) throw new Error('server SMTP tidak menawarkan STARTTLS — menolak mengirim kredensial tanpa TLS');
      const mech = ehlo.text.match(/^AUTH[ =](.*)$/im)?.[1]?.toUpperCase().split(/\s+/) ?? [];
      if (mech.includes('PLAIN') || !mech.includes('LOGIN')) {
        await cmd(`AUTH PLAIN ${Buffer.from(`\0${o.user}\0${o.pass ?? ''}`).toString('base64')}`, [235], 'AUTH');
      } else {
        await cmd('AUTH LOGIN', [334], 'AUTH');
        await cmd(Buffer.from(o.user).toString('base64'), [334], 'AUTH');
        await cmd(Buffer.from(o.pass ?? '').toString('base64'), [235], 'AUTH');
      }
    }
    await cmd(`MAIL FROM:<${addrOf(from)}>`, [250]);
    for (const r of to) await cmd(`RCPT TO:<${addrOf(r)}>`, [250, 251]);
    await cmd('DATA', [354]);
    const body = mime.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const done = await cmd(`${body}\r\n.`, [250], 'DATA');
    sock.write('QUIT\r\n');
    return `SMTP ${done.code}`;
  } finally {
    clearTimeout(timer);
    sock.removeAllListeners('close');
    sock.on('error', () => {});
    sock.end();
  }
}

function emailChannel(get: Getter): Channel | null {
  const toRaw = get('ALERT_EMAIL_TO');
  if (!toRaw) return null;
  const to = toRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const want = (get('ALERT_EMAIL_PROVIDER') ?? 'auto').toLowerCase();
  let smtp: SmtpOpts | null = null;
  let smtpErr: string | null = null;
  try {
    smtp = smtpOptsFrom(get);
  } catch (e: any) {
    smtpErr = e?.message ?? String(e);
  }
  const resendKey = get('ALERT_RESEND_API_KEY') ?? get('RESEND_API_KEY');
  const provider = want === 'smtp' || want === 'resend' ? want : smtp || smtpErr ? 'smtp' : resendKey ? 'resend' : 'none';
  // SMTP akun biasa (Gmail dsb.) hanya boleh mengirim atas nama akunnya → user SMTP didahulukan sebelum EMAIL_FROM platform.
  const smtpUser = smtp?.user?.includes('@') ? smtp.user : undefined;
  const from = get('ALERT_EMAIL_FROM') ?? (provider === 'smtp' ? smtpUser ?? get('EMAIL_FROM') : get('EMAIL_FROM'));
  const toDesc = to.map(maskEmail).join(', ');
  const fail = (why: string): Channel => ({
    name: 'email',
    describe: `email TIDAK AKTIF (${why}) → ${toDesc}`,
    async send() {
      throw new Error(why);
    },
  });
  if (provider === 'none') return fail('ALERT_SMTP_URL/ALERT_SMTP_HOST atau RESEND_API_KEY belum di-set');
  if (!from) return fail('ALERT_EMAIL_FROM belum di-set');
  if (provider === 'smtp') {
    if (smtpErr) return fail(smtpErr);
    if (!smtp) return fail('ALERT_SMTP_URL/ALERT_SMTP_HOST belum di-set');
    const s = smtp;
    return {
      name: 'email',
      describe: `email smtp ${s.secure ? 'TLS' : 'STARTTLS'} ${s.host}:${s.port}${s.user ? ` (auth ${maskEmail(s.user)})` : ''} dari ${maskEmail(addrOf(from))} → ${toDesc}`,
      send: (m) => smtpSend(s, from, to, buildMime(from, to, subjectOf(m), emailBody(m))),
    };
  }
  if (!resendKey) return fail('RESEND_API_KEY/ALERT_RESEND_API_KEY belum di-set');
  const base = (get('ALERT_RESEND_BASE_URL') ?? 'https://api.resend.com').replace(/\/$/, '');
  return {
    name: 'email',
    describe: `email resend ${new URL(base).host} dari ${maskEmail(addrOf(from))} → ${toDesc}`,
    async send(m) {
      const res = await fetch(`${base}/emails`, {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json', 'user-agent': 'rave-monitor' },
        body: JSON.stringify({ from, to, subject: subjectOf(m), text: emailBody(m), tags: [{ name: 'category', value: 'ops_alert' }] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
      return `Resend HTTP ${res.status}`;
    },
  };
}

export function channels(get: Getter): Channel[] {
  return [webhookChannel(get), emailChannel(get)].filter((c): c is Channel => !!c);
}
export const describeChannels = (get: Getter) => channels(get).map((c) => c.describe);

/** Kirim ke semua kanal; galat satu kanal tidak menghentikan kanal lain. Detail sudah disamarkan. */
export async function sendAlert(m: AlertMessage, get: Getter): Promise<ChannelResult[]> {
  return Promise.all(
    channels(get).map(async (c) => {
      try {
        return { channel: c.name, ok: true, detail: redact(await c.send(m), get) };
      } catch (e: any) {
        const why = e?.cause?.code ?? e?.code ?? e?.message ?? String(e);
        return { channel: c.name, ok: false, detail: redact(String(why), get) };
      }
    }),
  );
}

// ---------------- CLI (workflow uptime / uji manual) ----------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const get: Getter = (k) => process.env[k] || undefined;
  const list = describeChannels(get);
  if (argv.includes('--describe')) {
    console.log(list.length ? list.join('\n') : 'tidak ada kanal alert yang dikonfigurasi');
    process.exit(0);
  }
  const kind = (opt('--kind') ?? 'test') as AlertKind;
  if (!['problem', 'recovered', 'test'].includes(kind)) {
    console.error('--kind harus problem | recovered | test');
    process.exit(64);
  }
  const lines: string[] = [];
  argv.forEach((a, i) => a === '--line' && argv[i + 1] !== undefined && lines.push(argv[i + 1]));
  const env = opt('--env') ?? 'uptime';
  const m: AlertMessage = {
    kind,
    env,
    level: opt('--level') ?? (kind === 'problem' ? 'CRITICAL' : 'OK'),
    title: opt('--title') ?? (kind === 'test' ? `${env} uji alert dari ${hostname()}` : `${env} ${kind}`),
    lines,
  };
  if (!list.length) {
    console.error('tidak ada kanal alert yang dikonfigurasi (ALERT_WEBHOOK_URL / ALERT_EMAIL_TO)');
    process.exit(1);
  }
  const res = await sendAlert(m, get);
  for (const r of res) console.log(`${r.ok ? 'OK  ' : 'GAGAL'} ${r.channel}: ${r.detail}`);
  process.exit(res.some((r) => r.ok) ? 0 : 1);
}
