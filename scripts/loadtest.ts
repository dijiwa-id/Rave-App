// Uji beban endpoint pemutaran & checkout tiket (BRD §15.1 "uji beban endpoint pemutaran dan checkout tiket").
// Generator beban berbasis fetch bawaan Node (tanpa dependensi): N virtual user (VU) berjalan paralel selama durasi tertentu.
//
//   npm run loadtest:playback -- --vus 10 --duration 30s
//   npm run loadtest:checkout -- --vus 10 --duration 30s
//   npm run loadtest:browse   -- --vus 10 --duration 30s
//   npm run loadtest -- --scenario playback --target http://127.0.0.1:5173 --think 250 --out hasil.json
//
// Skenario:
//   playback  sesi pemutaran → GET stream (302) → [byte pertama media bila origin lokal] → event start → event progress (15 dtk, < ambang royalti)
//   checkout  order tiket ber-Idempotency-Key → replay key yang sama (cek idempoten) → bayar sandbox → tunggu PAID → cek tidak oversell
//   browse    beranda katalog, pencarian, rilis, daftar event (baca)
//
// Default menyasar stack dev (gateway :8080). Target lain (mis. produksi lokal :8088) DITOLAK kecuali --allow-prod.
// Respons 429 (rate limit gateway) dicatat terpisah, tidak dihitung sebagai galat — lihat docs/OPERATIONS.md §3.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { SEED } from '@rave/domain';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const devEnv: Record<string, string> = existsSync(join(ROOT, '.env')) ? (parseEnv(readFileSync(join(ROOT, '.env'), 'utf8')) as Record<string, string>) : {};
const DEV_GATEWAY_PORT = devEnv.GATEWAY_PORT || '8080';

// ---------------- Argumen ----------------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d?: string) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
if (flag('--help') || flag('-h')) {
  console.log(`Pakai: node --import tsx scripts/loadtest.ts --scenario playback|checkout|browse [opsi]
  --target URL        gateway/web (default http://127.0.0.1:${DEV_GATEWAY_PORT}; alias: dev, web=:5173, prod=:8088)
  --vus N             virtual user paralel (default 10)
  --duration 30s      durasi (s/m; default 30s)
  --think MS          jeda antar-iterasi per VU (default: playback 500, browse 250, checkout 2000)
  --anon              playback/browse tanpa login (pratinjau anonim; bucket rate limit per IP)
  --accounts PREFIX   akun uji: <PREFIX>-<n>@rave.test (default loadtest)
  --tokens-file F     JSON array access token (target tanpa dev_code OTP, mis. produksi)
  --raise-limits      login Super Admin, naikkan rate limit umum/OTP selama uji, lalu kembalikan (dev)
  --event ID          checkout: pakai event yang sudah ada (tidak dibatalkan di akhir)
  --quota N           checkout: kuota event uji (default vus×2 — sengaja bisa habis untuk menguji oversell)
  --keep-event        checkout: jangan batalkan event uji di akhir
  --fetch-media       playback: ambil byte pertama media walau origin eksternal (default hanya origin lokal)
  --out FILE          simpan hasil JSON
  --allow-prod        izinkan target selain stack dev
  --strict            exit 1 juga bila ada WARN latensi`);
  process.exit(0);
}

const SCENARIO = opt('--scenario', 'playback')!;
if (!['playback', 'checkout', 'browse'].includes(SCENARIO)) {
  console.error(`✗ skenario tidak dikenal: ${SCENARIO} (playback|checkout|browse)`);
  process.exit(2);
}
const ALIASES: Record<string, string> = { dev: `http://127.0.0.1:${DEV_GATEWAY_PORT}`, web: 'http://127.0.0.1:5173', prod: 'http://127.0.0.1:8088' };
const rawTarget = opt('--target', process.env.LOADTEST_TARGET ?? 'dev')!;
const TARGET = (ALIASES[rawTarget] ?? rawTarget).replace(/\/$/, '');
const VUS = Math.max(1, Number(opt('--vus', '10')));
const DURATION_MS = parseDuration(opt('--duration', '30s')!);
const THINK_MS = Number(opt('--think', SCENARIO === 'checkout' ? '2000' : SCENARIO === 'browse' ? '250' : '500'));
const ACCOUNT_PREFIX = opt('--accounts', 'loadtest')!;

function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(s.trim());
  if (!m) throw new Error(`durasi tidak valid: ${s}`);
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : m[2] === 'm' ? n * 60_000 : n * 1000;
}

