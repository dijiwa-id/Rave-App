/**
 * Utilitas lirik LRC untuk editor Artist Studio (fungsi murni, tanpa impor alias — diuji unit).
 * Cermin aturan server (services/catalog/src/lyrics.ts → parseLyrics): server tetap sumber kebenaran,
 * di sini hanya untuk umpan balik langsung (validasi per baris, ketuk waktu, geser ±ms).
 */

export const LRC_MAX_LINES = 600;
export const LRC_MAX_LINE = 300;
export const LRC_MAX_CHARS = 20_000;

const LEAD_TAGS = /^(\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+\s*/;
const ONE_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\s*\[([a-z]+):(.*)\]\s*$/i;

export type LyricsMode = 'plain' | 'synced';

export interface LrcRow {
  /** Indeks baris di teks mentah. */
  index: number;
  raw: string;
  /** Teks tanpa stempel waktu. */
  text: string;
  /** Stempel waktu (ms) di awal baris; kosong = belum diberi waktu. `null` = stempel tidak valid. */
  times: number[] | null;
  /** Tag metadata LRC ([ar:…], [offset:…]) — tidak ditampilkan, tidak perlu waktu. */
  meta: boolean;
  blank: boolean;
}

export interface LrcIssue {
  level: 'error' | 'warn';
  /** Indeks baris mentah (0-based), -1 = seluruh lirik. */
  index: number;
  code: 'empty' | 'too_long' | 'too_many' | 'too_many_chars' | 'no_time' | 'bad_time' | 'order' | 'zero' | 'past_end' | 'looks_lrc';
}

export function formatLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function tagMs(m: RegExpExecArray): number | null {
  const sec = Number(m[2]);
  if (sec >= 60) return null;
  const frac = m[3] ?? '';
  return (Number(m[1]) * 60 + sec) * 1000 + (frac ? Math.round(Number(frac) * 10 ** (3 - frac.length)) : 0);
}

export function parseRow(raw: string, index: number): LrcRow {
  const trimmed = raw.trim();
  const meta = META.exec(trimmed);
  if (meta && !/^\d/.test(meta[1]!)) return { index, raw, text: '', times: [], meta: true, blank: false };
  const lead = LEAD_TAGS.exec(raw);
  if (!lead)
    return {
      index,
      raw,
      text: trimmed,
      times: [],
      meta: false,
      blank: !trimmed,
    };
  const times: number[] = [];
  ONE_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  let bad = false;
  while ((m = ONE_TAG.exec(lead[0]))) {
    const v = tagMs(m);
    if (v === null) bad = true;
    else times.push(v);
  }
  return {
    index,
    raw,
    text: raw.slice(lead[0].length).trim(),
    times: bad ? null : times,
    meta: false,
    blank: false,
  };
}

export const parseRows = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map(parseRow);

/** Teks tampak seperti LRC (ada stempel waktu di awal baris). */
export const looksLikeLrc = (text: string) => /^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(text);

/** Baris yang perlu waktu pada mode tersinkron (bukan kosong, bukan metadata). */
export const isTimingRow = (r: LrcRow) => !r.meta && !r.blank;

/** Validasi lirik untuk umpan balik di editor. `durationMs` > 0 → cek stempel melewati durasi lagu. */
export function analyzeLyrics(mode: LyricsMode, text: string, durationMs = 0): { rows: LrcRow[]; issues: LrcIssue[] } {
  const rows = parseRows(text);
  const issues: LrcIssue[] = [];
  if (text.length > LRC_MAX_CHARS) issues.push({ level: 'error', index: -1, code: 'too_many_chars' });
  const content = rows.filter((r) => !r.meta && r.text);
  if (!content.length) issues.push({ level: 'error', index: -1, code: 'empty' });
  if (rows.filter(isTimingRow).length > LRC_MAX_LINES) issues.push({ level: 'error', index: -1, code: 'too_many' });
  for (const r of rows) if (r.text.length > LRC_MAX_LINE) issues.push({ level: 'error', index: r.index, code: 'too_long' });

  if (mode === 'plain') {
    if (looksLikeLrc(text)) issues.push({ level: 'warn', index: -1, code: 'looks_lrc' });
    return { rows, issues };
  }
  let prev = -1;
  let first = true;
  for (const r of rows) {
    if (!isTimingRow(r)) continue;
    if (r.times === null) {
      issues.push({ level: 'error', index: r.index, code: 'bad_time' });
      continue;
    }
    if (!r.times.length) {
      issues.push({ level: 'error', index: r.index, code: 'no_time' });
      continue;
    }
    const t = r.times[0]!;
    if (!first && t === 0) issues.push({ level: 'warn', index: r.index, code: 'zero' });
    else if (t < prev) issues.push({ level: 'warn', index: r.index, code: 'order' });
    if (durationMs > 0 && Math.max(...r.times) > durationMs + 5000) issues.push({ level: 'error', index: r.index, code: 'past_end' });
    prev = Math.max(prev, t);
    first = false;
  }
  return { rows, issues };
}

/** Ganti stempel waktu satu baris (semua stempel lama diganti satu stempel baru). */
export function setRowTime(text: string, index: number, ms: number | null): string {
  const lines = text.split('\n');
  const r = parseRow(lines[index] ?? '', index);
  if (r.meta) return text;
  lines[index] = ms === null ? r.text : `[${formatLrcTime(ms)}] ${r.text}`.trimEnd();
  return lines.join('\n');
}

/** Geser stempel waktu satu baris sebesar `delta` ms (baris tanpa waktu tidak berubah). */
export function nudgeRow(text: string, index: number, delta: number): string {
  const r = parseRow(text.split('\n')[index] ?? '', index);
  if (!r.times?.length) return text;
  return setRowTime(text, index, Math.max(0, r.times[0]! + delta));
}

/** Teks biasa → kerangka LRC: baris kosong dibuang, stempel yang ada dipertahankan, sisanya menunggu diberi waktu. */
export function toSyncedDraft(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.trim())
    .join('\n');
}

/** LRC → teks biasa (stempel & metadata dibuang, satu baris kosong antar bait dipertahankan). */
export function toPlain(text: string): string {
  return parseRows(text)
    .filter((r) => !r.meta)
    .map((r) => r.text)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Urutkan baris bertanda waktu secara stabil (metadata tetap di atas, baris tanpa waktu di akhir). */
export function sortByTime(text: string): string {
  const rows = parseRows(text).filter((r) => !r.blank);
  const meta = rows.filter((r) => r.meta);
  const timed = rows.filter((r) => !r.meta && r.times?.length).sort((a, b) => a.times![0]! - b.times![0]!);
  const rest = rows.filter((r) => !r.meta && !r.times?.length);
  return [...meta, ...timed, ...rest].map((r) => r.raw.trim()).join('\n');
}

/** Indeks baris (di `rows`) yang sedang aktif pada waktu `ms`, atau -1. */
export function activeRowAt(rows: LrcRow[], ms: number): number {
  let best = -1;
  let bestT = -1;
  for (const r of rows) {
    if (!r.times?.length || r.meta) continue;
    for (const t of r.times)
      if (t <= ms && t >= bestT) {
        best = r.index;
        bestT = t;
      }
  }
  return best;
}
