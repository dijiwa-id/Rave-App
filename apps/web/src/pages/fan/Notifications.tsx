import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Bell, CalendarDays, CheckCheck, Disc3, Handshake, Info, Settings2, Users, Wallet, type LucideIcon } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Notification, Paged } from '@/lib/types';
import { DarkError, FanPage } from '@/components/fan';
import { Button, cx, EmptyState, Skeleton, toast } from '@/components/ui';
import { localeTag, useDict } from '@/lib/i18n';

type Filter = 'all' | 'unread';
type Pages = InfiniteData<Paged<Notification>, string | null>;

const ICONS: Record<string, LucideIcon> = {
  booking: Handshake,
  payment: Wallet,
  event: CalendarDays,
  release: Disc3,
  system: Info,
  social: Users,
};

const isExternal = (link: string) => /^https?:\/\//i.test(link);

/** Waktu relatif singkat ("5 mnt lalu"); > 7 hari jatuh ke tanggal WIB. */
function relTime(iso: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  if (abs >= 7 * 86400) return fmt.dateTime(iso);
  const rtf = new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto', style: 'short' });
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** Kunci grup per hari kalender WIB. */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** Inbox notifikasi in-app (REQ-NTF-01). */
export default function Notifications() {
  const nav = useNavigate();
  const d = useDict('fan');
  const t = d.notifications;
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [markingAll, setMarkingAll] = useState(false);

  const key = ['notifications', filter] as const;
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      api<Paged<Notification>>('/v1/notifications', {
        query: { limit: 30, cursor: pageParam ?? undefined, unread: filter === 'unread' ? 'true' : undefined },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  // Jumlah belum dibaca dari server (bukan hanya halaman yang termuat); kunci sama dengan badge header.
  const unreadQ = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number }>('/v1/notifications/unread-count') });
  const unread = unreadQ.data?.unread ?? 0;

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);

  const groups = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86400_000).toISOString());
    const out: { key: 'today' | 'yesterday' | 'earlier'; label: string; items: Notification[] }[] = [];
    for (const n of items) {
      const k = dayKey(n.created_at);
      const key = k === today ? 'today' : k === yesterday ? 'yesterday' : 'earlier';
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(n);
      else out.push({ key, label: t[key], items: [n] });
    }
    return out;
  }, [items, t]);

  /** Tandai dibaca secara optimistis di semua cache notifikasi + badge. */
  function markLocal(ids: Set<string> | 'all') {
    const now = new Date().toISOString();
    qc.setQueriesData<Pages>({ queryKey: ['notifications'] }, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: p.data.map((n) => (!n.read_at && (ids === 'all' || ids.has(n.id)) ? { ...n, read_at: now } : n)),
            })),
          }
        : old,
    );
    qc.setQueryData<{ unread: number }>(['unread'], (old) =>
      old ? { unread: ids === 'all' ? 0 : Math.max(0, old.unread - ids.size) } : old,
    );
  }

  function open(n: Notification) {
    if (!n.read_at) {
      markLocal(new Set([n.id]));
      api(`/v1/notifications/${n.id}/read`, { method: 'POST' })
        .catch(() => undefined)
        .finally(() => {
          qc.invalidateQueries({ queryKey: ['notifications'] });
          qc.invalidateQueries({ queryKey: ['unread'] });
        });
    }
    if (!n.link) return;
    if (isExternal(n.link)) window.open(n.link, '_blank', 'noopener,noreferrer');
    else nav(n.link);
  }

  async function readAll() {
    setMarkingAll(true);
    markLocal('all');
    try {
      await api('/v1/notifications/read-all', { method: 'POST' });
    } catch (e) {
      toast.error(e);
    } finally {
      setMarkingAll(false);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    }
  }

  const filters: { v: Filter; label: string }[] = [
    { v: 'all', label: t.filterAll },
    { v: 'unread', label: unread ? `${t.filterUnread} (${unread})` : t.filterUnread },
  ];

  return (
    <FanPage>
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight">{t.title}</h1>
            <p className="mt-1 text-rave-muted" aria-live="polite">
              {unread ? t.unread(unread) : t.allRead}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <Button variant="outline" size="sm" icon={<CheckCheck />} loading={markingAll} onClick={readAll}>
                {t.markAllRead}
              </Button>
            )}
            <Link
              to="/app/settings#set-notifications"
              aria-label={t.preferences}
              title={t.preferences}
              className="inline-flex size-8 items-center justify-center border-2 border-transparent text-rave-muted hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <Settings2 className="size-4" />
            </Link>
          </div>
        </div>

        <div className="mb-6 flex gap-2" role="tablist" aria-label={t.filterLabel}>
          {filters.map((f) => (
            <button
              key={f.v}
              type="button"
              role="tab"
              aria-selected={filter === f.v}
              onClick={() => setFilter(f.v)}
              className={cx(
                'rounded-none px-4 py-1.5 text-sm font-bold transition',
                filter === f.v ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {q.isLoading && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[76px] w-full bg-white/5" />
            ))}
          </div>
        )}

        {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}

        {q.isSuccess && !items.length && (
          <EmptyState
            icon={<Bell className="size-12" />}
            title={filter === 'unread' ? t.emptyUnread : t.empty}
            body={filter === 'unread' ? undefined : t.emptyBody}
          />
        )}

        {groups.map((g) => (
          <section key={g.key} className="mb-6" aria-labelledby={`notif-${g.key}`}>
            <h2 id={`notif-${g.key}`} className="mb-2 text-xs font-bold tracking-[0.12em] text-rave-subtle uppercase">
              {g.label}
            </h2>
            <ul className="space-y-1.5">
              {g.items.map((n) => {
                const Icon = ICONS[n.category] ?? Bell;
                const unreadItem = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className={cx(
                        'group flex w-full items-start gap-3 rounded-none p-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-white',
                        unreadItem ? 'bg-rave-elevated hover:bg-rave-highlight' : 'bg-white/[0.03] hover:bg-white/[0.07]',
                      )}
                    >
                      <span
                        className={cx(
                          'mt-0.5 flex size-9 shrink-0 items-center justify-center',
                          unreadItem ? 'bg-rave-primary/15 text-rave-primary-text' : 'bg-white/5 text-rave-muted',
                        )}
                        aria-hidden
                      >
                        <Icon className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span className={cx('line-clamp-2 text-sm', unreadItem ? 'font-bold text-white' : 'font-semibold text-white/80')}>
                            {unreadItem && <span className="sr-only">{t.unreadSr} </span>}
                            {n.title}
                          </span>
                          <time dateTime={n.created_at} title={fmt.dateTime(n.created_at)} className="shrink-0 pt-0.5 text-xs text-rave-subtle">
                            {relTime(n.created_at)}
                          </time>
                        </span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-rave-muted">{n.body}</span>}
                        <span className="mt-1.5 block text-[11px] font-bold tracking-[0.08em] text-rave-subtle uppercase">
                          {t.categories[n.category] ?? n.category}
                        </span>
                      </span>
                      {unreadItem && <span className="mt-2 size-2 shrink-0 rounded-full bg-rave-primary" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {q.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              {t.loadMore}
            </Button>
          </div>
        )}
      </div>
    </FanPage>
  );
}
