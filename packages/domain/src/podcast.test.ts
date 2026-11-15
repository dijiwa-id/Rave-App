import { describe, expect, it } from 'vitest';
import { extractEmbedUrl, parseEmbed, publishTarget } from './podcast';

const ok = (input: string, allowed?: string[]) => {
  const r = parseEmbed(input, allowed);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.embed;
};

describe('extractEmbedUrl', () => {
  it('mengambil src dari kode iframe dan membuang atribut lain', () => {
    expect(extractEmbedUrl('<iframe style="border-radius:12px" src="https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk?utm_source=generator" width="100%" onload="alert(1)"></iframe>')).toBe(
      'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk?utm_source=generator',
    );
    expect(extractEmbedUrl("<iframe src='https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/123&amp;color=%23ff5500'></iframe>")).toContain('&color=');
  });
  it('menerima URL biasa, menolak teks lain', () => {
    expect(extractEmbedUrl('  https://youtu.be/dQw4w9WgXcQ ')).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(extractEmbedUrl('<script>alert(1)</script>')).toBeNull();
    expect(extractEmbedUrl('halo dunia')).toBeNull();
  });
});

describe('parseEmbed', () => {
  it('Spotify: URL halaman & embed → embed kanonik tanpa query', () => {
    expect(ok('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=abc')).toEqual({ provider: 'spotify', src: 'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk', kind: 'audio', height: 152 });
    expect(ok('<iframe src="https://open.spotify.com/embed/show/4rOoJ6Egrf8K2IrywzwOMk?utm_source=generator&theme=0"></iframe>').height).toBe(352);
  });
  it('YouTube: watch/youtu.be/embed/playlist → youtube-nocookie', () => {
    expect(ok('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10').src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(ok('https://youtu.be/dQw4w9WgXcQ').kind).toBe('video');
    expect(ok('<iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x"></iframe>').src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(ok('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG').src).toContain('videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    // Kode embed playlist resmi YouTube: "videoseries" (11 karakter) bukan ID video.
    expect(ok('<iframe src="https://www.youtube.com/embed/videoseries?si=x&amp;list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"></iframe>').src).toBe(
      'https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    );
  });
  it('Apple Podcasts: halaman episode → embed.podcasts.apple.com dengan ?i=', () => {
    expect(ok('https://podcasts.apple.com/id/podcast/nama-acara/id1234567890?i=1000123456789')).toEqual({
      provider: 'apple',
      src: 'https://embed.podcasts.apple.com/id/podcast/nama-acara/id1234567890?i=1000123456789',
      kind: 'audio',
      height: 175,
    });
  });
  it('SoundCloud: halaman lagu & player w.soundcloud.com', () => {
    expect(ok('https://soundcloud.com/artis/judul-episode').src).toBe('https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartis%2Fjudul-episode&visual=false');
    expect(ok('<iframe src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/293&amp;auto_play=true"></iframe>').src).toContain('api.soundcloud.com%2Ftracks%2F293');
  });
  it('Anchor / Spotify for Creators', () => {
    expect(ok('https://podcasters.spotify.com/pod/show/obrolan/embed/episodes/Ep-1-e2abc').provider).toBe('anchor');
    expect(ok('https://anchor.fm/obrolan/embed/episodes/Ep-1-e2abc').src).toBe('https://anchor.fm/obrolan/embed/episodes/Ep-1-e2abc');
  });
  it('menolak domain asing, http, javascript:, dan host tiruan', () => {
    expect(parseEmbed('https://evil.example/embed/episode/x')).toEqual({ ok: false, error: 'unsupported' });
    expect(parseEmbed('http://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk')).toEqual({ ok: false, error: 'not_https' });
    expect(parseEmbed('<iframe src="javascript:alert(1)"></iframe>')).toMatchObject({ ok: false });
    expect(parseEmbed('https://open.spotify.com.evil.example/episode/4rOoJ6Egrf8K2IrywzwOMk')).toEqual({ ok: false, error: 'unsupported' });
    expect(parseEmbed('https://w.soundcloud.com/player/?url=https%3A//evil.example/tracks/1')).toEqual({ ok: false, error: 'unsupported' });
    expect(parseEmbed('')).toEqual({ ok: false, error: 'empty' });
  });
  it('platform dikenali tetapi dimatikan admin → provider_disabled', () => {
    expect(parseEmbed('https://youtu.be/dQw4w9WgXcQ', ['spotify'])).toEqual({ ok: false, error: 'provider_disabled', provider: 'youtube' });
  });
});

describe('publishTarget', () => {
  it('tinjauan wajib → PENDING, selain itu langsung PUBLISHED', () => {
    expect(publishTarget(true)).toBe('PENDING');
    expect(publishTarget(false)).toBe('PUBLISHED');
  });
});
