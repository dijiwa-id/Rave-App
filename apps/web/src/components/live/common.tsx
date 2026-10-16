import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Eye, Radio } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { setting, usePlatformConfig } from '@/lib/platform';
import type { LiveStatus, LiveStream } from '@/lib/types';
import { Badge, cx } from '@/components/ui';

// Utilitas bersama Live Streaming (docs/API.md §10): pengaturan publik, viewer id, pill/badge status, kartu fan.

/** Pengaturan publik fitur live (fallback = default registri). */
export function useLiveSettings() {
  const cfg = usePlatformConfig();
  return {
    enabled: setting(cfg, 'modules.live', true),
    chat: setting(cfg, 'live.chat_enabled', true),
    browserIngest: setting(cfg, 'live.browser_ingest_enabled', true),
    rtmp: setting(cfg, 'live.rtmp_enabled', true),
  };
}

/** UUID penonton anonim per tab (sessionStorage `gema-live-viewer`) untuk heartbeat. */
export function liveViewerId(): string {
  const KEY = 'gema-live-viewer';
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) return v;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return (window as any).__gemaLiveViewer ??= crypto.randomUUID();
  }
}

export const isOnAir = (s: LiveStatus | undefined | null) => s === 'LIVE' || s === 'INTERRUPTED';

/** Daftar stream publik (`status=live|upcoming|ended`). */
export function useLiveStreams(params: { status: 'live' | 'upcoming' | 'ended'; artist_id?: string; event_id?: string; limit?: number }, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ['live-streams', params],
    queryFn: () => api<{ data: LiveStream[] }>('/v1/live/streams', { query: params, auth: false }),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval ?? 30_000,
    staleTime: 10_000,
  });
}

/** Apakah ada stream yang sedang live (titik merah di nav) — dipoll tiap 60 dtk. */
export function useAnyLive(enabled = true) {
  const q = useQuery({
    queryKey: ['live-any'],
    queryFn: () => api<{ data: LiveStream[] }>('/v1/live/streams', { query: { status: 'live', limit: 1 }, auth: false }).catch(() => ({ data: [] })),
    refetchInterval: 60_000,
    enabled,
    retry: false,
  });
  return !!q.data?.data.length;
}

/** Hitung mundur yang berdetak tiap detik; `null` bila waktu tidak ada. */
export function useCountdown(until: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, new Date(until).getTime() - now);
}

/** "2 hari 03:12:09" / "03:12:09". */
export function formatCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${d ? `${d} hari ` : ''}${hh}:${mm}:${ss}`;
}

export function Countdown({ until, className }: { until: string; className?: string }) {
  const left = useCountdown(until) ?? 0;
  return <span className={cx('font-mono font-bold tabular-nums', className)}>{left > 0 ? formatCountdown(left) : 'segera dimulai'}</span>;
}

/** Pill merah "LIVE" berdenyut (+ jumlah penonton). */
export function LivePill({ viewers, interrupted, className }: { viewers?: number | null; interrupted?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5', className)}>
      <span className={cx('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-black tracking-wider text-white uppercase', interrupted ? 'bg-amber-600' : 'bg-red-600')}>
        <span className="relative flex size-2">
          {!interrupted && <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />}
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
        {interrupted ? 'Terputus' : 'Live'}
      </span>
      {viewers != null && (
        <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">
          <Eye className="size-3" />
          {fmt.compact(viewers)}
        </span>
      )}
    </span>
  );
}

const STATUS_LABEL: Record<LiveStatus, string> = { SCHEDULED: 'Terjadwal', LIVE: 'Live', INTERRUPTED: 'Terputus', ENDED: 'Selesai' };
const STATUS_TONE: Record<LiveStatus, 'blue' | 'red' | 'amber' | 'neutral'> = { SCHEDULED: 'blue', LIVE: 'red', INTERRUPTED: 'amber', ENDED: 'neutral' };

/** Badge status untuk dasbor B2B. */
export function LiveStatusBadge({ status }: { status: LiveStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {status === 'LIVE' && <span className="size-1.5 animate-pulse rounded-full bg-red-500" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export const ENDED_REASON_LABEL: Record<string, string> = {
  ended_by_host: 'Diakhiri penyiar',
  signal_lost: 'Sinyal hilang',
  max_duration: 'Batas durasi tercapai',
};
export const endedReason = (r: string | null) => (!r ? '—' : r.startsWith('moderation') ? `Dihentikan moderator${r.includes(':') ? ` — ${r.split(':').slice(1).join(':').trim()}` : ''}` : (ENDED_REASON_LABEL[r] ?? r));

export const liveImage = (s: LiveStream) => s.cover_url ?? s.artist?.image_url ?? null;
export const liveHref = (s: Pick<LiveStream, 'id'>) => `/app/live/${s.id}`;

/** Kartu stream untuk aplikasi fan (gelap). */
export function LiveCard({ s, className }: { s: LiveStream; className?: string }) {
  const img = liveImage(s);
  const onAir = isOnAir(s.status);
  return (
    <Link to={liveHref(s)} className={cx('media-card group block', className)}>
      <div className="relative mb-3 aspect-video overflow-hidden rounded-md bg-gradient-to-br from-gema-highlight to-[#3a1020]">
        {img ? (
          <img src={img} alt="" loading="lazy" className={cx('size-full object-cover transition duration-300 group-hover:scale-105', s.status === 'ENDED' && 'opacity-60 grayscale')} />
        ) : (
          <div className="grid size-full place-items-center">
            <Radio className="size-10 text-white/60" />
          </div>
        )}
        <div className="absolute top-2 left-2">
          {onAir ? (
            <LivePill viewers={s.viewers} interrupted={s.status === 'INTERRUPTED'} />
          ) : s.status === 'SCHEDULED' ? (
            <span className="inline-flex items-center gap-1 rounded bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white">
              <CalendarClock className="size-3" /> {s.scheduled_at ? fmt.dateTime(s.scheduled_at) : 'Segera'}
            </span>
          ) : (
            <span className="rounded bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white/80">Sudah tayang</span>
          )}
        </div>
        {s.access === 'TICKET' && <span className="absolute top-2 right-2 rounded bg-gema-pink px-1.5 py-0.5 text-[10px] font-black text-white uppercase">Tiket</span>}
      </div>
      <p className="truncate font-bold text-white">{s.title}</p>
      <p className="truncate text-sm text-gema-muted">
        {s.artist?.name ?? s.org.name}
        {s.status === 'SCHEDULED' && s.scheduled_at && (
          <>
            {' · '}
            <Countdown until={s.scheduled_at} className="text-xs font-semibold text-gema-primary-text" />
          </>
        )}
        {s.status === 'ENDED' && s.ended_at && ` · ${fmt.date(s.ended_at)}`}
      </p>
    </Link>
  );
}
