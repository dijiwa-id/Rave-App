import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlusCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Release } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { ActionBar, colorFor, DarkError, HeroHeader, PlayFab, TrackTable } from '@/components/fan';
import { PageLoader, toast } from '@/components/ui';
import { localeTag, useDict } from '@/lib/i18n';

export default function Album() {
  const { id = '' } = useParams();
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const d = useDict('fan');
  const playQueue = usePlayer((s) => s.playQueue);
  const q = useQuery({ queryKey: ['release', id], queryFn: () => api<Release>(`/v1/catalog/releases/${id}`) });
  const lib = useQuery({ queryKey: ['library-summary'], queryFn: () => api<{ saved_releases: string[] }>('/v1/library/summary'), enabled: !!token });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const saved = !!lib.data?.saved_releases.includes(r.id);
  const total = r.tracks.reduce((s, t) => s + t.duration_ms, 0);
  async function toggleSave() {
    if (!token) return toast.info(d.album.signInToSave);
    try {
      await api(`/v1/library/releases/${r.id}`, { method: saved ? 'DELETE' : 'PUT' });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      toast.success(saved ? d.album.removed : d.album.saved);
    } catch (e) {
      toast.error(e);
    }
  }
  const color = colorFor(r.id);
  return (
    <div className="min-h-full pb-12">
      <HeroHeader
        color={color}
        image={r.cover_url}
        kicker={(d.album.types as Record<string, string>)[r.type] ?? r.type}
        title={r.title}
        meta={
          <>
            <Link to={`/app/artist/${r.artist.slug}`} className="font-bold hover:underline">
              {r.artist.name}
            </Link>
            <span>
              · {r.release_date?.slice(0, 4)} · {d.shared.songsDuration(r.tracks.length, Math.round(total / 60000))}
            </span>
          </>
        }
      />
      <div>
        <ActionBar>
          <PlayFab size="lg" onClick={() => playQueue(r.tracks.map(trackToPlayable))} />
          <button onClick={toggleSave} aria-label={saved ? d.album.remove : d.album.save} className={saved ? 'text-rave-primary-text' : 'text-rave-muted hover:text-white'}>
            {saved ? <CheckCircle2 className="size-8" /> : <PlusCircle className="size-8" />}
          </button>
        </ActionBar>
        <TrackTable tracks={r.tracks} showAlbum={false} showCover={false} />
        <div className="mt-8 px-4 text-xs text-rave-muted md:px-8">
          <p>{new Date(r.release_date).toLocaleDateString(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="mt-1">
            ℗ © {r.release_date?.slice(0, 4)} {r.label ?? r.artist.name}
            {r.upc && ` · UPC ${r.upc}`}
          </p>
        </div>
      </div>
    </div>
  );
}
