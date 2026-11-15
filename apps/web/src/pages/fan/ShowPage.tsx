import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Headphones, Lock } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Episode, Show } from '@/lib/types';
import { usePlayer, type Playable } from '@/stores/player';
import { colorFor, DarkError, HeroHeader, PlayFab } from '@/components/fan';
import { PageLoader } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { EmbedPlayer } from '@/components/podcast/EmbedPlayer';

export function episodeToPlayable(e: Episode, show: Pick<Show, 'id' | 'title'> & Partial<Pick<Show, 'content_warning'>>): Playable {
  return {
    id: e.id,
    kind: 'episode',
    title: e.title,
    subtitle: show.title,
    subtitleHref: `/app/show/${show.id}`,
    image_url: e.cover_url,
    duration_ms: e.duration_ms,
    // Info untuk kebijakan iklan: episode Premium tanpa iklan; konten berperingatan → hanya promosi internal.
    premium: e.is_premium,
    content_warning: !!show.content_warning,
  };
}

export default function ShowPage() {
  const { id = '' } = useParams();
  const playOne = usePlayer((s) => s.playOne);
  const d = useDict('fan');
  const q = useQuery({ queryKey: ['show', id], queryFn: () => api<Show & { episodes: Episode[] }>(`/v1/catalog/shows/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const s = q.data;
  return (
    <div className="min-h-full pb-12">
      <HeroHeader color={colorFor(s.id)} image={s.cover_url} kicker={s.kind === 'FICTION' ? d.show.audioFiction : 'Podcast'} title={s.title} meta={<strong>{s.publisher}</strong>} />
      <div className="grid gap-10 px-4 pt-6 md:px-8 lg:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-4 text-2xl font-bold">{d.show.allEpisodes}</h2>
          <ul className="divide-y divide-white/10">
            {s.episodes.map((e) => (
              <li key={e.id} className="flex gap-4 py-4">
                {e.cover_url || s.cover_url ? (
                  <img src={e.cover_url || s.cover_url} alt="" className="size-28 shrink-0 rounded-none object-cover" loading="lazy" />
                ) : (
                  <span className="grid size-28 shrink-0 place-items-center bg-white/5 text-rave-muted">
                    <Headphones className="size-8" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <Link to={`/app/episode/${e.id}`} className="line-clamp-2 font-bold hover:underline">
                    {e.season ? `S${e.season} E${e.episode_number} · ` : ''}
                    {e.title}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm text-rave-muted">{e.description}</p>
                  {e.source === 'embed' && e.embed && <EmbedPlayer embed={e.embed} title={e.title} className="mt-3 max-w-2xl" />}
                  <div className="mt-3 flex items-center gap-4 text-sm text-rave-muted">
                    {e.source !== 'embed' && <PlayFab size="xs" playKey={`episode:${e.id}`} label={d.shared.play(e.title)} onClick={() => playOne(episodeToPlayable(e, s))} />}
                    {e.is_premium && (
                      <span className="inline-flex items-center gap-1 rounded-none bg-rave-orange/20 px-2 py-0.5 text-xs font-bold text-rave-orange">
                        <Lock className="size-3" /> Premium
                      </span>
                    )}
                    <span>
                      {fmt.date(e.published_at)}
                      {e.duration_ms > 0 && ` · ${fmt.minutes(e.duration_ms)}`}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <aside>
          <h2 className="mb-4 text-2xl font-bold">{d.shared.about}</h2>
          <p className="text-rave-muted">{s.description}</p>
          <p className="mt-4 inline-block rounded-none bg-white/10 px-3 py-1 text-sm font-bold">{s.category}</p>
          {(s.age_rating || s.content_warning) && (
            <p className="mt-4 flex items-start gap-2 text-sm text-amber-300">
              <AlertTriangle className="size-4 shrink-0" />
              {s.age_rating && d.show.ageRating(s.age_rating)}
              {s.content_warning}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
