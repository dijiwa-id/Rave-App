import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settings } from '@rave/service-kit';

/**
 * Lapisan media service live:
 *  - RtmpIngest   : server RTMP (node-media-server, hanya modul RTMP-nya) untuk OBS/Larix/ffmpeg.
 *  - Transcoder   : satu proses ffmpeg per stream → HLS di storage/live/<id>; diawasi & di-restart otomatis.
 *  - BrowserIngest: potongan WebM MediaRecorder (HTTP, berurutan) → stdin ffmpeg.
 *  - DemoPublisher: sinyal uji (visual + musik sintetis) yang dipublikasikan lewat RTMP — menguji jalur penuh.
 */

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const LIVE_DIR = process.env.LIVE_DIR ?? join(ROOT, 'storage', 'live');
mkdirSync(LIVE_DIR, { recursive: true });

export const RTMP_PORT = Number(process.env.LIVE_RTMP_PORT ?? 1935);
/** Alamat RTMP yang ditampilkan ke encoder (produksi: domain ingest publik). */
export const RTMP_PUBLIC_URL = process.env.LIVE_RTMP_PUBLIC_URL ?? `rtmp://localhost:${RTMP_PORT}/live`;

export function ffmpegPath(): string | null {
  if (process.env.FFMPEG_PATH) return existsSync(process.env.FFMPEG_PATH) ? process.env.FFMPEG_PATH : null;
  try {
    const p = require('ffmpeg-static') as string | null;
    if (p && existsSync(p)) return p;
  } catch {
    /* paket opsional */
  }
  return null;
}

type Log = { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };

/** Panjang segmen HLS dari pengaturan `live.latency_mode`. */
export function segmentSeconds(): number {
  return { low: 1, balanced: 2, stable: 4 }[settings.get<string>('live.latency_mode')] ?? 2;
}

export const streamDir = (id: string) => join(LIVE_DIR, id);

// ---------------------------------------------------------------------------------------------
// Transcoder: input (RTMP pull / stdin WebM) → HLS
// ---------------------------------------------------------------------------------------------
export type TranscoderState = 'idle' | 'starting' | 'running' | 'restarting' | 'failed';
export type Source = { kind: 'rtmp'; url: string } | { kind: 'browser' };

export class Transcoder {
  state: TranscoderState = 'idle';
  restarts = 0;
  startedAt = Date.now();
  lastError: string | null = null;
  private proc: ChildProcess | null = null;
  private stopped = false;
  private backoff = 1000;
  private timer: NodeJS.Timeout | null = null;
  /** Header WebM (potongan pertama) — ditulis ulang ke ffmpeg baru bila transcoder di-restart di tengah siaran browser. */
  webmHeader: Buffer | null = null;

  constructor(
    readonly streamId: string,
    readonly source: Source,
    private log: Log,
  ) {}

  get stdin() {
    return this.proc?.stdin ?? null;
  }