// Pengaman: hanya stack dev tanpa --allow-prod.
{
  const u = new URL(TARGET);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname);
  const devPorts = new Set([DEV_GATEWAY_PORT, '5173']);
  if (!(loopback && devPorts.has(u.port)) && !flag('--allow-prod')) {
    console.error(`✗ ${TARGET} bukan stack dev (gateway :${DEV_GATEWAY_PORT} / web :5173). Uji beban terhadap produksi(-lokal) membuat data uji\n  dan memakan kuota rate limit pengguna nyata — tambahkan --allow-prod bila memang disengaja.`);
    process.exit(2);
  }
}

// ---------------- Statistik ----------------
type Kind = 'read' | 'write' | 'ttfa' | 'async';
interface Step {
  kind: Kind;
  ok: number[]; // latensi (ms) respons yang dianggap berhasil
  errors: number;
  limited: number; // 429
  expected: number; // penolakan bisnis yang wajar (mis. 409 tiket habis)
  statuses: Record<string, number>;
  samples: string[]; // contoh galat (maks 5)
}
const steps = new Map<string, Step>();
const STEP_KIND: Record<string, Kind> = {};
function step(name: string, kind: Kind): Step {
  let s = steps.get(name);
  if (!s) {
    s = { kind, ok: [], errors: 0, limited: 0, expected: 0, statuses: {}, samples: [] };
    steps.set(name, s);
    STEP_KIND[name] = kind;
  }
  return s;
}
let totalRequests = 0;
let running = true;
/** Diset ulang tepat sebelum VU mulai (login & persiapan tidak memakan durasi uji). */
let startedAt = Date.now();
let endedAt = 0;
const deadline = () => startedAt + DURATION_MS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);

interface Res {
  status: number;
  ms: number;
  data: any;
  headers: Headers;
  error?: string;
}

/** Satu permintaan HTTP + pencatatan. `expect` = status yang dianggap wajar selain 2xx/3xx (dicatat terpisah). */
async function req(
  name: string,
  kind: Kind,
  method: string,
  path: string,
  o: { token?: string | null; body?: unknown; idem?: string; expect?: number[]; headers?: Record<string, string>; raw?: boolean } = {},
): Promise<Res> {
  const st = step(name, kind);
  const t = performance.now();
  totalRequests++;
  try {
    const r = await fetch(path.startsWith('http') ? path : TARGET + path, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'user-agent': 'rave-loadtest',
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.idem ? { 'idempotency-key': o.idem } : {}),
        ...o.headers,
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    let data: any = null;
    if (o.raw) {
      // Byte pertama saja (TTFB media); sisa body dibatalkan.
      const reader = r.body?.getReader();
      if (reader) {
        await reader.read();
        await reader.cancel().catch(() => {});
      }
    } else {
      const text = await r.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
    }
    const ms = performance.now() - t;
    st.statuses[r.status] = (st.statuses[r.status] ?? 0) + 1;
    if (r.status === 429) st.limited++;
    else if (r.status < 400) st.ok.push(ms);
    else if (o.expect?.includes(r.status)) {
      st.expected++;
      // Latensi penolakan bisnis (mis. 409 habis) dilaporkan di baris tersendiri, tidak mencampuri latensi sukses.
      step(`${name} [${r.status}]`, kind).ok.push(ms);
    }
    else {
      st.errors++;
      if (st.samples.length < 5) st.samples.push(`${method} ${path.split('?')[0]} → ${r.status} ${typeof data === 'object' ? (data?.detail ?? data?.title ?? '') : String(data).slice(0, 120)} [x-request-id ${r.headers.get('x-request-id') ?? '-'}]`);
    }
    return { status: r.status, ms, data, headers: r.headers };
  } catch (e: any) {
    const ms = performance.now() - t;
    st.errors++;
    st.statuses['ERR'] = (st.statuses['ERR'] ?? 0) + 1;
    const msg = e?.cause?.code ?? e?.name ?? String(e);
    if (st.samples.length < 5) st.samples.push(`${method} ${path.split('?')[0]} → ${msg}`);
    return { status: 0, ms, data: null, headers: new Headers(), error: msg };
  }
}

