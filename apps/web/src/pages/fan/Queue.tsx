import { Link } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import { fmt } from '@/lib/api';
import { useShallow } from 'zustand/react/shallow';
import { usePlayer, type Playable } from '@/stores/player';
import { FanPage } from '@/components/fan';
import { cx, EmptyState } from '@/components/ui';
import { useDict } from '@/lib/i18n';

function Row({ p, i, active, onPlay }: { p: Playable; i: number; active?: boolean; onPlay: () => void }) {
  return (
    <button onClick={onPlay} className="grid w-full grid-cols-[24px_1fr_60px] items-center gap-4 rounded-none px-4 py-2 text-left text-sm text-rave-muted hover:bg-white/10">
      <span className={cx('text-right', active && 'text-rave-primary-text')}>{i}</span>
      <span className="flex min-w-0 items-center gap-3">
        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" decoding="async" width={40} height={40} className="size-10 rounded-none" /> : <span className="size-10 rounded-none bg-rave-highlight" />}
        <span className="min-w-0">
          <span className={cx('block truncate text-base', active ? 'text-rave-primary-text' : 'text-white')}>{p.title}</span>
          <span className="block truncate">{p.subtitle}</span>
        </span>
      </span>
      <span className="text-right tabular-nums">{fmt.duration(p.duration_ms)}</span>
    </button>
  );
}

export default function Queue() {
  const { queue, index, current } = usePlayer(useShallow((s) => ({ queue: s.queue, index: s.index, current: s.current })));
  const playQueue = usePlayer((s) => s.playQueue);
  const d = useDict('fan');
  if (!current)
    return (
      <div className="pt-24">
        <EmptyState icon={<ListMusic className="size-12" />} title={d.queue.empty} body={d.queue.emptyBody} action={<Link to="/app/search" className="rounded-none bg-white px-6 py-2.5 text-sm font-bold text-black">{d.queue.findMusic}</Link>} />
      </div>
    );
  const next = queue.slice(index + 1);
  return (
    <FanPage>
      <h1 className="mb-8 text-2xl font-bold">{d.queue.title}</h1>
      <h2 className="mb-2 font-bold text-rave-muted">{d.queue.nowPlaying}</h2>
      <Row p={current} i={1} active onPlay={() => {}} />
      {next.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 font-bold text-rave-muted">{d.queue.next}</h2>
          {next.map((p, i) => (
            <Row key={`${p.id}-${i}`} p={p} i={i + 2} onPlay={() => playQueue(queue, index + 1 + i)} />
          ))}
        </>
      )}
    </FanPage>
  );
}
