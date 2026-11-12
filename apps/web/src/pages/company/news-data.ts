// Ruang berita RAVE. Belum ada rilis berita resmi — daftar sengaja kosong (halaman menampilkan keadaan kosong).
// Menambah artikel: tambahkan metadata di NEWS_META dan teksnya per bahasa di kamus `company.news.articles[slug]`.
import { localeTag, useDict } from '@/lib/i18n';

/** Kunci kategori (juga dipakai di URL `?kategori=`); label per bahasa di `company.news.categories`. */
export const NEWS_CATEGORIES = ['Rilis', 'Scene', 'Produk', 'Event', 'Wawancara'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export interface NewsArticle {
  slug: string;
  category: NewsCategory;
  title: string;
  excerpt: string;
  image: string;
  imageAlt: string;
  date: string; // ISO
  author: string;
  readMin: number;
  featured?: boolean;
  body: readonly ({ p: string } | { h: string } | { quote: string; by: string })[];
}

type NewsMeta = Pick<NewsArticle, 'slug' | 'category' | 'image' | 'date' | 'readMin' | 'featured'>;
type NewsText = Pick<NewsArticle, 'title' | 'excerpt' | 'imageAlt' | 'author' | 'body'>;

const NEWS_META: NewsMeta[] = [];

/** Daftar artikel dalam bahasa aktif (metadata + teks dari kamus). */
export function useNews(): NewsArticle[] {
  const articles = useDict('company').news.articles as Record<string, NewsText>;
  return NEWS_META.map((m) => ({ ...m, ...articles[m.slug] }));
}

export const fmtNewsDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