/** Setelah 429: tunggu sesuai Retry-After (seperti klien sungguhan), dibatasi sisa durasi. */
async function backoff(r: Res) {
  if (r.status !== 429) return;
  const s = Number(r.headers.get('retry-after')) || Number(/(\d+) (detik|seconds)/.exec(r.data?.detail ?? '')?.[1]) || 5;
  await sleep(Math.min(s * 1000, deadline() - Date.now()));
}

// ---------------- Login (sekali per akun; token di-cache & di-refresh) ----------------
interface Tok {
  access_token: string;
  refresh_token?: string;
  exp: number; // epoch ms
  user_id?: string;
}
const CACHE_FILE = join(tmpdir(), `rave-loadtest-tokens-${new URL(TARGET).host.replace(/[^a-z0-9]/gi, '_')}.json`);
let cache: Record<string, Tok> = {};
try {
  cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
} catch {
  /* belum ada */
}
const saveCache = () => {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch {
    /* cache opsional */
  }
};
const loginStats = { otp429: 0, waits: 0 };

async function authCall(body: unknown, path: string): Promise<Res> {
  for (let i = 0; ; i++) {
    const r = await fetch(TARGET + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'rave-loadtest' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    const res: Res = { status: r.status, ms: 0, data, headers: r.headers };
    if (r.status !== 429 || i >= 6) return res;
    loginStats.otp429++;
    const wait = Number(r.headers.get('retry-after')) || Number(/(\d+) detik/.exec(data?.detail ?? '')?.[1]) || 30;
    // 429 dari IAM (5 OTP/alamat/15 mnt) tidak akan pulih dalam beberapa detik.
    if (/menit/.test(data?.detail ?? '') && !r.headers.get('retry-after')) return res;
    loginStats.waits++;
    process.stdout.write(`  … rate limit /v1/auth (kelas otp), menunggu ${wait} dtk\n`);
    await sleep(wait * 1000 + 250);
  }
}

const decodeExp = (jwt: string) => {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000;
  } catch {
    return Date.now() + 10 * 60_000;
  }
};

async function login(email: string): Promise<Tok> {
  const c = cache[email];
  // Cukup untuk seluruh durasi uji + 1 menit.
  if (c && c.exp > Date.now() + DURATION_MS + 60_000) return c;
  if (c?.refresh_token) {
    const r = await authCall({ grant_type: 'refresh_token', refresh_token: c.refresh_token }, '/v1/auth/token');
    if (r.status === 200) return (cache[email] = { access_token: r.data.access_token, refresh_token: r.data.refresh_token, exp: decodeExp(r.data.access_token), user_id: r.data.user?.id });
  }
  const otp = await authCall({ channel: 'email', destination: email }, '/v1/auth/otp');
  if (otp.status !== 200 || !otp.data?.dev_code)
    throw new Error(`OTP ${email} gagal (HTTP ${otp.status}): ${otp.data?.detail ?? (otp.status === 200 ? 'tidak ada dev_code — target bukan NODE_ENV dev; pakai --tokens-file' : '')}`);
  const tok = await authCall({ grant_type: 'otp', destination: email, code: otp.data.dev_code }, '/v1/auth/token');
  if (tok.status !== 200) throw new Error(`token ${email} gagal (HTTP ${tok.status}): ${tok.data?.detail ?? ''}`);
  return (cache[email] = { access_token: tok.data.access_token, refresh_token: tok.data.refresh_token, exp: decodeExp(tok.data.access_token), user_id: tok.data.user?.id });
}

async function vuTokens(n: number): Promise<(string | null)[]> {
  if (flag('--anon')) return Array(n).fill(null);
  const file = opt('--tokens-file') ?? process.env.LOADTEST_TOKENS_FILE;
  if (file) {
    const list = (JSON.parse(readFileSync(file, 'utf8')) as (string | { access_token: string })[]).map((t) => (typeof t === 'string' ? t : t.access_token));
    if (!list.length) throw new Error(`${file} kosong`);
    return Array.from({ length: n }, (_, i) => list[i % list.length]);
  }
  const out: (string | null)[] = [];
  for (let i = 1; i <= n; i++) {
    out.push((await login(`${ACCOUNT_PREFIX}-${i}@rave.test`)).access_token);
    saveCache();
  }
  return out;
}

