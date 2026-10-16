import { createHash, randomBytes } from 'node:crypto';
import { config, conflict, HttpError, INSTANCE_ID, notFound, publish, serviceHeaders, sessionLock, settings, uuidv7, type ServiceContext } from '@gema/service-kit';
import { clearHls, DemoPublisher, ffmpegPath, hlsStats, RTMP_PORT, segmentSeconds, startRtmp, Transcoder, type RtmpSession } from './media.js';

export const keyHash = (k: string) => createHash('sha256').update(k).digest('hex');
export const newStreamKey = () => 'gema_' + randomBytes(18).toString('base64url');

const ACTIVE = ['LIVE', 'INTERRUPTED'];
/** Instance ini (replika) dan alamat internalnya untuk replika lain (penerusan potongan ingest, kesehatan). */
export const ME = INSTANCE_ID;
export const INTERNAL_URL = (process.env.LIVE_INTERNAL_URL ?? `http://127.0.0.1:${config.ports.live}`).replace(/\/+$/, '');
/** Heartbeat tiap 5 dtk; instance tanpa heartbeat > 15 dtk dianggap mati (siarannya boleh diambil alih). */
const ALIVE = `now() - interval '15 seconds'`;
const ownerAlive = (col: string) => `EXISTS (SELECT 1 FROM instances i WHERE i.id = ${col} AND i.heartbeat_at > ${ALIVE})`;
export interface Owner {
  id: string;
  internal_url: string;
}
/** Batas byte potongan tak berurutan yang ditahan per sesi (lindungi memori). */
const MAX_PENDING_BYTES = 16 * 1024 * 1024;

interface BrowserSession {
  id: string;
  nextSeq: number;
  pending: Map<number, Buffer>;
  pendingBytes: number;
  lastChunkAt: number;
  live: boolean;
  writing: Promise<void>;
}

/**
 * Orkestrator siaran: satu-satunya yang mengubah status stream (SCHEDULED → LIVE ⇄ INTERRUPTED → ENDED)
 * dan memegang proses media. Status di DB = sumber kebenaran; state memori disinkronkan oleh watchdog.
 *
 * Multi-replika: setiap siaran punya `owner_instance` = replika yang memegang publisher & transcoder.
 * Watchdog hanya menyentuh siaran miliknya, atau mengambil alih (UPDATE bersyarat, satu pemenang) siaran
 * yang pemiliknya mati. Batas `live.max_concurrent` dihitung global di DB. Kanal demo hanya di satu replika
 * (kunci advisory sesi). Segmen HLS di LIVE_DIR bersama → replika mana pun bisa melayani pemutaran.
 */
export class LiveManager {
  readonly transcoders = new Map<string, Transcoder>();
  private rtmpSessions = new Map<string, string>(); // streamId → id sesi RTMP
  private browser = new Map<string, BrowserSession>(); // streamId → sesi ingest browser
  private keyIndex = new Map<string, string>(); // sha256(key) → streamId
  private demoIds = new Set<string>();
  private demo: DemoPublisher;
  private demoStreamId: string | null = null;
  private rtmp: { ok: boolean; kick: (sessionId: string) => void } = { ok: false, kick: () => {} };
  private cleanup = new Map<string, NodeJS.Timeout>();
  private ticking = false;
  /** Siaran yang sedang diklaim (publisher baru tersambung, klaim DB belum selesai) — jangan dibongkar watchdog. */
  private claiming = new Set<string>();
  private demoLock: ReturnType<typeof sessionLock>;

  constructor(private ctx: ServiceContext) {
    this.demo = new DemoPublisher(ctx.log);
    // Kunci lepas (koneksi putus) → berhenti seketika agar replika lain bisa mengambil alih kanal demo.
    this.demoLock = sessionLock('gema.live.demo', {
      log: (o, m) => ctx.log.warn(o, m),
      onLost: () => {
        this.demo.stop();
        this.demoStreamId = null;
      },
    });
  }

  get rtmpOk() {
    return this.rtmp.ok;
  }

