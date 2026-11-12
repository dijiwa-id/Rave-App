import { describe, expect, it } from 'vitest';
import { MAX_ARTIST_LINKS, normalizeArtistLink, normalizeArtistLinks } from './artist-links.js';

describe('normalizeArtistLink', () => {
  it('menerima https & menambahkan skema bila kosong', () => {
    expect(normalizeArtistLink('instagram', 'instagram.com/rave')).toEqual({ ok: true, link: { platform: 'instagram', url: 'https://instagram.com/rave' } });
    expect(normalizeArtistLink('spotify', 'https://open.spotify.com/artist/abc')).toMatchObject({ ok: true });
    expect(normalizeArtistLink('website', 'https://band.example.id')).toMatchObject({ ok: true });
  });
  it('menolak http, host salah, IP, kredensial, platform tak dikenal', () => {
    expect(normalizeArtistLink('instagram', 'http://instagram.com/rave').ok).toBe(false);
    expect(normalizeArtistLink('instagram', 'https://evil.com/instagram.com').ok).toBe(false);
    expect(normalizeArtistLink('instagram', 'https://notinstagram.com/x').ok).toBe(false);
    expect(normalizeArtistLink('website', 'https://127.0.0.1/x').ok).toBe(false);
    expect(normalizeArtistLink('website', 'https://localhost/x').ok).toBe(false);
    expect(normalizeArtistLink('website', 'https://u:p@band.example.id').ok).toBe(false);
    expect(normalizeArtistLink('website', 'javascript:alert(1)').ok).toBe(false);
    expect(normalizeArtistLink('myspace', 'https://myspace.com/x').ok).toBe(false);
  });
});

describe('normalizeArtistLinks', () => {
  it('menolak duplikat platform & melebihi batas', () => {
    const r = normalizeArtistLinks([
      { platform: 'tiktok', url: 'https://tiktok.com/@a' },
      { platform: 'tiktok', url: 'https://tiktok.com/@b' },
    ]);
    expect(r).toMatchObject({ ok: false, index: 1 });
    const many = Array.from({ length: MAX_ARTIST_LINKS + 1 }, (_, i) => ({ platform: 'website', url: `https://s${i}.example.id` }));
    expect(normalizeArtistLinks(many).ok).toBe(false);
  });
  it('mengizinkan beberapa situs web berbeda', () => {
    const r = normalizeArtistLinks([
      { platform: 'website', url: 'https://a.example.id' },
      { platform: 'website', url: 'https://b.example.id' },
    ]);
    expect(r.ok).toBe(true);
  });
});
