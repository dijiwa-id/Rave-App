import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Epk } from '@/lib/types';
import { EpkView } from '@/components/b2b/EpkView';
import { PageLoader } from '@/components/ui';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { useDict } from '@/lib/i18n';

/**
 * Halaman publik link EPK privat (`/epk/:slug?token=…`, dibuat dari Studio → EPK → "Link EPK privat").
 * Tanpa login: token share membuka metrik lengkap; kontak tetap disamarkan sesuai aturan backend.
 */
export default function EpkPublic() {
  const { slug = '' } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? undefined;
  const d = useDict('public');
  const q = useQuery({
    queryKey: ['epk-public', slug, token],
    queryFn: () => api<Epk>(`/v1/booking/artists/${encodeURIComponent(slug)}/epk`, { query: token ? { token } : undefined }),
    retry: false,
  });
  return (
    <div className="min-h-full bg-b2b-bg text-b2b-ink">
      <header className="flex items-center justify-between border-b border-b2b-line bg-b2b-card px-4 py-4 md:px-8">
        <Link to="/" aria-label={d.homeAria}>
          <RaveLogo dark className="h-8" />
        </Link>
        <Link to={`/a/${slug}`} className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">
          {d.epk.listenOnRave}
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        {q.isLoading && <PageLoader />}
        {q.isError && (
          <div className="rounded-none border border-dashed border-b2b-line bg-b2b-card px-6 py-12 text-center">
            <p className="font-bold">{d.epk.cannotOpen}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-b2b-muted">{(q.error as Error)?.message ?? d.epk.invalid} {d.epk.askNew}</p>
          </div>
        )}
        {q.data && <EpkView epk={q.data} />}
      </main>
    </div>
  );
}
