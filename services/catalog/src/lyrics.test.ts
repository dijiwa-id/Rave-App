import { describe, expect, it } from 'vitest';
import { formatLrcTime, lyricsToText, parseLyrics } from './lyrics.js';

describe('parseLyrics — synced (LRC)', () => {
  it('mengurai stempel waktu, metadata, offset & multi-stempel', () => {
    const r = parseLyrics('synced', '[ti:Lagu]\n[offset:+500]\n[00:12.50] Baris satu\n[00:05.1][01:00.123]  Reff  \n');
    expect(r).toEqual({
      ok: true,
      synced: true,
      lines: [
        { time_ms: 4600, text: 'Reff' },
        { time_ms: 12000, text: 'Baris satu' },
        { time_ms: 59623, text: 'Reff' },
      ],
      plain: 'Reff\nBaris satu\nReff',
    });
  });
  it('menolak baris tanpa stempel waktu & detik ≥ 60', () => {
    expect(parseLyrics('synced', '[00:01.00] a\nb')).toMatchObject({ ok: false, line: 2 });
    expect(parseLyrics('synced', '[00:61.00] a')).toMatchObject({ ok: false, line: 1 });
    expect(parseLyrics('synced', '')).toMatchObject({ ok: false });
  });
  it('round-trip ke teks LRC', () => {
    const r = parseLyrics('synced', '[01:02.30] Halo');
    expect(r.ok && lyricsToText(true, r.lines)).toBe('[01:02.30] Halo');
    expect(formatLrcTime(3_723_450)).toBe('62:03.45');
  });
});

describe('parseLyrics — plain', () => {
  it('merapikan baris kosong beruntun & menyimpan pemisah bait', () => {
    const r = parseLyrics('plain', '\n\nBait 1\n\n\n\nBait 2\n\n');
    expect(r).toMatchObject({ ok: true, synced: false, plain: 'Bait 1\n\nBait 2' });
  });
  it('menolak baris terlalu panjang', () => {
    expect(parseLyrics('plain', 'x'.repeat(301))).toMatchObject({ ok: false, line: 1 });
  });
});