// ---------------- Rate limit sementara (Super Admin) ----------------
const LIMIT_KEYS = { 'security.rate_limit_per_minute': 10000, 'security.rate_limit_otp_per_minute': 100 };
let restoreLimits: (() => Promise<void>) | null = null;
async function raiseLimits() {
  const sa = await login(SEED.emails.superadmin);
  saveCache();
  const h = { authorization: `Bearer ${sa.access_token}`, 'content-type': 'application/json' };
  const cur = await fetch(`${TARGET}/v1/admin/platform/settings`, { headers: h }).then((r) => r.json() as Promise<any>);
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(LIMIT_KEYS)) prev[k] = cur?.values?.[k];
  const put = (changes: Record<string, unknown>, reason: string) =>
    fetch(`${TARGET}/v1/admin/platform/settings`, { method: 'PUT', headers: h, body: JSON.stringify({ changes, reason }) });
  const r = await put(LIMIT_KEYS, `uji beban ${SCENARIO} (scripts/loadtest.ts) — sementara`);
  if (!r.ok) throw new Error(`gagal menaikkan rate limit: HTTP ${r.status} ${await r.text()}`);
  console.log(`  rate limit dinaikkan sementara: ${JSON.stringify(LIMIT_KEYS)} (sebelumnya ${JSON.stringify(prev)})`);
  restoreLimits = async () => {
    restoreLimits = null;
    const rr = await put(prev, `selesai uji beban ${SCENARIO} — kembalikan rate limit`);
    console.log(rr.ok ? `  rate limit dikembalikan: ${JSON.stringify(prev)}` : `  ! GAGAL mengembalikan rate limit (HTTP ${rr.status}) — kembalikan manual di Super Admin → Pengaturan → Keamanan`);
  };
  await sleep(1500); // gateway menerima perubahan lewat LISTEN rave_settings
}

// ---------------- Skenario: playback ----------------
async function trackPool(): Promise<string[]> {
  const home = await fetch(`${TARGET}/v1/catalog/home`).then((r) => r.json() as Promise<any>);
  const releaseIds = new Set<string>();
  for (const it of home?.quick_picks ?? []) if (it.kind === 'release') releaseIds.add(it.id);
  for (const s of home?.sections ?? []) for (const it of s.items ?? []) if (it.kind === 'release') releaseIds.add(it.id);
  const ids: string[] = [];
  for (const id of [...releaseIds].slice(0, 12)) {
    const r = await fetch(`${TARGET}/v1/catalog/releases/${id}`).then((x) => (x.ok ? (x.json() as Promise<any>) : null));
    for (const t of r?.tracks ?? []) ids.push(t.id);
  }
  if (!ids.length) throw new Error('tidak ada lagu LIVE di katalog (jalankan npm run seed)');
  return ids;
}

const mediaNotes = { local: 0, external: 0, externalHosts: new Set<string>() };
async function playbackVu(token: string | null, tracks: string[]) {
  while (Date.now() < deadline()) {
    const track_id = tracks[Math.floor(Math.random() * tracks.length)];
    const t0 = performance.now();
    const s = await req('playback.session', 'write', 'POST', '/v1/playback/sessions', { token, body: { track_id, quality: 'auto', source: 'other' } });
    if (s.status !== 201) {
      await backoff(s);
      await sleep(THINK_MS);
      continue;
    }
    const st = await req('playback.stream', 'read', 'GET', s.data.stream_url, { token, expect: [] });
    if (st.status === 429) {
      await backoff(st);
      continue;
    }
    const loc = st.headers.get('location');
    let ttfa = performance.now() - t0;
    if (loc) {
      const url = new URL(loc, TARGET);
      const local = url.origin === new URL(TARGET).origin;
      if (local) mediaNotes.local++;
      else {
        mediaNotes.external++;
        mediaNotes.externalHosts.add(url.host);
      }
      if (local || flag('--fetch-media')) {
        const m = await req('playback.media_first_byte', 'read', 'GET', url.toString(), { token: local ? token : null, raw: true, headers: { range: 'bytes=0-65535' } });
        if (m.status === 206 || m.status === 200) ttfa = performance.now() - t0;
      }
    }
    // TTFA klien = buat sesi + resolusi stream (+ byte pertama media bila diambil). Hanya iterasi yang sukses.
    if (st.status === 302 || st.status === 200) step('playback.TTFA', 'ttfa').ok.push(ttfa);
    const ev = (type: string, played: number) => ({ session_id: s.data.session_id, track_id, type, position_ms: played, played_ms: played, at: new Date().toISOString() });
    const e1 = await req('playback.event_start', 'write', 'POST', '/v1/events/play', { token, body: { events: [ev('start', 0)] } });
    await backoff(e1);
    await sleep(THINK_MS);
    if (Date.now() >= deadline()) break;
    // played_ms 15 dtk < ambang qualified stream (30 dtk) → tidak menambah royalti/streaming qualified.
    const e2 = await req('playback.event_progress', 'write', 'POST', '/v1/events/play', { token, body: { events: [ev('progress', 15_000)] } });
    await backoff(e2);
  }
}

