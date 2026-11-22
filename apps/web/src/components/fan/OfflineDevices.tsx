import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, Globe, Laptop, Smartphone, Sparkles } from 'lucide-react';
import { SETTINGS_BY_KEY } from '@rave/domain/settings';
import type { DevicePlatform, OfflineDenyCode } from '@rave/domain/offline';
import { api, fmt } from '@/lib/api';
import { setting, usePlatformConfig } from '@/lib/platform';
import { deviceSlots, offlineAvailability, offlineDenyCode, offlineErrorText, type OfflineDevice, type OfflineDevicesResponse } from '@/lib/offline';
import { useAuth } from '@/stores/auth';
import { useDict } from '@/lib/i18n';
import { Button, confirmDialog, cx, Skeleton, toast } from '@/components/ui';

/** Query key bersama (invalidasi setelah cabut perangkat). */
export const OFFLINE_DEVICES_KEY = ['me-devices'] as const;
const OFFLINE_GATE_KEY = ['offline-gate'] as const;

const PLATFORM_ICON: Record<DevicePlatform, typeof Laptop> = { desktop: Laptop, android: Smartphone, ios: Smartphone, web: Globe };
const num = (cfg: ReturnType<typeof usePlatformConfig>, key: string) => setting<number>(cfg, key, SETTINGS_BY_KEY[key]!.default as number);
const LINK = 'inline-flex min-h-11 items-center gap-1.5 font-bold text-rave-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rave-primary';

/**
 * Pengaturan fan → "Perangkat & unduhan" (P-7, docs/API.md §12). Web fase 1 tidak menyimpan unduhan: panel ini
 * menjelaskan status hak, mengarahkan ke aplikasi desktop/mobile, dan mengelola perangkat terdaftar (cabut).
 */
