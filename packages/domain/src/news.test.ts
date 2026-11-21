import { describe, expect, it } from 'vitest';
import { hasEnglish, localizeNews, newsStatus, readMinutes, slugify } from './news';

describe('news', () => {
  it('slugify membuat slug URL yang aman', () => {
    expect(slugify('RAVE Pro Resmi Dibuka: Promotor & Venue!')).toBe('rave-pro-resmi-dibuka-promotor-dan-venue');
    expect(slugify('  Café — Señor  ')).toBe('cafe-senor');
    expect(slugify('---')).toBe('');
  });

  it('readMinutes minimal 1 dan ±200 kata/menit', () => {
    expect(readMinutes({ title: 'A', excerpt: 'B', body: [] })).toBe(1);
    const p = Array(1000).fill('kata').join(' ');
    expect(readMinutes({ title: '', excerpt: '', body: [{ p }] })).toBe(5);
  });

  it('newsStatus menurunkan terjadwal dari published_at di masa depan', () => {
    const now = new Date('2026-11-21T10:00:00Z');
    expect(newsStatus('published', '2026-11-22T00:00:00Z', now)).toBe('scheduled');
    expect(newsStatus('published', '2026-11-20T00:00:00Z', now)).toBe('published');
    expect(newsStatus('draft', null, now)).toBe('draft');
    expect(newsStatus('archived', '2026-11-20T00:00:00Z', now)).toBe('archived');
  });

  it('localizeNews memakai fallback Indonesia per bidang', () => {
    const c = { id: { title: 'Judul', excerpt: 'Ringkas', image_alt: 'Foto', body: [{ p: 'Isi' }] }, en: { title: 'Title', excerpt: '', body: [] } };
    expect(localizeNews(c, 'en')).toEqual({ title: 'Title', excerpt: 'Ringkas', image_alt: 'Foto', body: [{ p: 'Isi' }] });
    expect(localizeNews(c, 'id').title).toBe('Judul');
    expect(hasEnglish(c)).toBe(false);
  });
});