  async init() {
    const { db } = this.ctx;
    // Siaran "LIVE" milik instance yang sudah mati (mis. restart proses ini) TIDAK diubah di sini — watchdog
    // mengambil alihnya (INTERRUPTED, masa tunggu berlaku). Siaran milik replika lain yang hidup tidak disentuh.
    await this.heartbeat();
    // Kanal demo yang sudah berakhir dihidupkan lagi sebagai jadwal (khusus demo).
    await db.query(`UPDATE streams SET status='SCHEDULED', started_at=NULL, ended_at=NULL, ended_reason=NULL, scheduled_at=now() WHERE is_demo AND status='ENDED'`);
    await this.loadKeys();
    this.rtmp = await startRtmp(
      {
        authorize: (key, s) => this.authorizeRtmp(key, s),
        started: (key, s) => void this.rtmpStarted(key, s).catch((e) => this.ctx.log.error({ err: e?.message }, 'publish RTMP gagal diproses')),
        ended: (key, s) => void this.rtmpEnded(key, s).catch((e) => this.ctx.log.error({ err: e?.message }, 'akhir publish RTMP gagal diproses')),
      },
      this.ctx.log,
    );
    if (!ffmpegPath()) this.ctx.log.error({}, 'ffmpeg tidak ditemukan — transcoding nonaktif');
    await this.heartbeat();
    this.ctx.log.info({ instance: ME, internalUrl: INTERNAL_URL, rtmpPort: RTMP_PORT, rtmp: this.rtmp.ok }, 'instance live terdaftar');
  }

  // ---------------- Registri instance ----------------
  /** Dipanggil saat start & job tiap 5 dtk. Baris instance mati > 1 jam dibersihkan. */
  async heartbeat() {
    const { db } = this.ctx;
    await db.query(
      `INSERT INTO instances (id, internal_url, rtmp_port, rtmp_ok) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET internal_url=EXCLUDED.internal_url, rtmp_port=EXCLUDED.rtmp_port, rtmp_ok=EXCLUDED.rtmp_ok, heartbeat_at=now()`,
      [ME, INTERNAL_URL, RTMP_PORT, this.rtmp.ok],
    );
    if (Math.random() < 0.02) await db.query(`DELETE FROM instances WHERE heartbeat_at < now() - interval '1 hour'`);
  }

  /** Pemilik hidup sebuah siaran (null bila tidak ada / mati). */
  async ownerOf(id: string): Promise<Owner | null> {
    return this.ctx.db.one<Owner>(
      `SELECT i.id, i.internal_url FROM streams s JOIN instances i ON i.id = s.owner_instance AND i.heartbeat_at > ${ALIVE} WHERE s.id = $1`,
      [id],
    );
  }