  start() {
    const bin = ffmpegPath();
    if (!bin) {
      this.state = 'failed';
      this.lastError = 'ffmpeg tidak tersedia di server (set FFMPEG_PATH)';
      return;
    }
    this.state = this.restarts ? 'restarting' : 'starting';
    const dir = streamDir(this.streamId);
    mkdirSync(dir, { recursive: true });
    const seg = segmentSeconds();
    const input =
      this.source.kind === 'rtmp'
        ? ['-rw_timeout', '15000000', '-i', this.source.url]
        : ['-f', 'webm', '-thread_queue_size', '1024', '-i', 'pipe:0'];
    // RTMP dari encoder (H.264) → video disalin apa adanya (murah); browser (VP8/VP9) → x264.
    const video =
      this.source.kind === 'rtmp'
        ? ['-c:v', 'copy']
        : ['-vf', "scale='min(1280,iw)':-2", '-fps_mode', 'cfr', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '5000k', '-g', String(30 * seg), '-keyint_min', String(30 * seg), '-sc_threshold', '0'];
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...input,
      '-map', '0:v:0?', '-map', '0:a:0?',
      ...video,
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-f', 'hls', '-hls_time', String(seg), '-hls_list_size', '8',
      '-hls_flags', 'delete_segments+independent_segments+append_list+discont_start+program_date_time+temp_file',
      '-hls_start_number_source', 'epoch',
      '-hls_segment_filename', join(dir, 'seg%d.ts'),
      join(dir, 'index.m3u8'),
    ];
    // Untuk browser, stdin harus pipe; untuk RTMP stdin diabaikan (-nostdin).
    if (this.source.kind === 'browser') args.splice(args.indexOf('-nostdin'), 1);
    const p = spawn(bin, args, { stdio: [this.source.kind === 'browser' ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    this.proc = p;
    let stderr = '';
    p.stderr!.on('data', (d) => (stderr = (stderr + d.toString()).slice(-2000)));
    p.stdin?.on('error', () => {}); // EPIPE saat ffmpeg mati — ditangani oleh 'exit'
    if (this.source.kind === 'browser' && this.webmHeader) p.stdin!.write(this.webmHeader);
    const started = Date.now();
    p.on('spawn', () => {
      this.state = 'running';
      this.startedAt = started;
    });
    // 'error' (mis. spawn gagal/ENOENT) dan 'exit' bisa sama-sama terpicu — jalur restart cukup sekali.
    let ended = false;
    const onEnd = (code: number | null, signal: NodeJS.Signals | null, spawnErr?: string) => {
      if (ended) return;
      ended = true;
      if (this.proc === p) this.proc = null;
      if (this.stopped) {
        this.state = 'idle';
        return;
      }
      this.lastError = spawnErr ?? (stderr.trim().split('\n').slice(-3).join(' | ') || `ffmpeg keluar (${code ?? signal})`);
      // Berjalan cukup lama → anggap kegagalan baru, reset backoff.
      if (Date.now() - started > 60_000) this.backoff = 1000;
      this.restarts++;
      this.state = 'restarting';
      this.log.warn({ stream: this.streamId, code, err: this.lastError, retryMs: this.backoff }, 'transcoder berhenti — restart');
      this.timer = setTimeout(() => !this.stopped && this.start(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15_000);
    };
    p.on('exit', (code, signal) => onEnd(code, signal));
    p.on('error', (e) => onEnd(null, null, `ffmpeg gagal dijalankan: ${e.message}`));
  }

  /** Paksa restart (watchdog: segmen tidak bertambah). */
  kick() {
    if (this.proc && !this.stopped) this.proc.kill('SIGKILL');
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.proc) {
      this.proc.stdin?.end();
      const p = this.proc;
      p.kill('SIGTERM');
      setTimeout(() => p.exitCode === null && p.kill('SIGKILL'), 3000).unref();
    }
    this.state = 'idle';
  }
}

/** Statistik HLS dari disk: umur segmen terbaru & bitrate rata-rata 3 segmen terakhir. */
export function hlsStats(id: string): { last_segment_at: string | null; segment_age_s: number | null; bitrate_kbps: number | null } {
  const dir = streamDir(id);
  if (!existsSync(dir)) return { last_segment_at: null, segment_age_s: null, bitrate_kbps: null };
  // ffmpeg (hls_flags delete_segments) bisa menghapus segmen lama di antara readdir & stat → lewati, jangan gagal.
  const segs = readdirSync(dir)
    .filter((f) => /^seg\d+\.ts$/.test(f))
    .flatMap((f) => {
      try {
        const st = statSync(join(dir, f));
        return [{ size: st.size, mtime: st.mtimeMs }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!segs.length) return { last_segment_at: null, segment_age_s: null, bitrate_kbps: null };
  const recent = segs.slice(0, 3);
  const bytes = recent.reduce((s, x) => s + x.size, 0);
  return {
    last_segment_at: new Date(segs[0].mtime).toISOString(),
    segment_age_s: Math.round((Date.now() - segs[0].mtime) / 100) / 10,
    bitrate_kbps: Math.round((bytes * 8) / (recent.length * segmentSeconds()) / 1000),
  };
}

export function clearHls(id: string) {
  rmSync(streamDir(id), { recursive: true, force: true });
}

/** Segmen yang baru ditulis bisa belum masuk playlist — jangan disentuh sebelum umur ini. */
const SEGMENT_GRACE_MS = 2 * 60_000;
/** Folder tanpa siaran aktif yang tidak berubah selama ini dianggap sisa (siaran berakhir / DB di-reset). */
const ORPHAN_DIR_MS = 60 * 60_000;

/**
 * Pemeliharaan LIVE_DIR (aman dijalankan paralel di semua replika — hanya menghapus, dengan batas umur):
 *  - segmen `seg*.ts` yang tidak lagi dirujuk `index.m3u8`. ffmpeg `delete_segments` hanya menghapus segmen
 *    sesinya sendiri, jadi setiap restart transcoder (restart service, siaran tersambung ulang) meninggalkan segmen lama;
 *  - folder siaran yang bukan milik siaran aktif (`isActive`) dan sudah diam ≥ 1 jam.
 */
export function pruneLiveStorage(isActive: (streamId: string) => boolean) {
  const now = Date.now();
  let segments = 0;
  let dirs = 0;
  for (const name of readdirSync(LIVE_DIR)) {
    const dir = join(LIVE_DIR, name);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!isActive(name)) {
      if (now - st.mtimeMs > ORPHAN_DIR_MS) {
        rmSync(dir, { recursive: true, force: true });
        dirs++;
      }
      continue;
    }
    let playlist: string;
    try {
      playlist = readFileSync(join(dir, 'index.m3u8'), 'utf8');
    } catch {
      continue; // transcoder belum menulis playlist — belum ada yang bisa dinilai
    }
    const referenced = new Set(playlist.match(/seg\d+\.ts/g) ?? []);
    for (const f of readdirSync(dir)) {
      if (!/^seg\d+\.ts$/.test(f) || referenced.has(f)) continue;
      try {
        if (now - statSync(join(dir, f)).mtimeMs > SEGMENT_GRACE_MS) {
          rmSync(join(dir, f), { force: true });
          segments++;
        }
      } catch {
        /* sudah dihapus ffmpeg / replika lain */
      }
    }
  }
  return { segments, dirs };
}

// ---------------------------------------------------------------------------------------------
// Ingest RTMP (node-media-server: hanya server RTMP-nya, tanpa HTTP/API/store bawaan)
// ---------------------------------------------------------------------------------------------
export interface RtmpSession {
  id: string;
  streamName: string;
  ip: string;
  socket: net.Socket;
}
export interface RtmpHandlers {
  /** Sinkron: kembalikan false untuk menolak publish (socket ditutup). */
  authorize(key: string, s: RtmpSession): boolean;
  started(key: string, s: RtmpSession): void;
  ended(key: string, s: RtmpSession): void;
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once('error', () => res(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => res(true)));
  });
}

/** Putuskan publisher dengan tegas: FIN dulu, lalu destroy bila encoder terus menulis ke koneksi setengah-tertutup. */
function hangUp(socket?: net.Socket) {
  if (!socket || socket.destroyed) return;
  socket.end();
  setTimeout(() => socket.destroyed || socket.destroy(), 1000).unref();
}

export async function startRtmp(h: RtmpHandlers, log: Log): Promise<{ ok: boolean; kick: (sessionId: string) => void }> {
  if (!(await portFree(RTMP_PORT))) {
    log.error({ port: RTMP_PORT }, 'port RTMP terpakai — ingest RTMP nonaktif (siaran browser tetap jalan)');
    return { ok: false, kick: () => {} };
  }
  const Context = require('node-media-server/src/core/context.js');
  const nmsLog = require('node-media-server/src/core/logger.js');
  nmsLog.level = 'error';
  Context.config = { bind: '0.0.0.0', rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 } };
  const NodeRtmpServer = require('node-media-server/src/server/rtmp_server.js');
  const server = new NodeRtmpServer();
  const rejected = new Set<string>();
  const accepted = new Set<string>();
  Context.eventEmitter.on('prePublish', (s: RtmpSession) => {
    let ok = false;
    try {
      ok = h.authorize(s.streamName, s);
    } catch (e: any) {
      log.error({ err: e?.message }, 'otorisasi RTMP gagal');
    }
    if (!ok) {
      rejected.add(s.id);
      hangUp(s.socket);
    }
  });
  Context.eventEmitter.on('postPublish', (s: RtmpSession) => {
    if (rejected.delete(s.id)) return;
    accepted.add(s.id);
    // NMS menunda donePublish selama masa tunggu internalnya; RAVE punya masa tunggu sendiri
    // (status INTERRUPTED), jadi putusnya socket publisher langsung diteruskan.
    s.socket.once('close', () => {
      if (accepted.delete(s.id)) h.ended(s.streamName, s);
    });
    h.started(s.streamName, s);
  });
  Context.eventEmitter.on('donePublish', (s: RtmpSession) => {
    rejected.delete(s.id);
    if (accepted.delete(s.id)) h.ended(s.streamName, s);
  });
  server.run();
  log.info({ port: RTMP_PORT }, 'ingest RTMP siap');
  return {
    ok: true,
    kick: (sessionId) => hangUp(Context.sessions.get(sessionId)?.socket),
  };
}

// ---------------------------------------------------------------------------------------------
// Kanal demo: visual gradien + gelombang suara dari melodi sintetis → RTMP lokal
// ---------------------------------------------------------------------------------------------
export class DemoPublisher {
  private proc: ChildProcess | null = null;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;

