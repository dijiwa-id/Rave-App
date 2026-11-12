// Smoke test end-to-end lewat API Gateway dengan token asli (login OTP).
// Prasyarat: `npm run seed` lalu `npm run dev:services`. Jalankan: `npx tsx scripts/e2e.ts`
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { SEED, seedId } from '@rave/domain';

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

/** Endpoint OTP dibatasi per IP di gateway (security.rate_limit_otp_per_minute); e2e login banyak akun dari satu IP → tunggu jendela berikutnya. */
async function callOtpClass(method: string, path: string, body: unknown) {
  for (let attempt = 0; ; attempt++) {
    const r = await call(null, method, path, body);
    if (r.status !== 429 || attempt >= 2) return r;
    const wait = Number(/(\d+) detik/.exec(r.data?.detail ?? '')?.[1] ?? 30) + 1;
    console.log(`  … rate limit OTP gateway, menunggu ${wait} dtk`);
    await new Promise((res) => setTimeout(res, wait * 1000));
  }
}

async function login(email: string) {
  let otp = await callOtpClass('POST', '/v1/auth/otp', { channel: 'email', destination: email });
  // Pengirim email sementara tidak tersedia (mis. cache konfigurasi integrasi ±15 dtk setelah diganti) → 503; coba lagi.
  for (let i = 0; i < 6 && (otp.status === 502 || otp.status === 503); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    otp = await callOtpClass('POST', '/v1/auth/otp', { channel: 'email', destination: email });
  }
  const tok = await callOtpClass('POST', '/v1/auth/token', { grant_type: 'otp', destination: email, code: otp.data?.dev_code });
  if (tok.status !== 200) throw new Error(`login ${email} gagal: ${JSON.stringify(tok.data)}`);
  return tok.data as { access_token: string; refresh_token: string; user: any };
}

/** PNG persegi minimal (RGBA solid) untuk uji unggah branding. */
function pngSquare(n: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) raw.writeUInt32BE(0x1ed760ff, y * (n * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20000, every = 500): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await wait(every);
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
const ref = await callOtpClass('POST', '/v1/auth/token', { grant_type: 'refresh_token', refresh_token: fan.refresh_token });
const reuse = await callOtpClass('POST', '/v1/auth/token', { grant_type: 'refresh_token', refresh_token: fan.refresh_token });
check('refresh token berotasi & reuse ditolak', ref.status === 200 && reuse.status === 401, [ref.status, reuse.status]);
const F = ref.data.access_token as string;

console.log('\n▶ Streaming (fan)');
const home = await call(F, 'GET', '/v1/catalog/home?city=Bandung');
check('beranda: quick picks & section', home.data?.quick_picks?.length === 6 && home.data?.sections?.length > 0);
const search = await call(F, 'GET', '/v1/catalog/search?q=hujn');
check('pencarian toleran typo ("hujn")', search.data?.tracks?.some((t: any) => /hujan/i.test(t.title)), search.data?.tracks?.map((t: any) => t.title));
const track = search.data.tracks[0];
const sess = await call(F, 'POST', '/v1/playback/sessions', { track_id: track.id, quality: 'lossless' });
check('sesi playback + URL bertanda tangan', [200, 201].includes(sess.status) && !!sess.data.stream_url && !sess.data.preview_only, sess.data);
// HQ & Lossless khusus Premium: fan Gratis diturunkan ke AAC 160, Premium mendapat AAC 320.
check('fan Gratis minta Lossless → AAC 160 (quality_capped=premium)', sess.data?.quality === 'normal' && sess.data.codec_label === 'AAC 160' && sess.data.quality_capped === 'premium', sess.data);
const P2 = (await login(SEED.emails.premium)).access_token;
const premSess = await call(P2, 'POST', '/v1/playback/sessions', { track_id: track.id, quality: 'high' });
check('fan Premium minta Tinggi → AAC 320', premSess.data?.quality === 'high' && premSess.data.codec_label === 'AAC 320' && premSess.data.quality_capped === null, premSess.data);
const stream = await call(null, 'GET', sess.data.stream_url);
check('stream 302 ke media', stream.status === 302, stream.status);
const tampered = await call(null, 'GET', sess.data.stream_url.replace(/sig=../, 'sig=00'));
check('URL dimanipulasi ditolak', tampered.status === 403, tampered.status);
const anon = await call(null, 'POST', '/v1/playback/sessions', { track_id: track.id, quality: 'auto' });
check('anonim = pratinjau 30 dtk', anon.data?.preview_only === true && anon.data?.preview_ms === 30000, anon.data);

console.log('\n▶ Master multi-format & rendisi (Artist Studio)');
{
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const FFM = createRequire(import.meta.url)('ffmpeg-static') as string;
  const AT = (await login(SEED.emails.artist)).access_token;
  const flacPath = `${tmpdir()}/rave-e2e-${process.pid}.flac`;
  execFileSync(FFM, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=96000:duration=3', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', flacPath]);
  const flac = readFileSync(flacPath);
  rmSync(flacPath, { force: true });
  // MIME kosong (umum untuk .flac di browser Windows) → ditentukan dari ekstensi.
  const init = await call(AT, 'POST', '/v1/studio/uploads', { kind: 'audio', filename: 'e2e-master.flac', content_type: '', size: flac.length });
  const put = await fetch(BASE + init.data?.upload_url, { method: 'PUT', headers: { authorization: `Bearer ${AT}`, 'content-type': 'application/octet-stream' }, body: new Uint8Array(flac) });
  const up = await put.json();
  check('upload master FLAC 24/96: probe lossless + antre transcoding', put.status === 200 && up.meta?.lossless === true && up.meta?.bit_depth === 24 && up.meta?.sample_rate === 96000 && up.transcode_status === 'pending', up);
  const done = await until(() => call(AT, 'GET', `/v1/studio/uploads/${init.data?.upload_id}`), (r) => ['done', 'failed'].includes(r.data?.transcode_status), 90_000, 1000);
  check('transcoding → AAC 64/160/320 + FLAC 24/96', done.data?.transcode_status === 'done' && Object.keys(done.data.renditions ?? {}).sort().join() === 'high,lossless,low,normal' && done.data.renditions.lossless?.codec_label === 'FLAC 24/96', done.data);
  const baseUrl = String(up.public_url).replace(/\.flac$/, '');
  // Batch 2 — split hak wajib disetujui semua pihak sebelum QC meloloskan rilis; undangan dikirim ke pihak.
  {
    const png = pngSquare(400);
    const art = await call(AT, 'POST', '/v1/studio/uploads', { kind: 'artwork', filename: 'e2e-cover.png', content_type: 'image/png', size: png.length });
    const artPut = await fetch(BASE + art.data?.upload_url, { method: 'PUT', headers: { authorization: `Bearer ${AT}`, 'content-type': 'image/png' }, body: new Uint8Array(png) });
    const artUp = await artPut.json();
    const rel = await call(AT, 'POST', '/v1/studio/releases', {
      artist_id: SEED.artists[0].id, title: `E2E Split ${Date.now()}`, type: 'SINGLE', genre: 'indie-pop', release_date: '2026-01-01', cover_url: artUp.public_url,
      tracks: [{ title: 'E2E Split Track', audio_url: up.public_url, duration_ms: 3000 }],
    });
    const trackId = rel.data?.tracks?.[0]?.id;
    const invitee = `e2e-split-${Date.now()}@rave.test`;
    const sp = await call(AT, 'PUT', `/v1/studio/tracks/${trackId}/splits`, {
      master: [{ party_name: 'Senja Kolektif', pct: 70 }, { party_name: 'Produser Tamu', email: invitee, pct: 30 }],
      publishing: [{ party_name: 'Senja Kolektif', pct: 100 }],
    });
    const sub = await call(AT, 'POST', `/v1/studio/releases/${rel.data?.id}/submit`, {});
    check('rilis dengan master unggahan & split diajukan (IN_REVIEW)', rel.status === 201 && sp.status === 200 && sub.data?.status === 'IN_REVIEW', [rel.status, rel.data?.detail, sp.status, sub.status, sub.data?.errors ?? sub.data?.detail]);
    const qcList = await call(admin.access_token, 'GET', '/v1/admin/qc/releases');
    const qcRow = qcList.data?.data?.find((r: any) => r.id === rel.data?.id);
    check('QC melihat peringatan split belum disetujui', qcRow?.qc_warnings?.some((w: string) => /belum disetujui/.test(w)), qcRow?.qc_warnings);
    const blocked = await call(admin.access_token, 'POST', `/v1/admin/qc/releases/${rel.data?.id}/decision`, { approve: true });
    check('QC tidak bisa menyetujui rilis sebelum semua split disetujui (409)', blocked.status === 409, blocked.status);
    const inv = await login(invitee);
    const pend = await call(inv.access_token, 'GET', '/v1/studio/splits/pending');
    const mineSplit = pend.data?.data?.find((x: any) => x.track_id === trackId);
    const ok = mineSplit ? await call(inv.access_token, 'POST', `/v1/studio/splits/${mineSplit.id}/approve`, {}) : { status: 0 };
    check('pihak yang diundang menyetujui bagiannya', ok.status === 200, [pend.status, ok.status]);
    const approved = await call(admin.access_token, 'POST', `/v1/admin/qc/releases/${rel.data?.id}/decision`, { approve: true });
    check('setelah semua split disetujui, QC menyetujui rilis', approved.status === 200 && ['LIVE', 'SCHEDULED'].includes(approved.data?.status), [approved.status, approved.data?.status]);
    // Ganti sampul: rilis LIVE → menunggu QC (sampul lama tetap tayang); URL eksternal ditolak.
    const ext = await call(AT, 'PUT', `/v1/studio/releases/${rel.data?.id}/cover`, { cover_url: 'https://example.com/x.jpg' });
    check('sampul dari URL eksternal ditolak (422)', ext.status === 422, ext.status);
    const png2 = pngSquare(500);
    const art2 = await call(AT, 'POST', '/v1/studio/uploads', { kind: 'artwork', filename: 'e2e-cover-2.png', content_type: 'image/png', size: png2.length });
    const art2Up = await (await fetch(BASE + art2.data?.upload_url, { method: 'PUT', headers: { authorization: `Bearer ${AT}`, 'content-type': 'image/png' }, body: new Uint8Array(png2) })).json();
    const sub2 = await call(AT, 'PUT', `/v1/studio/releases/${rel.data?.id}/cover`, { cover_url: art2Up.public_url });
    check('ganti sampul rilis LIVE → menunggu tinjauan, sampul lama tetap', sub2.status === 200 && sub2.data?.pending_cover?.url === art2Up.public_url && sub2.data?.cover_url === artUp.public_url, [sub2.status, sub2.data?.pending_cover, sub2.data?.cover_url]);
    const pubRel = await call(null, 'GET', `/v1/catalog/releases/${rel.data?.id}`);
    check('API publik tetap menampilkan sampul lama & tidak membocorkan pengajuan', pubRel.data?.cover_url === artUp.public_url && !('pending_cover' in (pubRel.data ?? {})), [pubRel.status, pubRel.data?.cover_url]);
    const coverQ = await call(admin.access_token, 'GET', '/v1/admin/qc/covers');
    check('antrean QC memuat pengajuan sampul', coverQ.data?.data?.some((c: any) => c.id === rel.data?.id && c.pending_cover === art2Up.public_url), coverQ.data?.data?.length);
    const ok2 = await call(admin.access_token, 'POST', `/v1/admin/qc/covers/${rel.data?.id}/decision`, { approve: true });
    const relAfter = await call(null, 'GET', `/v1/catalog/releases/${rel.data?.id}`);
    check('QC menyetujui → sampul baru tayang', ok2.status === 200 && relAfter.data?.cover_url === art2Up.public_url, [ok2.status, relAfter.data?.cover_url]);
    const notifC = await until(() => call(AT, 'GET', '/v1/notifications'), (r) => r.data?.data?.some((n: any) => n.title === 'Sampul rilis diperbarui'), 15000, 1000);
    check('artis dinotifikasi hasil tinjauan sampul', notifC.data?.data?.some((n: any) => n.title === 'Sampul rilis diperbarui'));
    (globalThis as any).__e2eCoverRelease = rel.data?.id;
    // Lirik dari Studio: LRC tersinkron / teks biasa, validasi, tampil di API publik, tidak bisa untuk lagu artis lain.
    {
      const lrc = '[ti:E2E]\n[00:00.50] Baris pertama\n[00:01.80] Baris kedua';
      const putL = await call(AT, 'PUT', `/v1/studio/tracks/${trackId}/lyrics`, { mode: 'synced', text: lrc, language: 'id' });
      const pubL = await call(null, 'GET', `/v1/catalog/tracks/${trackId}/lyrics`);
      check('lirik: LRC tersinkron disimpan & tampil di API publik', putL.status === 200 && pubL.data?.synced === true && pubL.data?.lines?.[1]?.time_ms === 1800, [putL.status, putL.data?.detail, pubL.data?.lines]);
      const badL = await call(AT, 'PUT', `/v1/studio/tracks/${trackId}/lyrics`, { mode: 'synced', text: '[00:00.50] ok\ntanpa waktu' });
      const longL = await call(AT, 'PUT', `/v1/studio/tracks/${trackId}/lyrics`, { mode: 'synced', text: '[59:00.00] melebihi durasi' });
      check('lirik: baris tanpa stempel waktu / melebihi durasi lagu ditolak (422)', badL.status === 422 && badL.data?.line === 2 && longL.status === 422, [badL.status, badL.data?.line, longL.status]);
      const plainL = await call(AT, 'PUT', `/v1/studio/tracks/${trackId}/lyrics`, { mode: 'plain', text: 'Bait satu\n\n\nBait dua' });
      const getL = await call(AT, 'GET', `/v1/studio/tracks/${trackId}/lyrics`);
      check('lirik: teks biasa disimpan (tidak tersinkron)', plainL.status === 200 && getL.data?.lyrics?.synced === false && getL.data?.lyrics?.text === 'Bait satu\n\nBait dua', getL.data);
      const outsider = await login(SEED.emails.promotor);
      const foreign = await call(outsider.access_token, 'PUT', `/v1/studio/tracks/${trackId}/lyrics`, { mode: 'plain', text: 'x' });
      check('lirik: pengguna yang bukan pengelola artis tidak bisa mengubah (403/404)', [403, 404].includes(foreign.status), foreign.status);
    }
    // Edit rilis LIVE: pengajuan perubahan → QC → tayang; tanggal rilis LIVE terkunci; data lama tetap tayang.
    {
      const relId = rel.data?.id;
      const before = await call(null, 'GET', `/v1/catalog/releases/${relId}`);
      const dateLive = await call(AT, 'PUT', `/v1/studio/releases/${relId}/changes`, { release_date: '2099-01-01' });
      check('edit rilis: tanggal rilis yang sudah tayang ditolak (422)', dateLive.status === 422, [dateLive.status, dateLive.data?.detail]);
      const noop = await call(AT, 'PUT', `/v1/studio/releases/${relId}/changes`, { title: before.data?.title });
      check('edit rilis: pengajuan tanpa perubahan ditolak (400)', noop.status === 400, noop.status);
      const newTitle = `${before.data?.title} (Remaster)`;
      const ch = await call(AT, 'PUT', `/v1/studio/releases/${relId}/changes`, { title: newTitle, tracks: [{ id: trackId, title: 'E2E Split Track (Edit)' }], note: 'uji e2e' });
      const pubMid = await call(null, 'GET', `/v1/catalog/releases/${relId}`);
      check(
        'edit rilis: perubahan diajukan, data lama tetap tayang',
        ch.status === 200 && ch.data?.pending_changes?.release?.title === newTitle && pubMid.data?.title === before.data?.title && !('pending_changes' in (pubMid.data ?? {})),
        [ch.status, ch.data?.detail, pubMid.data?.title],
      );
      const queue = await call(admin.access_token, 'GET', '/v1/admin/qc/changes');
      check('edit rilis: antrean QC memuat pengajuan', queue.data?.data?.some((c: any) => c.id === relId && c.changes?.release?.title === newTitle), queue.data?.data?.length);
      const noReason = await call(admin.access_token, 'POST', `/v1/admin/qc/changes/${relId}/decision`, { approve: false });
      const ok3 = await call(admin.access_token, 'POST', `/v1/admin/qc/changes/${relId}/decision`, { approve: true });
      const after = await call(null, 'GET', `/v1/catalog/releases/${relId}`);
      check(
        'edit rilis: QC menyetujui → judul rilis & lagu baru tayang (tolak tanpa alasan = 400)',
        noReason.status === 400 && ok3.status === 200 && after.data?.title === newTitle && after.data?.tracks?.[0]?.title === 'E2E Split Track (Edit)',
        [noReason.status, ok3.status, after.data?.title, after.data?.tracks?.[0]?.title],
      );
      const notifE = await until(() => call(AT, 'GET', '/v1/notifications'), (r) => r.data?.data?.some((n: any) => n.title === 'Perubahan rilis diterapkan'), 15000, 1000);
      check('edit rilis: artis dinotifikasi hasil tinjauan', notifE.data?.data?.some((n: any) => n.title === 'Perubahan rilis diterapkan'));
      const draftEdit = await call(AT, 'PUT', `/v1/studio/releases/${relId}/changes`, {});
      check('edit rilis: pengajuan kosong ditolak', [400, 422].includes(draftEdit.status), draftEdit.status);
    }
    // Tarik rilis dari tinjauan (IN_REVIEW → DRAFT) agar bisa diedit.
    {
      const r2 = await call(AT, 'POST', '/v1/studio/releases', {
        artist_id: SEED.artists[0].id, title: `E2E Withdraw ${Date.now()}`, type: 'SINGLE', genre: 'pop', release_date: '2026-01-01', cover_url: artUp.public_url,
        tracks: [{ title: 'E2E Withdraw Track', audio_url: up.public_url, duration_ms: 3000 }],
      });
      const t2 = r2.data?.tracks?.[0]?.id;
      await call(AT, 'PUT', `/v1/studio/tracks/${t2}/splits`, { master: [{ party_name: 'Senja Kolektif', pct: 100 }], publishing: [{ party_name: 'Senja Kolektif', pct: 100 }] });
      const sub3 = await call(AT, 'POST', `/v1/studio/releases/${r2.data?.id}/submit`, {});
      const wd = await call(AT, 'POST', `/v1/studio/releases/${r2.data?.id}/withdraw`, {});
      const wd2 = await call(AT, 'POST', `/v1/studio/releases/${r2.data?.id}/withdraw`, {});
      const edit = await call(AT, 'PATCH', `/v1/studio/releases/${r2.data?.id}`, { title: 'E2E Withdraw (diedit)' });
      check(
        'tarik dari tinjauan → DRAFT & bisa diedit; tarik dua kali ditolak (409)',
        sub3.data?.status === 'IN_REVIEW' && wd.status === 200 && wd.data?.status === 'DRAFT' && wd2.status === 409 && edit.status === 200 && edit.data?.title === 'E2E Withdraw (diedit)',
        [sub3.status, sub3.data?.status ?? sub3.data?.errors, wd.status, wd.data?.status, wd2.status, edit.status],
      );
    }
    // Profil artis (Artist Studio): foto/banner hanya unggahan Studio; tautan sosial divalidasi & tampil di API publik.
    {
      const aid = SEED.artists[0].id;
      const before = await call(null, 'GET', `/v1/catalog/artists/${aid}`);
      const extImg = await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, { image_url: 'https://example.com/me.jpg' });
      const extBanner = await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, { cover_url: 'https://example.com/banner.jpg' });
      check('profil: foto/banner dari URL eksternal ditolak (422)', extImg.status === 422 && extBanner.status === 422, [extImg.status, extBanner.status]);
      const badHost = await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, { links: [{ platform: 'instagram', url: 'https://evil.example.com/rave' }] });
      const badHttp = await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, { links: [{ platform: 'website', url: 'http://band.example.id' }] });
      const dup = await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, { links: [{ platform: 'spotify', url: 'https://open.spotify.com/artist/a' }, { platform: 'spotify', url: 'https://open.spotify.com/artist/b' }] });
      check('profil: tautan host salah / http / platform ganda ditolak (422)', badHost.status === 422 && badHttp.status === 422 && dup.status === 422, [badHost.status, badHttp.status, dup.status]);
      const okP = await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, {
        image_url: before.data?.image_url, // nilai lama (demo-art seed) tetap sah bila tidak diubah
        links: [{ platform: 'instagram', url: 'instagram.com/senjakolektif' }, { platform: 'website', url: 'https://senja.example.id' }],
      });
      check('profil: tautan valid disimpan & dinormalisasi', okP.status === 200 && okP.data?.links?.[0]?.url === 'https://instagram.com/senjakolektif' && okP.data?.links?.length === 2, [okP.status, okP.data?.detail, okP.data?.links]);
      const pubA = await call(null, 'GET', `/v1/catalog/artists/${aid}`);
      check('profil: API publik artis mengembalikan tautan', pubA.data?.links?.length === 2 && pubA.data?.image_url === before.data?.image_url, pubA.data?.links);
      const other = await call(AT, 'PATCH', `/v1/studio/artists/${SEED.artists[1].id}`, { bio: 'x' });
      check('profil: tidak bisa mengubah artis lain (403/404)', [403, 404].includes(other.status), other.status);
      await call(AT, 'PATCH', `/v1/studio/artists/${aid}`, { links: [] });
    }
  }
  const std = await fetch(`${BASE}${baseUrl}.normal.m4a`);
  check('rendisi standar dapat diputar (audio/mp4)', std.status === 200 && std.headers.get('content-type') === 'audio/mp4', std.status);
  const [hq, ll] = await Promise.all([fetch(`${BASE}${baseUrl}.high.m4a`), fetch(`${BASE}${baseUrl}.lossless.flac`)]);
  check('rendisi Premium tanpa URL bertanda tangan ditolak (403)', hq.status === 403 && ll.status === 403, [hq.status, ll.status]);
  const raw = await fetch(`${BASE}${up.public_url}`, { headers: { range: 'bytes=0-99' } });
  check('master mentah tanpa tanda tangan ditolak (403) — audit A2', raw.status === 403, raw.status);
  const rng = await fetch(`${BASE}${baseUrl}.normal.m4a`, { headers: { range: 'bytes=0-99' } });
  check('media mendukung Range (206) untuk seek', rng.status === 206 && (await rng.arrayBuffer()).byteLength === 100, rng.status);
  const other = await call(F, 'GET', `/v1/studio/uploads/${init.data?.upload_id}`);
  check('status upload hanya untuk pemiliknya', other.status === 404 || other.status === 403, other.status);
  const bad = await call(AT, 'POST', '/v1/studio/uploads', { kind: 'audio', filename: 'bukan-audio.flac', content_type: 'audio/flac', size: 64 });
  const badPut = await fetch(BASE + bad.data?.upload_url, { method: 'PUT', headers: { authorization: `Bearer ${AT}`, 'content-type': 'audio/flac' }, body: new Uint8Array(64).fill(7) });
  check('berkas bukan audio ditolak (422)', badPut.status === 422, badPut.status);
}

