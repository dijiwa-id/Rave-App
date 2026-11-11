import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageMinus, ImagePlus, Pencil, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Playlist as PlaylistT, Track } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { ActionBar, colorFor, DarkError, HeroHeader, PlayFab, TrackTable } from '@/components/fan';
import { Button, EmptyState, Input, Modal, PageLoader, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { IMAGE_ACCEPT, uploadFile } from '@/lib/upload';

function AddTracks({ playlistId, onAdded }: { playlistId: string; onAdded: () => void }) {
  const d = useDict('fan');
  const [q, setQ] = useState('');
  const res = useQuery({
    queryKey: ['search', 'add', q],
    queryFn: () => api<{ tracks: Track[] }>('/v1/catalog/search', { query: { q, type: 'track' } }),
    enabled: q.trim().length > 1,
  });
  async function add(t: Track) {
    try {
      await api(`/v1/library/playlists/${playlistId}/items`, { body: { track_id: t.id } });
      toast.success(d.playlist.added(t.title));
      onAdded();
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <section className="mt-10 px-4 md:px-8">
      <hr className="mb-6 border-white/10" />
      <h2 className="text-2xl font-bold">{d.playlist.findSomething}</h2>
      <label className="relative mt-4 block max-w-md">
        <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-rave-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={d.playlist.searchSongs} aria-label={d.playlist.searchSongsLabel} className="h-10 w-full rounded-none bg-white/10 pr-3 pl-10 text-sm focus:outline-none" />
      </label>
      <ul className="mt-4 max-w-3xl">
        {(res.data?.tracks ?? []).slice(0, 8).map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-none px-2 py-2 hover:bg-white/10">
            {t.release.cover_url && <img src={t.release.cover_url} alt="" loading="lazy" decoding="async" width={40} height={40} className="size-10 rounded-none" />}
            <div className="min-w-0 flex-1">
              <p className="truncate">{t.title}</p>
              <p className="truncate text-sm text-rave-muted">{t.artist.name}</p>
            </div>
            <button onClick={() => add(t)} className="rounded-none border border-rave-muted px-4 py-1.5 text-sm font-bold hover:border-white">
              {d.playlist.add}
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
  const d = useDict('fan');
  const qc = useQueryClient();
  const nav = useNavigate();
  const playQueue = usePlayer((s) => s.playQueue);
  const q = useQuery({ queryKey: ['playlist', id], queryFn: () => api<PlaylistT>(`/v1/library/playlists/${id}`) });
  const [edit, setEdit] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
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
  /** Sampul kustom: unggah (JPEG/PNG ≤ 8 MB, ≥ 300 px — divalidasi server) lalu simpan; null = kembali ke sampul otomatis. */
  async function setCover(file: File | null) {
    if (file && !/^image\/(png|jpeg)$/.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) return toast.error(d.playlist.coverType);
    if (file && file.size > 8 * 1024 * 1024) return toast.error(d.playlist.coverTooBig);
    setCoverBusy(true);
    try {
      const cover_url = file ? await uploadFile(file, 'artwork', 'playlist') : null;
      await api(`/v1/library/playlists/${id}`, { method: 'PATCH', body: { cover_url } });
      refresh();
      toast.success(file ? d.playlist.coverUpdated : d.playlist.coverRemoved);
    } catch (e) {
      toast.error(e);
    } finally {
      setCoverBusy(false);
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
    if (!confirm(d.playlist.confirmDelete)) return;
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
        kicker={p.is_editorial ? d.playlist.editorial : p.visibility === 'PRIVATE' ? d.playlist.private : d.playlist.public}
        title={p.title}
        meta={
          <>
            {p.description && <p className="mb-1 w-full text-white/70">{p.description}</p>}
            <strong>{p.owner.name}</strong>
            <span>
              · {d.shared.songsDuration(p.track_count, Math.round(total / 60000))}
            </span>
          </>
        }
      />
      <div>
        <ActionBar>
          {tracks.length > 0 && <PlayFab size="lg" onClick={() => playQueue(tracks.map(trackToPlayable))} />}
          {mine && (
            <>
              <button
                aria-label={d.playlist.editDetails}
                onClick={() => {
                  setTitle(p.title);
                  setDesc(p.description ?? '');
                  setEdit(true);
                }}
                className="text-rave-muted hover:text-white"
              >
                <Pencil className="size-6" />
              </button>
              <label
                title={d.playlist.changeCover}
                className={coverBusy ? 'cursor-wait text-rave-muted opacity-50' : 'cursor-pointer text-rave-muted hover:text-white'}
              >
                <ImagePlus className="size-6" aria-hidden />
                <span className="sr-only">{coverBusy ? d.playlist.coverUploading : d.playlist.changeCover}</span>
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  disabled={coverBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void setCover(f);
                  }}
                />
              </label>
              {p.has_custom_cover && (
                <button aria-label={d.playlist.removeCover} title={d.playlist.removeCover} disabled={coverBusy} onClick={() => void setCover(null)} className="text-rave-muted hover:text-white disabled:opacity-50">
                  <ImageMinus className="size-6" />
                </button>
              )}
              <button aria-label={d.playlist.deletePlaylist} onClick={destroy} className="text-rave-muted hover:text-white">
                <Trash2 className="size-6" />
              </button>
            </>
          )}
        </ActionBar>
        {tracks.length ? <TrackTable tracks={tracks} onRemove={mine ? remove : undefined} onMove={mine ? move : undefined} /> : <EmptyState title={d.playlist.empty} body={mine ? d.playlist.emptyBody : undefined} />}
        {mine && <AddTracks playlistId={id} onAdded={refresh} />}
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title={d.playlist.editDetails} theme="dark">
        <div className="space-y-3">
          <Input theme="dark" value={title} onChange={(e) => setTitle(e.target.value)} aria-label={d.playlist.title} placeholder={d.playlist.title} maxLength={100} />
          <Input theme="dark" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label={d.playlist.description} placeholder={d.playlist.descriptionPlaceholder} />
          <div className="flex justify-end">
            <Button variant="white" onClick={save} disabled={!title.trim()}>
              {d.playlist.save}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