export function OfflineDevices() {
  const s = useDict('fan').settings.offline;
  const qc = useQueryClient();
  const user = useAuth((x) => x.user);
  const cfg = usePlatformConfig();
  const enabled = cfg ? setting<boolean>(cfg, 'download.enabled', false) : undefined;
  const tiers = setting<string[]>(cfg, 'download.tiers', SETTINGS_BY_KEY['download.tiers']!.default as string[]);

  const devices = useQuery({ queryKey: OFFLINE_DEVICES_KEY, queryFn: () => api<OfflineDevicesResponse>('/v1/me/devices'), staleTime: 30_000 });
  // Probe saklar + rollout di server (allowlist tidak publik): `GET /v1/offline/licenses` hanya di-gate offlineGate.
  // Hanya dipanggil bila fitur aktif agar akun biasa tidak memicu 403 saat fitur mati.
  const gate = useQuery({
    queryKey: [...OFFLINE_GATE_KEY, user?.id],
    queryFn: () =>
      api('/v1/offline/licenses', { query: { limit: 1 } }).then(
        () => null,
        (e: unknown) => {
          const code = offlineDenyCode(e);
          if (code) return code;
          throw e;
        },
      ),
    enabled: enabled === true && !!user,
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Galat jaringan pada probe: jangan blokir — anggap lolos & biarkan aplikasi yang memutuskan saat mengunduh.
  const gateCode: OfflineDenyCode | null | undefined = enabled === false ? null : gate.isError ? null : gate.data;
  const status = offlineAvailability({ enabled, tiers, premium: !!user?.premium, memberType: user?.member_type, gate: gateCode });

  const [busy, setBusy] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: (d: OfflineDevice) => api<OfflineDevice>(`/v1/me/devices/${d.id}`, { method: 'DELETE' }),
    onSuccess: (_r, d) => toast.success(s.revoked(d.name)),
    onError: (e) => toast.error(offlineErrorText(e, s.errors, s.loadFailed)),
    onSettled: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: OFFLINE_DEVICES_KEY });
      qc.invalidateQueries({ queryKey: OFFLINE_GATE_KEY });
    },
  });
  async function askRevoke(d: OfflineDevice) {
    if (busy) return;
    const ok = await confirmDialog({ title: s.revokeTitle(d.name), body: s.revokeBody, confirmLabel: s.revokeConfirm, danger: true, detail: `${s.platforms[d.platform] ?? d.platform}${d.app_version ? ` · ${s.version(d.app_version)}` : ''}` });
    if (!ok) return;
    setBusy(d.id);
    revoke.mutate(d);
  }

  const list = devices.data?.data ?? [];
  const limit = devices.data?.limit ?? num(cfg, 'subscription.download_devices');
  const activeCount = devices.data?.active ?? list.length;
  const slots = deviceSlots(activeCount, limit);

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-rave-muted">{s.intro}</p>

      {/* Status hak — "segera hadir" untuk fitur mati/rollout, bukan galat. */}
      <div aria-live="polite" className={cx('border-l-2 px-4 py-3', status === 'ready' ? 'border-rave-primary bg-rave-primary/10' : 'border-white/25 bg-white/[0.04]')}>
        {status === 'unknown' ? (
          <p className="text-sm text-rave-muted">{s.checking}</p>
        ) : (
          <>
            <p className="flex items-center gap-2 font-bold text-white">
              {status === 'ready' ? <Download className="size-4 shrink-0 text-rave-primary-text" /> : status === 'disabled' || status === 'rollout' ? <Clock className="size-4 shrink-0 text-rave-muted" /> : <Sparkles className="size-4 shrink-0 text-rave-primary-text" />}
              {s.status[status][0]}
            </p>
            <p className="mt-1 text-sm text-rave-muted">{status === 'ready' ? s.readyLimits(limit, num(cfg, 'download.max_tracks_per_device'), num(cfg, 'download.license_ttl_days')) : s.status[status][1]}</p>
            <div className="mt-1 flex flex-wrap gap-x-5">
              {(status === 'premium_required' || status === 'tier_not_allowed') && (
                <Link to="/premium" className={LINK}>
                  {s.premiumCta}
                </Link>
              )}
              {status === 'ready' && (
                <Link to="/unduh" className={LINK}>
                  <Download className="size-4" /> {s.getApp}
                </Link>
              )}
            </div>
          </>
        )}
      </div>

      {/* Perangkat terdaftar */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="font-bold text-white">{s.devicesTitle}</h3>
          {devices.data && (
            <span className={cx('font-label text-sm font-bold tabular-nums', slots.full ? 'text-rave-primary-text' : 'text-rave-muted')}>
              <span aria-hidden>{slots.label}</span>
              <span className="sr-only">{s.slotsAria(activeCount, limit)}</span>
            </span>
          )}
        </div>

        {devices.isLoading ? (
          <ul className="divide-y divide-white/[0.07] border border-white/10" aria-busy>
            {[0, 1].map((i) => (
              <li key={i} className="flex min-h-[72px] items-center gap-3 px-4 py-3">
                <Skeleton className="size-10 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : devices.error && !devices.data ? (
          <div role="alert" className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
            <p className="font-semibold text-red-400">{s.loadFailed}</p>
            <p className="mt-1 text-rave-muted">{offlineErrorText(devices.error, s.errors, '')}</p>
            <Button variant="outline" size="sm" className="mt-3 h-11" loading={devices.isFetching} onClick={() => devices.refetch()}>
              {s.retry}
            </Button>
          </div>
        ) : list.length === 0 ? (
          <div className="border border-dashed border-white/15 px-4 py-6 text-center">
            <p className="font-bold text-white">{s.emptyTitle}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-rave-muted">{s.emptyBody}</p>
            <Link to="/unduh" className={cx(LINK, 'mt-1 justify-center')}>
              <Download className="size-4" /> {s.getApp}
            </Link>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-white/[0.07] border border-white/10">
              {list.map((d) => {
                const Icon = PLATFORM_ICON[d.platform] ?? Smartphone;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="grid size-10 shrink-0 place-items-center border-2 border-rave-ink bg-rave-purple text-rave-paper" aria-hidden>
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-bold text-white" title={d.name}>
                          {d.name}
                        </span>
                        <span className="rave-label shrink-0 border border-rave-primary/60 px-1.5 py-0.5 !text-[9.5px] text-rave-primary-text">{s.active}</span>
                      </p>
                      <p className="text-sm text-rave-muted">
                        {s.platforms[d.platform] ?? d.platform}
                        {d.app_version && ` · ${s.version(d.app_version)}`}
                      </p>
                      <p className="text-xs text-rave-subtle">{d.last_seen_at ? s.lastSeen(fmt.dateTime(d.last_seen_at)) : s.added(fmt.dateTime(d.created_at))}</p>
                    </div>
                    <Button variant="outline" className="h-11 shrink-0" loading={busy === d.id} disabled={!!busy && busy !== d.id} onClick={() => void askRevoke(d)} aria-label={s.revokeAria(d.name)}>
                      {s.revoke}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {slots.full && <p className="mt-2 text-sm text-rave-muted">{s.full}</p>}
          </>
        )}
      </div>
    </div>
  );
}