console.log('\n▶ Sampul playlist pengguna');
{
  const { execFileSync } = await import('node:child_process');
  const { readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const FFM = createRequire(import.meta.url)('ffmpeg-static') as string;
  const img = (size: string) => {
    const f = `${tmpdir()}/rave-e2e-cover-${process.pid}-${size}.png`;
    execFileSync(FFM, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x5b2a6e:s=${size}`, '-frames:v', '1', f]);
    const b = readFileSync(f);
    rmSync(f, { force: true });
    return b;
  };
  const up = async (buf: Buffer) => {
    const init = await call(F, 'POST', '/v1/studio/uploads', { kind: 'artwork', purpose: 'playlist', filename: 'sampul.png', content_type: 'image/png', size: buf.length });
    const put = await fetch(BASE + init.data?.upload_url, { method: 'PUT', headers: { authorization: `Bearer ${F}`, 'content-type': 'image/png' }, body: new Uint8Array(buf) });
    return { status: put.status, data: await put.json() };
  };
  const pl = await call(F, 'POST', '/v1/library/playlists', { title: 'E2E Sampul', visibility: 'PRIVATE' });
  check('playlist baru tanpa sampul kustom', pl.status === 201 && pl.data?.has_custom_cover === false, pl.data);
  const ok = await up(img('600x600'));
  check('fan mengunggah sampul 600×600', ok.status === 200 && ok.data?.meta?.width === 600, ok.data);
  const set = await call(F, 'PATCH', `/v1/library/playlists/${pl.data?.id}`, { cover_url: ok.data?.public_url });
  check('sampul dipasang (has_custom_cover)', set.data?.cover_url === ok.data?.public_url && set.data?.has_custom_cover === true, set.data);
  const tiny = await up(img('100x100'));
  check('sampul < 300 px ditolak (422)', tiny.status === 422, tiny.status);
  const evil = await call(F, 'PATCH', `/v1/library/playlists/${pl.data?.id}`, { cover_url: 'javascript:alert(1)' });
  check('cover_url berbahaya ditolak (400)', evil.status === 400, evil.status);
  const clear = await call(F, 'PATCH', `/v1/library/playlists/${pl.data?.id}`, { cover_url: null });
  check('hapus sampul → otomatis lagi', clear.data?.has_custom_cover === false, clear.data);
  await call(F, 'DELETE', `/v1/library/playlists/${pl.data?.id}`);
}
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
check('QR berputar diterbitkan', /^RAVE1\./.test(qr.data?.payload ?? ''), qr.data);
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
// ---- Generated Contract: PDF draf, signed URL privat, RBAC, verifikasi publik ----
const KID = acc.data?.contract?.id;
const prev = await until(
  () => call(P, 'GET', `/v1/booking/contracts/${KID}/preview-url`),
  (r) => r.status === 200,
  60000,
  1000,
);
check('PDF draf kontrak dirender (preview-url)', prev.status === 200 && prev.data?.kind === 'DRAFT' && prev.data?.sha256?.length === 64, prev.data);
// Tanpa PDF (mis. Chromium tidak tersedia di host) langkah unduhan dicatat gagal, bukan membuat seluruh suite crash.
if (prev.status === 200 && prev.data?.url) {
  const pdfRes = await fetch(BASE + prev.data.url);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check('signed URL mengunduh PDF dengan hash cocok', pdfRes.status === 200 && pdfBuf.subarray(0, 5).toString() === '%PDF-' && (await import('node:crypto')).createHash('sha256').update(pdfBuf).digest('hex') === prev.data.sha256, [pdfRes.status, pdfBuf.length]);
  const tamperedPdf = await call(null, 'GET', prev.data.url.slice(0, -3) + 'abc');
  check('signed URL dimanipulasi ditolak (403)', tamperedPdf.status === 403, tamperedPdf.status);
} else {
  check('signed URL mengunduh PDF dengan hash cocok', false, 'dilewati: PDF draf tidak dirender');
  check('signed URL dimanipulasi ditolak (403)', false, 'dilewati: PDF draf tidak dirender');
}
const outsider = await call(fan.access_token, 'GET', `/v1/booking/contracts/${KID}/preview-url`);
check('pihak luar tidak bisa meminta pratinjau (403)', outsider.status === 403, outsider.status);
const vfy = await call(null, 'GET', `/v1/booking/verify/${KID}`);
check('verifikasi publik: status & hash tanpa data sensitif', vfy.status === 200 && vfy.data?.sha256 === prev.data?.sha256 && !JSON.stringify(vfy.data).match(/nik|npwp|rekening|bank|\*{4}/i), vfy.data);
const vers = await call(M, 'GET', `/v1/booking/contracts/${KID}/versions`);
check('riwayat versi memuat v1', vers.data?.data?.length === 1 && vers.data.data[0].version === 1, vers.data);
// ---- E-sign native OTP: urutan, RBAC, rate limit, sekali pakai, audit ----
const legacySign = await call(P, 'POST', `/v1/booking/bookings/${B}/sign`, { signer_name: 'Lewat jalur lama' }, true);
check('jalur tanda tangan lama tanpa OTP ditolak untuk kontrak baru (409)', legacySign.status === 409, legacySign.status);
const outOfTurn = await call(M, 'POST', `/v1/booking/contracts/${KID}/sign/request-otp`, {});
check('manajemen tidak bisa minta OTP sebelum giliran (409)', outOfTurn.status === 409, outOfTurn.status);
const strangerOtp = await call(fan.access_token, 'POST', `/v1/booking/contracts/${KID}/sign/request-otp`, {});
check('pihak luar tidak bisa minta OTP (403)', strangerOtp.status === 403, strangerOtp.status);
const otp1 = await call(P, 'POST', `/v1/booking/contracts/${KID}/sign/request-otp`, {});
check('promotor minta OTP (kode dev tersedia)', otp1.status === 200 && /^\d{6}$/.test(otp1.data?.dev_code ?? '') && otp1.data?.party === 'promotor', otp1.data);
const cooldown = await call(P, 'POST', `/v1/booking/contracts/${KID}/sign/request-otp`, {});
check('permintaan OTP beruntun dibatasi (429)', cooldown.status === 429, cooldown.status);
const wrong = await call(P, 'POST', `/v1/booking/contracts/${KID}/sign/verify-otp`, { code: otp1.data.dev_code === '000000' ? '111111' : '000000' });
check('OTP salah ditolak (422)', wrong.status === 422, wrong.data);
const okSign = await call(P, 'POST', `/v1/booking/contracts/${KID}/sign/verify-otp`, { code: otp1.data.dev_code });
check('promotor menandatangani → menunggu manajemen', okSign.data?.status === 'AWAITING_MANAGEMENT_SIGN', okSign.data);
const otpReuse = await call(P, 'POST', `/v1/booking/contracts/${KID}/sign/verify-otp`, { code: otp1.data.dev_code });
check('OTP sekali pakai & tidak bisa tanda tangan dua kali (409/422)', [409, 422].includes(otpReuse.status), otpReuse.status);
const turnNotif = await until(() => call(M, 'GET', '/v1/notifications'), (r) => r.data?.data?.some((n: any) => n.title === 'Giliran Anda menandatangani kontrak'), 15000, 1000);
check('manajemen dinotifikasi giliran tanda tangan setelah promotor menandatangani', turnNotif.data?.data?.some((n: any) => n.title === 'Giliran Anda menandatangani kontrak'));
const stillDraft = await call(P, 'GET', `/v1/booking/contracts/${KID}/preview-url`);
check('sebelum ACTIVE pratinjau tetap DRAF', stillDraft.data?.kind === 'DRAFT', stillDraft.data?.kind);
const otp2 = await call(M, 'POST', `/v1/booking/contracts/${KID}/sign/request-otp`, {});
const signed = await (async () => {
  await call(M, 'POST', `/v1/booking/contracts/${KID}/sign/verify-otp`, { code: otp2.data.dev_code });
  return call(M, 'GET', `/v1/booking/bookings/${B}`);
})();
check('tanda tangan kedua pihak (SIGNED)', signed.data?.status === 'SIGNED' && signed.data?.contract?.status === 'ACTIVE', [signed.data?.status, signed.data?.contract?.status]);
// ---- PDF final + lembar pengesahan + verifikasi publik (Batch 2, B5) ----
const fin = await until(() => call(P, 'GET', `/v1/booking/contracts/${KID}/preview-url`), (r) => r.data?.kind === 'FINAL', 90000, 1500);
check('PDF final dirender setelah semua pihak menandatangani', fin.data?.kind === 'FINAL' && /^[0-9a-f]{64}$/.test(fin.data?.sha256 ?? '') && fin.data?.final_sha256 === fin.data?.sha256 && fin.data?.draft_sha256 === prev.data?.sha256 && fin.data?.final_pending === false && fin.data?.verify_path === `/verify/${KID}`, fin.data);
if (fin.data?.url) {
  const fpdf = Buffer.from(await (await fetch(BASE + fin.data.url)).arrayBuffer());
  check('unduhan PDF final cocok dengan final_sha256', fpdf.subarray(0, 5).toString() === '%PDF-' && (await import('node:crypto')).createHash('sha256').update(fpdf).digest('hex') === fin.data.final_sha256, fpdf.length);
}
const draftAgain = await call(P, 'GET', `/v1/booking/contracts/${KID}/preview-url?kind=DRAFT`);
check('draf yang ditandatangani tetap bisa diunduh', draftAgain.data?.kind === 'DRAFT' && draftAgain.data?.sha256 === fin.data?.draft_sha256, draftAgain.data?.kind);
const vfyFinal = await call(null, 'GET', `/v1/booking/verify/${KID}`);
check('verifikasi publik menampilkan dokumen FINAL & hash tanda tangan', vfyFinal.data?.document === 'FINAL' && vfyFinal.data?.final_sha256 === fin.data?.final_sha256 && vfyFinal.data?.status === 'ACTIVE' && (vfyFinal.data?.signatures ?? []).every((x: any) => x.signed_sha256 === fin.data?.draft_sha256) && !JSON.stringify(vfyFinal.data).match(/nik|npwp|rekening|bank|\*{4}/i), vfyFinal.data);
const auditLog = await call(M, 'GET', `/v1/booking/contracts/${KID}/audit-log`);
check('audit kontrak mencatat finalize', auditLog.data?.data?.some((x: any) => x.action === 'finalize' && x.data?.final_sha256 === fin.data?.final_sha256), auditLog.data?.data?.map((x: any) => x.action));
const sigAudit = await call(M, 'GET', `/v1/booking/contracts/${KID}/audit-log`);
const acts = (sigAudit.data?.data ?? []).map((r: any) => r.action);
check('audit kontrak mencatat generate, OTP, tanda tangan (IP & UA)', ['generate', 'sign.otp_requested', 'sign.otp_failed', 'sign'].every((a) => acts.includes(a)) && sigAudit.data.data.filter((r: any) => r.action === 'sign').every((r: any) => r.ip_address), acts);
const lateOtp = await call(P, 'POST', `/v1/booking/contracts/${KID}/sign/request-otp`, {});
check('kontrak ACTIVE terkunci (409)', lateOtp.status === 409, lateOtp.status);
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

console.log('\n▶ Super Admin: pengaturan, storage, backup, event bus');
const sa = await login(SEED.emails.superadmin);
check('super admin: klaim superadmin + admin_role SUPER_ADMIN', sa.user.roles.includes('superadmin') && sa.user.admin_role === 'SUPER_ADMIN', [sa.user.roles, sa.user.admin_role]);
const S = sa.access_token;
const ov = await call(S, 'GET', '/v1/admin/platform/overview');
check('overview: semua service ok + KPI terisi', ov.status === 200 && ov.data.services.every((x: any) => x.ok) && ov.data.kpis.users_total > 0 && ov.data.kpis.artists > 0, ov.data?.services?.filter((x: any) => !x.ok));
const opsPut = await call(admin.access_token, 'PUT', '/v1/admin/platform/settings', { changes: { 'general.announcement': 'x' }, reason: 'uji akses' });
const opsGet = await call(admin.access_token, 'GET', '/v1/admin/platform/settings');
check('area Platform khusus Super Admin: OPS tidak bisa baca maupun ubah (403)', opsPut.status === 403 && opsGet.status === 403, [opsGet.status, opsPut.status]);
const badSet = await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'booking.default_dp_pct': 5 }, reason: 'uji validasi' });
check('validasi registri: DP 5% ditolak (400 + errors per kunci)', badSet.status === 400 && badSet.data?.errors?.[0]?.path === 'booking.default_dp_pct', badSet.data);
const maint = await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'maintenance.enabled': true }, reason: 'uji pemeliharaan e2e' });
check('aktifkan mode pemeliharaan (versi naik)', maint.status === 200 && maint.data.values['maintenance.enabled'] === true, maint.data);
const blocked = await until(
  () => call(P, 'POST', '/v1/booking/inquiries', { ...inqBody, event_name: 'Saat maintenance' }, true),
  (r) => r.status === 503,
  12_000,
);
check('gateway menolak transaksi saat pemeliharaan (503)', blocked.status === 503 && String(blocked.data?.type).endsWith('/maintenance'), [blocked.status, blocked.data]);
const readOk = await call(F, 'GET', '/v1/catalog/home');
const liveDuringMaint = await call(null, 'GET', '/v1/live/streams?status=live');
const pbDuringMaint = liveDuringMaint.data?.data?.[0] ? await call(null, 'POST', `/v1/live/streams/${liveDuringMaint.data.data[0].id}/playback`) : { status: 200 };
check('menonton live tetap jalan saat pemeliharaan (POST playback tidak diblok)', pbDuringMaint.status === 200, pbDuringMaint.status);
check('baca/streaming tetap jalan saat pemeliharaan', readOk.status === 200, readOk.status);
const cfg = await call(null, 'GET', '/v1/platform/config');
check('config publik memuat status pemeliharaan', cfg.data?.settings?.['maintenance.enabled'] === true, cfg.data);
const reset = await call(S, 'POST', '/v1/admin/platform/settings/reset', { keys: ['maintenance.enabled'], reason: 'selesai uji e2e' });
check('reset ke default', reset.data?.values?.['maintenance.enabled'] === false, reset.data?.values?.['maintenance.enabled']);
const setHist = await call(S, 'GET', '/v1/admin/platform/settings/history?key=maintenance.enabled');
check('riwayat perubahan tercatat', setHist.data?.data?.length >= 2, setHist.data?.data?.length);
const stor = await call(S, 'GET', '/v1/admin/platform/storage');
check('storage: disk, bucket, ukuran DB per schema', stor.data?.disk?.total_bytes > 0 && ['uploads', 'backups', 'branding'].every((n) => stor.data.buckets.some((b: any) => b.name === n)) && stor.data.database.schemas.some((x: any) => x.schema === 'catalog'), stor.data?.disk);
const scan = await call(S, 'POST', '/v1/admin/platform/storage/buckets/uploads/orphans/scan');
check('pindai file yatim', scan.status === 200 && Array.isArray(scan.data.orphans), scan.data);
const mnt = await call(S, 'POST', '/v1/admin/platform/storage/maintenance', { action: 'prune_idempotency' });
check('maintenance prune_idempotency', mnt.status === 200 && mnt.data.action === 'prune_idempotency', mnt.data);
const bk = await call(S, 'POST', '/v1/admin/platform/backups', { note: 'e2e' }, true);
check('backup dibuat (202 RUNNING)', bk.status === 202 && bk.data.status === 'RUNNING', [bk.status, bk.data]);
const bkDone = await until(
  () => call(S, 'GET', '/v1/admin/platform/backups'),
  (r) => r.data?.data?.find((x: any) => x.id === bk.data.id)?.status !== 'RUNNING',
  60_000,
);
const bkRow = bkDone.data?.data?.find((x: any) => x.id === bk.data.id);
check('backup selesai (pg_dump + gzip + sha256)', bkRow?.status === 'COMPLETED' && bkRow.size_bytes > 0 && bkRow.sha256?.length === 64, bkRow);
if (bkRow?.status === 'COMPLETED') {
  const del = await call(S, 'DELETE', `/v1/admin/platform/backups/${bk.data.id}`);
  check('hapus backup', del.data?.deleted === true, del.data);
}
const busOv = await call(S, 'GET', '/v1/admin/platform/bus');
check('event bus: topik & consumer group', busOv.data?.topics?.length > 0 && busOv.data.consumers.length > 0, busOv.data?.topics?.length);
console.log('\n▶ Super Admin: branding & tema');
async function upload(token: string, slot: string, type: string, body: Buffer) {
  const res = await fetch(`${BASE}/v1/admin/platform/branding?slot=${slot}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': type }, body: new Uint8Array(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const goodSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#1ed760"/></svg>');
const evilSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" onload="alert(1)"><script>alert(2)</script></svg>');
const wideSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50"><rect width="200" height="50"/></svg>');
const opsUp = await upload(admin.access_token, 'icon', 'image/svg+xml', goodSvg);
check('admin OPS tidak boleh unggah branding (403)', opsUp.status === 403, opsUp.status);
const evil = await upload(S, 'icon', 'image/svg+xml', evilSvg);
check('SVG berisi skrip/on* ditolak (422)', evil.status === 422, [evil.status, evil.data?.detail]);
const wide = await upload(S, 'icon', 'image/svg+xml', wideSvg);
check('ikon non-persegi ditolak', wide.status === 422, [wide.status, wide.data?.detail]);
const tinyPng = pngSquare(16);
const tiny = await upload(S, 'icon', 'image/png', tinyPng);
check('PNG ikon < 64 px ditolak', tiny.status === 422, [tiny.status, tiny.data?.detail]);
const icon = await upload(S, 'icon', 'image/svg+xml', goodSvg);
check('unggah ikon SVG (201, path bucket branding)', icon.status === 201 && /^\/v1\/platform\/branding\/icon-[0-9a-f]{16}\.svg$/.test(icon.data?.url), icon.data);
const logo = await upload(S, 'logo', 'image/png', pngSquare(128));
check('unggah logo PNG (201)', logo.status === 201 && logo.data?.url?.endsWith('.png') && logo.data.width === 128, logo.data);
const extUrl = await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'branding.logo_url': 'https://evil.example/logo.png' }, reason: 'uji url eksternal' });
check('URL logo eksternal ditolak registri (400)', extUrl.status === 400, extUrl.status);
const ghost = await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'branding.logo_url': '/v1/platform/branding/logo-0000000000000000.png' }, reason: 'uji file hilang' });
check('path file yang belum diunggah ditolak (400)', ghost.status === 400 && ghost.data?.errors?.[0]?.path === 'branding.logo_url', ghost.data?.errors);
const brandSave = await call(S, 'PUT', '/v1/admin/platform/settings', {
  changes: { 'branding.icon_url': icon.data?.url, 'branding.logo_url': logo.data?.url, 'appearance.dashboard_theme': 'dark', 'appearance.allow_user_theme': false },
  reason: 'uji branding & tema e2e',
});
check('simpan branding + tema gelap terkunci', brandSave.status === 200 && brandSave.data.values['appearance.dashboard_theme'] === 'dark', brandSave.data);
const pubCfg = await call(null, 'GET', '/v1/platform/config');
check('config publik memuat ikon, logo & tema', pubCfg.data?.settings?.['branding.icon_url'] === icon.data?.url && pubCfg.data.settings['appearance.dashboard_theme'] === 'dark' && pubCfg.data.settings['appearance.allow_user_theme'] === false, pubCfg.data?.settings);
const iconFile = await fetch(BASE + icon.data?.url);
check('file ikon publik: image/svg+xml + CSP sandbox + nosniff', iconFile.status === 200 && iconFile.headers.get('content-type') === 'image/svg+xml' && /sandbox/.test(iconFile.headers.get('content-security-policy') ?? '') && iconFile.headers.get('x-content-type-options') === 'nosniff', [iconFile.status, iconFile.headers.get('content-type')]);
const brandFiles = await call(S, 'GET', '/v1/admin/platform/storage/buckets/branding/files');
check('bucket branding: file terpakai ditandai', brandFiles.data?.data?.some((f: any) => f.referenced === true) , brandFiles.data?.data);
const delUsed = await call(S, 'DELETE', `/v1/admin/platform/storage/buckets/branding/files/${icon.data?.url.split('/').pop()}?force=true`);
check('file branding yang dipakai tidak bisa dihapus (409)', delUsed.status === 409, delUsed.status);
const brandReset = await call(S, 'POST', '/v1/admin/platform/settings/reset', { keys: ['branding.icon_url', 'branding.logo_url', 'appearance.dashboard_theme', 'appearance.allow_user_theme'], reason: 'kembalikan branding bawaan' });
check('reset branding & tema ke bawaan', brandReset.data?.values?.['branding.icon_url'] === '' && brandReset.data.values['appearance.dashboard_theme'] === 'light', brandReset.data?.values);
for (const f of [icon, logo]) await call(S, 'DELETE', `/v1/admin/platform/storage/buckets/branding/files/${f.data?.url?.split('/').pop()}`);

