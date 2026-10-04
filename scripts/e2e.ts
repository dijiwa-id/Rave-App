// Smoke test end-to-end lewat API Gateway dengan token asli (login OTP).
// Prasyarat: `npm run seed` lalu `npm run dev:services`. Jalankan: `npx tsx scripts/e2e.ts`
import { SEED } from '@gema/domain';

const BASE = process.env.GATEWAY ?? 'http://127.0.0.1:8080';
let passed = 0;
let failed = 0;

async function call(token: string | null, method: string, path: string, body?: unknown, idem = false) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idem ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

function check(name: string, cond: boolean, info?: unknown) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m`, info === undefined ? '' : JSON.stringify(info).slice(0, 400));
  }
}

async function login(email: string) {
  const otp = await call(null, 'POST', '/v1/auth/otp', { channel: 'email', destination: email });
  const tok = await call(null, 'POST', '/v1/auth/token', { grant_type: 'otp', destination: email, code: otp.data?.dev_code });
  if (tok.status !== 200) throw new Error(`login ${email} gagal: ${JSON.stringify(tok.data)}`);
  return tok.data as { access_token: string; refresh_token: string; user: any };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await wait(500);
    v = await fn();
  }
  return v;
}

console.log('\n▶ Status & auth');
const st = await call(null, 'GET', '/v1/status');
check('semua service sehat', st.data?.ok === true, st.data);
const fan = await login(SEED.emails.fan);
const manager = await login(SEED.emails.manager);
const promotor = await login(SEED.emails.promotor);
const admin = await login(SEED.emails.admin);
check('login OTP 4 akun demo', !!fan.access_token && !!manager.access_token && !!promotor.access_token && !!admin.access_token);
check('manajer mendapat akses artis Senja', manager.user.orgs.some((o: any) => o.artist_id === SEED.artists[0].id), manager.user.orgs);
check('promotor KYC terverifikasi', promotor.user.kyc_status === 'VERIFIED', promotor.user.kyc_status);
const bad = await call('rusak.token.x', 'GET', '/v1/me');
check('token rusak ditolak di gateway (401)', bad.status === 401);
const internal = await call(null, 'GET', '/internal/tracks/x/media');
check('/internal/* tidak terekspos (404)', internal.status === 404);
const ref = await call(null, 'POST', '/v1/auth/token', { grant_type: 'refresh_token', refresh_token: fan.refresh_token });
const reuse = await call(null, 'POST', '/v1/auth/token', { grant_type: 'refresh_token', refresh_token: fan.refresh_token });
check('refresh token berotasi & reuse ditolak', ref.status === 200 && reuse.status === 401, [ref.status, reuse.status]);
const F = ref.data.access_token as string;

console.log('\n▶ Streaming (fan)');
const home = await call(F, 'GET', '/v1/catalog/home?city=Bandung');
check('beranda: quick picks & section', home.data?.quick_picks?.length === 6 && home.data?.sections?.length > 0);
const search = await call(F, 'GET', '/v1/catalog/search?q=hujn');
check('pencarian toleran typo ("hujn")', search.data?.tracks?.some((t: any) => /hujan/i.test(t.title)), search.data?.tracks?.map((t: any) => t.title));
const track = search.data.tracks[0];
const sess = await call(F, 'POST', '/v1/playback/sessions', { track_id: track.id, quality: 'lossless' });
check('sesi playback + URL bertanda tangan', [200, 201].includes(sess.status) && sess.data.codec_label === 'FLAC 16/44.1' && !sess.data.preview_only, sess.data);
const stream = await call(null, 'GET', sess.data.stream_url);
check('stream 302 ke media', stream.status === 302, stream.status);
const tampered = await call(null, 'GET', sess.data.stream_url.replace(/sig=../, 'sig=00'));
check('URL dimanipulasi ditolak', tampered.status === 403, tampered.status);
const anon = await call(null, 'POST', '/v1/playback/sessions', { track_id: track.id, quality: 'auto' });
check('anonim = pratinjau 30 dtk', anon.data?.preview_only === true && anon.data?.preview_ms === 30000, anon.data);
const plays = await call(F, 'POST', '/v1/events/play', {
  events: [
    { session_id: sess.data.session_id, track_id: track.id, type: 'start', position_ms: 0, played_ms: 0, at: new Date().toISOString() },
    { session_id: sess.data.session_id, track_id: track.id, type: 'progress', position_ms: 45000, played_ms: 45000, at: new Date().toISOString() },
  ],
});
check('play event ≥30 dtk = qualified stream', plays.data?.qualified === 1, plays.data);
const lyrics = await call(F, 'GET', `/v1/catalog/tracks/${track.id}/lyrics`);
check('lirik tersinkron', lyrics.status === 200 && lyrics.data.synced && lyrics.data.lines.length > 5, lyrics.status);
await call(F, 'PUT', `/v1/library/likes/${track.id}`);
const liked = await call(F, 'GET', '/v1/library/likes');
check('like lagu + hidrasi dari katalog', liked.data?.data?.some((t: any) => t.id === track.id && t.title === track.title));
const pl = await call(F, 'POST', '/v1/library/playlists', { title: 'E2E Playlist' });
await call(F, 'POST', `/v1/library/playlists/${pl.data.id}/items`, { track_id: track.id });
const plGet = await call(F, 'GET', `/v1/library/playlists/${pl.data.id}`);
check('playlist dibuat & berisi lagu', plGet.data?.items?.length === 1);
await call(F, 'DELETE', `/v1/library/playlists/${pl.data.id}`);
const hist = await until(
  () => call(F, 'GET', '/v1/library/history'),
  (r) => r.data?.data?.some((t: any) => t.id === track.id),
);
check('riwayat dengar terisi via event bus (playback → library)', hist.data?.data?.some((t: any) => t.id === track.id));
const prem = await call(F, 'GET', '/v1/catalog/shows');
const premEp = await (async () => {
  for (const s of prem.data.data) {
    const d = await call(F, 'GET', `/v1/catalog/shows/${s.id}`);
    const e = d.data.episodes.find((x: any) => x.is_premium);
    if (e) return e;
  }
})();
const paywall = await call(F, 'POST', '/v1/playback/sessions', { episode_id: premEp.id, quality: 'auto' });
check('episode premium → 402 paywall', paywall.status === 402, paywall.status);

console.log('\n▶ Ticketing (fan beli → promotor check-in)');
const events = await call(null, 'GET', '/v1/ticketing/events');
check('event publik tersedia', events.data?.data?.length >= 6, events.data?.data?.length);
let ev: any = null;
let order: any = null;
const limitHit: number[] = [];
outer: for (const e of events.data.data) {
  const d = await call(null, 'GET', `/v1/ticketing/events/${e.id}`);
  for (const t of d.data.ticket_types) {
    if (t.remaining < 1 || (t.sale_starts_at && new Date(t.sale_starts_at) > new Date())) continue;
    const o = await call(F, 'POST', '/v1/ticketing/orders', { event_id: d.data.id, items: [{ ticket_type_id: t.id, quantity: 1 }] }, true);
    if (o.status === 201) {
      ev = d.data;
      order = o;
      break outer;
    }
    limitHit.push(o.status);
  }
}
if (limitHit.includes(422)) check('batas tiket per akun ditegakkan (422)', true);
check('order tiket + invoice (ticketing → finance)', order.status === 201 && order.data.invoice?.amount > 0, order.data);
const pay = await call(F, 'POST', `/v1/finance/invoices/${order.data.invoice.id}/simulate-pay`, { method: 'QRIS' }, true);
check('bayar via PG sandbox (webhook HMAC)', pay.status === 200, pay.data);
const paid = await until(
  () => call(F, 'GET', `/v1/ticketing/orders/${order.data.order.id}`),
  (r) => r.data?.status === 'PAID',
);
check('order PAID via event finance.payment.succeeded', paid.data?.status === 'PAID', paid.data?.status);
const mine = await call(F, 'GET', '/v1/ticketing/tickets/mine');
const ticket = mine.data.data.find((t: any) => t.event.id === ev.id && t.status === 'VALID');
const qr = await call(F, 'GET', `/v1/ticketing/tickets/${ticket.id}/qr`);
check('QR berputar diterbitkan', /^GEMA1\./.test(qr.data?.payload ?? ''), qr.data);
const P = promotor.access_token;
const ci = await call(P, 'POST', '/v1/ticketing/checkin', { event_id: ev.id, payload: qr.data.payload, gate: 'A' });
const ci2 = await call(P, 'POST', '/v1/ticketing/checkin', { event_id: ev.id, payload: qr.data.payload, gate: 'B' });
check('check-in OK lalu DUPLICATE', ci.data?.ok === true && ci2.data?.reason === 'DUPLICATE', [ci.data, ci2.data]);
const fanCi = await call(F, 'POST', '/v1/ticketing/checkin', { event_id: ev.id, payload: qr.data.payload, gate: 'A' });
check('fan tidak bisa check-in (403)', fanCi.status === 403, fanCi.status);

console.log('\n▶ Booking off-air + escrow (promotor ↔ manajer Senja)');
const M = manager.access_token;
const senja = SEED.artists[0].id;
const date = new Date(Date.now() + (60 + Math.floor(Math.random() * 200)) * 86400_000).toISOString().slice(0, 10);
const epk = await call(P, 'GET', `/v1/booking/artists/${senja}/epk`);
check('EPK dinamis dengan statistik streaming', epk.data?.stats?.monthly_listeners > 0 && epk.data?.stats?.top_cities?.length > 0, epk.data?.stats);
const disc = await call(P, 'GET', '/v1/booking/discovery?city=Bandung');
check('discovery + Audience Match', disc.data?.data?.length > 0 && typeof disc.data.data[0].audience_match === 'number');
const inq = await call(
  P,
  'POST',
  '/v1/booking/inquiries',
  {
    artist_id: senja,
    promotor_org_id: SEED.orgs.pensiPromotor,
    event_name: 'E2E Pensi',
    event_date: date,
    start_time: '19:00',
    duration_min: 60,
    city: 'Bandung',
    venue: 'Aula E2E',
    capacity: 800,
    category: 'PENSI',
    format: 'FULL_BAND',
    budget: 30_000_000,
    hold: true,
  },
  true,
);
check('inquiry dibuat (INQUIRY)', inq.status === 201 && inq.data.status === 'INQUIRY', inq.data);
const B = inq.data.id;
check('kontak tersamar sebelum BOOKED', String(inq.data.contact?.email ?? '').includes('*'), inq.data.contact);
const inqBody = {
  artist_id: senja, promotor_org_id: SEED.orgs.pensiPromotor, event_name: 'E2E Pensi', event_date: date, start_time: '19:00',
  duration_min: 60, city: 'Bandung', venue: 'Aula E2E', capacity: 800, category: 'PENSI', format: 'FULL_BAND', budget: 30_000_000, hold: true,
};
const dup = await call(P, 'POST', '/v1/booking/inquiries', { ...inqBody, event_name: 'Hold kedua' }, true);
check('inquiry kedua di tanggal sama → HOLD_2 (antre), bukan dobel', dup.status === 201, [dup.status, dup.data]);
const cal = await call(M, 'GET', `/v1/booking/artists/${senja}/calendar?from=${date}&to=${date}`);
check('kalender: HOLD_1 + HOLD_2', ['HOLD_1', 'HOLD_2'].every((s) => cal.data?.data?.some((c: any) => c.status === s)), cal.data?.data?.map((c: any) => c.status));
const off = await call(M, 'POST', `/v1/booking/bookings/${B}/offers`, { fee: 32_000_000, dp_pct: 50, settlement_days_before: 7, message: 'Offer dari manajemen' }, true);
check('manajer kirim offer (NEGOTIATING)', off.data?.status === 'NEGOTIATING', off.data?.status);
const self = await call(M, 'POST', `/v1/booking/bookings/${B}/accept`);
check('tidak bisa menerima offer sendiri', self.status === 409 || self.status === 403, self.status);
const acc = await call(P, 'POST', `/v1/booking/bookings/${B}/accept`);
check('promotor terima → kontrak terbit (CONTRACT_SENT)', acc.data?.status === 'CONTRACT_SENT' && acc.data?.contract?.sha256?.length === 64, acc.data?.status);
await call(P, 'POST', `/v1/booking/bookings/${B}/sign`, { signer_name: 'Promotor E2E' }, true);
const signed = await call(M, 'POST', `/v1/booking/bookings/${B}/sign`, { signer_name: 'Manajer E2E' }, true);
check('tanda tangan kedua pihak (SIGNED)', signed.data?.status === 'SIGNED', signed.data?.status);
const inv = await until(
  () => call(P, 'GET', `/v1/finance/invoices?reference_id=${B}`),
  (r) => r.data?.data?.length >= 2,
);
check('finance menerbitkan invoice DP & pelunasan', inv.data?.data?.length >= 2, inv.data);
const dp = inv.data.data.find((i: any) => i.purpose === 'BOOKING_DP');
const st2 = inv.data.data.find((i: any) => i.purpose === 'BOOKING_SETTLEMENT');
await call(P, 'POST', `/v1/finance/invoices/${dp.id}/simulate-pay`, { method: 'VA' }, true);
const booked = await until(
  () => call(P, 'GET', `/v1/booking/bookings/${B}`),
  (r) => r.data?.status === 'BOOKED',
);
check('DP masuk escrow → BOOKED & kontak dibuka', booked.data?.status === 'BOOKED' && !String(booked.data?.contact?.email).includes('*'), [booked.data?.status, booked.data?.contact]);
await call(P, 'POST', `/v1/finance/invoices/${st2.id}/simulate-pay`, { method: 'VA' }, true);
const secured = await until(
  () => call(P, 'GET', `/v1/booking/bookings/${B}`),
  (r) => r.data?.status === 'BOOKED_AND_SECURED',
);
check('pelunasan → BOOKED_AND_SECURED', secured.data?.status === 'BOOKED_AND_SECURED', secured.data?.status);
const esc = await call(M, 'GET', `/v1/finance/escrow/${B}`);
check('escrow menahan dana', esc.data?.held_amount > 0, esc.data);
await call(P, 'POST', `/v1/booking/bookings/${B}/show-done`);
await call(M, 'POST', `/v1/booking/bookings/${B}/show-done`);
const settled = await until(
  () => call(M, 'GET', `/v1/booking/bookings/${B}`),
  (r) => r.data?.status === 'SETTLED',
  90_000,
);
check('show done → COMPLETED → escrow release → SETTLED', settled.data?.status === 'SETTLED', settled.data?.status);
const wallet = await call(M, 'GET', `/v1/finance/wallets/${SEED.artists[0].orgId}`);
check('wallet artis menerima dana off-air', wallet.data?.balances?.offair > 0, wallet.data?.balances);
const third = await call(P, 'POST', '/v1/booking/inquiries', { ...inqBody, event_name: 'Setelah booked' }, true);
check('tanggal sudah booked → inquiry baru ditolak (409, anti double booking)', third.status === 409, [third.status, third.data]);

console.log('\n▶ Notifikasi, admin & rekonsiliasi');
const notif = await call(M, 'GET', '/v1/notifications');
check('manajer menerima notifikasi booking', notif.data?.data?.some((n: any) => n.category === 'booking'), notif.data?.data?.length);
const fanNotif = await call(F, 'GET', '/v1/notifications');
check('fan menerima notifikasi pembayaran tiket', fanNotif.data?.data?.some((n: any) => n.category === 'payment'));
const adminNotif = await call(admin.access_token, 'GET', '/v1/notifications');
check('admin TIDAK menerima notifikasi booking artis yang belum diklaim', !adminNotif.data?.data?.some((n: any) => n.category === 'booking'));
const recon = await call(admin.access_token, 'GET', '/v1/admin/finance/reconciliation');
check('ledger seimbang (debit = kredit)', recon.data?.balanced === true && recon.data.total_debit === recon.data.total_credit, recon.data && { b: recon.data.balanced, d: recon.data.total_debit, c: recon.data.total_credit });
const fanAdmin = await call(F, 'GET', '/v1/admin/finance/reconciliation');
check('fan tidak bisa akses back office (403)', fanAdmin.status === 403, fanAdmin.status);
const audit = await call(admin.access_token, 'GET', '/v1/admin/iam/audit-logs');
check('audit log tersedia', audit.status === 200);

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} lulus, ${failed} gagal\x1b[0m\n`);
process.exit(failed ? 1 : 0);
