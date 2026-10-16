import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Mic2, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePlayer } from '@/stores/player';
import { colorFor } from '@/components/fan';
import { cx, EmptyState, toast } from '@/components/ui';
import type { Lyrics as LyricsT } from './Track';

/** Indeks baris aktif (-1 = belum ada / lirik tidak tersinkron). */
function activeLine(lines: { time_ms: number }[], synced: boolean, pos: number): number {
  if (!synced) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].time_ms <= pos + 150) idx = i;
  return idx;
}

/** Lirik tersinkron layar penuh (REQ-STR-03): highlight baris aktif, auto-scroll, mode karaoke. */
export default function Lyrics() {
  const current = usePlayer((s) => s.current);
  const seek = usePlayer((s) => s.seek);
  const [karaoke, setKaraoke] = useState(false);
  const isTrack = current?.kind === 'track';
  const q = useQuery({
    queryKey: ['lyrics', current?.id],
    queryFn: () => api<LyricsT>(`/v1/catalog/tracks/${current!.id}/lyrics`),
    enabled: isTrack,
    retry: false,
  });
  const lines = q.data?.lines ?? [];
  const synced = !!q.data?.synced;
  // Berlangganan indeks turunan (primitif), bukan positionMs → render ulang hanya saat baris berganti.
  const active = usePlayer((s) => activeLine(lines, synced, s.positionMs));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    refs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  const color = colorFor(current?.id);
  if (!current)
    return (
      <div className="pt-24">
        <EmptyState icon={<Mic2 className="size-12" />} title="Putar lagu untuk melihat lirik" action={<Link to="/app" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black">Ke Beranda</Link>} />
      </div>
    );

  async function shareLine(text: string) {
    const card = `“${text}”\n— ${current!.title}, ${current!.subtitle} · didengar di GEMA`;
    try {
      await navigator.clipboard.writeText(card);
      toast.success('Kutipan lirik disalin — bagikan ke teman!');
    } catch {
      toast.info(card);
    }
  }

  return (
    <div className="min-h-full px-4 pt-24 pb-24 md:px-12" style={{ background: color }}>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-white/70">Lirik</p>
          <p className="text-xl font-bold">
            {current.title} · <span className="text-white/80">{current.subtitle}</span>
          </p>
        </div>
        {q.data?.synced && (
          <button onClick={() => setKaraoke(!karaoke)} aria-pressed={karaoke} className={cx('rounded-full px-4 py-2 text-sm font-bold', karaoke ? 'bg-white text-black' : 'bg-black/30 text-white')}>
            Mode karaoke
          </button>
        )}
      </div>
      {!isTrack ? (
        <p className="text-2xl font-bold text-black/60">Lirik tidak tersedia untuk episode.</p>
      ) : q.isLoading ? (
        <p className="text-2xl font-bold text-black/50">Memuat lirik…</p>
      ) : q.isError || !lines.length ? (
        <p className="text-2xl font-bold text-black/60">Lirik belum tersedia untuk lagu ini.</p>
      ) : (
        <div className="max-w-4xl space-y-4">
          {lines.map((l, i) => {
            const done = q.data!.synced && i < active;
            const on = i === active;
            return (
              <div key={i} className="group flex items-start gap-3">
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  onClick={() => q.data!.synced && seek(l.time_ms)}
                  className={cx(
                    'text-left font-extrabold tracking-tight transition-all duration-300',
                    karaoke ? 'text-4xl md:text-5xl' : 'text-2xl md:text-4xl',
                    !q.data!.synced ? 'text-white' : on ? 'scale-[1.01] text-white' : done ? 'text-white/60' : 'text-black/60 hover:text-white/80',
                    karaoke && !on && 'blur-[1px]',
                  )}
                >
                  {l.text || '♪'}
                </button>
                {l.text && (
                  <button onClick={() => shareLine(l.text)} aria-label="Bagikan baris lirik" className="mt-2 opacity-0 transition group-hover:opacity-100">
                    <Share2 className="size-5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-16 text-xs text-black/50">Lirik ditampilkan berdasarkan lisensi publisher.</p>
    </div>
  );
}
