import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api } from '@/lib/api';
import type { Paged, Track } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { ActionBar, DarkError, glow, PlayFab, TrackTable } from '@/components/fan';
import { EmptyState, PageLoader } from '@/components/ui';
import { useDict } from '@/lib/i18n';

export default function Liked() {
  const user = useAuth((s) => s.user);
  const d = useDict('fan');
  const playQueue = usePlayer((s) => s.playQueue);
  const q = useQuery({ queryKey: ['likes'], queryFn: () => api<Paged<Track>>('/v1/library/likes') });
  const tracks = q.data?.data ?? [];
  return (
    <div className="min-h-full pb-12">
      <header className="flex items-end gap-6 px-4 pt-24 pb-6 md:px-8" style={{ background: glow('#7A3E91', '88') }}>
        <div className="grid size-44 shrink-0 place-items-center rounded-none bg-gradient-to-br from-[#5B2A6E] to-[#F4C21F] shadow-2xl md:size-56">
          <Heart className="size-20 fill-white text-white" />
        </div>
        <div>
          <p className="text-sm font-bold">{d.shared.playlist}</p>
          <h1 className="my-2 text-4xl font-black tracking-tighter md:text-7xl lg:text-8xl">{d.library.likedSongs}</h1>
          <p className="text-sm">
            <strong>{user?.display_name}</strong> · {d.shared.songs(tracks.length)}
          </p>
        </div>
      </header>
      <div>
        <ActionBar>{tracks.length > 0 && <PlayFab size="lg" onClick={() => playQueue(tracks.map(trackToPlayable))} />}</ActionBar>
        {q.isLoading && <PageLoader />}
        {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
        {!q.isLoading && !tracks.length && <EmptyState title={d.liked.emptyTitle} body={d.liked.emptyBody} icon={<Heart className="size-12" />} />}
        {tracks.length > 0 && <TrackTable tracks={tracks} />}
      </div>
    </div>
  );
}
