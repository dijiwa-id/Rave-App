/**
 * Lirik lagu dari Artist Studio (fungsi murni — dipakai PUT /v1/studio/tracks/:id/lyrics dan diuji unit).
 *
 * - `plain`: teks biasa, satu baris lirik per baris; tidak tersinkron (pemutar tidak menyorot baris).
 * - `synced`: format LRC — `[mm:ss.xx] teks` (boleh beberapa stempel waktu per baris, `[mm:ss]`, `[mm:ss:xx]`,
 *   milidetik 1–3 digit). Tag metadata LRC (`[ar:…]`, `[ti:…]`, `[offset:+/-ms]`, dll.) dikenali; offset diterapkan.
 *   Baris tanpa stempel waktu ditolak agar artis tidak mengira lirik sudah tersinkron.
 *
 * Disimpan sebagai `lines = [{time_ms, text}]` (urut waktu) + `plain` (untuk pencarian lirik).
 */
export const LYRICS_MAX_LINES = 600;
export const LYRICS_MAX_LINE = 300;
export const LYRICS_MAX_CHARS = 20_000;
/** Batas wajar durasi lagu (stempel waktu di atas ini hampir pasti salah ketik). */
export const LYRICS_MAX_MS = 4 * 3600_000;

export interface LyricLine {
  time_ms: number;
  text: string;
}
export type LyricsParse = { ok: true; synced: boolean; lines: LyricLine[]; plain: string } | { ok: false; line: number; error: string };

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[([a-z]+):(.*)\]$/i;

/** Rapikan teks satu baris: buang karakter kontrol & spasi berlebih. */
const clean = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function tagToMs(m: RegExpExecArray): number | null {
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (sec >= 60) return null;
  const frac = m[3] ?? '';
  // "5" = 500 ms, "50" = 500 ms, "500" = 500 ms (konvensi LRC: sepersepuluh / seperseratus / milidetik).
  const ms = frac ? Math.round(Number(frac) * 10 ** (3 - frac.length)) : 0;
  return (min * 60 + sec) * 1000 + ms;
}

export function parseLyrics(mode: 'plain' | 'synced', raw: string): LyricsParse {
  const text = (raw ?? '').replace(/\r\n?/g, '\n');
  if (text.length > LYRICS_MAX_CHARS) return { ok: false, line: 0, error: `Lirik terlalu panjang (maks. ${LYRICS_MAX_CHARS.toLocaleString('id-ID')} karakter)` };
  const rows = text.split('\n');

  if (mode === 'plain') {
    // Pertahankan satu baris kosong sebagai pemisah bait; buang kosong di awal/akhir & kosong beruntun.
    const lines: LyricLine[] = [];
    for (let i = 0; i < rows.length; i++) {
      const t = clean(rows[i]!);
      if (t.length > LYRICS_MAX_LINE) return { ok: false, line: i + 1, error: `Baris ${i + 1} terlalu panjang (maks. ${LYRICS_MAX_LINE} karakter)` };
      if (!t && (!lines.length || lines[lines.length - 1]!.text === '')) continue;
      lines.push({ time_ms: 0, text: t });
    }
    while (lines.length && lines[lines.length - 1]!.text === '') lines.pop();
    if (!lines.length) return { ok: false, line: 0, error: 'Lirik kosong' };
    if (lines.length > LYRICS_MAX_LINES) return { ok: false, line: LYRICS_MAX_LINES + 1, error: `Maksimal ${LYRICS_MAX_LINES} baris` };
    return { ok: true, synced: false, lines, plain: lines.map((l) => l.text).join('\n') };
  }

  let offset = 0;
  const lines: LyricLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!.trim();
    if (!row) continue;
    const meta = META_TAG.exec(row);
    if (meta && !/^\d/.test(meta[1]!)) {
      if (meta[1]!.toLowerCase() === 'offset') {
        const v = Number(meta[2]!.trim());
        if (!Number.isFinite(v) || Math.abs(v) > 60_000) return { ok: false, line: i + 1, error: `Offset LRC tidak valid di baris ${i + 1}` };
        // LRC: offset positif = lirik tampil lebih awal.
        offset = -Math.round(v);
      }
      continue;
    }
    const times: number[] = [];
    let last = 0;
    TIME_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(row)) && m.index === last) {
      const ms = tagToMs(m);
      if (ms === null) return { ok: false, line: i + 1, error: `Stempel waktu tidak valid di baris ${i + 1}` };
      times.push(ms);
      last = TIME_TAG.lastIndex;
    }
    if (!times.length) return { ok: false, line: i + 1, error: `Baris ${i + 1} belum memiliki stempel waktu [mm:ss.xx]` };
    const t = clean(row.slice(last));
    if (t.length > LYRICS_MAX_LINE) return { ok: false, line: i + 1, error: `Baris ${i + 1} terlalu panjang (maks. ${LYRICS_MAX_LINE} karakter)` };
    for (const ms of times) {
      const at = Math.max(0, ms + offset);
      if (at > LYRICS_MAX_MS) return { ok: false, line: i + 1, error: `Stempel waktu di baris ${i + 1} melebihi durasi wajar` };
      lines.push({ time_ms: at, text: t });
    }
  }
  if (!lines.length || lines.every((l) => !l.text)) return { ok: false, line: 0, error: 'Lirik kosong' };
  if (lines.length > LYRICS_MAX_LINES) return { ok: false, line: LYRICS_MAX_LINES + 1, error: `Maksimal ${LYRICS_MAX_LINES} baris` };
  // Urutkan stabil berdasarkan waktu (baris dengan beberapa stempel / urutan file acak).
  lines.sort((a, b) => a.time_ms - b.time_ms);
  return { ok: true, synced: true, lines, plain: lines.filter((l) => l.text).map((l) => l.text).join('\n') };
}

/** Lirik tersimpan → teks untuk editor (LRC bila tersinkron). */
export function lyricsToText(synced: boolean, lines: LyricLine[]): string {
  if (!synced) return lines.map((l) => l.text).join('\n');
  return lines.map((l) => `[${formatLrcTime(l.time_ms)}] ${l.text}`.trimEnd()).join('\n');
}

export function formatLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
