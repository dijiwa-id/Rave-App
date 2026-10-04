import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import AnimatedList from '@/components/reactbits/AnimatedList';
import { api, fmt } from '@/lib/api';
import type { Notification, Paged } from '@/lib/types';
import { DarkError, FanPage } from '@/components/fan';
import { Button, EmptyState, PageLoader, toast } from '@/components/ui';

const CAT_LABEL: Record<string, string> = { booking: 'Booking', payment: 'Pembayaran', event: 'Event', release: 'Rilis', system: 'Sistem', social: 'Sosial' };

/** Inbox notifikasi in-app (REQ-NTF-01). */
export default function Notifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<Paged<Notification>>('/v1/notifications', { query: { limit: 50 } }) });
  const items = q.data?.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  async function open(n: Notification) {
    try {
      if (!n.read_at) await api(`/v1/notifications/${n.id}/read`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    } catch {
      /* abaikan */
    }
    if (n.link) nav(n.link);
  }
  async function readAll() {
    try {
      await api('/v1/notifications/read-all', { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    } catch (e) {
      toast.error(e);
    }
  }

  if (q.isLoading) return <PageLoader />;
  return (
    <FanPage>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Notifikasi</h1>
          <p className="mt-1 text-gema-muted">{unread ? `${unread} belum dibaca` : 'Semua sudah dibaca'}</p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={readAll}>
            Tandai semua dibaca
          </Button>
        )}
      </div>
      {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
      {!q.isError && !items.length && <EmptyState icon={<Bell className="size-12" />} title="Belum ada notifikasi" body="Kabar rilis baru, jadwal manggung, dan transaksi akan muncul di sini." />}
      {items.length > 0 && (
        <>
          <AnimatedList
            items={items.map((n) => `${n.read_at ? '' : '● '}${n.title} — ${n.body} · ${CAT_LABEL[n.category] ?? n.category}, ${fmt.dateTime(n.created_at)}`)}
            onItemSelect={(_, i) => open(items[i])}
            showGradients={false}
            enableArrowNavigation
            displayScrollbar
            className="!w-full max-w-3xl [&>div]:!max-h-[65vh] [&>div]:!px-0"
            itemClassName="!bg-gema-elevated hover:!bg-gema-highlight cursor-pointer"
          />
          <p className="mt-3 text-xs text-gema-subtle">Gunakan tombol panah & Enter untuk navigasi keyboard.</p>
        </>
      )}
    </FanPage>
  );
}
