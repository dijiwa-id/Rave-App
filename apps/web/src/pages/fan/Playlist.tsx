import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Playlist as PlaylistT, Track } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { ActionBar, colorFor, DarkError, HeroHeader, PlayFab, TrackTable } from '@/components/fan';
import { Button, EmptyState, Input, Modal, PageLoader, toast } from '@/components/ui';

function AddTracks({ playlistId, onAdded }: { playlistId: string; onAdded: () => void }) {
  const [q, setQ] = useState('');
  const res = useQuery({
    queryKey: ['search', 'add', q],
    queryFn: () => api<{ tracks: Track[] }>('/v1/catalog/search', { query: { q, type: 'track' } }),
    enabled: q.trim().length > 1,
  });
  async function add(t: Track) {
    try {
      await api(`/v1/library/playlists/${playlistId}/items`, { body: { track_id: t.id } });
      toast.success(`"${t.title}" ditambahkan`);
      onAdded();
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <section className="mt-10 px-4 md:px-8">
      <hr className="mb-6 border-white/10" />
      <h2 className="text-2xl font-bold">Ayo cari sesuatu untuk playlist-mu</h2>
      <label className="relative mt-4 block max-w-md">
        <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-gema-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari lagu" aria-label="Cari lagu untuk ditambahkan" className="h-10 w-full rounded bg-white/10 pr-3 pl-10 text-sm focus:outline-none" />
      </label>
      <ul className="mt-4 max-w-3xl">
        {(res.data?.tracks ?? []).slice(0, 8).map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/10">
            {t.release.cover_url && <img src={t.release.cover_url} alt="" loading="lazy" decoding="async" width={40} height={40} className="size-10 rounded" />}
            <div className="min-w-0 flex-1">
              <p className="truncate">{t.title}</p>
              <p className="truncate text-sm text-gema-muted">{t.artist.name}</p>
            </div>
            <button onClick={() => add(t)} className="rounded-full border border-gema-muted px-4 py-1.5 text-sm font-bold hover:border-white">
              Tambah
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Playlist() {
  const { id = '' } = useParams();
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const nav = useNavigate();
  const playQueue = usePlayer((s) => s.playQueue);
  const q = useQuery({ queryKey: ['playlist', id], queryFn: () => api<PlaylistT>(`/v1/library/playlists/${id}`) });
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const p = q.data;
  const mine = !p.is_editorial && p.owner.id === user?.id;
  const tracks = p.items.map((i) => i.track);
  const total = tracks.reduce((s, t) => s + t.duration_ms, 0);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['playlist', id] });
    qc.invalidateQueries({ queryKey: ['library-summary'] });
  };

  async function save() {
    try {
      await api(`/v1/library/playlists/${id}`, { method: 'PATCH', body: { title, description: desc } });
      setEdit(false);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  }
  async function remove(i: number) {
    try {
      await api(`/v1/library/playlists/${id}/items/${p.items[i].item_id}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      toast.error(e);
    }
  }
  /** Pindah satu langkah: `after_item_id` = item sebelum posisi tujuan (null = paling atas). */
  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= p.items.length) return;
    const after = dir === -1 ? (p.items[i - 2]?.item_id ?? null) : p.items[i + 1].item_id;
    try {
      await api(`/v1/library/playlists/${id}/items/${p.items[i].item_id}/move`, { body: { after_item_id: after } });
      refresh();
    } catch (e) {
      toast.error(e);
    }
  }
  async function destroy() {
    if (!confirm('Hapus playlist ini?')) return;
    try {
      await api(`/v1/library/playlists/${id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      nav('/app/library');
    } catch (e) {
      toast.error(e);
    }
  }

  const color = colorFor(p.id);
  return (
    <div className="min-h-full pb-12">
      <HeroHeader
        color={color}
        image={p.cover_url ?? tracks[0]?.release.cover_url ?? null}
        kicker={p.is_editorial ? 'Playlist editorial' : p.visibility === 'PRIVATE' ? 'Playlist privat' : 'Playlist publik'}
        title={p.title}
        meta={
          <>
            {p.description && <p className="mb-1 w-full text-white/70">{p.description}</p>}
            <strong>{p.owner.name}</strong>
            <span>
              · {p.track_count} lagu, {Math.round(total / 60000)} mnt
            </span>
          </>
        }
      />
      <div style={{ background: `linear-gradient(${color}55, transparent 240px)` }}>
        <ActionBar>
          {tracks.length > 0 && <PlayFab size="lg" onClick={() => playQueue(tracks.map(trackToPlayable))} />}
          {mine && (
            <>
              <button
                aria-label="Ubah detail"
                onClick={() => {
                  setTitle(p.title);
                  setDesc(p.description ?? '');
                  setEdit(true);
                }}
                className="text-gema-muted hover:text-white"
              >
                <Pencil className="size-6" />
              </button>
              <button aria-label="Hapus playlist" onClick={destroy} className="text-gema-muted hover:text-white">
                <Trash2 className="size-6" />
              </button>
            </>
          )}
        </ActionBar>
        {tracks.length ? <TrackTable tracks={tracks} onRemove={mine ? remove : undefined} onMove={mine ? move : undefined} /> : <EmptyState title="Playlist masih kosong" body={mine ? 'Tambahkan lagu lewat pencarian di bawah.' : undefined} />}
        {mine && <AddTracks playlistId={id} onAdded={refresh} />}
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title="Ubah detail" theme="dark">
        <div className="space-y-3">
          <Input theme="dark" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Judul" placeholder="Judul" maxLength={100} />
          <Input theme="dark" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Deskripsi" placeholder="Tambahkan deskripsi (opsional)" />
          <div className="flex justify-end">
            <Button variant="white" onClick={save} disabled={!title.trim()}>
              Simpan
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