// ---------------- Skenario: browse ----------------
async function browseVu(token: string | null, releases: string[]) {
  const qs = ['senja', 'kota', 'hujan', 'pagi', 'laut'];
  while (Date.now() < deadline()) {
    for (const [name, path] of [
      ['browse.home', '/v1/catalog/home'],
      ['browse.search', `/v1/catalog/search?q=${qs[Math.floor(Math.random() * qs.length)]}`],
      ['browse.release', `/v1/catalog/releases/${releases[Math.floor(Math.random() * releases.length)]}`],
      ['browse.events', '/v1/ticketing/events'],
    ] as const) {
      if (Date.now() >= deadline()) return;
      const r = await req(name, 'read', 'GET', path, { token });
      await backoff(r);
    }
    await sleep(THINK_MS);
  }
}

// ---------------- Skenario: checkout ----------------
const checkout = { created: 0, replayOk: 0, replayBad: 0, soldOut: 0, limitPerAccount: 0, paid: 0, payTimeout: 0, payThrottled: 0, paidOrderIds: new Set<string>() };

async function checkoutVu(token: string, eventId: string, typeId: string) {
  while (Date.now() < deadline()) {
    const key = crypto.randomUUID();
    const body = { event_id: eventId, items: [{ ticket_type_id: typeId, quantity: 1 }] };
    const o = await req('checkout.order', 'write', 'POST', '/v1/ticketing/orders', { token, body, idem: key, expect: [409, 422] });
    if (o.status === 429) {
      await backoff(o);
      continue;
    }
    if (o.status === 409) {
      checkout.soldOut++;
      await sleep(THINK_MS);
      continue;
    }
    if (o.status === 422) {
      checkout.limitPerAccount++;
      await sleep(THINK_MS);
      continue;
    }
    if (o.status !== 201) {
      await sleep(THINK_MS);
      continue;
    }
    checkout.created++;
    const orderId = o.data.order.id;
    // Klien mengulang dengan key yang sama (timeout jaringan) → respons yang sama, bukan order kedua.
    if (checkout.created % 3 === 0) {
      const again = await req('checkout.order_replay', 'write', 'POST', '/v1/ticketing/orders', { token, body, idem: key });
      if (again.status === 201 && again.data?.order?.id === orderId && again.headers.get('idempotent-replayed') === 'true') checkout.replayOk++;
      else if (again.status !== 429) checkout.replayBad++;
      await backoff(again);
    }
    const t0 = performance.now();
    const pay = await req('checkout.pay_sandbox', 'write', 'POST', `/v1/finance/invoices/${o.data.invoice.id}/simulate-pay`, { token, body: { method: 'QRIS' }, idem: crypto.randomUUID() });
    if (pay.status !== 200) {
      await backoff(pay);
      continue;
    }
    // Pembayaran → finance → event bus → ticketing (asinkron). Polling hemat: endpoint order dibatasi 30/menit/akun.
    let paid = false;
    let throttled = false; // menunggu 429 saat polling → durasi bayar→PAID tidak mencerminkan server
    for (const wait of [300, 500, 800, 1200, 2000, 3000, 5000]) {
      await sleep(wait);
      const g = await req('checkout.order_status', 'read', 'GET', `/v1/ticketing/orders/${orderId}`, { token });
      if (g.status === 429) {
        throttled = true;
        await backoff(g);
      }
      if (g.data?.status === 'PAID') {
        paid = true;
        break;
      }
    }
    if (paid) {
      checkout.paid++;
      checkout.paidOrderIds.add(orderId);
      if (throttled) checkout.payThrottled++;
      else step('checkout.pay_to_PAID', 'async').ok.push(performance.now() - t0);
    } else checkout.payTimeout++;
    await sleep(THINK_MS);
  }
}

