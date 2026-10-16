import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlusCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Release } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { ActionBar, colorFor, DarkError, HeroHeader, PlayFab, TrackTable } from '@/components/fan';
import { PageLoader, toast } from '@/components/ui';

const TYPE_LABEL = { SINGLE: 'Single', EP: 'EP', ALBUM: 'Album' } as const;

export default function Album() {
  const { id = '' } = useParams();
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const playQueue = usePlayer((s) => s.playQueue);
  const q = useQuery({ queryKey: ['release', id], queryFn: () => api<Release>(`/v1/catalog/releases/${id}`) });
  const lib = useQuery({ queryKey: ['library-summary'], queryFn: () => api<{ saved_releases: string[] }>('/v1/library/summary'), enabled: !!token });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const r = q.data;
  const saved = !!lib.data?.saved_releases.includes(r.id);
  const total = r.tracks.reduce((s, t) => s + t.duration_ms, 0);
  async function toggleSave() {
    if (!token) return toast.info('Masuk untuk menyimpan album');
    try {
      await api(`/v1/library/releases/${r.id}`, { method: saved ? 'DELETE' : 'PUT' });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      toast.success(saved ? 'Dihapus dari Koleksi' : 'Disimpan ke Koleksi');
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
        kicker={TYPE_LABEL[r.type] ?? r.type}
        title={r.title}
        meta={
          <>
            <Link to={`/app/artist/${r.artist.slug}`} className="font-bold hover:underline">
              {r.artist.name}
            </Link>
            <span>
              · {r.release_date?.slice(0, 4)} · {r.tracks.length} lagu, {Math.round(total / 60000)} mnt
            </span>
          </>
        }
      />
      <div style={{ background: `linear-gradient(${color}55, transparent 240px)` }}>
        <ActionBar>
          <PlayFab size="lg" onClick={() => playQueue(r.tracks.map(trackToPlayable))} />
          <button onClick={toggleSave} aria-label={saved ? 'Hapus dari Koleksi' : 'Simpan ke Koleksi'} className={saved ? 'text-gema-primary-text' : 'text-gema-muted hover:text-white'}>
            {saved ? <CheckCircle2 className="size-8" /> : <PlusCircle className="size-8" />}
          </button>
        </ActionBar>
        <TrackTable tracks={r.tracks} showAlbum={false} showCover={false} />
        <div className="mt-8 px-4 text-xs text-gema-muted md:px-8">
          <p>{new Date(r.release_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="mt-1">
            ℗ © {r.release_date?.slice(0, 4)} {r.label ?? r.artist.name}
            {r.upc && ` · UPC ${r.upc}`}
          </p>
        </div>
      </div>
    </div>
  );
}
