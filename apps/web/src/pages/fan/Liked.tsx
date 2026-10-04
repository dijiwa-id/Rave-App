import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api } from '@/lib/api';
import type { Paged, Track } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { ActionBar, DarkError, PlayFab, TrackTable } from '@/components/fan';
import { EmptyState, PageLoader } from '@/components/ui';

export default function Liked() {
  const user = useAuth((s) => s.user);
  const playQueue = usePlayer((s) => s.playQueue);
  const q = useQuery({ queryKey: ['likes'], queryFn: () => api<Paged<Track>>('/v1/library/likes') });
  const tracks = q.data?.data ?? [];
  return (
    <div className="min-h-full pb-12">
      <header className="flex items-end gap-6 bg-gradient-to-b from-[#5038a0] to-[#2a1f5a] px-4 pt-24 pb-6 md:px-8">
        <div className="grid size-44 shrink-0 place-items-center rounded bg-gradient-to-br from-[#450af5] to-[#c4efd9] shadow-2xl md:size-56">
          <Heart className="size-20 fill-white text-white" />
        </div>
        <div>
          <p className="text-sm font-bold">Playlist</p>
          <h1 className="my-2 text-4xl font-black tracking-tighter md:text-7xl lg:text-8xl">Lagu yang Disukai</h1>
          <p className="text-sm">
            <strong>{user?.display_name}</strong> · {tracks.length} lagu
          </p>
        </div>
      </header>
      <div className="bg-gradient-to-b from-[#2a1f5a]/60 to-transparent">
        <ActionBar>{tracks.length > 0 && <PlayFab size="lg" onClick={() => playQueue(tracks.map(trackToPlayable))} />}</ActionBar>
        {q.isLoading && <PageLoader />}
        {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
        {!q.isLoading && !tracks.length && <EmptyState title="Lagu yang kamu sukai akan muncul di sini" body="Simpan lagu dengan mengetuk ikon hati." icon={<Heart className="size-12" />} />}
        {tracks.length > 0 && <TrackTable tracks={tracks} />}
      </div>
    </div>
  );
}
