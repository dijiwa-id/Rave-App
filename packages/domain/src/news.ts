/**
 * Ruang berita RAVE (/berita) — aturan bersama Back Office, service Platform, dan web publik.
 * Artikel dwibahasa: Bahasa Indonesia wajib, Inggris opsional (fallback ke Indonesia per bidang).
 */

/** Kunci kategori (dipakai di URL `?kategori=` dan basis data); label per bahasa ada di kamus web. */
export const NEWS_CATEGORIES = ['Rilis', 'Scene', 'Produk', 'Event', 'Wawancara'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const NEWS_LANGS = ['id', 'en'] as const;
export type NewsLang = (typeof NEWS_LANGS)[number];

/** Blok isi artikel: paragraf, subjudul, atau kutipan. */
export type NewsBlock = { p: string } | { h: string } | { quote: string; by: string };

export interface NewsText {
  title: string;
  excerpt: string;
  image_alt: string;
  body: NewsBlock[];
}
export type NewsContent = { id: NewsText; en?: Partial<NewsText> | null };

/** Status tersimpan di basis data; "scheduled" diturunkan dari published_at di masa depan. */
export type NewsStoredStatus = 'draft' | 'published' | 'archived';
export type NewsStatus = NewsStoredStatus | 'scheduled';

export const NEWS_LIMITS = { slug: 120, title: 160, excerpt: 320, imageAlt: 200, author: 80, block: 4000, blocks: 120, quoteBy: 120 } as const;

/** Slug URL dari judul: huruf kecil ASCII, angka, dan tanda hubung tunggal. */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NEWS_LIMITS.slug)
    .replace(/-+$/g, '');
}

export const NEWS_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const blockText = (b: NewsBlock) => ('p' in b ? b.p : 'h' in b ? b.h : `${b.quote} ${b.by}`);

/** Estimasi waktu baca (menit, minimal 1) dari judul, ringkasan, dan isi — ±200 kata per menit. */
export function readMinutes(t: Pick<NewsText, 'title' | 'excerpt' | 'body'>): number {
  const text = [t.title, t.excerpt, ...t.body.map(blockText)].join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Status efektif yang dilihat editor. */
export function newsStatus(status: NewsStoredStatus, publishedAt: Date | string | null, now = new Date()): NewsStatus {
  if (status !== 'published') return status;
  return publishedAt && new Date(publishedAt).getTime() > now.getTime() ? 'scheduled' : 'published';
}

/** Teks dalam bahasa yang diminta; bidang Inggris yang kosong memakai teks Indonesia. */
export function localizeNews(c: NewsContent, lang: string): NewsText {
  const base = c.id;
  if (lang !== 'en' || !c.en) return base;
  const en = c.en;
  const body = Array.isArray(en.body) && en.body.length ? en.body : base.body;
  return {
    title: en.title?.trim() || base.title,
    excerpt: en.excerpt?.trim() || base.excerpt,
    image_alt: en.image_alt?.trim() || base.image_alt,
    body,
  };
}

/** Kelengkapan terjemahan Inggris (untuk penanda di Back Office). */
export function hasEnglish(c: NewsContent): boolean {
  return !!(c.en?.title?.trim() && c.en?.excerpt?.trim() && c.en?.body?.length);
}
