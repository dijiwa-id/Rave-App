import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lock, Play } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Episode, Show } from '@/lib/types';
import { usePlayer, type Playable } from '@/stores/player';
import { colorFor, DarkError, HeroHeader } from '@/components/fan';
import { PageLoader } from '@/components/ui';

export function episodeToPlayable(e: Episode, show: Pick<Show, 'id' | 'title'>): Playable {
  return { id: e.id, kind: 'episode', title: e.title, subtitle: show.title, subtitleHref: `/app/show/${show.id}`, image_url: e.cover_url, duration_ms: e.duration_ms };
}

export default function ShowPage() {
  const { id = '' } = useParams();
  const playOne = usePlayer((s) => s.playOne);
  const q = useQuery({ queryKey: ['show', id], queryFn: () => api<Show & { episodes: Episode[] }>(`/v1/catalog/shows/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const s = q.data;
  return (
    <div className="min-h-full pb-12">
      <HeroHeader color={colorFor(s.id)} image={s.cover_url} kicker={s.kind === 'FICTION' ? 'Audio fiksi' : 'Podcast'} title={s.title} meta={<strong>{s.publisher}</strong>} />
      <div className="grid gap-10 px-4 pt-6 md:px-8 lg:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-4 text-2xl font-bold">Semua episode</h2>
          <ul className="divide-y divide-white/10">
            {s.episodes.map((e) => (
              <li key={e.id} className="flex gap-4 py-4">
                <img src={e.cover_url} alt="" className="size-28 shrink-0 rounded-md object-cover" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <Link to={`/app/episode/${e.id}`} className="line-clamp-2 font-bold hover:underline">
                    {e.season ? `S${e.season} E${e.episode_number} · ` : ''}
                    {e.title}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm text-gema-muted">{e.description}</p>
                  <div className="mt-3 flex items-center gap-4 text-sm text-gema-muted">
                    <button onClick={() => playOne(episodeToPlayable(e, s))} aria-label={`Putar ${e.title}`} className="grid size-8 place-items-center rounded-full bg-white text-black hover:scale-105">
                      <Play className="ml-0.5 size-4 fill-current" />
                    </button>
                    {e.is_premium && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gema-orange/20 px-2 py-0.5 text-xs font-bold text-gema-orange">
                        <Lock className="size-3" /> Premium
                      </span>
                    )}
                    <span>
                      {fmt.date(e.published_at)} · {fmt.minutes(e.duration_ms)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <aside>
          <h2 className="mb-4 text-2xl font-bold">Tentang</h2>
          <p className="text-gema-muted">{s.description}</p>
          <p className="mt-4 inline-block rounded-full bg-white/10 px-3 py-1 text-sm font-bold">{s.category}</p>
          {(s.age_rating || s.content_warning) && (
            <p className="mt-4 flex items-start gap-2 text-sm text-amber-300">
              <AlertTriangle className="size-4 shrink-0" />
              {s.age_rating && `Rating usia ${s.age_rating}. `}
              {s.content_warning}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
