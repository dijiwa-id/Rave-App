import { describe, expect, it } from 'vitest';
import { activeRowAt, analyzeLyrics, formatLrcTime, looksLikeLrc, nudgeRow, parseRows, setRowTime, sortByTime, toPlain, toSyncedDraft } from './lrc';

const codes = (mode: 'plain' | 'synced', text: string, dur = 0) => analyzeLyrics(mode, text, dur).issues.map((i) => `${i.level}:${i.code}@${i.index}`);

describe('lrc (editor lirik Studio)', () => {
  it('format & parse stempel waktu (1–3 digit pecahan, metadata)', () => {
    expect(formatLrcTime(83_456)).toBe('01:23.46');
    const rows = parseRows('[ar:RAVE]\n[00:01.5] a\n[00:02:25] b\n[00:03.250][00:09.00] c\n\nd');
    expect(rows[0]!.meta).toBe(true);
    expect(rows[1]!.times).toEqual([1500]);
    expect(rows[2]!.times).toEqual([2250]);
    expect(rows[3]!.times).toEqual([3250, 9000]);
    expect(rows[3]!.text).toBe('c');
    expect(rows[4]!.blank).toBe(true);
    expect(rows[5]!.times).toEqual([]);
    expect(parseRows('[00:61.00] x')[0]!.times).toBeNull();
  });

  it('validasi mode tersinkron: tanpa waktu, urutan, 00:00 berulang, melewati durasi', () => {
    expect(codes('synced', '[00:01.00] a\nb')).toEqual(['error:no_time@1']);
    expect(codes('synced', '[00:05.00] a\n[00:02.00] b')).toEqual(['warn:order@1']);
    expect(codes('synced', '[00:00.00] a\n[00:00.00] b')).toEqual(['warn:zero@1']);
    expect(codes('synced', '[00:01.00] a\n[03:30.00] b', 180_000)).toEqual(['error:past_end@1']);
    expect(codes('synced', '[00:61.00] a')).toContain('error:bad_time@0');
    expect(codes('synced', '[ar:x]\n\n[00:01.00] a\n\n[00:03.00] b')).toEqual([]);
  });

  it('validasi umum: kosong, baris terlalu panjang, teks biasa berisi LRC', () => {
    expect(codes('plain', '  \n ')).toEqual(['error:empty@-1']);
    expect(codes('plain', 'x'.repeat(301))).toEqual(['error:too_long@0']);
    expect(codes('plain', '[00:01.00] a')).toEqual(['warn:looks_lrc@-1']);
    expect(looksLikeLrc('a\n b')).toBe(false);
  });

  it('cap, geser, urutkan, konversi', () => {
    const t = toSyncedDraft('satu\n\n dua \n');
    expect(t).toBe('satu\ndua');
    const s = setRowTime(t, 1, 12_340);
    expect(s).toBe('satu\n[00:12.34] dua');
    expect(nudgeRow(s, 1, -100)).toBe('satu\n[00:12.24] dua');
    expect(nudgeRow(s, 0, 100)).toBe(s); // tanpa waktu → tetap
    expect(nudgeRow('[00:00.05] a', 0, -100)).toBe('[00:00.00] a');
    expect(setRowTime(s, 1, null)).toBe('satu\ndua');
    expect(sortByTime('[ti:x]\n[00:05.00] b\nc\n[00:01.00] a')).toBe('[ti:x]\n[00:01.00] a\n[00:05.00] b\nc');
    expect(toPlain('[ar:x]\n[00:01.00] a\n\n\n\n[00:02.00] b')).toBe('a\n\nb');
  });

  it('baris aktif pada waktu tertentu', () => {
    const rows = parseRows('[00:01.00] a\n[00:05.00] b\nc');
    expect(activeRowAt(rows, 500)).toBe(-1);
    expect(activeRowAt(rows, 1000)).toBe(0);
    expect(activeRowAt(rows, 7000)).toBe(1);
  });
});
