import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, PlusCircle } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Episode, Show } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { usePlayer } from '@/stores/player';
import { colorFor, DarkError, PlayFab } from '@/components/fan';
import { PageLoader, toast } from '@/components/ui';
import { episodeToPlayable } from './ShowPage';

/** Episode (mockup Spotify 7 & 10): header warna, tombol play hijau, deskripsi, paywall premium. */
export default function EpisodePage() {
  const { id = '' } = useParams();
  const user = useAuth((s) => s.user);
  const { current, playing, toggle, playOne, error } = usePlayer();
  const q = useQuery({ queryKey: ['episode', id], queryFn: () => api<Episode & { show: Show }>(`/v1/catalog/episodes/${id}`) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const e = q.data;
  const locked = e.is_premium && !user?.premium;
  const isCurrent = current?.id === e.id;
  const color = colorFor(e.show.id);
  return (
    <div className="min-h-full pb-12">
      <header className="px-4 pt-24 pb-8 md:px-8" style={{ background: `linear-gradient(${color}, ${color}88)` }}>
        <div className="flex flex-col gap-6 md:flex-row md:items-end">
          <img src={e.cover_url} alt="" className="size-48 rounded-lg shadow-2xl md:size-56" />
          <div className="min-w-0">
            <p className="text-sm font-bold">Episode {e.is_premium && '· Premium'}</p>
            <h1 className="my-3 text-3xl font-black tracking-tight md:text-5xl">{e.title}</h1>
            <Link to={`/app/show/${e.show.id}`} className="text-lg font-bold hover:underline">
              {e.show.title}
            </Link>
          </div>
        </div>
      </header>
      <div className="bg-gradient-to-b from-black/40 to-transparent px-4 py-6 md:px-8">
        <p className="flex items-center gap-3 text-sm text-gema-muted">
          {fmt.date(e.published_at)} · {fmt.minutes(e.duration_ms)}
          <span className="h-1 w-24 rounded-full bg-white/20" />
        </p>
        <div className="mt-5 flex items-center gap-6">
          {locked ? (
            <span className="grid size-14 place-items-center rounded-full bg-white/20" aria-label="Terkunci">
              <Lock className="size-6" />
            </span>
          ) : (
            <PlayFab size="lg" playing={isCurrent && playing} onClick={() => (isCurrent ? toggle() : playOne(episodeToPlayable(e, e.show)))} />
          )}
          <button onClick={() => toast.success('Disimpan ke Episode Kamu')} aria-label="Simpan episode" className="text-gema-muted hover:text-white">
            <PlusCircle className="size-8" />
          </button>
        </div>
        {(locked || (isCurrent && error?.includes('Premium'))) && (
          <div className="mt-8 max-w-2xl rounded-xl bg-gradient-to-r from-[#1e70e0] to-[#7c3aed] p-6">
            <p className="text-lg font-black">Episode ini khusus Premium</p>
            <p className="mt-1 text-sm text-white/85">Dengarkan podcast premium dan cerita fiksi berseri tanpa iklan. Musik tetap gratis.</p>
            <Link to="/premium" className="mt-4 inline-block rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black hover:scale-105">
              Coba Premium gratis
            </Link>
          </div>
        )}
        <h2 className="mt-10 mb-3 text-2xl font-bold">Deskripsi episode</h2>
        <p className="max-w-3xl leading-relaxed whitespace-pre-line text-gema-muted">{e.description}</p>
      </div>
    </div>
  );
}