  /** Panggil endpoint /internal milik replika pemilik (token service). Galat upstream diteruskan apa adanya. */
  async forward<T = any>(o: Owner, method: string, path: string, body?: Buffer, timeoutMs = 5000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(o.internal_url + path, {
        method,
        headers: { ...(await serviceHeaders(this.ctx.name)), ...(body ? { 'content-type': 'application/octet-stream' } : {}) },
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpError(502, 'Bad Gateway', 'Server penerima siaran tidak terjangkau — coba lagi atau mulai ulang siaran', { owner_instance: o.id });
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new HttpError(res.status, data?.title ?? 'Upstream error', data?.detail ?? `live ${o.id} → ${res.status}`);
    return data as T;
  }

  /** Muat ulang indeks kunci dari DB (sumber kebenaran): siaran/rotasi kunci di replika lain terlihat ≤ 1 tick. */
  private async loadKeys() {
    const rows = await this.ctx.db.query(`SELECT id, stream_key_hash, is_demo FROM streams WHERE status <> 'ENDED'`);
    const keys = new Map<string, string>();
    const demo = new Set<string>();
    for (const r of rows) {
      keys.set(r.stream_key_hash, r.id);
      if (r.is_demo) demo.add(r.id);
    }
    this.keyIndex = keys;
    this.demoIds = demo;
  }

  /**
   * Klaim kepemilikan siaran untuk publisher yang tersambung ke instance ini (RTMP / mulai ingest browser).
   * Satu transaksi + kunci advisory global → cek "sumber lain" dan kapasitas `live.max_concurrent` atomik
   * antar-replika. Siaran INTERRUPTED boleh diklaim replika mana pun (publisher menyambung ulang ke replika lain).
   */
  private async claim(id: string, o: { demo: boolean; hash?: string }) {
    await this.ctx.db.tx(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('gema.live.capacity'))`);
      const s = (
        await tx.query(`SELECT s.status, s.stream_key_hash, s.owner_instance, ${ownerAlive('s.owner_instance')} AS owner_alive FROM streams s WHERE s.id=$1 FOR UPDATE`, [id])
      ).rows[0];
      if (!s) throw notFound('Siaran');
      if (s.status === 'ENDED') throw conflict('Siaran sudah berakhir — buat siaran baru');
      if (o.hash && s.stream_key_hash !== o.hash) throw conflict('Stream key sudah dirotasi');
      if (s.owner_instance && s.owner_instance !== ME && s.owner_alive && s.status !== 'INTERRUPTED')
        throw conflict('Siaran ini sedang menerima sinyal dari sumber lain (OBS/browser)');
      if (!o.demo) {
        const n = (
          await tx.query(
            `SELECT count(*)::int AS n FROM streams s WHERE s.id <> $1 AND NOT s.is_demo AND s.status <> 'ENDED' AND s.owner_instance IS NOT NULL AND ${ownerAlive('s.owner_instance')}`,
            [id],
          )
        ).rows[0].n;
        if (n >= settings.num('live.max_concurrent')) throw new HttpError(429, 'Too Many Requests', 'Kapasitas siaran bersamaan platform penuh. Coba beberapa menit lagi.');
      }
      await tx.query(`UPDATE streams SET owner_instance=$2, updated_at=now() WHERE id=$1`, [id, ME]);
    });
  }

  /** Lepas klaim siaran yang belum pernah LIVE (ingest browser dimulai lalu berhenti sebelum potongan pertama). */
  private async release(id: string) {
    await this.ctx.db.query(`UPDATE streams SET owner_instance=NULL WHERE id=$1 AND owner_instance=$2 AND status='SCHEDULED'`, [id, ME]);
  }

  // ---------------- Kunci stream ----------------
  register(streamId: string, hash: string, isDemo = false) {
    for (const [h, id] of this.keyIndex) if (id === streamId) this.keyIndex.delete(h);
    this.keyIndex.set(hash, streamId);
    if (isDemo) this.demoIds.add(streamId);
  }
  private unregister(streamId: string) {
    for (const [h, id] of this.keyIndex) if (id === streamId) this.keyIndex.delete(h);
  }

  isPublishing(id: string) {
    return this.rtmpSessions.has(id) || this.browser.has(id);
  }
  hasBrowserSession(id: string) {
    return this.browser.has(id);
  }
  /** Siaran sedang menerima sinyal di replika mana pun (lokal, atau LIVE/mulai-ingest dengan pemilik hidup). */
  async busy(r: { id: string; status: string; owner_instance: string | null }) {
    if (this.isPublishing(r.id)) return true;
    if (!r.owner_instance || (r.status !== 'LIVE' && r.status !== 'SCHEDULED')) return false;
    return !!(await this.ownerOf(r.id));
  }

  // ---------------- RTMP ----------------
  private authorizeRtmp(key: string, s: RtmpSession): boolean {
    const id = this.keyIndex.get(keyHash(key));
    const log = this.ctx.log;
    if (!id) return log.warn({ ip: s.ip }, 'RTMP ditolak: stream key tidak dikenal'), false;
    const demo = this.demoIds.has(id);
    if (!settings.bool('modules.live')) return log.warn({ id }, 'RTMP ditolak: modul live mati'), false;
    if (!demo && !settings.bool('live.rtmp_enabled')) return log.warn({ id }, 'RTMP ditolak: ingest RTMP dimatikan'), false;
    if (this.isPublishing(id)) return log.warn({ id }, 'RTMP ditolak: stream sudah punya publisher aktif'), false;
    // Kapasitas global & publisher di replika lain diperiksa di DB saat rtmpStarted (claim) — hook ini sinkron.
    return true;
  }

  private async rtmpStarted(key: string, s: RtmpSession) {
    const id = this.keyIndex.get(keyHash(key))!;
    const demo = this.demoIds.has(id);
    this.rtmpSessions.set(id, s.id);
    this.claiming.add(id);
    try {
      try {
        await this.claim(id, { demo, hash: keyHash(key) });
      } catch (e: any) {
        this.ctx.log.warn({ id, err: e?.detail ?? e?.message }, 'RTMP ditolak');
        if (this.rtmpSessions.get(id) === s.id) this.rtmpSessions.delete(id);
        this.rtmp.kick(s.id);
        return;
      }
      const ok = await this.goLive(id, demo ? 'demo' : 'rtmp');
      if (!ok) {
        this.rtmpSessions.delete(id);
        this.rtmp.kick(s.id);
        return;
      }
    } finally {
      this.claiming.delete(id);
    }
    this.startTranscoder(id, new Transcoder(id, { kind: 'rtmp', url: `rtmp://127.0.0.1:${RTMP_PORT}/live/${key}` }, this.ctx.log));
  }

  private async rtmpEnded(key: string, s: RtmpSession) {
    const id = this.keyIndex.get(keyHash(key)) ?? [...this.rtmpSessions].find(([, sid]) => sid === s.id)?.[0];
    if (!id || this.rtmpSessions.get(id) !== s.id) return;
    this.rtmpSessions.delete(id);
    this.stopTranscoder(id);
    await this.interrupt(id);
  }

  // ---------------- Transcoder ----------------
  private startTranscoder(id: string, t: Transcoder) {
    this.transcoders.get(id)?.stop();
    const pending = this.cleanup.get(id);
    if (pending) clearTimeout(pending), this.cleanup.delete(id);
    this.transcoders.set(id, t);
    t.start();
  }
  private stopTranscoder(id: string) {
    this.transcoders.get(id)?.stop();
    this.transcoders.delete(id);
  }

  // ---------------- Ingest browser ----------------
  /** Mulai ingest browser di instance ini: klaim kepemilikan (potongan ke replika lain diteruskan ke sini). */
  async startBrowser(id: string, status: string): Promise<string> {
    if (status === 'ENDED') throw conflict('Siaran sudah berakhir — buat siaran baru');
    if (!settings.bool('live.browser_ingest_enabled')) throw new HttpError(403, 'Forbidden', 'Siaran dari browser sedang dinonaktifkan admin');
    if (this.isPublishing(id) || this.claiming.has(id)) throw conflict('Siaran ini sedang menerima sinyal dari sumber lain (OBS/browser)');
    this.claiming.add(id);
    try {
      await this.claim(id, { demo: false });
    } finally {
      this.claiming.delete(id);
    }
    if (this.isPublishing(id)) throw conflict('Siaran ini sedang menerima sinyal dari sumber lain (OBS/browser)');
    const session: BrowserSession = { id: uuidv7(), nextSeq: 0, pending: new Map(), pendingBytes: 0, lastChunkAt: Date.now(), live: false, writing: Promise.resolve() };
    this.browser.set(id, session);
    this.startTranscoder(id, new Transcoder(id, { kind: 'browser' }, this.ctx.log));
    return session.id;
  }

  /** Terima potongan berurutan; duplikat diabaikan (retry klien aman), yang lebih maju ditahan sampai celahnya terisi. */
  async chunk(id: string, sessionId: string, seq: number, buf: Buffer) {
    const s = this.browser.get(id);
    if (!s || s.id !== sessionId) throw conflict('Sesi siaran browser tidak aktif — mulai ulang siaran');
    s.lastChunkAt = Date.now();
    if (seq < s.nextSeq) return { received: seq, buffered: s.pending.size };
    const prev = s.pending.get(seq);
    if (seq > s.nextSeq) {
      if (!prev && (s.pending.size >= 60 || s.pendingBytes + buf.length > MAX_PENDING_BYTES))
        throw conflict(`Potongan ${s.nextSeq} hilang — kirim ulang dari sana`);
    }
    s.pending.set(seq, buf);
    s.pendingBytes += buf.length - (prev?.length ?? 0);
    if (seq > s.nextSeq) return { received: seq, buffered: s.pending.size };
    // Tulis berurutan dengan backpressure stdin ffmpeg. Rantai dipulihkan bila tulisan sebelumnya gagal.
    s.writing = s.writing
      .catch(() => {})
      .then(async () => {
        const t = this.transcoders.get(id);
        while (s.pending.has(s.nextSeq)) {
          const b = s.pending.get(s.nextSeq)!;
          s.pending.delete(s.nextSeq);
          s.pendingBytes -= b.length;
          if (s.nextSeq === 0 && t) t.webmHeader = b;
          s.nextSeq++;
          const stdin = t?.stdin;
          if (stdin && !stdin.destroyed && !stdin.write(b))
            await new Promise<void>((r) => {
              // Lepas kedua listener setelah salah satu terpicu (hindari kebocoran listener).
              const done = () => {
                stdin.off('drain', done);
                stdin.off('close', done);
                r();
              };
              stdin.once('drain', done).once('close', done);
            });
        }
      });
    await s.writing;
    if (!s.live) {
      s.live = true;
      if (!(await this.goLive(id, 'browser'))) {
        await this.stopBrowser(id, sessionId);
        throw conflict('Siaran tidak dapat dimulai');
      }
    }
    return { received: seq, buffered: s.pending.size };
  }

  async stopBrowser(id: string, sessionId?: string) {
    const s = this.browser.get(id);
    if (!s || (sessionId && s.id !== sessionId)) return;
    this.browser.delete(id);
    const t = this.transcoders.get(id);
    t?.stdin?.end(); // ffmpeg menulis segmen terakhir lalu keluar
    setTimeout(() => this.transcoders.get(id) === t && this.stopTranscoder(id), 4000).unref();
    await this.interrupt(id);
    await this.release(id);
  }

  // ---------------- Transisi status ----------------
  /** Publisher tersambung → LIVE (pemilik = instance ini). false bila stream berakhir/tidak ada/diambil replika lain. */
  private async goLive(id: string, ingest: 'rtmp' | 'browser' | 'demo'): Promise<boolean> {
    return this.ctx.db.tx(async (tx) => {
      const s = (await tx.query(`SELECT *, ${ownerAlive('owner_instance')} AS owner_alive FROM streams WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!s || s.status === 'ENDED') return false;
      // Klaim sudah dilakukan; bila sementara itu replika lain yang hidup mengambilnya (dan tidak sedang terputus) → mundur.
      if (s.owner_instance && s.owner_instance !== ME && s.owner_alive && s.status !== 'INTERRUPTED') return false;
      await tx.query(
        `UPDATE streams SET status='LIVE', ingest=$2, owner_instance=$3, interrupted_at=NULL, started_at=coalesce(started_at, now()), updated_at=now() WHERE id=$1`,
        [id, ingest, ME],
      );
      if (s.status === 'SCHEDULED') {
        // Kanal demo tidak memicu notifikasi follower (ia dimulai ulang setiap service start).
        if (!s.is_demo) await publish(tx, 'live.stream.started', id, { streamId: id, orgId: s.org_id, artistId: s.artist_id, title: s.title });
        this.ctx.log.info({ id, ingest, title: s.title }, 'siaran dimulai');
      } else if (s.status === 'INTERRUPTED') this.ctx.log.info({ id, ingest }, 'siaran tersambung kembali');
      return true;
    });
  }

  /** Hanya siaran milik instance ini (atau tanpa pemilik) — kejadian lokal yang basi tidak boleh memutus siaran replika lain. */
  private async interrupt(id: string) {
    await this.ctx.db.query(
      `UPDATE streams SET status='INTERRUPTED', interrupted_at=now(), ingest=NULL, updated_at=now()
        WHERE id=$1 AND status='LIVE' AND (owner_instance IS NULL OR owner_instance=$2)`,
      [id, ME],
    );
  }

  /** Bongkar state media lokal (publisher, transcoder, demo) tanpa menyentuh DB. */
  private dropLocal(id: string, stopDemo = true) {
    const rtmpSession = this.rtmpSessions.get(id);
    if (rtmpSession) this.rtmp.kick(rtmpSession), this.rtmpSessions.delete(id);
    this.browser.delete(id);
    this.stopTranscoder(id);
    if (stopDemo && this.demoIds.has(id) && this.demoStreamId === id) this.demo.stop();
  }

  /**
   * Akhiri siaran: putuskan publisher, hentikan transcoder, ENDED + event. Idempoten; boleh dipanggil di replika
   * mana pun — bila pemiliknya replika lain, pemilik diberi tahu agar segera memutus publisher (watchdog-nya juga
   * melakukannya ≤ 3 dtk sebagai cadangan).
   */
  async end(id: string, reason: string) {
    this.dropLocal(id, reason !== 'demo_disabled');
    this.unregister(id);
    let remoteOwner: string | null = null;
    const ended = await this.ctx.db.tx(async (tx) => {
      const s = (await tx.query(`SELECT * FROM streams WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!s || s.status === 'ENDED') return null;
      if (s.owner_instance && s.owner_instance !== ME) remoteOwner = s.owner_instance;
      const r = (
        await tx.query(
          `UPDATE streams SET status='ENDED', ended_at=now(), ended_reason=$2, ingest=NULL, owner_instance=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
          [id, reason],
        )
      ).rows[0];
      if (s.started_at && !s.is_demo) {
        const durationS = Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000);
        await publish(tx, 'live.stream.ended', id, { streamId: id, reason, durationS, peakViewers: s.peak_viewers });
      }
      return r;
    });
    if (remoteOwner) void this.notifyOwner(id, remoteOwner);
    // Segmen HLS dibiarkan sebentar agar penonton menerima akhir siaran, lalu dihapus (belum ada fitur replay).
    // LIVE_DIR dipakai bersama: hapus hanya bila siaran masih ENDED (kanal demo bisa sudah dihidupkan replika lain).
    const prev = this.cleanup.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.cleanup.delete(id);
      if (this.transcoders.has(id)) return;
      this.ctx.db
        .one(`SELECT status FROM streams WHERE id=$1`, [id])
        .then((r) => (!r || r.status === 'ENDED') && clearHls(id))
        .catch(() => {});
    }, 120_000);
    timer.unref();
    this.cleanup.set(id, timer);
    if (ended) this.ctx.log.info({ id, reason }, 'siaran berakhir');
    return ended;
  }

  private async notifyOwner(id: string, ownerId: string) {
    const o = await this.ctx.db.one<Owner>(`SELECT id, internal_url FROM instances WHERE id=$1 AND heartbeat_at > ${ALIVE}`, [ownerId]).catch(() => null);
    if (!o) return;
    await this.forward(o, 'POST', `/internal/live/streams/${id}/sync`, undefined, 2000).catch((e) =>
      this.ctx.log.warn({ id, owner: ownerId, err: e?.detail ?? e?.message }, 'gagal memberi tahu pemilik siaran — watchdog-nya menyusul'),
    );
  }

  /**
   * Selaraskan state media lokal dengan DB: publisher/transcoder lokal untuk siaran yang sudah ENDED, dihapus,
   * atau kini dimiliki replika lain → dibongkar. Dipanggil watchdog & endpoint internal `/sync`.
   */
  async syncLocal(only?: string[]) {
    const ids = (only ?? [...new Set([...this.rtmpSessions.keys(), ...this.browser.keys(), ...this.transcoders.keys()])]).filter((id) => !this.claiming.has(id));
    if (!ids.length) return;
    const rows = await this.ctx.db.query<{ id: string; status: string; owner_instance: string | null }>(
      `SELECT id, status, owner_instance FROM streams WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = byId.get(id);
      if (r && r.status !== 'ENDED' && (!r.owner_instance || r.owner_instance === ME)) continue;
      if (!this.isPublishing(id) && !this.transcoders.has(id)) continue;
      this.ctx.log.info({ id, status: r?.status ?? 'deleted', owner: r?.owner_instance ?? null }, 'siaran bukan milik instance ini lagi — publisher lokal diputus');
      this.dropLocal(id);
      if (!r || r.status === 'ENDED') this.unregister(id);
    }
  }

  // ---------------- Kesehatan ----------------
  health(id: string, status: string, ingest: string | null, startedAt: string | null, viewers: number) {
    const t = this.transcoders.get(id);
    const hls = hlsStats(id);
    const warnings: string[] = [];
    const seg = segmentSeconds();
    if (!ffmpegPath()) warnings.push('ffmpeg tidak tersedia di server');
    if (status === 'INTERRUPTED') warnings.push('Sinyal publisher terputus — menunggu sambung ulang');
    if (t?.state === 'restarting') warnings.push(`Transcoder dimulai ulang (${t.restarts}×): ${t.lastError ?? ''}`.trim());
    if (status === 'LIVE' && hls.segment_age_s !== null && hls.segment_age_s > Math.max(10, seg * 4)) warnings.push(`Tidak ada segmen baru selama ${Math.round(hls.segment_age_s)} dtk`);
    if (status === 'LIVE' && hls.bitrate_kbps !== null && hls.bitrate_kbps < 300) warnings.push('Bitrate sangat rendah — periksa koneksi upload encoder');
    const b = this.browser.get(id);
    if (b && b.pending.size > 5) warnings.push(`Potongan tertunda ${b.pending.size} — koneksi upload lambat`);
    return {
      instance: ME,
      status,
      ingest,
      uptime_s: startedAt && status !== 'ENDED' ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000) : 0,
      bitrate_kbps: status === 'ENDED' ? null : hls.bitrate_kbps,
      last_segment_at: hls.last_segment_at,
      segment_age_s: hls.segment_age_s,
      transcoder: t?.state ?? 'idle',
      restarts: t?.restarts ?? 0,
      viewers,
      warnings,
    };
  }

  // ---------------- Watchdog (tiap 3 dtk) ----------------
  async tick() {
    // Cegah run tumpang tindih (watchdog tiap 3 dtk, DB bisa lambat).
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.tickOnce();
    } finally {
      this.ticking = false;
    }
  }

  private async tickOnce() {
    const { db, log } = this.ctx;
    const seg = segmentSeconds();
    // 1) Ingest browser yang diam → anggap putus.
    for (const [id, s] of this.browser) if (Date.now() - s.lastChunkAt > 15_000) await this.stopBrowser(id, s.id);
    // 2) Transcoder macet (publisher masih ada tetapi segmen tidak bertambah) → restart.
    for (const [id, t] of this.transcoders) {
      if (t.state !== 'running' || Date.now() - t.startedAt < 20_000) continue;
      const h = hlsStats(id);
      if (h.segment_age_s === null || h.segment_age_s > Math.max(20, seg * 6)) {
        log.warn({ id, age: h.segment_age_s }, 'watchdog: segmen tidak bertambah — restart transcoder');
        t.kick();
      }
    }
    // 3) Indeks kunci & state lokal mengikuti DB (siaran baru/rotasi/akhir dari replika lain).
    await this.loadKeys();
    await this.syncLocal();
    const all = await db.query(
      `SELECT s.id, s.status, s.started_at, s.interrupted_at, s.is_demo, s.owner_instance, ${ownerAlive('s.owner_instance')} AS owner_alive
         FROM streams s WHERE s.status = ANY($1)`,
      [ACTIVE],
    );
    const rows: typeof all = [];
    for (const r0 of all) {
      let r = r0;
      if (r.owner_instance !== ME) {
        // Milik replika lain yang hidup → bukan urusan instance ini.
        if (r.owner_alive || this.claiming.has(r.id)) continue;
        // Pemilik mati (atau tidak ada) → ambil alih; UPDATE bersyarat → hanya satu replika yang menang.
        const took = await this.takeover(r.id, r.owner_instance);
        if (!took) continue;
        r = took;
      }
      rows.push(r);
      // 4) DB bilang LIVE tetapi tidak ada publisher di proses ini → INTERRUPTED.
      if (r.status === 'LIVE' && !this.isPublishing(r.id) && !this.claiming.has(r.id)) await this.interrupt(r.id);
      // 5) Masa tunggu sambung ulang habis.
      if (r.status === 'INTERRUPTED' && r.interrupted_at && Date.now() - new Date(r.interrupted_at).getTime() > settings.num('live.reconnect_grace_seconds') * 1000)
        await this.end(r.id, 'signal_lost');
      // 6) Batas durasi (kanal demo dikecualikan).
      else if (!r.is_demo && r.started_at && Date.now() - new Date(r.started_at).getTime() > settings.num('live.max_duration_hours') * 3600_000) await this.end(r.id, 'max_duration');
    }
    if (!settings.bool('modules.live')) for (const r of rows) await this.end(r.id, 'module_disabled');
    await this.syncDemo();
  }

  /** Siaran terjadwal yang tak pernah dimulai > 24 jam setelah jadwalnya (atau 7 hari sejak dibuat bila tanpa jadwal) → ENDED. */
  async expireScheduled() {
    const rows = await this.ctx.db.query(
      `SELECT id FROM streams WHERE status='SCHEDULED' AND NOT is_demo
         AND coalesce(scheduled_at + interval '24 hours', created_at + interval '7 days') < now() LIMIT 100`,
    );
    for (const { id } of rows) if (!this.isPublishing(id) && !this.claiming.has(id)) await this.end(id, 'never_started');
    if (rows.length) this.ctx.log.info({ n: rows.length }, 'siaran terjadwal kedaluwarsa');
  }

  /** Ambil alih siaran yatim: LIVE → INTERRUPTED (masa tunggu mulai sekarang), pemilik = instance ini. */
  private async takeover(id: string, prevOwner: string | null) {
    const r = await this.ctx.db.one(
      `UPDATE streams SET owner_instance=$2,
              status = CASE WHEN status='LIVE' THEN 'INTERRUPTED' ELSE status END,
              interrupted_at = CASE WHEN status='LIVE' THEN now() ELSE coalesce(interrupted_at, now()) END,
              ingest = CASE WHEN status='LIVE' THEN NULL ELSE ingest END, updated_at=now()
        WHERE id=$1 AND status = ANY($4) AND owner_instance IS NOT DISTINCT FROM $3
          AND (owner_instance IS NULL OR NOT ${ownerAlive('owner_instance')})
        RETURNING id, status, started_at, interrupted_at, is_demo, owner_instance, true AS owner_alive`,
      [id, ME, prevOwner, ACTIVE],
    );
    if (r) this.ctx.log.warn({ id, prevOwner }, 'pemilik siaran mati — diambil alih instance ini');
    return r;
  }

  /**
   * Kanal demo hidup selama `live.demo_channel` & `modules.live` aktif. Kunci baru tiap start (tidak pernah keluar
   * dari proses). Hanya satu replika yang menjalankannya: pemegang kunci advisory sesi `gema.live.demo`.
   */
  private async syncDemo() {
    const want = settings.bool('live.demo_channel') && settings.bool('modules.live') && this.rtmp.ok && !!ffmpegPath();
    if (!want) {
      if (this.demo.running) {
        this.demo.stop();
        if (this.demoStreamId) await this.end(this.demoStreamId, 'demo_disabled');
        this.demoStreamId = null;
      }
      await this.demoLock.close(); // lepas kunci (bila dipegang) & koneksinya
      return;
    }
    if (this.demo.running) return;
    // Bukan pemegang kunci → replika lain yang menjalankan demo (atau akan, pada tick berikutnya).
    if (!(await this.demoLock.tryAcquire().catch(() => false))) return;
    const { db } = this.ctx;
    await db.query(`UPDATE streams SET status='SCHEDULED', started_at=NULL, ended_at=NULL, ended_reason=NULL WHERE is_demo AND status='ENDED'`);
    const d = await db.one(`SELECT id FROM streams WHERE is_demo ORDER BY created_at LIMIT 1`);
    if (!d) return;
    const key = newStreamKey();
    await db.query(`UPDATE streams SET stream_key_hash=$2, key_hint=$3 WHERE id=$1`, [d.id, keyHash(key), key.slice(-4)]);
    this.register(d.id, keyHash(key), true);
    this.demoStreamId = d.id;
    this.demo.start(key);
    this.ctx.log.info({ id: d.id }, 'kanal demo dimulai');
  }

  /**
   * Shutdown: hentikan media lokal, tandai siaran LIVE milik instance ini INTERRUPTED dan hapus baris instance
   * → replika lain langsung mengambil alih (tanpa menunggu heartbeat basi 15 dtk). Kunci demo dilepas.
   */
  async stopAll() {
    this.demo.stop();
    for (const t of this.transcoders.values()) t.stop();
    const { db } = this.ctx;
    await db
      .query(`UPDATE streams SET status='INTERRUPTED', interrupted_at=now(), ingest=NULL, updated_at=now() WHERE owner_instance=$1 AND status='LIVE'`, [ME])
      .catch(() => {});
    await db.query(`UPDATE streams SET owner_instance=NULL WHERE owner_instance=$1 AND status='SCHEDULED'`, [ME]).catch(() => {});
    await db.query(`DELETE FROM instances WHERE id=$1`, [ME]).catch(() => {});
    await this.demoLock.close();
  }
}
