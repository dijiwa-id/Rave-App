import { EQ_BANDS, usePrefs } from '@/stores/prefs';
import { useAuth } from '@/stores/auth';

/**
 * Rantai efek Web Audio untuk elemen <audio> pemutar: 6 filter EQ → gain (normalisasi + preamp) → output.
 *
 * - Dibuat malas: hanya ketika equalizer atau normalisasi pertama kali aktif. Tanpa keduanya, audio tidak melewati
 *   Web Audio sama sekali (perilaku lama, tanpa risiko).
 * - Aman karena stream disajikan dari origin yang sama (`/v1/playback/stream/...`); MediaElementSource lintas-origin
 *   tanpa CORS akan senyap.
 * - Normalisasi memakai `loudness_gain_db` dari sesi pemutaran (dihitung server per lagu), dibatasi −12…+6 dB.
 * - Preamp negatif sebesar boost EQ tertinggi mencegah clipping saat pita dinaikkan.
 * - Equalizer khusus Premium (diabaikan untuk akun Gratis); normalisasi untuk semua.
 * - Media eksternal (origin lain) diminta lewat `&fx=1` → server meneruskannya satu-origin agar tidak senyap.
 */
let el: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
let out: GainNode | null = null;
let loudnessDb = 0;

const dbToGain = (db: number) => Math.pow(10, db / 20);

export function registerAudio(a: HTMLAudioElement) {
  el = a;
}

const eqAllowed = () => !!useAuth.getState().user?.premium;
const wantsFx = () => {
  const p = usePrefs.getState();
  return (p.eqOn && eqAllowed()) || p.normalize;
};
/** Stream perlu `&fx=1` bila audio (akan) dirutekan lewat Web Audio. */
export const fxRouted = () => !!ctx || wantsFx();
export const withFx = (url: string) => (fxRouted() && url.includes('/v1/playback/stream/') && !url.includes('fx=1') ? `${url}&fx=1` : url);

/** Rantai baru dibuat saat lagu sedang dimuat tanpa `fx=1` → muat ulang di posisi yang sama agar tidak senyap. */
function rerouteCurrent() {
  if (!el?.src || !el.src.includes('/v1/playback/stream/') || el.src.includes('fx=1')) return;
  const t = el.currentTime;
  const playing = !el.paused;
  el.src = `${el.src}&fx=1`;
  el.addEventListener('loadedmetadata', () => (el!.currentTime = t), { once: true });
  if (playing) void el.play().catch(() => {});
}

function ensureGraph(): boolean {
  if (ctx) return true;
  if (!el || typeof window === 'undefined') return false;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = new AC() as AudioContext;
    const src = ctx.createMediaElementSource(el);
    filters = EQ_BANDS.map((f, i) => {
      const b = ctx!.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    out = ctx.createGain();
    let node: AudioNode = src;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    node.connect(out);
    out.connect(ctx.destination);
    rerouteCurrent();
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

/** Terapkan preferensi saat ini ke rantai (membuat rantai bila baru dibutuhkan). */
export function applyFx() {
  const p = usePrefs.getState();
  const eqOn = p.eqOn && eqAllowed();
  if (!ctx && !eqOn && !p.normalize) return;
  if (!ensureGraph() || !ctx || !out) return;
  const t = ctx.currentTime;
  filters.forEach((f, i) => f.gain.setTargetAtTime(eqOn ? (p.eq[i] ?? 0) : 0, t, 0.04));
  const preamp = eqOn ? -Math.max(0, ...p.eq) : 0;
  const norm = p.normalize ? Math.max(-12, Math.min(6, loudnessDb)) : 0;
  out.gain.setTargetAtTime(dbToGain(preamp + norm), t, 0.06);
  resumeFx();
}

/** Dipanggil pemutar saat sesi baru dimuat. */
export function setLoudness(db: number | null | undefined) {
  loudnessDb = Number.isFinite(db) ? (db as number) : 0;
  applyFx();
}

/** AudioContext bisa "suspended" (kebijakan autoplay) — lanjutkan setiap kali memutar. */
export function resumeFx() {
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

if (typeof window !== 'undefined') {
  usePrefs.subscribe(() => applyFx());
  useAuth.subscribe((s, prev) => s.user?.premium !== prev.user?.premium && applyFx());
}