const admins = await call(S, 'GET', '/v1/admin/iam/admins');
check('daftar tim admin', admins.data?.data?.some((u: any) => u.admin_role === 'SUPER_ADMIN'), admins.data?.data?.map((u: any) => u.admin_role));
const selfDemote = await call(S, 'PATCH', `/v1/admin/iam/users/${SEED.users.superadmin}`, { admin_role: null, reason: 'uji proteksi' });
check('tidak bisa mencabut Super Admin milik sendiri', selfDemote.status === 403 || selfDemote.status === 409, selfDemote.status);

console.log('\n▶ Live streaming (RTMP, browser, HLS, chat, akses tiket)');
await wait(6000); // gateway mem-polling pengaturan tiap 5 dtk — pastikan reset mode pemeliharaan di atas sudah terbaca
const FF = createRequire(import.meta.url)('ffmpeg-static') as string;
const RTMP = process.env.LIVE_RTMP ?? 'rtmp://127.0.0.1:1935/live';
/** Publisher ala OBS: sinyal uji H.264/AAC ke RTMP. */
const pushRtmp = (key: string, seconds = 60) =>
  spawn(FF, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', String(seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'flv', `${RTMP}/${key}`], { stdio: 'ignore' });
const exited = (p: ReturnType<typeof spawn>, ms: number) => new Promise<number | null>((r) => { const t = setTimeout(() => r(null), ms); p.on('exit', (c) => (clearTimeout(t), r(c))); });
const streamOf = (id: string, token: string | null = null) => call(token, 'GET', `/v1/live/streams/${id}`);

const demoList = await call(null, 'GET', '/v1/live/streams?status=live');
const demo = demoList.data?.data?.find((x: any) => x.is_demo);
check('kanal demo sedang LIVE (sumber demo → RTMP → HLS)', demo?.status === 'LIVE' && demo.ingest === 'demo', demoList.data?.data?.map((x: any) => [x.title, x.status]));
const pb = await call(null, 'POST', `/v1/live/streams/${demo?.id}/playback`);
check('anonim dapat URL HLS bertanda tangan', pb.status === 200 && /index\.m3u8\?token=/.test(pb.data?.hls_url), pb.data);
const m3u8 = await fetch(BASE + pb.data?.hls_url);
const playlist = await m3u8.text();
const segLine = playlist.split('\n').find((l) => l.startsWith('seg'));
check('playlist HLS live: content-type, segmen membawa token', m3u8.headers.get('content-type') === 'application/vnd.apple.mpegurl' && !!segLine?.includes('token='), playlist.slice(0, 200));
const segRes = await fetch(`${BASE}/v1/live/hls/${demo?.id}/${segLine}`);
const segBuf = Buffer.from(await segRes.arrayBuffer());
check('segmen MPEG-TS terunduh (sync byte 0x47)', segRes.status === 200 && segBuf.length > 10_000 && segBuf[0] === 0x47, [segRes.status, segBuf.length]);
const noTok = await fetch(`${BASE}/v1/live/hls/${demo?.id}/index.m3u8?token=1.palsu`);
check('HLS tanpa token valid ditolak (403)', noTok.status === 403, noTok.status);
const hb = await call(F, 'POST', `/v1/live/streams/${demo?.id}/heartbeat`, { viewer_id: crypto.randomUUID() });
await call(null, 'POST', `/v1/live/streams/${demo?.id}/heartbeat`, { viewer_id: crypto.randomUUID() });
// Jumlah penonton & total_views ditulis job tiap 5 dtk (konsisten-akhir, aman multi-replika).
const afterHb = await until(() => streamOf(demo?.id), (r) => r.data?.viewers >= 2 && r.data.total_views >= 2, 15_000);
check('heartbeat menghitung penonton (login + anonim)', hb.data?.viewers >= 1 && afterHb.data?.viewers >= 2 && afterHb.data.total_views >= 2, [hb.data, afterHb.data?.viewers, afterHb.data?.total_views]);
const anonChat = await call(null, 'POST', `/v1/live/streams/${demo?.id}/chat`, { body: 'halo' });
check('chat butuh login (401)', anonChat.status === 401, anonChat.status);
const c1 = await call(F, 'POST', `/v1/live/streams/${demo?.id}/chat`, { body: 'Merinding dengar lagu baru! 🔥' });
const c2 = await call(F, 'POST', `/v1/live/streams/${demo?.id}/chat`, { body: 'spam' });
check('kirim chat (201) + slowmode menolak pesan beruntun (429)', c1.status === 201 && c1.data.mine === true && c2.status === 429, [c1.status, c2.status]);
const chatPoll = await call(null, 'GET', `/v1/live/streams/${demo?.id}/chat`);
check('polling chat memuat pesan', chatPoll.data?.data?.some((m: any) => m.id === c1.data?.id) && chatPoll.data.last_id >= c1.data?.id, chatPoll.data?.last_id);
const modDel = await call(admin.access_token, 'DELETE', `/v1/admin/live/chat/${c1.data?.id}`);
const chatAfter = await call(null, 'GET', `/v1/live/streams/${demo?.id}/chat`);
check('admin menghapus pesan chat (moderasi)', modDel.data?.deleted === true && !chatAfter.data?.data?.some((m: any) => m.id === c1.data?.id), modDel.data);

// Siaran bertiket (seed: event ticketing #1)
const tour = await streamOf(SEED.liveStreams.tourBandung, M);
check('siaran bertiket: non-pemegang tiket → ticket_required', tour.data?.access === 'TICKET' && tour.data.can_watch === false && tour.data.access_reason === 'ticket_required', tour.data && [tour.data.access_reason]);
const tourAnon = await streamOf(SEED.liveStreams.tourBandung);
check('siaran bertiket: anonim → login_required', tourAnon.data?.access_reason === 'login_required', tourAnon.data?.access_reason);
const tourPb = await call(M, 'POST', `/v1/live/streams/${SEED.liveStreams.tourBandung}/playback`);
check('playback bertiket tanpa tiket → 403 ticket-required', tourPb.status === 403 && String(tourPb.data?.type).endsWith('/ticket-required'), [tourPb.status, tourPb.data?.type]);
if (ev?.id === seedId(700, 1)) {
  const fanTour = await streamOf(SEED.liveStreams.tourBandung, F);
  check('pemegang tiket event lolos gating (tinggal menunggu siaran dimulai)', fanTour.data?.access_reason === 'not_live', fanTour.data?.access_reason);
}

// RTMP (OBS) ingest: kunci, LIVE, putus → INTERRUPTED, sambung ulang → LIVE, akhiri → ENDED
const artistTok = (await login(SEED.emails.artist)).access_token;
const fanCreate = await call(F, 'POST', '/v1/live/studio/streams', { org_id: SEED.artists[0].orgId, title: 'Tidak boleh', access: 'PUBLIC' });
check('fan bukan anggota org tidak bisa membuat siaran (403)', fanCreate.status === 403, fanCreate.status);
const created = await call(artistTok, 'POST', '/v1/live/studio/streams', { org_id: SEED.artists[0].orgId, title: 'E2E Soundcheck RTMP', access: 'PUBLIC' });
check('artis membuat siaran → stream key sekali tampil + URL RTMP', created.status === 201 && /^rave_/.test(created.data?.stream_key) && created.data.stream.status === 'SCHEDULED', created.data);
const LS = created.data?.stream?.id as string;
const badPub = pushRtmp('rave_kunci_palsu', 10);
check('RTMP dengan kunci salah ditolak server', (await exited(badPub, 8000)) !== null, 'publisher tidak diputus');
let pub = pushRtmp(created.data?.stream_key, 120);
const live1 = await until(() => streamOf(LS), (r) => r.data?.status === 'LIVE', 20_000);
check('publish RTMP → LIVE (ingest rtmp)', live1.data?.status === 'LIVE' && live1.data.ingest === 'rtmp', live1.data?.status);
const health = await until(() => call(artistTok, 'GET', `/v1/live/studio/streams/${LS}/health`), (r) => r.data?.bitrate_kbps > 0 && r.data.transcoder === 'running', 25_000);
check('health: transcoder running, segmen & bitrate terukur', health.data?.transcoder === 'running' && health.data.bitrate_kbps > 0 && health.data.segment_age_s < 10, health.data);
const rot = await call(artistTok, 'POST', `/v1/live/studio/streams/${LS}/key`);
check('rotasi kunci ditolak saat siaran berjalan (409)', rot.status === 409, rot.status);
const second = pushRtmp(created.data?.stream_key, 10);
check('publisher kedua untuk stream yang sama ditolak', (await exited(second, 8000)) !== null);
pub.kill('SIGKILL');
const intr = await until(() => streamOf(LS), (r) => r.data?.status === 'INTERRUPTED', 20_000);
check('publisher putus → INTERRUPTED (bukan langsung berakhir)', intr.data?.status === 'INTERRUPTED', intr.data?.status);
pub = pushRtmp(created.data?.stream_key, 120);
const back = await until(() => streamOf(LS), (r) => r.data?.status === 'LIVE', 20_000);
check('sambung ulang dalam masa tunggu → LIVE lagi', back.data?.status === 'LIVE', back.data?.status);
const endRes = await call(artistTok, 'POST', `/v1/live/studio/streams/${LS}/end`);
check('akhiri siaran → ENDED (ended_by_host)', endRes.data?.status === 'ENDED' && endRes.data.ended_reason === 'ended_by_host', endRes.data?.status);
check('publisher diputus saat siaran diakhiri', (await exited(pub, 10_000)) !== null);
const pbEnded = await call(null, 'POST', `/v1/live/streams/${LS}/playback`);
check('playback siaran berakhir → 409 not-live', pbEnded.status === 409, pbEnded.status);
const again = pushRtmp(created.data?.stream_key, 10);
check('kunci siaran yang sudah berakhir tidak bisa dipakai lagi', (await exited(again, 8000)) !== null);

// Ingest browser: potongan WebM (MediaRecorder) berurutan lewat HTTP
const created2 = await call(artistTok, 'POST', '/v1/live/studio/streams', { org_id: SEED.artists[0].orgId, title: 'E2E Siaran dari Browser', access: 'PUBLIC' });
const BS = created2.data?.stream?.id as string;
const webm = await new Promise<Buffer>((res, rej) => {
  const p = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330', '-t', '12',
    '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '800k', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const parts: Buffer[] = [];
  p.stdout!.on('data', (d) => parts.push(d));
  p.on('exit', (c) => (c === 0 ? res(Buffer.concat(parts)) : rej(new Error('webm gagal'))));
});
const ing = await call(artistTok, 'POST', `/v1/live/studio/streams/${BS}/ingest/start`, { mime: 'video/webm;codecs=vp8,opus' });
check('mulai ingest browser', ing.status === 200 && !!ing.data?.session_id, ing.data);
const putChunk = (seq: number, buf: Buffer) =>
  fetch(`${BASE}/v1/live/studio/streams/${BS}/ingest/${ing.data?.session_id}/chunks/${seq}`, { method: 'PUT', headers: { authorization: `Bearer ${artistTok}`, 'content-type': 'video/webm' }, body: new Uint8Array(buf) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const CH = 24;
const size = Math.ceil(webm.length / CH);
const chunks = Array.from({ length: CH }, (_, i) => webm.subarray(i * size, (i + 1) * size));
let okChunks = 0;
// Potongan 3 dikirim sebelum 2 (jaringan tak berurutan) + potongan 1 diulang (retry) — server harus tetap merakit berurutan.
const chunkOrder = [0, 1, 1, 3, 2, ...Array.from({ length: CH - 4 }, (_, i) => i + 4)];
for (const seq of chunkOrder) {
  const r = await putChunk(seq, chunks[seq]);
  if (r.status === 200) okChunks++;
  await wait(400);
}
check('potongan WebM diterima (termasuk duplikat & tak berurutan)', okChunks === chunkOrder.length, okChunks);
const bLive = await until(() => call(artistTok, 'GET', `/v1/live/studio/streams/${BS}/health`), (r) => r.data?.status === 'LIVE' && r.data.last_segment_at, 20_000);
check('ingest browser → LIVE + segmen HLS (VP8/Opus → H.264/AAC)', bLive.data?.status === 'LIVE' && !!bLive.data.last_segment_at, bLive.data);
const bPb = await call(null, 'POST', `/v1/live/streams/${BS}/playback`);
const bList = await fetch(BASE + bPb.data?.hls_url).then((r) => r.text());
check('siaran browser dapat diputar (playlist berisi segmen)', /seg\d+\.ts\?token=/.test(bList), bList.slice(0, 120));
await call(artistTok, 'POST', `/v1/live/studio/streams/${BS}/ingest/${ing.data?.session_id}/stop`);
const bIntr = await until(() => streamOf(BS), (r) => r.data?.status === 'INTERRUPTED', 10_000);
check('stop ingest browser → INTERRUPTED', bIntr.data?.status === 'INTERRUPTED', bIntr.data?.status);
const modStop = await call(admin.access_token, 'POST', `/v1/admin/live/streams/${BS}/stop`, { reason: 'uji moderasi e2e' });
check('admin menghentikan siaran (moderasi)', modStop.data?.status === 'ENDED' && String(modStop.data.ended_reason).startsWith('moderation'), modStop.data?.ended_reason);
for (const id of [LS, BS]) await call(artistTok, 'DELETE', `/v1/live/studio/streams/${id}`);
const ovLive = await call(S, 'GET', '/v1/admin/platform/overview');
check('dasbor Super Admin: service live sehat + KPI siaran', ovLive.data?.services?.some((x: any) => x.name === 'live' && x.ok) && ovLive.data.kpis.streams_live >= 1, ovLive.data?.kpis?.streams_live);

console.log('\n▶ Iklan: kebijakan penayangan tier Gratis');
const adAnon = await call(null, 'POST', '/v1/ads/break', { placement: 'between_tracks' });
check('iklan: anonim tidak pernah diberi iklan', adAnon.data?.outcome === 'anonymous' && adAnon.data.ads.length === 0, adAnon.data);
const adPrem = await call(admin.access_token, 'POST', '/v1/admin/ads/simulate', { premium: true });
check('iklan: simulator — Premium selalu bebas iklan', adPrem.data?.outcome === 'premium', adPrem.data);
const adGrace = await call(admin.access_token, 'POST', '/v1/admin/ads/simulate', { streams_today: 1 });
check('iklan: simulator — masa bebas iklan harian', adGrace.data?.outcome === 'grace', adGrace.data);
const adServe = await call(admin.access_token, 'POST', '/v1/admin/ads/simulate', { streams_today: 10, streams_since_break: 5, minutes_since_break: 30, genres: ['indie-pop'] });
check('iklan: simulator — tayang bila syarat terpenuhi', adServe.data?.outcome === 'serve' && adServe.data.slots >= 1, adServe.data);
const adBad = await call(admin.access_token, 'POST', '/v1/admin/ads/campaigns', { advertiser: 'E2E', name: 'Uji judi', category: 'gambling', type: 'display', title: 'Uji kategori', duration_s: 10 });
check('iklan: kategori terlarang ditolak (422)', adBad.status === 422, adBad.status);
const adNew = await call(admin.access_token, 'POST', '/v1/admin/ads/campaigns', { advertiser: 'E2E', name: 'Uji alur tinjauan', category: 'education', type: 'display', title: 'Kelas produksi musik', duration_s: 10, click_url: 'https://example.com', submit: true });
check('iklan: kampanye valid diajukan', adNew.status === 201 && adNew.data.status === 'PENDING_REVIEW', adNew.data);
const adSelf = await call(admin.access_token, 'POST', `/v1/admin/ads/campaigns/${adNew.data?.id}/review`, { approve: true });
check('iklan: pembuat tidak boleh meninjau sendiri (403)', adSelf.status === 403, adSelf.status);
const adRej = await call(S, 'POST', `/v1/admin/ads/campaigns/${adNew.data?.id}/review`, { approve: false, note: 'Uji e2e' });
check('iklan: Super Admin menolak dengan alasan', adRej.data?.status === 'REJECTED', adRej.data?.status);
const adDel = await call(admin.access_token, 'DELETE', `/v1/admin/ads/campaigns/${adNew.data?.id}`);
check('iklan: kampanye ditolak tanpa impresi dapat dihapus', adDel.data?.deleted === true, adDel.data);
const adOv = await call(admin.access_token, 'GET', '/v1/admin/ads/overview?days=7');
check('iklan: ringkasan & matriks kategori', !!adOv.data?.kpis && adOv.data.policy.categories.some((c: any) => c.key === 'gambling' && c.blocked), adOv.data?.kpis);

console.log('\n▶ Refund tiket (permintaan pembeli, perubahan jadwal, pembatalan event, bayar terlambat)');
{
  // Endpoint /v1/ticketing/orders* dibatasi 30 permintaan/menit per akun: polling di bagian ini tiap 2,5 dtk.
  const day = 86_400_000;
  /** Panggilan endpoint order tiket fan: ulangi saat kena rate limit 30/menit (gateway kelas `tix`). */
  const callT = async (method: string, path: string, body?: unknown) => {
    for (let i = 0; ; i++) {
      const r = await call(F, method, path, body);
      if (r.status !== 429 || i >= 20) return r;
      await wait(3000);
    }
  };
  const starts = new Date(Date.now() + 30 * day);
  const evNew = await call(P, 'POST', '/v1/ticketing/events', {
    org_id: SEED.orgs.pensiPromotor, title: `E2E Refund ${Date.now()}`, city: 'Bandung', venue_name: 'Aula E2E',
    starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 4 * 3600_000).toISOString(),
    ticket_types: [{ name: 'Reguler', price: 100_000, quota: 50, max_per_account: 4 }],
  });
  const evId = evNew.data?.id;
  await call(P, 'POST', `/v1/ticketing/events/${evId}/publish`);
  const typeId = evNew.data?.ticket_types?.[0]?.id;
  const buy = async (pay = true) => {
    const o = await call(F, 'POST', '/v1/ticketing/orders', { event_id: evId, items: [{ ticket_type_id: typeId, quantity: 1 }] }, true);
    if (pay) {
      await call(F, 'POST', `/v1/finance/invoices/${o.data?.invoice?.id}/simulate-pay`, { method: 'QRIS' }, true);
      await until(() => callT('GET', `/v1/ticketing/orders/${o.data?.order?.id}`), (r) => r.data?.status === 'PAID', 30000, 2500);
    }
    return o.data;
  };
  const setRefund = (changes: Record<string, unknown>) => call(S, 'PUT', '/v1/admin/platform/settings', { changes, reason: 'uji refund e2e' });
  const refundDone = (id: string) => until(() => callT('GET', `/v1/ticketing/orders/${id}`), (r) => r.data?.refund?.status === 'COMPLETED', 30000, 2500);

  // 1) Default kebijakan: refund atas permintaan pembeli mati.
  const o1 = await buy();
  await setRefund({ 'refund.buyer_request_enabled': false });
  const q0 = await until(() => callT('GET', `/v1/ticketing/orders/${o1.order.id}/refund`), (r) => r.data?.eligible === false, 30000, 2500);
  const r0 = await callT('POST', `/v1/ticketing/orders/${o1.order.id}/refund`);
  check('refund pembeli ditolak saat kebijakan mati (409)', q0.data?.eligible === false && r0.status === 409, [q0.data, r0.status]);

  // 2) Kebijakan dinyalakan (80%, H-7): pembeli mengajukan sendiri.
  await setRefund({ 'refund.buyer_request_enabled': true, 'refund.buyer_refund_pct': 80 });
  const q1 = await until(() => callT('GET', `/v1/ticketing/orders/${o1.order.id}/refund`), (r) => r.data?.eligible === true, 30000, 2500);
  check('pratinjau refund pembeli: 80% tanpa biaya layanan', q1.data?.reason === 'buyer_request' && q1.data?.pct === 80 && q1.data?.amount === 80_000, q1.data);
  const r1 = await callT('POST', `/v1/ticketing/orders/${o1.order.id}/refund`);
  check('pengajuan refund → order REFUNDED, tiket dibatalkan', r1.status === 200 && r1.data?.status === 'REFUNDED' && r1.data?.refund?.status === 'PENDING', r1.data);
  const d1 = await refundDone(o1.order.id);
  check('finance mengembalikan dana (ticketing → finance → ticketing)', d1.data?.refund?.status === 'COMPLETED' && d1.data?.refund?.amount === 80_000, d1.data?.refund);
  // Refund lewat adapter penyedia: REQUESTED → PENDING (sandbox) → COMPLETED oleh webhook bertanda tangan.
  const fr = await call(S, 'GET', `/v1/admin/finance/refunds?reference_id=${o1.order.id}`);
  const rf = fr.data?.data?.[0];
  check('refund melewati penyedia: PENDING → COMPLETED via webhook', rf?.status === 'COMPLETED' && rf?.provider === 'sandbox' && /^sbx_rf_/.test(rf?.provider_ref ?? '') && rf?.settled_by === 'provider', rf);
  const secret = process.env.PG_WEBHOOK_SECRET ?? 'dev-pg-webhook-secret';
  const sign = (raw: string, key = secret) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`;
  };
  const hook = (raw: string, sig: string) => fetch(`${BASE}/v1/webhooks/pg/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pg-signature': sig }, body: raw });
  const lateFail = JSON.stringify({ event_id: `e2e_rf_${Date.now()}`, refund_ref: rf?.provider_ref, status: 'FAILED', failure_reason: 'uji e2e' });
  const forged = await hook(lateFail, sign(lateFail, 'kunci-palsu'));
  check('webhook refund bertanda tangan palsu ditolak (401)', forged.status === 401, forged.status);
  const genuine = await hook(lateFail, sign(lateFail));
  const rfAfter = (await call(S, 'GET', `/v1/admin/finance/refunds?reference_id=${o1.order.id}`)).data?.data?.[0];
  check('refund final tidak berubah oleh webhook susulan', genuine.status === 200 && rfAfter?.status === 'COMPLETED', [genuine.status, rfAfter?.status]);
  const recon = await call(S, 'GET', '/v1/admin/finance/reconciliation');
  const owed = recon.data?.accounts?.find((a: any) => a.account === `liability:refund:${SEED.users.fan}`)?.balance ?? 0;
  check('utang refund ke pembeli lunas & ledger seimbang', recon.data?.balanced === true && Number(owed) === 0, [recon.data?.balanced, owed]);
  const retryNone = await call(S, 'POST', `/v1/admin/finance/refunds/${o1.order.id}/retry`);
  check('refund selesai tidak bisa dikirim ulang (409)', retryNone.status === 409, retryNone.status);

  const r1b = await callT('POST', `/v1/ticketing/orders/${o1.order.id}/refund`);
  check('refund ganda ditolak (409)', r1b.status === 409, r1b.status);
  const myT = await call(F, 'GET', '/v1/ticketing/tickets/mine');
  const t1 = myT.data?.data?.find((t: any) => t.order_id === o1.order.id);
  const qrDead = t1 ? await call(F, 'GET', `/v1/ticketing/tickets/${t1.id}/qr`) : { status: 0 };
  check('tiket refund tidak bisa dipakai (QR 409)', t1?.status === 'REFUNDED' && qrDead.status === 409, [t1?.status, qrDead.status]);
  const evAfter = await call(null, 'GET', `/v1/ticketing/events/${evId}`);
  check('kuota tiket kembali ke penjualan', evAfter.data?.ticket_types?.[0]?.remaining === 50, evAfter.data?.ticket_types?.[0]);

  // 3) Jadwal berubah → refund penuh walau permintaan biasa dimatikan lagi.
  await setRefund({ 'refund.buyer_request_enabled': false });
  const o2 = await buy();
  const moved = await call(P, 'PATCH', `/v1/ticketing/events/${evId}`, { starts_at: new Date(starts.getTime() + day).toISOString(), ends_at: new Date(starts.getTime() + day + 4 * 3600_000).toISOString() });
  const q2 = await until(() => callT('GET', `/v1/ticketing/orders/${o2.order.id}/refund`), (r) => r.data?.reason === 'rescheduled', 30000, 2500);
  check('jadwal berubah → hak refund penuh termasuk biaya layanan', moved.status === 200 && q2.data?.eligible && q2.data?.pct === 100 && q2.data?.refund_fee === true, q2.data);
  const badTime = await call(P, 'PATCH', `/v1/ticketing/events/${evId}`, { ends_at: new Date(starts.getTime() - day).toISOString() });
  check('edit event: selesai sebelum mulai ditolak (400)', badTime.status === 400, badTime.status);

  // 4) Pembatalan event: order PAID direfund penuh otomatis; reservasi berjalan dihentikan.
  const o3 = await buy(false); // reservasi belum dibayar
  const fanCancel = await call(F, 'POST', `/v1/ticketing/events/${evId}/cancel`, { reason: 'Fan tidak boleh membatalkan event' });
  check('fan tidak bisa membatalkan event (403)', fanCancel.status === 403, fanCancel.status);
  const cancel = await call(P, 'POST', `/v1/ticketing/events/${evId}/cancel`, { reason: 'Venue tidak dapat digunakan (uji e2e)' });
  check('promotor membatalkan event → refund diajukan', cancel.status === 200 && cancel.data?.status === 'CANCELLED' && cancel.data?.refunds?.requested === 1, cancel.data?.refunds ?? cancel.data);
  const d2 = await refundDone(o2.order.id);
  check('pembeli event batal menerima refund penuh', d2.data?.refund?.reason === 'event_cancelled' && d2.data?.refund?.amount === 100_000, d2.data?.refund);
  const o3s = await callT('GET', `/v1/ticketing/orders/${o3.order.id}`);
  check('reservasi event batal dihentikan (CANCELLED)', o3s.data?.status === 'CANCELLED', o3s.data?.status);

  // 5) Pembayaran tetap masuk untuk reservasi event yang sudah batal → refund otomatis (tidak ditahan / dead letter).
  await call(F, 'POST', `/v1/finance/invoices/${o3.invoice.id}/simulate-pay`, { method: 'QRIS' }, true);
  const d3 = await refundDone(o3.order.id);
  check('pembayaran terlambat untuk event batal → dana dikembalikan otomatis', d3.data?.status === 'REFUNDED' && d3.data?.refund?.amount === 100_000, d3.data);

  const nRefund = await until(() => call(F, 'GET', '/v1/notifications'), (r) => r.data?.data?.some((n: any) => n.title === 'Dana tiket dikembalikan'));
  check('pembeli menerima notifikasi refund', nRefund.data?.data?.some((n: any) => n.title === 'Dana tiket dikembalikan'));
  const nMove = (await call(F, 'GET', '/v1/notifications')).data?.data?.some((n: any) => n.title === 'Jadwal event berubah');
  check('pembeli menerima notifikasi perubahan jadwal', !!nMove);
  const queue = await call(S, 'GET', '/v1/admin/ticketing/refunds');
  check('antrean refund di back office', queue.status === 200 && queue.data?.data?.some((r: any) => r.order_id === o2.order.id), queue.status);
  await call(S, 'POST', '/v1/admin/platform/settings/reset', { keys: ['refund.buyer_request_enabled', 'refund.buyer_refund_pct'], reason: 'selesai uji refund e2e' });
}

console.log('\n▶ Akses per peran (fan, artis, manajer, promotor, admin, Super Admin)');
{
  const nonAdmin: [string, string][] = [['fan', F], ['artis', artistTok], ['manajer', M], ['promotor', P]];
  const probes = ['/v1/admin/platform/settings', '/v1/admin/platform/overview', '/v1/admin/qc/releases', '/v1/admin/iam/kyc', '/v1/admin/finance/reconciliation', '/v1/admin/ticketing/refunds', '/v1/admin/ads/campaigns'];
  const leaks: string[] = [];
  for (const [who, tok] of nonAdmin)
    for (const path of probes) {
      const r = await call(tok, 'GET', path);
      if (r.status !== 403) leaks.push(`${who} ${path} → ${r.status}`);
    }
  check('akun non-admin ditolak di semua endpoint back office & platform (403)', !leaks.length, leaks);

  const meOps = await call(admin.access_token, 'GET', '/v1/me');
  check('/v1/me memuat izin efektif peran (OPS tanpa refund)', meOps.data?.admin_permissions?.includes('qc.review') && !meOps.data?.admin_permissions?.includes('finance.refund'), meOps.data?.admin_permissions);
  const opsRefund = await call(admin.access_token, 'POST', `/v1/admin/ticketing/orders/${crypto.randomUUID()}/refund`, { pct: 100, refund_fee: true, note: 'uji akses peran' });
  check('OPS tidak boleh memutuskan refund (403)', opsRefund.status === 403, opsRefund.status);

  // Admin baru berperan Finance & Support (dibuat Super Admin lewat Tim Admin).
  const mk = async (role: string) => {
    const email = `e2e-${role.toLowerCase()}-${Date.now()}@rave.test`;
    const first = await login(email);
    await call(S, 'PATCH', `/v1/admin/iam/users/${first.user.id}`, { admin_role: role, reason: 'uji peran e2e' });
    return { id: first.user.id as string, tok: (await login(email)).access_token };
  };
  const fin = await mk('FINANCE');
  const sup = await mk('SUPPORT');
  const finRecon = await call(fin.tok, 'GET', '/v1/admin/finance/reconciliation');
  const finQc = await call(fin.tok, 'GET', '/v1/admin/qc/releases');
  const finPlat = await call(fin.tok, 'GET', '/v1/admin/platform/settings');
  check('Finance: buka keuangan, ditolak QC & Platform', finRecon.status === 200 && finQc.status === 403 && finPlat.status === 403, [finRecon.status, finQc.status, finPlat.status]);
  const supAudit0 = await call(sup.tok, 'GET', '/v1/admin/iam/audit-logs');
  check('Support default tidak boleh lihat audit log (403)', supAudit0.status === 403, supAudit0.status);

  // Super Admin memberi Support izin audit log → berlaku tanpa login ulang.
  const bad = await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'access.role.SUPPORT': ['users.view', 'platform.everything'] }, reason: 'uji validasi izin' });
  check('izin tak dikenal ditolak (400)', bad.status === 400, bad.status);
  const grant = await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'access.role.SUPPORT': ['users.view', 'finance.view', 'audit.view'] }, reason: 'Support perlu audit log (uji e2e)' });
  const supAudit1 = await until(() => call(sup.tok, 'GET', '/v1/admin/iam/audit-logs'), (r) => r.status === 200, 15000);
  check('Super Admin memberi izin → langsung berlaku tanpa login ulang', grant.status === 200 && supAudit1.status === 200, [grant.status, supAudit1.status]);
  const opsGrant = await call(admin.access_token, 'PUT', '/v1/admin/platform/settings', { changes: { 'access.role.OPS': ['finance.refund'] }, reason: 'eskalasi diri' });
  check('admin non-Super tidak bisa mengubah izin peran (403)', opsGrant.status === 403, opsGrant.status);
  await call(S, 'POST', '/v1/admin/platform/settings/reset', { keys: ['access.role.SUPPORT'], reason: 'selesai uji peran e2e' });
  const supAudit2 = await until(() => call(sup.tok, 'GET', '/v1/admin/iam/audit-logs'), (r) => r.status === 403, 15000);
  check('izin dicabut → akses langsung tertutup', supAudit2.status === 403, supAudit2.status);
  const supPlat = await call(sup.tok, 'GET', '/v1/admin/platform/overview');
  const supTeam = await call(sup.tok, 'GET', '/v1/admin/iam/admins');
  check('tim admin & platform tetap khusus Super Admin', supPlat.status === 403 && supTeam.status === 403, [supPlat.status, supTeam.status]);
  for (const u of [fin, sup]) await call(S, 'PATCH', `/v1/admin/iam/users/${u.id}`, { admin_role: null, reason: 'selesai uji peran e2e' });
}