// ---------------- Laporan ----------------
const TARGETS: Record<Kind, number | null> = { read: 200, write: 500, ttfa: 1000, async: null };
function report(extra: Record<string, unknown>) {
  const elapsed = ((endedAt || Date.now()) - startedAt) / 1000;
  const rows: any[] = [];
  let warn = 0;
  let errors = 0;
  let limited = 0;
  for (const [name, s] of steps) {
    const sorted = [...s.ok].sort((a, b) => a - b);
    const n = s.ok.length + s.errors + s.limited + s.expected;
    const p95 = pct(sorted, 95);
    const target = TARGETS[s.kind];
    const verdict = target == null || !sorted.length ? '-' : p95 < target ? 'PASS' : 'WARN';
    if (verdict === 'WARN') warn++;
    if (s.kind !== 'ttfa' && s.kind !== 'async') {
      errors += s.errors;
      limited += s.limited;
    }
    rows.push({
      step: name,
      kind: s.kind,
      n: s.kind === 'ttfa' || s.kind === 'async' ? sorted.length : n,
      ok: sorted.length,
      rps: s.kind === 'ttfa' || s.kind === 'async' ? null : Math.round((n / elapsed) * 10) / 10,
      p50: Math.round(pct(sorted, 50)),
      p95: Math.round(p95),
      p99: Math.round(pct(sorted, 99)),
      max: Math.round(sorted[sorted.length - 1] ?? NaN),
      err: s.errors,
      err_pct: n ? Math.round((s.errors / n) * 1000) / 10 : 0,
      r429: s.limited,
      expected: s.expected,
      target: target ?? null,
      verdict,
      statuses: s.statuses,
      samples: s.samples,
    });
  }
  console.log(`\n▶ Hasil ${SCENARIO} — ${TARGET}, ${VUS} VU × ${(DURATION_MS / 1000).toFixed(0)} dtk (berjalan ${elapsed.toFixed(1)} dtk), think ${THINK_MS} ms`);
  const head = ['langkah', 'n', 'rps', 'p50', 'p95', 'p99', 'max', 'galat', '429', 'wajar', 'target p95', 'hasil'];
  const fmt = (r: any) => [r.step, r.n, r.rps ?? '-', r.p50, r.p95, r.p99, r.max, `${r.err} (${r.err_pct}%)`, r.r429, r.expected, r.target ? `< ${r.target} ms` : '-', r.verdict].map((v) => String(Number.isNaN(v) ? '-' : v));
  const table = [head, ...rows.map(fmt)];
  const w = head.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  for (const [i, r] of table.entries()) {
    console.log('  ' + r.map((c, j) => (j === 0 ? c.padEnd(w[j]) : c.padStart(w[j]))).join('  '));
    if (i === 0) console.log('  ' + w.map((x) => '-'.repeat(x)).join('  '));
  }
  for (const r of rows) for (const s of r.samples) console.log(`  ! ${r.step}: ${s}`);
  const httpTotal = rows.filter((r) => r.kind !== 'ttfa' && r.kind !== 'async').reduce((a, r) => a + r.n, 0);
  console.log(
    `  total ${totalRequests} permintaan, ${(totalRequests / elapsed).toFixed(1)} RPS, galat ${errors} (${httpTotal ? ((errors / httpTotal) * 100).toFixed(2) : 0}%), 429 ${limited}` +
      (loginStats.otp429 ? `, 429 saat login ${loginStats.otp429}` : ''),
  );
  if (limited) console.log(`  ⓘ 429 = rate limit gateway (bukan galat aplikasi). Naikkan sementara: --raise-limits atau Super Admin → Pengaturan → Keamanan (docs/OPERATIONS.md §3.4).`);
  return { rows, warn, errors, limited, elapsed, httpTotal };
}

