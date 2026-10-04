import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, ListMusic, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { usePlayer } from '@/stores/player';
import { useAuth } from '@/stores/auth';
import { cx, toast } from '@/components/ui';

function Range({ value, max, onChange, className, label }: { value: number; max: number; onChange: (v: number) => void; className?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('group relative flex h-3 items-center', className)}>
      <div className="h-1 w-full rounded-full bg-white/30">
        <div className="h-1 rounded-full bg-white group-hover:bg-gema-green" style={{ width: `${pct}%` }} />
      </div>
      <div className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow group-hover:opacity-100" style={{ left: `${pct}%` }} />
      <input
        aria-label={label}
        type="range"
        min={0}
        max={max || 1}
        step={max > 100 ? 100 : 0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

export function LikeButton({ trackId, className }: { trackId: string; className?: string }) {
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['likes-contains', trackId],
    queryFn: () => api<{ ids: string[] }>('/v1/library/likes/contains', { query: { ids: trackId } }),
    enabled: !!token,
  });
  const liked = !!data?.ids.includes(trackId);
  async function toggle() {
    if (!token) return toast.info('Masuk untuk menyimpan lagu');
    qc.setQueryData(['likes-contains', trackId], { ids: liked ? [] : [trackId] });
    try {
      await api(`/v1/library/likes/${trackId}`, { method: liked ? 'DELETE' : 'PUT' });
      qc.invalidateQueries({ queryKey: ['likes'] });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      if (!liked) toast.success('Ditambahkan ke Lagu yang Disukai');
    } catch (e) {
      qc.setQueryData(['likes-contains', trackId], { ids: liked ? [trackId] : [] });
      toast.error(e);
    }
  }
  return (
    <button onClick={toggle} aria-label={liked ? 'Hapus dari disukai' : 'Simpan ke disukai'} aria-pressed={liked} className={cx('transition hover:scale-110', liked ? 'text-gema-green' : 'text-gema-muted hover:text-white', className)}>
      <Heart className={cx('size-5', liked && 'fill-current')} />
    </button>
  );
}

export function PlayerBar() {
  const p = usePlayer();
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === 'one' ? Repeat1 : Repeat;
  return (
    <footer className="flex h-[90px] items-center justify-between gap-4 border-t border-white/5 bg-[#181818] px-4" aria-label="Pemutar">
      {/* Kiri: info lagu */}
      <div className="flex w-[30%] min-w-0 items-center gap-3">
        {p.current ? (
          <>
            {p.current.image_url ? <img src={p.current.image_url} alt="" className="size-14 rounded object-cover" /> : <div className="size-14 rounded bg-gema-highlight" />}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{p.current.title}</p>
              {p.current.subtitleHref ? (
                <Link to={p.current.subtitleHref} className="truncate text-xs text-gema-muted hover:text-white hover:underline">
                  {p.current.subtitle}
                </Link>
              ) : (
                <p className="truncate text-xs text-gema-muted">{p.current.subtitle}</p>
              )}
            </div>
            {p.current.kind === 'track' && <LikeButton trackId={p.current.id} className="ml-2 shrink-0" />}
          </>
        ) : (
          <p className="text-sm text-gema-subtle">Pilih lagu untuk diputar</p>
        )}
      </div>

      {/* Tengah: kontrol */}
      <div className="flex max-w-[722px] flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-5">
          <button onClick={p.toggleShuffle} aria-label="Acak" aria-pressed={p.shuffle} className={cx('hidden sm:block', p.shuffle ? 'text-gema-green' : 'text-gema-muted hover:text-white')}>
            <Shuffle className="size-4" />
          </button>
          <button onClick={p.prev} aria-label="Sebelumnya" className="text-gema-muted hover:text-white">
            <SkipBack className="size-5 fill-current" />
          </button>
          <button onClick={p.toggle} aria-label={p.playing ? 'Jeda' : 'Putar'} className="grid size-9 place-items-center rounded-full bg-white text-black transition hover:scale-105">
            {p.playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </button>
          <button onClick={p.next} aria-label="Berikutnya" className="text-gema-muted hover:text-white">
            <SkipForward className="size-5 fill-current" />
          </button>
          <button onClick={p.cycleRepeat} aria-label="Ulangi" className={cx('relative hidden sm:block', p.repeat !== 'off' ? 'text-gema-green' : 'text-gema-muted hover:text-white')}>
            <RepeatIcon className="size-4" />
            {p.repeat !== 'off' && <span className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-gema-green" />}
          </button>
        </div>
        <div className="flex w-full items-center gap-2 text-[11px] text-gema-muted tabular-nums">
          <span className="w-10 text-right">{fmt.duration(p.positionMs)}</span>
          <Range label="Posisi" value={p.positionMs} max={p.durationMs} onChange={p.seek} className="flex-1" />
          <span className="w-10">{fmt.duration(p.durationMs)}</span>
        </div>
        {p.error && <p className="text-[11px] text-amber-400">{p.error}</p>}
      </div>

      {/* Kanan: kualitas, lirik, antrean, volume */}
      <div className="hidden w-[30%] items-center justify-end gap-3 md:flex">
        {p.session && (
          <span title="Kualitas audio (REQ-STR-02)" className="rounded border border-gema-green/50 px-1.5 py-0.5 text-[10px] font-bold text-gema-green">
            {p.session.codec_label}
          </span>
        )}
        <Link to="/app/lyrics" aria-label="Lirik" className="text-gema-muted hover:text-white">
          <Mic2 className="size-4" />
        </Link>
        <Link to="/app/queue" aria-label="Antrean" className="text-gema-muted hover:text-white">
          <ListMusic className="size-4" />
        </Link>
        <button onClick={p.toggleMute} aria-label="Bisukan" className="text-gema-muted hover:text-white">
          <VolIcon className="size-4" />
        </button>
        <Range label="Volume" value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} className="w-24" />
      </div>
    </footer>
  );
}