  constructor(private log: Log) {}

  get running() {
    return !this.stopped;
  }

  start(key: string) {
    const bin = ffmpegPath();
    if (!bin || !this.stopped) return;
    this.stopped = false;
    const spawnOnce = () => {
      if (this.stopped) return;
      // Progresi akor I–V–vi–IV (C–G–Am–F, rasio frekuensi dari C) + arpeggio, 4 dtk per akor.
      const f = "if(lt(mod(t,16),4),1,if(lt(mod(t,16),8),1.4983,if(lt(mod(t,16),12),1.6818,1.3348)))";
      const arp = "if(lt(mod(t*4,4),1),1,if(lt(mod(t*4,4),2),1.2599,if(lt(mod(t*4,4),3),1.4983,2)))";
      const audio = `aevalsrc='0.12*sin(2*PI*t*130.81*${f})+0.08*sin(2*PI*t*261.63*${f}*${arp})*exp(-3*mod(t,0.25))+0.05*sin(2*PI*t*196*${f})':s=44100:c=stereo`;
      const filter =
        '[0:v]format=rgba[bg];' +
        '[1:a]asplit=2[a1][aout];' +
        '[a1]showwaves=s=854x160:mode=cline:rate=30:colors=white|white:draw=full,format=rgba,colorchannelmixer=aa=0.85[w];' +
        '[bg][w]overlay=0:H-h-40,format=yuv420p[v]';
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-re',
        '-f', 'lavfi', '-i', 'gradients=s=854x480:r=30:c0=0x1e1b4b:c1=0x7c3aed:c2=0x1ed760:c3=0x0f172a:n=4:speed=0.015',
        '-f', 'lavfi', '-i', audio,
        '-filter_complex', filter, '-map', '[v]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-b:v', '1200k', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'flv', `rtmp://127.0.0.1:${RTMP_PORT}/live/${key}`,
      ];
      const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      this.proc = p;
      let err = '';
      p.stderr!.on('data', (d) => (err = (err + d.toString()).slice(-1000)));
      let ended = false;
      const onEnd = (code: number | null, spawnErr?: string) => {
        if (ended) return;
        ended = true;
        if (this.proc === p) this.proc = null;
        if (this.stopped) return;
        this.log.warn({ code, err: spawnErr ?? err.trim().slice(-300) }, 'publisher demo berhenti — restart 3 dtk');
        this.timer = setTimeout(spawnOnce, 3000);
      };
      p.on('exit', (code) => onEnd(code));
      p.on('error', (e) => onEnd(null, `ffmpeg gagal dijalankan: ${e.message}`));
    };
    spawnOnce();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }
}
