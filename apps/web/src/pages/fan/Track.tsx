import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Artist, Track as TrackT } from '@/lib/types';
import { useShallow } from 'zustand/react/shallow';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { LikeButton } from '@/layouts/PlayerBar';
import { ActionBar, colorFor, DarkError, glow, PlayFab, TrackTable } from '@/components/fan';
import { PageLoader } from '@/components/ui';
import { useDict } from '@/lib/i18n';

export interface Lyrics {
  synced: boolean;
  lines: { time_ms: number; text: string }[];
}

/** Halaman lagu (mockup Spotify 9): judul raksasa, tombol play hijau, lirik. */
export default function Track() {
  const { id = '' } = useParams();
  const d = useDict('fan');
  const { current, playing, toggle, playQueue } = usePlayer(useShallow((s) => ({ current: s.current, playing: s.playing, toggle: s.toggle, playQueue: s.playQueue })));
  const q = useQuery({ queryKey: ['track', id], queryFn: () => api<TrackT>(`/v1/catalog/tracks/${id}`) });
  const lyrics = useQuery({ queryKey: ['lyrics', id], queryFn: () => api<Lyrics>(`/v1/catalog/tracks/${id}/lyrics`), enabled: !!q.data?.has_lyrics, retry: false });
  const artist = useQuery({ queryKey: ['artist', q.data?.artist.slug], queryFn: () => api<Artist>(`/v1/catalog/artists/${q.data!.artist.slug}`), enabled: !!q.data });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const t = q.data;
  const isCurrent = current?.id === t.id;
  const color = colorFor(t.release.id);
  const big = t.title.length < 16 ? 'text-6xl md:text-8xl' : t.title.length < 30 ? 'text-5xl md:text-7xl' : 'text-4xl md:text-5xl';
  return (
    <div className="min-h-full pb-12">
      <header className="px-4 pt-24 pb-8 md:px-8" style={{ background: glow(color, '77') }}>
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          {t.release.cover_url && <img src={t.release.cover_url} alt="" className="size-48 rounded-none shadow-[0_4px_60px_rgba(0,0,0,0.5)] md:size-60" />}
          <div className="min-w-0">
            <p className="text-sm font-bold">{d.shared.song}</p>
            <h1 className={`my-3 font-black tracking-tighter break-words ${big}`}>{t.title}</h1>
            <p className="flex flex-wrap items-center gap-1.5 text-sm">
              {artist.data?.image_url && <img src={artist.data.image_url} alt="" className="size-6 rounded-full" />}
              <Link to={`/app/artist/${t.artist.slug}`} className="font-bold hover:underline">
                {t.artist.name}
              </Link>
              <span>•</span>
              <Link to={`/app/album/${t.release.id}`} className="hover:underline">
                {t.release.title}
              </Link>
              <span>•</span>
              <span>{fmt.duration(t.duration_ms)}</span>
              <span>•</span>
              <span>{d.track.plays(fmt.num(t.play_count))}</span>
            </p>
          </div>
        </div>
      </header>
      <ActionBar>
        <PlayFab size="lg" playing={isCurrent && playing} onClick={() => (isCurrent ? toggle() : playQueue([trackToPlayable(t)]))} />
        <LikeButton trackId={t.id} className="[&>svg]:size-8" />
        <MoreHorizontal className="size-7 text-rave-muted" aria-hidden />
      </ActionBar>
      <div className="grid gap-10 px-4 md:px-8 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-4 text-2xl font-bold">{d.shared.lyrics}</h2>
          {!t.has_lyrics || lyrics.isError ? (
            <p className="text-rave-muted">{d.shared.lyricsUnavailable}</p>
          ) : lyrics.isLoading ? (
            <p className="text-rave-muted">{d.shared.loadingLyrics}</p>
          ) : (
            <div className="space-y-2 text-lg leading-relaxed font-semibold text-white/80">
              {lyrics.data!.lines.map((l, i) => (
                <p key={i}>{l.text || '♪'}</p>
              ))}
              {lyrics.data!.synced && (
                <Link to="/app/lyrics" className="mt-4 inline-block text-sm font-bold text-rave-primary-text hover:underline" onClick={() => !isCurrent && playQueue([trackToPlayable(t)])}>
                  {d.track.openSynced}
                </Link>
              )}
            </div>
          )}
          <div className="mt-8 text-xs text-rave-subtle">{t.isrc && <p>ISRC {t.isrc}</p>}</div>
        </section>
        {artist.data && (
          <aside>
            <Link to={`/app/artist/${artist.data.slug}`} className="flex items-center gap-4 rounded-none p-2 hover:bg-white/10">
              {artist.data.image_url && <img src={artist.data.image_url} alt="" className="size-20 rounded-full object-cover" />}
              <div>
                <p className="text-xs font-bold">{d.shared.artist}</p>
                <p className="font-bold hover:underline">{artist.data.name}</p>
              </div>
            </Link>
          </aside>
        )}
      </div>
      {artist.data && artist.data.top_tracks.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 px-4 text-sm text-rave-muted md:px-8">{d.track.popularFrom}</h2>
          <h3 className="mb-4 px-4 text-2xl font-bold md:px-8">{artist.data.name}</h3>
          <TrackTable tracks={artist.data.top_tracks.slice(0, 5)} />
        </section>
      )}
    </div>
  );
}