// ---------------- Main ----------------
let cleanup: (() => Promise<void>) | null = null;
let exitCode = 0;
const onSignal = async () => {
  if (!running) return;
  running = false;
  console.log('\n  dihentikan — membersihkan…');
  await cleanup?.().catch((e) => console.error(`  ! cleanup gagal: ${e?.message ?? e}`));
  await restoreLimits?.().catch(() => {});
  process.exit(130);
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

try {
  const ver = await fetch(`${TARGET}/v1/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json() as Promise<any>).catch(() => null);
  if (!ver) throw new Error(`${TARGET}/v1/version tidak terjangkau — stack belum jalan?`);
  console.log(`▶ Uji beban ${SCENARIO} → ${TARGET} (API ${ver.version}), ${VUS} VU × ${DURATION_MS / 1000} dtk`);
  if (flag('--raise-limits')) await raiseLimits();

  let extra: Record<string, unknown> = {};
  if (SCENARIO === 'playback') {
    const [tracks, tokens] = [await trackPool(), await vuTokens(VUS)];
    console.log(`  ${tracks.length} lagu, ${tokens.filter(Boolean).length} akun login, ${tokens.filter((t) => !t).length} anonim`);
    startedAt = Date.now();
    await Promise.all(tokens.map((t, i) => sleep((i * 1000) / VUS).then(() => playbackVu(t, tracks))));
    endedAt = Date.now();
    extra = { media: { local: mediaNotes.local, external: mediaNotes.external, external_hosts: [...mediaNotes.externalHosts] } };
    if (mediaNotes.external && !flag('--fetch-media'))
      console.log(`  ⓘ ${mediaNotes.external} stream mengarah ke origin eksternal (${[...mediaNotes.externalHosts].join(', ')}) — byte media tidak diambil (pakai --fetch-media); TTFA = sesi + resolusi stream.`);
  } else if (SCENARIO === 'browse') {
    const home = await fetch(`${TARGET}/v1/catalog/home`).then((r) => r.json() as Promise<any>);
    const releases = [...(home?.quick_picks ?? []).filter((x: any) => x.kind === 'release').map((x: any) => x.id)];
    const tokens = await vuTokens(VUS);
    startedAt = Date.now();
    await Promise.all(tokens.map((t, i) => sleep((i * 1000) / VUS).then(() => browseVu(t, releases))));
    endedAt = Date.now();
  } else {
    // Event uji milik org promotor demo: kuota kecil (sengaja bisa habis) agar perebutan kuota & oversell teruji,
    // tanpa menghabiskan inventori event demo. Di akhir dibatalkan → order PAID direfund otomatis (sandbox).
    const tokens = (await vuTokens(VUS)) as string[];
    if (tokens.some((t) => !t)) throw new Error('checkout butuh login (tanpa --anon)');
    const P = (await login(SEED.emails.promotor)).access_token;
    saveCache();
    const ph = { authorization: `Bearer ${P}`, 'content-type': 'application/json' };
    let eventId = opt('--event');
    let typeId: string;
    let quota: number;
    let created = false;
    if (eventId) {
      const ev = await fetch(`${TARGET}/v1/ticketing/events/${eventId}`).then((r) => r.json() as Promise<any>);
      const t = (ev?.ticket_types ?? []).sort((a: any, b: any) => b.remaining - a.remaining)[0];
      if (!t) throw new Error(`event ${eventId} tidak ditemukan / tanpa kategori tiket`);
      typeId = t.id;
      quota = t.quota;
      console.log(`  event ${ev.title}: kategori ${t.name}, kuota ${t.quota}, sisa ${t.remaining}`);
    } else {
      quota = Number(opt('--quota', String(VUS * 2)));
      const starts = new Date(Date.now() + 60 * 86_400_000);
      const r = await fetch(`${TARGET}/v1/ticketing/events`, {
        method: 'POST',
        headers: ph,
        body: JSON.stringify({
          org_id: SEED.orgs.pensiPromotor,
          title: `LOADTEST ${new Date().toISOString().slice(0, 16)} ${crypto.randomUUID().slice(0, 4)}`,
          city: 'Bandung',
          venue_name: 'Uji Beban',
          starts_at: starts.toISOString(),
          ends_at: new Date(starts.getTime() + 3 * 3600_000).toISOString(),
          ticket_types: [{ name: 'Uji', price: 10_000, quota, max_per_account: 20 }],
        }),
      });
      const ev = (await r.json()) as any;
      if (r.status !== 201) throw new Error(`gagal membuat event uji: HTTP ${r.status} ${ev?.detail ?? ''}`);
      eventId = ev.id as string;
      typeId = ev.ticket_types[0].id;
      const pub = await fetch(`${TARGET}/v1/ticketing/events/${eventId}/publish`, { method: 'POST', headers: { authorization: ph.authorization } });
      if (!pub.ok) throw new Error(`gagal publish event uji: HTTP ${pub.status}`);
      created = true;
      console.log(`  event uji ${eventId} (kuota ${quota}, maks 20/akun)`);
    }
    const evId = eventId;
    const cancelEvent = async () => {
      if (!created || flag('--keep-event')) return;
      created = false;
      const c = await fetch(`${TARGET}/v1/ticketing/events/${evId}/cancel`, { method: 'POST', headers: ph, body: JSON.stringify({ reason: 'Event uji beban (scripts/loadtest.ts) — dibatalkan otomatis' }) });
      const cj = (await c.json().catch(() => null)) as any;
      console.log(c.ok ? `  event uji dibatalkan: ${cj?.refunds?.requested ?? 0} order PAID direfund otomatis (sandbox), ${cj?.refunds?.queued ?? 0} antre` : `  ! gagal membatalkan event uji ${evId}: HTTP ${c.status}`);
    };
    cleanup = cancelEvent;
    const before = await fetch(`${TARGET}/v1/ticketing/events/${evId}`).then((r) => r.json() as Promise<any>);
    const remainingBefore = before.ticket_types.find((t: any) => t.id === typeId)?.remaining ?? quota;

    startedAt = Date.now();
    await Promise.all(tokens.map((t, i) => sleep((i * 1000) / VUS).then(() => checkoutVu(t, evId, typeId))));
    endedAt = Date.now();

    // Verifikasi oversell: angka dari sisi server (promotor) vs kuota & order PAID yang diamati klien.
    await sleep(3000); // pembayaran terakhir yang masih diproses bus
    const orgEvents = await fetch(`${TARGET}/v1/ticketing/orgs/${SEED.orgs.pensiPromotor}/events`, { headers: { authorization: ph.authorization } }).then((r) => r.json() as Promise<any>);
    const mine = orgEvents?.data?.find((e: any) => e.id === evId);
    const after = await fetch(`${TARGET}/v1/ticketing/events/${evId}`).then((r) => r.json() as Promise<any>);
    const tt = after.ticket_types.find((t: any) => t.id === typeId);
    const sold = mine?.sold ?? null;
    const soldInTest = created ? sold : remainingBefore - tt.remaining;
    const oversell = (sold != null && sold > quota) || tt.remaining < 0 || checkout.paid > remainingBefore;
    console.log(
      `\n▶ Verifikasi inventori: kuota ${quota}, terjual (server) ${sold ?? '?'}, sisa ${tt.remaining}, PAID diamati klien ${checkout.paid}, order dibuat ${checkout.created}, ditolak habis (409) ${checkout.soldOut}, batas per akun (422) ${checkout.limitPerAccount}, belum PAID saat timeout ${checkout.payTimeout}, bayar→PAID tak diukur karena polling kena 429 ${checkout.payThrottled}`,
    );
    console.log(`  idempotensi: replay key sama → order sama ${checkout.replayOk}× OK, ${checkout.replayBad}× SALAH`);
    console.log(oversell ? '  ✗ OVERSELL TERDETEKSI' : '  ✓ tidak oversell (terjual ≤ kuota, sisa ≥ 0)');
    if (created && sold != null && sold !== checkout.paid) console.log(`  ⓘ terjual server (${sold}) ≠ PAID diamati klien (${checkout.paid}) — selisih = order dibayar yang belum PAID saat polling berhenti`);
    if (oversell || checkout.replayBad) exitCode = 1;
    extra = { event_id: evId, quota, sold, sold_in_test: soldInTest, remaining: tt.remaining, oversell, ...checkout, paidOrderIds: undefined };
    await cancelEvent();
  }
  running = false;
  const r = report(extra);
  if (r.errors) exitCode = 1;
  if (r.warn && flag('--strict')) exitCode = Math.max(exitCode, 1);
  console.log(`  kesimpulan: ${r.errors ? 'GALAT (lihat contoh di atas)' : r.warn ? 'WARN (latensi di atas target BRD)' : 'PASS'}`);
  const out = opt('--out');
  if (out) {
    writeFileSync(out, JSON.stringify({ scenario: SCENARIO, target: TARGET, vus: VUS, duration_ms: DURATION_MS, think_ms: THINK_MS, at: new Date(startedAt).toISOString(), elapsed_s: r.elapsed, total_requests: totalRequests, errors: r.errors, r429: r.limited, login_429: loginStats.otp429, steps: r.rows, ...extra }, null, 2));
    console.log(`  hasil JSON: ${out}`);
  }
} catch (e: any) {
  console.error(`✗ ${e?.message ?? e}`);
  exitCode = 2;
  await cleanup?.().catch(() => {});
} finally {
  await (restoreLimits as (() => Promise<void>) | null)?.().catch(() => {});
}
process.exit(exitCode);
