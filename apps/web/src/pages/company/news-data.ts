// Konten awal ruang berita RAVE (kabar produk & scene dari artis di katalog demo).
// Satu sumber data: kartu daftar, cerita utama, dan halaman artikel — mudah dipindah ke CMS platform nanti.
// Metadata (slug, kategori, gambar, tanggal) di sini; teks artikel per bahasa ada di kamus `company.news.articles[slug]`.
import gigJakarta from '@/assets/landing/gig-jakarta.webp';
import gigDiy from '@/assets/landing/gig-diy.webp';
import gigPub from '@/assets/landing/gig-jakarta-pub.webp';
import roleArtist from '@/assets/landing/role-artist.webp';
import rolePromotor from '@/assets/landing/role-promotor.webp';
import roleFan from '@/assets/landing/role-fan.webp';
import stage from '@/assets/landing/hero-stage.webp';
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

const NEWS_META: NewsMeta[] = [
  { slug: 'gig-kecil-kota-besar', category: 'Scene', image: gigDiy, date: '2026-11-08', readMin: 6, featured: true },
  { slug: 'senja-kolektif-hujan-di-dago', category: 'Rilis', image: roleArtist, date: '2026-11-05', readMin: 3 },
  { slug: 'rave-live-siaran-bertiket', category: 'Produk', image: stage, date: '2026-11-02', readMin: 4 },
  { slug: 'panduan-escrow-promotor', category: 'Produk', image: rolePromotor, date: '2026-10-29', readMin: 5 },
  { slug: 'nirmala-dari-kamar-ke-panggung', category: 'Wawancara', image: roleFan, date: '2026-10-24', readMin: 7 },
  { slug: 'kalender-gig-november', category: 'Event', image: gigJakarta, date: '2026-10-20', readMin: 4 },
  { slug: 'kota-mati-gedung-kosong', category: 'Rilis', image: gigPub, date: '2026-10-15', readMin: 3 },
];

/** Daftar artikel dalam bahasa aktif (metadata + teks dari kamus). */
export function useNews(): NewsArticle[] {
  const articles = useDict('company').news.articles as Record<string, NewsText>;
  return NEWS_META.map((m) => ({ ...m, ...articles[m.slug] }));
}

export const fmtNewsDate = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
