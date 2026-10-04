import { Link } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import { fmt } from '@/lib/api';
import { usePlayer, type Playable } from '@/stores/player';
import { FanPage } from '@/components/fan';
import { cx, EmptyState } from '@/components/ui';

function Row({ p, i, active, onPlay }: { p: Playable; i: number; active?: boolean; onPlay: () => void }) {
  return (
    <button onClick={onPlay} className="grid w-full grid-cols-[24px_1fr_60px] items-center gap-4 rounded-md px-4 py-2 text-left text-sm text-gema-muted hover:bg-white/10">
      <span className={cx('text-right', active && 'text-gema-green')}>{i}</span>
      <span className="flex min-w-0 items-center gap-3">
        {p.image_url ? <img src={p.image_url} alt="" className="size-10 rounded" /> : <span className="size-10 rounded bg-gema-highlight" />}
        <span className="min-w-0">
          <span className={cx('block truncate text-base', active ? 'text-gema-green' : 'text-white')}>{p.title}</span>
          <span className="block truncate">{p.subtitle}</span>
        </span>
      </span>
      <span className="text-right tabular-nums">{fmt.duration(p.duration_ms)}</span>
    </button>
  );
}

export default function Queue() {
  const { queue, index, current } = usePlayer();
  const playQueue = usePlayer((s) => s.playQueue);
  if (!current)
    return (
      <div className="pt-24">
        <EmptyState icon={<ListMusic className="size-12" />} title="Antrean kosong" body="Putar sesuatu, lalu lihat apa yang akan diputar berikutnya." action={<Link to="/app/search" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black">Cari musik</Link>} />
      </div>
    );
  const next = queue.slice(index + 1);
  return (
    <FanPage>
      <h1 className="mb-8 text-2xl font-bold">Antrean</h1>
      <h2 className="mb-2 font-bold text-gema-muted">Sedang diputar</h2>
      <Row p={current} i={1} active onPlay={() => {}} />
      {next.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 font-bold text-gema-muted">Berikutnya</h2>
          {next.map((p, i) => (
            <Row key={`${p.id}-${i}`} p={p} i={i + 2} onPlay={() => playQueue(queue, index + 1 + i)} />
          ))}
        </>
      )}
    </FanPage>
  );
}
