import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Radio } from 'lucide-react';
import { DarkError, FanPage, glow } from '@/components/fan';
import { EmptyState, Skeleton } from '@/components/ui';
import { LiveCard, liveHref, useLiveSettings, useLiveStreams } from '@/components/live/common';
import { LivePlayer } from '@/components/live/LivePlayer';
import { useDict } from '@/lib/i18n';

function Grid({ title, children, empty, loading }: { title: string; children: React.ReactNode; empty?: string; loading?: boolean }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-bold tracking-tight">{title}</h2>
      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full" />
          ))}
        </div>
      ) : empty ? (
        <p className="text-sm text-rave-muted">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{children}</div>
      )}
    </section>
  );
}

/** /app/live — siaran yang sedang berlangsung, akan datang, dan sebelumnya. */
export default function Live() {
  const { enabled } = useLiveSettings();
  const d = useDict('fan');
  const live = useLiveStreams({ status: 'live', limit: 24 }, { enabled, refetchInterval: 20_000 });
  const upcoming = useLiveStreams({ status: 'upcoming', limit: 12 }, { enabled, refetchInterval: 60_000 });
  const ended = useLiveStreams({ status: 'ended', limit: 8 }, { enabled, refetchInterval: 120_000 });
  // Hero dikunci ke stream yang sedang diputar (urutan viewers berubah tiap polling — jangan ganti video).
  const [heroId, setHeroId] = useState<string | null>(null);
  const list = live.data?.data ?? [];
  const top = list.find((s) => s.id === heroId) ?? list[0];
  useEffect(() => {
    if (top && top.id !== heroId) setHeroId(top.id);
  }, [top, heroId]);

  if (!enabled)
    return (
      <FanPage>
        <EmptyState icon={<Radio className="size-12" />} title={d.live.unavailable} body={d.live.unavailableBody} />
      </FanPage>
    );

  const rest = list.filter((s) => s.id !== top?.id);

  return (
    <div className="min-h-full pb-12" style={{ background: glow('#8A2F3F', '66') }}>
      <FanPage className="pb-0">
        <h1 className="mb-6 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <Radio className="size-7 text-red-500" /> Live
        </h1>
        {live.isError && <DarkError error={live.error} retry={() => live.refetch()} />}

        {/* Hero: stream paling ramai, diputar otomatis tanpa suara */}
        {live.isLoading ? (
          <Skeleton className="mb-10 aspect-video w-full max-w-5xl" />
        ) : top ? (
          <section className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-end">
            <LivePlayer streamId={top.id} />
            <div>
              <p className="text-xs font-bold tracking-widest text-red-400 uppercase">{d.live.liveNowEyebrow}</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight md:text-4xl">{top.title}</h2>
              {top.artist && (
                <Link to={`/app/artist/${top.artist.slug}`} className="mt-2 inline-block font-bold text-rave-muted hover:text-white hover:underline">
                  {top.artist.name}
                </Link>
              )}
              {top.description && <p className="mt-3 line-clamp-3 text-sm text-rave-muted">{top.description}</p>}
              <Link to={liveHref(top)} className="mt-5 inline-flex items-center gap-2 rounded-none bg-white px-6 py-3 text-sm font-bold text-black hover:scale-105">
                <MessageCircle className="size-4" /> {d.live.watchAndChat}
              </Link>
            </div>
          </section>
        ) : (
          !live.isError && (
            <div className="mb-10 rounded-none bg-white/5 p-8 text-center">
              <Radio className="mx-auto size-10 text-rave-subtle" />
              <p className="mt-3 font-bold">{d.live.nobodyLive}</p>
              <p className="mt-1 text-sm text-rave-muted">{d.live.nobodyLiveBody}</p>
            </div>
          )
        )}

        {rest.length > 0 && (
          <Grid title={d.shared.liveNow}>
            {rest.map((s) => (
              <LiveCard key={s.id} s={s} />
            ))}
          </Grid>
        )}

        <Grid title={d.live.upcoming} loading={upcoming.isLoading} empty={!upcoming.isLoading && !upcoming.data?.data.length ? d.live.noScheduled : undefined}>
          {upcoming.data?.data.map((s) => (
            <LiveCard key={s.id} s={s} />
          ))}
        </Grid>

        {!!ended.data?.data.length && (
          <Grid title={d.live.past}>
            {ended.data.data.map((s) => (
              <LiveCard key={s.id} s={s} />
            ))}
          </Grid>
        )}
      </FanPage>
    </div>
  );
}