// ---------------- Kontrol payout: dual control & masa tunggu rekening baru (§11.5, GO-LIVE) ----------------
{
  console.log('\n▶ Payout: dual control & masa tunggu rekening');
  const ART = (await login(SEED.emails.artist)).access_token;
  const party = SEED.artists[0].orgId;
  const wallet0 = await call(ART, 'GET', `/v1/finance/wallets/${party}`);
  const total0 = Number(wallet0.data?.balances?.total ?? 0);
  if (total0 < 400_000) {
    check('saldo wallet artis cukup untuk uji payout (≥ Rp400.000)', false, total0);
  } else {
    await call(S, 'PUT', '/v1/admin/platform/settings', { changes: { 'payout.approval_threshold_idr': 100_000, 'payout.bank_change_cooldown_hours': 24 }, reason: 'uji kontrol payout e2e' });
    await until(() => call(S, 'GET', '/v1/admin/finance/payouts'), (r) => r.data?.threshold_idr === 100_000, 15000);
    const bankA = { bank: 'BCA', number: '1234567890', holder: 'Senja Kolektif' };
    const small = await call(ART, 'POST', '/v1/finance/payouts', { party_id: party, amount: 60_000, bank_account: bankA }, true);
    check('payout di bawah ambang → langsung antre (REQUESTED), rekening pertama tanpa masa tunggu', small.status === 201 && small.data?.status === 'REQUESTED' && !small.data?.hold_until, [small.status, small.data]);
    const big = await call(ART, 'POST', '/v1/finance/payouts', { party_id: party, amount: 150_000, bank_account: bankA }, true);
    check('payout di atas ambang → PENDING_APPROVAL (dual control)', big.status === 201 && big.data?.status === 'PENDING_APPROVAL' && big.data?.approval_required === true, [big.status, big.data]);
    const selfApprove = await call(ART, 'POST', `/v1/admin/finance/payouts/${big.data?.id}/approve`, {});
    check('pemohon (non-admin) tidak bisa menyetujui payout (403)', selfApprove.status === 403, selfApprove.status);
    const queue = await call(S, 'GET', '/v1/admin/finance/payouts', undefined);
    check('antrean persetujuan memuat payout PENDING_APPROVAL', queue.data?.data?.some((r: any) => r.id === big.data?.id && r.status === 'PENDING_APPROVAL'), queue.data?.counts);
    const approved = await call(S, 'POST', `/v1/admin/finance/payouts/${big.data?.id}/approve`, { note: 'cek rekening OK' });
    check('admin lain menyetujui → REQUESTED', approved.status === 200 && approved.data?.status === 'REQUESTED', [approved.status, approved.data]);
    const again = await call(S, 'POST', `/v1/admin/finance/payouts/${big.data?.id}/approve`, {});
    check('persetujuan ganda ditolak (409)', again.status === 409, again.status);
    const done = await until(
      () => call(ART, 'GET', `/v1/finance/wallets/${party}`),
      (r) => r.data?.payouts?.filter((x: any) => [small.data?.id, big.data?.id].includes(x.id)).every((x: any) => x.status === 'COMPLETED'),
      30000,
    );
    check('payout disetujui & di bawah ambang diproses job → COMPLETED', done.data?.payouts?.filter((x: any) => [small.data?.id, big.data?.id].includes(x.id)).every((x: any) => x.status === 'COMPLETED'), done.data?.payouts);

    // Tolak → dana kembali ke wallet, ledger tetap seimbang.
    const toReject = await call(ART, 'POST', '/v1/finance/payouts', { party_id: party, amount: 120_000, bank_account: bankA }, true);
    const before = Number((await call(ART, 'GET', `/v1/finance/wallets/${party}`)).data?.balances?.total ?? 0);
    const badReject = await call(S, 'POST', `/v1/admin/finance/payouts/${toReject.data?.id}/reject`, { reason: 'x' });
    check('penolakan tanpa alasan memadai ditolak (400)', badReject.status === 400, badReject.status);
    const rejected = await call(S, 'POST', `/v1/admin/finance/payouts/${toReject.data?.id}/reject`, { reason: 'Nama rekening tidak cocok dengan KYC' });
    const after = Number((await call(ART, 'GET', `/v1/finance/wallets/${party}`)).data?.balances?.total ?? 0);
    check('payout ditolak → REJECTED & dana kembali ke wallet', rejected.status === 200 && rejected.data?.status === 'REJECTED' && after === before + 120_000, [rejected.status, rejected.data?.status, before, after]);

    // Ganti rekening → penarikan berikutnya ditahan masa tunggu, tidak diproses job.
    const changed = await call(ART, 'POST', '/v1/finance/payouts', { party_id: party, amount: 60_000, bank_account: { ...bankA, number: '9988776655' } }, true);
    const holdMs = changed.data?.hold_until ? new Date(changed.data.hold_until).getTime() - Date.now() : 0;
    check('rekening baru diganti → payout tertahan ±24 jam', changed.status === 201 && changed.data?.status === 'REQUESTED' && holdMs > 23 * 3600_000, [changed.status, changed.data]);
    await new Promise((r) => setTimeout(r, 7000));
    const stillHeld = (await call(ART, 'GET', `/v1/finance/wallets/${party}`)).data?.payouts?.find((x: any) => x.id === changed.data?.id);
    check('job payout melewati payout yang masih dalam masa tunggu', stillHeld?.status === 'REQUESTED', stillHeld?.status);
    const cleanup = await call(S, 'POST', `/v1/admin/finance/payouts/${changed.data?.id}/reject`, { reason: 'Uji e2e: batalkan payout tertahan' });
    check('payout tertahan dapat ditolak sebelum dikirim', cleanup.status === 200 && cleanup.data?.status === 'REJECTED', cleanup.status);
    const reconP = await call(S, 'GET', '/v1/admin/finance/reconciliation');
    check('ledger tetap seimbang setelah payout & penolakan', reconP.data?.balanced === true, reconP.data && { d: reconP.data.total_debit, c: reconP.data.total_credit });
    const notifs = await until(() => call(ART, 'GET', '/v1/notifications'), (r) => r.data?.data?.some((n: any) => n.title === 'Penarikan dana ditolak'), 15000);
    check('pemilik wallet menerima notifikasi penolakan', notifs.data?.data?.some((n: any) => n.title === 'Penarikan dana ditolak'));
    await call(S, 'POST', '/v1/admin/platform/settings/reset', { keys: ['payout.approval_threshold_idr', 'payout.bank_change_cooldown_hours'], reason: 'selesai uji payout e2e' });
  }
}

