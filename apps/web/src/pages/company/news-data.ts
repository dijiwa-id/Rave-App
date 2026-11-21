// Ruang berita RAVE — artikel dikelola dari Back Office → Konten → Berita (izin news.publish) dan disajikan
// service Platform (GET /v1/platform/news). Bahasa mengikuti Accept-Language; teks Inggris kosong → teks Indonesia.
import { useQuery } from '@tanstack/react-query';
import { NEWS_CATEGORIES, type NewsBlock, type NewsCategory } from '@rave/domain/news';
import { api, ApiError } from '@/lib/api';
import { localeTag, useLocale } from '@/lib/i18n';

export { NEWS_CATEGORIES };
export type { NewsCategory };

export interface NewsArticle {
  slug: string;
  category: NewsCategory;
  title: string;
  excerpt: string;
  image: string | null;
  imageAlt: string;
  date: string; // ISO (tanggal terbit)
  author: string;
  readMin: number;
  featured?: boolean;
  body: readonly NewsBlock[];
}

interface ApiSummary {
  slug: string;
  category: NewsCategory;
  title: string;
  excerpt: string;
  image: string | null;
  image_alt: string;
  author: string;
  date: string;
  read_min: number;
  featured: boolean;
}
interface ApiList {
  data: ApiSummary[];
  total: number;
  categories: Partial<Record<NewsCategory, number>>;
}
type ApiArticle = ApiSummary & { body: NewsBlock[]; updated_at: string; related: ApiSummary[] };

const toArticle = (a: ApiSummary, body: NewsBlock[] = []): NewsArticle => ({
  slug: a.slug,
  category: a.category,
  title: a.title,
  excerpt: a.excerpt,
  image: a.image,
  imageAlt: a.image_alt,
  date: a.date,
  author: a.author,
  readMin: a.read_min,
  featured: a.featured,
  body,
});

/** Daftar artikel tayang dalam bahasa aktif + jumlah per kategori. */
export function useNews() {
  const locale = useLocale((s) => s.locale);
  const q = useQuery({
    queryKey: ['news', locale],
    queryFn: () => api<ApiList>('/v1/platform/news', { query: { limit: 100 }, auth: false }),
    staleTime: 60_000,
  });
  return {
    articles: (q.data?.data ?? []).map((a) => toArticle(a)),
    categories: q.data?.categories ?? {},
    total: q.data?.total ?? 0,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}

/** Satu artikel tayang + "baca juga". `notFound` = slug tidak ada / belum tayang. */
export function useNewsArticle(slug: string | undefined) {
  const locale = useLocale((s) => s.locale);
  const q = useQuery({
    queryKey: ['news-article', slug, locale],
    queryFn: () => api<ApiArticle>(`/v1/platform/news/${encodeURIComponent(slug ?? '')}`, { auth: false }),
    enabled: !!slug,
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  return {
    article: q.data ? toArticle(q.data, q.data.body) : null,
    related: (q.data?.related ?? []).map((a) => toArticle(a)),
    isLoading: q.isLoading,
    notFound: q.error instanceof ApiError && q.error.status === 404,
    isError: q.isError,
    refetch: q.refetch,
  };
}

/** Tanggal terbit (menerima ISO penuh maupun YYYY-MM-DD). */
export const fmtNewsDate = (iso: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
};
