import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ListMusic, ListPlus, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { PlaylistSummary } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { cx, Spinner, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';

const MENU_W = 288;

/**
 * Tombol "Tambah ke playlist" untuk satu lagu: menu (portal, posisi mengikuti tombol) berisi playlist yang bisa
 * diubah pengguna (milik sendiri + kolaborasi), pencarian, dan "Playlist baru" yang langsung berisi lagu ini.
 * Tamu diarahkan ke login.
 */
export function AddToPlaylist({ trackId, trackTitle, excludePlaylistId, className }: { trackId: string; trackTitle: string; excludePlaylistId?: string; className?: string }) {
  const d = useDict('common').fan;
  const token = useAuth((s) => s.accessToken);
  const me = useAuth((s) => s.user?.id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const list = useQuery({
    queryKey: ['my-playlists'],
    queryFn: () => api<{ data: PlaylistSummary[] }>('/v1/library/playlists'),
    enabled: open && !!token,
    staleTime: 30_000,
  });
  const editable = (list.data?.data ?? []).filter((p) => p.id !== excludePlaylistId && !p.is_editorial && (p.owner.id === me || p.visibility === 'COLLAB'));
  const term = q.trim().toLowerCase();
  const shown = term ? editable.filter((p) => p.title.toLowerCase().includes(term)) : editable;

  // Posisi menu: di bawah tombol, rata kanan; naik ke atas bila ruang bawah kurang (mis. dekat player bar).
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 360 && r.top > window.innerHeight - r.bottom;
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      if (e.type === 'scroll' && menu.current?.contains(e.target as Node)) return;
      setOpen(false);
      if (e.type === 'keydown') btn.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!token) return nav(`/login?next=${encodeURIComponent(location.pathname)}`);
    setQ('');
    setAdded(new Set());
    setOpen((o) => !o);
  }

  function refresh(id: string) {
    qc.invalidateQueries({ queryKey: ['playlist', id] });
    qc.invalidateQueries({ queryKey: ['my-playlists'] });
    qc.invalidateQueries({ queryKey: ['library-summary'] });
  }

  async function addTo(p: PlaylistSummary) {
    setBusy(p.id);
    try {
      await api(`/v1/library/playlists/${p.id}/items`, { body: { track_id: trackId } });
      setAdded((s) => new Set(s).add(p.id));
      refresh(p.id);
      toast.success(d.addedTo(p.title));
      setOpen(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function createWith() {
    setBusy('new');
    try {
      const title = term ? q.trim() : d.newPlaylistFrom(trackTitle);
      const pl = await api<PlaylistSummary>('/v1/library/playlists', { body: { title } });
      await api(`/v1/library/playlists/${pl.id}/items`, { body: { track_id: trackId } });
      refresh(pl.id);
      toast.success(d.addedTo(pl.title));
      setOpen(false);
      nav(`/app/playlist/${pl.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const row = 'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-50';

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={d.addToPlaylistFor(trackTitle)}
        title={d.addToPlaylist}
        className={cx('grid size-8 place-items-center text-rave-muted transition hover:text-white', open && 'text-rave-primary-text', className)}
      >
        <ListPlus className="size-[18px]" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label={d.addToPlaylist}
            className="fixed z-[150] w-72 border border-white/15 bg-rave-elevated text-white shadow-[4px_4px_0_#0b0a0c,0_20px_40px_-12px_rgb(0_0_0/0.7)] animate-[rave-pop_0.16s_ease-out]"
            style={{ left: pos.left, top: pos.top, transform: pos.up ? 'translateY(-100%)' : undefined }}
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
              <ListPlus className="size-4 text-rave-primary-text" />
              <p className="min-w-0 flex-1 truncate font-label text-[11px] font-bold tracking-[0.14em] uppercase">{d.addToPlaylist}</p>
            </div>
            {editable.length > 5 && (
              <label className="relative block border-b border-white/10">
                <span className="sr-only">{d.findPlaylist}</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-rave-subtle" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={d.findPlaylist} className="h-10 w-full bg-transparent pr-3 pl-9 text-sm placeholder:text-rave-subtle focus:outline-none" />
              </label>
            )}
            <button role="menuitem" onClick={createWith} disabled={!!busy} className={cx(row, 'font-bold')}>
              <span className="grid size-9 shrink-0 place-items-center bg-rave-primary text-rave-on-primary">{busy === 'new' ? <Spinner className="size-4" /> : <Plus className="size-4" />}</span>
              <span className="min-w-0 truncate">{term ? d.createNamed(q.trim()) : d.newPlaylist}</span>
            </button>
            <div className="max-h-72 overflow-y-auto py-1">
              {list.isLoading ? (
                <div className="grid place-items-center py-6">
                  <Spinner className="size-5" />
                </div>
              ) : list.isError ? (
                <p className="px-3 py-4 text-sm text-rave-muted">{d.playlistsFailed}</p>
              ) : shown.length === 0 ? (
                <p className="px-3 py-4 text-sm text-rave-muted">{term ? d.noPlaylistMatch : d.noPlaylistsYet}</p>
              ) : (
                shown.map((p) => (
                  <button key={p.id} role="menuitem" onClick={() => addTo(p)} disabled={!!busy} className={row}>
                    {p.cover_url ? <img src={p.cover_url} alt="" className="size-9 shrink-0 object-cover" /> : <span className="grid size-9 shrink-0 place-items-center bg-rave-highlight"><ListMusic className="size-4 text-rave-muted" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.title}</span>
                      <span className="block truncate text-xs text-rave-muted">{d.trackCount(p.track_count)}</span>
                    </span>
                    {busy === p.id ? <Spinner className="size-4" /> : added.has(p.id) ? <Check className="size-4 text-rave-primary-text" /> : null}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