// ---------------- Integrasi Super Admin: email & payment gateway (Midtrans) ----------------
{
  console.log('\n▶ Integrasi: email & payment gateway');
  const { createServer } = await import('node:http');
  const { createHash, createHmac } = await import('node:crypto');
  const SECRET = 'e2e-relay-secret-' + Date.now();
  const got: { to: string; tag: string; sigOk: boolean }[] = [];
  const relay = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ts = String(req.headers['x-rave-timestamp'] ?? '');
      const sigOk = req.headers['x-rave-signature'] === createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
      try {
        const m = JSON.parse(body);
        got.push({ to: m.to, tag: m.tag, sigOk });
      } catch {}
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"relay-ok"}');
    });
  });
  await new Promise<void>((r) => relay.listen(0, '127.0.0.1', () => r()));
  const relayUrl = `http://127.0.0.1:${(relay.address() as any).port}/send`;

  const opsInt = await call(admin.access_token, 'GET', '/v1/admin/platform/integrations');
  check('integrasi khusus Super Admin (admin OPS 403)', opsInt.status === 403, opsInt.status);
  const int0 = await call(S, 'GET', '/v1/admin/platform/integrations');
  check('integrasi: awalnya memakai env', int0.status === 200 && int0.data?.data?.every((x: any) => x.source === 'env'), int0.data?.data?.map((x: any) => x.source));

  const badEmail = await call(S, 'PUT', '/v1/admin/platform/integrations/email', { provider: 'webhook', config: { EMAIL_FROM: 'RAVE <no-reply@rave.test>' }, secrets: {}, reason: 'uji validasi e2e' });
  check('integrasi email: field wajib kosong ditolak (400)', badEmail.status === 400 && badEmail.data?.errors?.some((e: any) => e.path === 'EMAIL_WEBHOOK_URL'), badEmail.data?.errors);
  const putEmail = await call(S, 'PUT', '/v1/admin/platform/integrations/email', {
    provider: 'webhook',
    config: { EMAIL_FROM: 'RAVE <no-reply@rave.test>', EMAIL_WEBHOOK_URL: relayUrl },
    secrets: { MESSAGING_WEBHOOK_SECRET: SECRET },
    reason: 'uji relay email e2e',
  });
  check('integrasi email disimpan; rahasia hanya tampil termasking', putEmail.status === 200 && putEmail.data?.source === 'dashboard' && putEmail.data?.secrets?.MESSAGING_WEBHOOK_SECRET === `••••${SECRET.slice(-4)}` && !JSON.stringify(putEmail.data).includes(SECRET), putEmail.data);
  // OTP login baru dikirim lewat konfigurasi dasbor (cache service ±15 dtk).
  const otpTo = `e2e-otp-${Date.now()}@rave.test`;
  const delivered = await until(
    async () => {
      await callOtpClass('POST', '/v1/auth/otp', { channel: 'email', destination: otpTo });
      return got.find((g) => g.to === otpTo && g.tag === 'otp');
    },
    (g) => !!g,
    40000,
    8000,
  );
  check('OTP login terkirim lewat relay dari dasbor (HMAC valid)', !!delivered && delivered.sigOk, got.slice(-3));
  const testMail = await call(S, 'POST', '/v1/admin/platform/integrations/email/test', { to: 'qa@rave.test' });
  check('email uji dari dasbor terkirim', testMail.data?.ok === true && got.some((g) => g.to === 'qa@rave.test' && g.tag === 'test'), testMail.data);
  const keep = await call(S, 'PUT', '/v1/admin/platform/integrations/email', { provider: 'webhook', config: { EMAIL_FROM: 'RAVE <halo@rave.test>', EMAIL_WEBHOOK_URL: relayUrl }, secrets: {}, reason: 'ganti pengirim e2e' });
  check('menyimpan tanpa mengisi ulang rahasia → rahasia lama dipertahankan', keep.data?.secrets?.MESSAGING_WEBHOOK_SECRET === `••••${SECRET.slice(-4)}`, keep.data?.secrets);
  const resetEmail = await call(S, 'DELETE', '/v1/admin/platform/integrations/email', { reason: 'selesai uji e2e' });
  check('integrasi email dikembalikan ke env', resetEmail.data?.source === 'env', resetEmail.data?.source);

  // Payment gateway: Midtrans (sandbox) dengan server key uji — pembayaran dikonfirmasi lewat notifikasi bertanda tangan.
  const SK = 'SB-Mid-server-e2e' + Date.now();
  const badPg = await call(S, 'PUT', '/v1/admin/platform/integrations/payment', { provider: 'midtrans', config: { MIDTRANS_MODE: 'sandbox' }, secrets: {}, reason: 'uji validasi e2e' });
  check('Midtrans tanpa server key ditolak (400)', badPg.status === 400, badPg.status);
  const putPg = await call(S, 'PUT', '/v1/admin/platform/integrations/payment', { provider: 'midtrans', config: { MIDTRANS_MODE: 'sandbox', MIDTRANS_CLIENT_KEY: 'SB-Mid-client-e2e' }, secrets: { MIDTRANS_SERVER_KEY: SK }, reason: 'uji Midtrans e2e' });
  check('Midtrans disimpan, server key termasking', putPg.status === 200 && putPg.data?.provider === 'midtrans' && !JSON.stringify(putPg.data).includes(SK), putPg.data?.secrets);
  const pgTest = await call(S, 'POST', '/v1/admin/platform/integrations/payment/test', {});
  check('uji koneksi Midtrans memberi hasil terstruktur (kunci uji → tidak valid / tak terjangkau)', pgTest.status === 200 && pgTest.data?.ok === false && typeof pgTest.data?.message === 'string', pgTest.data);

  const starts = new Date(Date.now() + 40 * 86_400_000);
  const ev = await call(P, 'POST', '/v1/ticketing/events', {
    org_id: SEED.orgs.pensiPromotor, title: `E2E Midtrans ${Date.now()}`, city: 'Jakarta', venue_name: 'Aula PG',
    starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3 * 3600_000).toISOString(),
    ticket_types: [{ name: 'Reguler', price: 75_000, quota: 10, max_per_account: 2 }],
  });
  await call(P, 'POST', `/v1/ticketing/events/${ev.data?.id}/publish`);
  const ord = await call(F, 'POST', '/v1/ticketing/orders', { event_id: ev.data?.id, items: [{ ticket_type_id: ev.data?.ticket_types?.[0]?.id, quantity: 1 }] }, true);
  const inv = ord.data?.invoice;
  // Tunggu cache konfigurasi finance (±15 dtk) memakai Midtrans: checkout tidak lagi "sandbox".
  const co = await until(() => call(F, 'POST', `/v1/finance/invoices/${inv?.id}/checkout`, { finish_url: 'https://evil.example/steal' }), (r) => r.status !== 200 || r.data?.provider !== 'sandbox', 30000, 3000);
  check('checkout Midtrans dengan kunci uji ditolak penyedia → 502/503 (bukan 500)', co.status === 502 || co.status === 503, [co.status, co.data?.detail]);
  const sim = await call(F, 'POST', `/v1/finance/invoices/${inv?.id}/simulate-pay`, { method: 'QRIS' }, true);
  check('simulasi bayar sandbox masih bisa untuk invoice yang belum ke Midtrans', sim.status === 200 || sim.status === 409, sim.status);
  // Invoice kedua: dibayar lewat notifikasi Midtrans bertanda tangan.
  const ord2 = await call(F, 'POST', '/v1/ticketing/orders', { event_id: ev.data?.id, items: [{ ticket_type_id: ev.data?.ticket_types?.[0]?.id, quantity: 1 }] }, true);
  const inv2 = ord2.data?.invoice;
  const gross = `${inv2?.amount}.00`;
  const note = (status: string, sig?: string) => ({
    order_id: inv2?.id, status_code: '200', gross_amount: gross, transaction_status: status, fraud_status: 'accept', payment_type: 'qris',
    transaction_id: `e2e-${inv2?.id}`, settlement_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    signature_key: sig ?? createHash('sha512').update(`${inv2?.id}200${gross}${SK}`).digest('hex'),
  });
  const forged = await fetch(BASE + '/v1/webhooks/pg/midtrans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note('settlement', 'f'.repeat(128))) });
  check('notifikasi Midtrans dengan signature palsu ditolak (401)', forged.status === 401, forged.status);
  const pending = await fetch(BASE + '/v1/webhooks/pg/midtrans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note('pending')) });
  check('notifikasi pending diterima tanpa mengubah status', pending.status === 200, pending.status);
  const settle = await fetch(BASE + '/v1/webhooks/pg/midtrans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note('settlement')) });
  const settleAgain = await fetch(BASE + '/v1/webhooks/pg/midtrans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note('settlement')) });
  const paidOrder = await until(() => call(F, 'GET', `/v1/ticketing/orders/${ord2.data?.order?.id}`), (r) => r.data?.status === 'PAID', 30000, 2500);
  check('settlement Midtrans bertanda tangan → invoice & order PAID, notifikasi ulang idempoten', settle.status === 200 && settleAgain.status === 200 && paidOrder.data?.status === 'PAID', [settle.status, settleAgain.status, paidOrder.data?.status]);
  const invAfter = await call(F, 'GET', `/v1/finance/invoices/${inv2?.id}`);
  check('invoice mencatat penyedia midtrans', invAfter.data?.provider === 'midtrans' && invAfter.data?.status === 'PAID', invAfter.data && { p: invAfter.data.provider, s: invAfter.data.status });
  const reconPg = await call(S, 'GET', '/v1/admin/finance/reconciliation');
  check('ledger seimbang setelah pembayaran Midtrans', reconPg.data?.balanced === true, reconPg.data && { d: reconPg.data.total_debit, c: reconPg.data.total_credit });
  await call(S, 'DELETE', '/v1/admin/platform/integrations/payment', { reason: 'selesai uji Midtrans e2e' });
  await call(P, 'POST', `/v1/ticketing/events/${ev.data?.id}/cancel`, { reason: 'selesai uji e2e' }).catch(() => null);
  relay.close();
}

// ---------------- Batch 1 go-live: hak admin, KYC, force majeure, refund booking, kode rilis ----------------
{
  console.log('\n▶ Batch 1 go-live (audit 2026-11-12)');
  // Suite panjang: token akses (15 mnt) dari awal sudah kedaluwarsa → perbarui lewat refresh token (rotasi), tanpa OTP baru.
  const renew = async (sess: { refresh_token: string }) => {
    const r = await callOtpClass('POST', '/v1/auth/token', { grant_type: 'refresh_token', refresh_token: sess.refresh_token });
    if (r.status !== 200) throw new Error(`refresh gagal: ${JSON.stringify(r.data)}`);
    return r.data.access_token as string;
  };
  const P = await renew(promotor);
  const M = await renew(manager);
  const S = await renew(sa);
  const OPS = await renew(admin);
  const artistOrg = SEED.artists[0].orgId;
  // A1 — admin back office bukan OWNER semua org/wallet
  const opsPayout = await call(OPS, 'POST', '/v1/finance/payouts', { party_id: artistOrg, amount: 100_000, bank_account: { bank: 'BCA', number: '5555666677', holder: 'Penyusup' } }, true);
  check('A1: admin OPS tidak bisa menarik dana wallet org lain (403)', opsPayout.status === 403, opsPayout.status);
  const opsMember = await call(OPS, 'POST', `/v1/orgs/${SEED.orgs.pensiPromotor}/members`, { email: `e2e-sneak-${Date.now()}@rave.test`, role: 'FINANCE' });
  check('A1: admin OPS tidak bisa menambah anggota ke org promotor (403)', opsMember.status === 403, opsMember.status);
  const opsWallet = await call(OPS, 'GET', `/v1/finance/wallets/${artistOrg}`);
  check('A1: admin dengan izin finance.view tetap bisa MEMBACA wallet', opsWallet.status === 200, opsWallet.status);
  const opsReveal = await call(OPS, 'POST', `/v1/admin/finance/payouts/${crypto.randomUUID()}/reveal`, {});
  check('A1/B2: membuka nomor rekening butuh izin finance.payout (OPS 403)', opsReveal.status === 403, opsReveal.status);

  // B3 — KYC wajib untuk menarik dana & membuat event; KYC tidak bisa disetujui sendiri
  const nk = await login(`e2e-nokyc-${Date.now()}@rave.test`);
  const nkPayout = await call(nk.access_token, 'POST', '/v1/finance/payouts', { party_id: nk.user.id, amount: 60_000, bank_account: { bank: 'BCA', number: '1112223334', holder: 'Tanpa KYC' } }, true);
  check('B3: penarikan tanpa KYC ditolak (403)', nkPayout.status === 403 && /KYC/.test(nkPayout.data?.detail ?? ''), [nkPayout.status, nkPayout.data?.detail]);
  const nkOrg = await call(nk.access_token, 'POST', '/v1/orgs', { type: 'PROMOTOR', name: `E2E Promotor Tanpa KYC ${Date.now()}`, city: 'Jakarta' });
  const nk2 = await login(nk.user.email);
  const st0 = new Date(Date.now() + 50 * 86_400_000);
  const nkEvent = await call(nk2.access_token, 'POST', '/v1/ticketing/events', {
    org_id: nkOrg.data?.id, title: 'Event Tanpa KYC', city: 'Jakarta', venue_name: 'Aula Tanpa KYC',
    starts_at: st0.toISOString(), ends_at: new Date(st0.getTime() + 3 * 3600_000).toISOString(), ticket_types: [{ name: 'Reguler', price: 50_000, quota: 10, max_per_account: 2 }],
  });
  check('B3: membuat event bertiket tanpa KYC ditolak (403)', nkOrg.status === 201 && nkEvent.status === 403, [nkOrg.status, nkEvent.status, nkEvent.data?.detail ?? nkEvent.data?.errors]);
  const ownKyc = await call(OPS, 'POST', '/v1/me/kyc', { level: 'INDIVIDUAL', full_name: 'Admin RAVE', id_number: '3174000011112222' });
  const selfDecide = ownKyc.data?.id ? await call(OPS, 'POST', `/v1/admin/iam/kyc/${ownKyc.data.id}/decision`, { approve: true }) : { status: 0 };
  check('B3: admin tidak bisa menyetujui KYC miliknya sendiri (403)', selfDecide.status === 403, [ownKyc.status, selfDecide.status]);
  if (ownKyc.data?.id) await call(S, 'POST', `/v1/admin/iam/kyc/${ownKyc.data.id}/decision`, { approve: false, reason: 'Uji e2e — dibersihkan' });
  const noReason = await call(S, 'POST', `/v1/admin/iam/kyc/${crypto.randomUUID()}/decision`, { approve: false });
  check('B3: penolakan KYC wajib beralasan / pengajuan harus ada', noReason.status === 400 || noReason.status === 404, noReason.status);

  // Kurasi artwork — khusus Super Admin
  const artOps = await call(OPS, 'GET', '/v1/admin/artwork');
  const artS = await call(S, 'GET', '/v1/admin/artwork?filter=all');
  check('kurasi artwork khusus Super Admin (OPS 403, Super Admin 200)', artOps.status === 403 && artS.status === 200 && artS.data?.data?.length > 0, [artOps.status, artS.status]);
  const curRel = (globalThis as any).__e2eCoverRelease ?? artS.data?.data?.[0]?.id;
  const reqChange = await call(S, 'POST', `/v1/admin/artwork/${curRel}/request-change`, { reason: 'Logo pihak ketiga terlihat di artwork' });
  check('Super Admin meminta artis mengganti artwork', reqChange.status === 200, reqChange.status);
  const badReplace = await call(S, 'POST', `/v1/admin/artwork/${curRel}/replace`, { cover_url: 'https://example.com/a.jpg', reason: 'uji URL eksternal' });
  check('penggantian artwork dengan URL eksternal ditolak (400)', badReplace.status === 400, badReplace.status);

  // B7 — rilis tidak boleh memakai URL audio eksternal
  const ART = (await login(SEED.emails.artist)).access_token;
  const ext = await call(ART, 'POST', '/v1/studio/releases', { artist_id: SEED.artists[0].id, title: 'E2E Eksternal', type: 'SINGLE', genre: 'indie-pop', release_date: '2027-01-01', tracks: [{ title: 'x', audio_url: 'https://example.com/a.mp3', duration_ms: 1000 }] });
  check('B7: audio eksternal ditolak (422/400)', ext.status === 422 || ext.status === 400, [ext.status, ext.data?.detail]);
  const badUpc = await call(ART, 'POST', '/v1/studio/releases', { artist_id: SEED.artists[0].id, title: 'E2E UPC', type: 'SINGLE', genre: 'indie-pop', release_date: '2027-01-01', upc: '899000000001', tracks: [] });
  check('B7: UPC dengan check digit salah ditolak', badUpc.status === 422 || badUpc.status === 400, badUpc.status);

  // Booking sampai BOOKED (DP dibayar) untuk menguji force majeure (B6) & refund booking (B1).
  const bookToBooked = async (name: string, days: number) => {
    const d = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const iq = await call(P, 'POST', '/v1/booking/inquiries', { ...inqBody, event_name: name, event_date: d, hold: true }, true);
    const id = iq.data?.id;
    await call(M, 'POST', `/v1/booking/bookings/${id}/offers`, { fee: 20_000_000, dp_pct: 50, settlement_days_before: 7, message: 'offer e2e' }, true);
    const ac = await call(P, 'POST', `/v1/booking/bookings/${id}/accept`);
    const kid = ac.data?.contract?.id;
    await until(() => call(P, 'GET', `/v1/booking/contracts/${kid}/preview-url`), (r) => r.status === 200, 60000, 1000);
    for (const tok of [P, M]) {
      const o = await call(tok, 'POST', `/v1/booking/contracts/${kid}/sign/request-otp`, {});
      await call(tok, 'POST', `/v1/booking/contracts/${kid}/sign/verify-otp`, { code: o.data?.dev_code });
    }
    const dpInv = await until(() => call(P, 'GET', `/v1/finance/invoices?reference_id=${id}`), (r) => r.data?.data?.some((i: any) => i.purpose === 'BOOKING_DP'), 30000, 1000);
    const dpI = dpInv.data?.data?.find((i: any) => i.purpose === 'BOOKING_DP');
    await call(P, 'POST', `/v1/finance/invoices/${dpI?.id}/simulate-pay`, { method: 'VA' }, true);
    const bk = await until(() => call(P, 'GET', `/v1/booking/bookings/${id}`), (r) => r.data?.status === 'BOOKED', 30000, 1000);
    // Bagian escrow DP (tanpa biaya layanan platform, yang tidak ikut dikembalikan saat batal).
    return { id, status: bk.data?.status as string, dp: Number(dpI?.escrow_amount ?? dpI?.amount ?? 0) };
  };

  const fm = await bookToBooked('E2E Force Majeure', 45 + Math.floor(Math.random() * 300));
  check('booking uji B6 mencapai BOOKED (DP dibayar)', fm.status === 'BOOKED', fm.status);
  const fmNoEvidence = await call(P, 'POST', `/v1/booking/bookings/${fm.id}/cancel`, { reason: 'Banjir besar', force_majeure: true });
  check('B6: klaim force majeure tanpa bukti ditolak (422)', fmNoEvidence.status === 422, fmNoEvidence.status);
  const fmClaim = await call(P, 'POST', `/v1/booking/bookings/${fm.id}/cancel`, { reason: 'Banjir besar', force_majeure: true, evidence: 'Surat BPBD nomor 123/2026 tentang status darurat banjir kota', incurred_costs: 2_000_000 });
  check('B6: klaim force majeure → DISPUTED (bukan batal sepihak)', fmClaim.status === 200 && fmClaim.data?.status === 'DISPUTED' && !!fmClaim.data?.force_majeure_claim, [fmClaim.status, fmClaim.data?.status]);
  const disputes = await call(S, 'GET', '/v1/admin/disputes');
  const dsp = disputes.data?.data?.find((x: any) => x.booking_id === fm.id && x.status === 'OPEN');
  check('B6: sengketa berjenis FORCE_MAJEURE dengan bukti tampil di mediasi', dsp?.kind === 'FORCE_MAJEURE' && !!dsp?.evidence && dsp?.claimed_costs === 2_000_000, dsp);
  const wal0 = Number((await call(ART, 'GET', `/v1/finance/wallets/${artistOrg}`)).data?.balances?.offair ?? 0);
  const resolved = await call(S, 'POST', `/v1/admin/disputes/${dsp?.id}/resolve`, { outcome: 'FORCE_MAJEURE', note: 'Bukti valid, biaya riil disetujui sebagian', awarded_costs: 1_000_000 });
  check('B6: mediator memutus force majeure dengan biaya riil', resolved.status === 200 && resolved.data?.awarded_costs === 1_000_000, [resolved.status, resolved.data]);
  const fmBk = await until(() => call(P, 'GET', `/v1/booking/bookings/${fm.id}`), (r) => r.data?.status === 'FORCE_MAJEURE', 15000, 1000);
  check('B6: booking berstatus FORCE_MAJEURE setelah putusan', fmBk.data?.status === 'FORCE_MAJEURE', fmBk.data?.status);
  // B1 — sisa DP direfund lewat mesin refund (baris refunds → dispatch → selesai di sandbox)
  const rf = await until(
    () => call(S, 'GET', `/v1/admin/finance/refunds?kind=booking&reference_id=${fm.id}`),
    (r) => r.data?.data?.length > 0 && r.data.data.every((x: any) => x.status === 'COMPLETED'),
    40000,
    1500,
  );
  const rfTotal = (rf.data?.data ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0);
  check('B1: refund booking tercatat & terkirim ke promotor (escrow DP − biaya riil; biaya layanan tidak dikembalikan)', rf.data?.data?.length > 0 && rfTotal === fm.dp - 1_000_000 && rf.data.data.every((x: any) => x.status === 'COMPLETED'), [rfTotal, fm.dp, rf.data?.data?.map((x: any) => x.status)]);
  const wal1 = Number((await until(() => call(ART, 'GET', `/v1/finance/wallets/${artistOrg}`), (r) => Number(r.data?.balances?.offair ?? 0) !== wal0, 15000, 1000)).data?.balances?.offair ?? 0);
  check('B4/B6: biaya riil ke artis dipotong komisi & PPh (net < 1.000.000)', wal1 > wal0 && wal1 - wal0 < 1_000_000, [wal0, wal1]);
  const pNotif = await until(() => call(P, 'GET', '/v1/notifications'), (r) => r.data?.data?.some((n: any) => n.title === 'Dana booking dikembalikan'), 15000, 1000);
  check('B1: promotor menerima notifikasi refund booking', pNotif.data?.data?.some((n: any) => n.title === 'Dana booking dikembalikan'));
  const reconB1 = await call(S, 'GET', '/v1/admin/finance/reconciliation');
  check('ledger seimbang setelah force majeure & refund booking', reconB1.data?.balanced === true, reconB1.data && { d: reconB1.data.total_debit, c: reconB1.data.total_credit });
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} lulus, ${failed} gagal\x1b[0m\n`);
process.exit(failed ? 1 : 0);
