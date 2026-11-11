import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Episode, Paged, Show } from '@/lib/types';
import { DarkError, glow, MediaCard, Shelf } from '@/components/fan';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';

export function EpisodeCard({ e }: { e: Episode }) {
  const nav = useNavigate();
  return (
    <div className="media-card cursor-pointer" onClick={() => nav(`/app/episode/${e.id}`)}>
      <img src={e.cover_url} alt="" loading="lazy" className="mb-4 aspect-square w-full rounded-none object-cover shadow-[var(--shadow-card)]" />
      <p className="truncate font-bold">{e.title}</p>
      <p className="mt-2 flex items-center gap-2 text-sm text-rave-muted">
        {e.is_premium && (
          <span className="inline-flex items-center gap-0.5 rounded-none bg-rave-muted px-1 text-[10px] font-bold text-black">
            <Lock className="size-2.5" /> P
          </span>
        )}
        {fmt.date(e.published_at, { month: 'short', year: 'numeric' })} · {fmt.minutes(e.duration_ms)}
      </p>
    </div>
  );
}

/** Podcast & cerita fiksi (mockup Spotify 3). */
export default function Podcasts() {
  const [params] = useSearchParams();
  const t = useDict('fan');
  const [kind, setKind] = useState<'PODCAST' | 'FICTION'>(params.get('kind') === 'FICTION' ? 'FICTION' : 'PODCAST');
  const shows = useQuery({ queryKey: ['shows', kind], queryFn: () => api<Paged<Show>>('/v1/catalog/shows', { query: { kind } }) });
  const list = shows.data?.data ?? [];
  // Episode terbaik: ambil episode dari beberapa show teratas
  const details = useQueries({
    queries: list.slice(0, 4).map((s) => ({ queryKey: ['show', s.id], queryFn: () => api<Show & { episodes: Episode[] }>(`/v1/catalog/shows/${s.id}`) })),
  });
  const best = details
    .flatMap((d) => d.data?.episodes.slice(0, 2) ?? [])
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, 6);
  const byCategory = list.reduce<Record<string, Show[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-full pb-12">
      <header className="px-4 pt-28 pb-12 md:px-8" style={{ background: glow('#1F5C52', '66') }}>
        <h1 className="text-6xl font-black tracking-tighter text-white/90 md:text-8xl">{kind === 'PODCAST' ? t.podcasts.podcast : t.podcasts.stories}</h1>
        <div className="mt-6 flex gap-2" role="tablist">
          {(
            [
              ['PODCAST', t.podcasts.podcast],
              ['FICTION', t.podcasts.audioFiction],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cx('rounded-none px-4 py-1.5 text-sm font-bold', kind === k ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20')}>
              {l}
            </button>
          ))}
        </div>
      </header>
      <div className="px-4 pt-8 md:px-8">
        {shows.isError && <DarkError error={shows.error} retry={() => shows.refetch()} />}
        <Shelf title={t.podcasts.bestEpisodes} loading={shows.isLoading || details.some((d) => d.isLoading)}>
          {best.length ? best.map((e) => <EpisodeCard key={e.id} e={e} />) : !shows.isLoading && <p className="col-span-full text-rave-muted">{t.podcasts.noEpisodes}</p>}
        </Shelf>
        {shows.isLoading && (
          <Shelf title="…" loading>
            {null}
          </Shelf>
        )}
        {Object.entries(byCategory).map(([cat, items]) => (
          <Shelf key={cat} title={cat.charAt(0).toUpperCase() + cat.slice(1)}>
            {items.map((s) => (
              <MediaCard key={s.id} title={s.title} subtitle={s.publisher} image={s.cover_url} href={`/app/show/${s.id}`} />
            ))}
          </Shelf>
        ))}
        {!shows.isLoading && !shows.isError && !list.length && <p className="text-rave-muted">{t.podcasts.noContent}</p>}
      </div>
    </div>
  );
}
