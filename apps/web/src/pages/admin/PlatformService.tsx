import type { ComponentType } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Construction, Power } from 'lucide-react';
import { SETTINGS_BY_KEY } from '@rave/domain/settings';
import { RAVE_SERVICES } from '@/lib/raveServices';
import { api } from '@/lib/api';
import type { SettingsResponse } from '@/lib/types';
import { useDict } from '@/lib/i18n';
import { Badge, Card, cx, PageHeader } from '@/components/ui';
import { SettingsEditor } from './PlatformSettings';
import { ServiceReport } from './ServiceReport';

type ServicesDict = ReturnType<typeof useDict<'admin'>>['services'];

/** Tab Laporan untuk layanan yang endpoint laporannya belum ada: jujur "segera hadir" + metrik yang direncanakan. */
function ReportSoon({ id, t }: { id: string; t: ServicesDict }) {
  const planned = (t.reportPlanned as Record<string, readonly string[] | undefined>)[id] ?? [];
  return (
    <div className="rounded-none border border-dashed border-b2b-line bg-b2b-card px-6 py-10">
      <div className="mx-auto max-w-xl text-center">
        <BarChart3 className="mx-auto size-8 text-b2b-muted" aria-hidden />
        <h3 className="mt-3 font-bold text-b2b-ink">{t.reportSoon.title}</h3>
        <p className="mt-1 text-sm text-b2b-muted">{t.reportSoon.body}</p>
      </div>
      {planned.length > 0 && (
        <div className="mx-auto mt-6 max-w-xl">
          <p className="text-xs font-bold tracking-wider text-b2b-muted uppercase">{t.reportSoon.planned}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {planned.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Ringkasan rollout Unduhan Offline (P-7) di kepala halaman: saklar induk, allowlist, paket & batas. Membaca cache
 * `platform-settings` yang sama dengan editor → ikut berubah begitu Super Admin menyimpan.
 */
function DownloadsRollout({ t }: { t: ServicesDict }) {
  const r = t.rollout;
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<SettingsResponse>('/v1/admin/platform/settings') });
  const v = <T,>(k: string) => (q.data?.values[k] ?? SETTINGS_BY_KEY[k]!.default) as T;
  if (q.isLoading) return <div className="mb-6 h-[92px] animate-pulse border border-b2b-line bg-b2b-card" aria-hidden />;
  if (q.error && !q.data) return <p className="mb-6 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">{r.loadFailed}</p>;
  const on = v<boolean>('download.enabled');
  const allow = v<string[]>('download.allow_user_ids');
  const tiers = v<string[]>('download.tiers');
  const tierLabel = (x: string) => SETTINGS_BY_KEY['download.tiers']!.options?.find((o) => o.value === x)?.label ?? x;
  return (
    <section aria-label={r.title} className="b2b-surface mb-6 border border-b2b-line p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className={cx('grid size-10 shrink-0 place-items-center border-2 border-b2b-ink', on ? 'bg-rave-primary text-rave-ink' : 'bg-b2b-card text-b2b-muted')} aria-hidden>
            <Power className="size-5" />
          </span>
          <div>
            <p className="font-label text-[10.5px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{r.title}</p>
            <Badge tone={on ? 'green' : 'neutral'} className="mt-1">
              {on ? r.on : r.off}
            </Badge>
          </div>
        </div>
        <ul className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <li className={cx('min-w-0 font-bold', allow.length > 0 && 'text-amber-700')}>{allow.length ? r.allowlist(allow.length) : r.everyone}</li>
          <li className="min-w-0">
            <span className="text-b2b-muted">{r.tiers}: </span>
            <span className="font-bold">{tiers.length ? tiers.map(tierLabel).join(', ') : r.noTiers}</span>
          </li>
          <li className="min-w-0 text-b2b-muted sm:col-span-2">{[r.devices(v<number>('subscription.download_devices')), r.perDevice(v<number>('download.max_tracks_per_device')), r.ttl(v<number>('download.license_ttl_days'))].join(' · ')}</li>
        </ul>
      </div>
      {!on && <p className="mt-3 text-sm text-b2b-muted">{r.offHint}</p>}
    </section>
  );
}

/** Ringkasan khusus layanan di kepala halaman (status rollout, dsb.). */
const SUMMARY: Record<string, ComponentType<{ t: ServicesDict }>> = { downloads: DownloadsRollout };

/**
 * Halaman satu layanan RAVE (Super Admin): pengaturan layanan itu sendiri (bukan lagi di Platform → Pengaturan).
 * Layanan yang belum siap menampilkan status "Dalam pengembangan" + rencana, lalu pengaturan yang sudah disiapkan.
 */
export function PlatformService() {
  const { id = '' } = useParams();
  const t = useDict('admin').services;
  const [params, setParams] = useSearchParams();
  const svc = RAVE_SERVICES.find((s) => s.id === id);
  if (!svc) return <Navigate to="/admin/platform" replace />;
  const info = t.items[svc.id as keyof typeof t.items];
  const filter = svc.keys ? (d: { key: string }) => svc.keys!(d.key) : undefined;
  const Icon = svc.icon;
  // Laporan 'soon' (endpoint belum ada) → buka Pengaturan dulu; tab Laporan tetap bisa dipilih.
  const want = params.get('tab');
  const tab = svc.report && want !== 'settings' && (svc.report !== 'soon' || want === 'report') ? 'report' : 'settings';
  const Summary = SUMMARY[svc.id];
  return (
    <div>
      <PageHeader title={info.name} subtitle={info.description} />
      {Summary && <Summary t={t} />}
      {svc.status === 'soon' && (
        <Card className="mb-6">
          <div className="flex flex-col items-start gap-5 p-6 sm:flex-row sm:p-8">
            <span className="grid size-16 shrink-0 place-items-center border-2 border-b2b-ink bg-rave-mustard text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
              <Icon className="size-8" />
            </span>
            <div className="min-w-0 flex-1">
              <Badge tone="amber">
                <Construction className="size-3.5" /> {t.underDevelopment}
              </Badge>
              <h2 className="mt-3 !font-display text-4xl leading-none !font-normal !uppercase">{t.comingSoon}</h2>
              <p className="mt-3 max-w-2xl text-sm text-b2b-muted">{info.plan}</p>
              {!!info.steps.length && (
                <>
                  <p className="mt-6 text-xs font-bold tracking-wider text-b2b-muted uppercase">{t.roadmap}</p>
                  <ol className="mt-2 space-y-1.5 text-sm">
                    {info.steps.map((s, i) => (
                      <li key={s} className="flex gap-3">
                        <span className="grid size-5 shrink-0 place-items-center bg-b2b-ink text-[11px] font-bold text-white">{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </div>
        </Card>
      )}
      {svc.report && (
        <div className="mb-5 flex gap-1 border-b-2 border-b2b-line" role="tablist">
          {(['report', 'settings'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() =>
                setParams(
                  (p) => {
                    p.set('tab', k);
                    return p;
                  },
                  { replace: true },
                )
              }
              className={cx('-mb-0.5 border-b-2 px-4 py-2 text-sm font-bold', tab === k ? 'border-b2b-ink text-b2b-ink' : 'border-transparent text-b2b-muted hover:text-b2b-ink')}
            >
              {k === 'report' ? t.tabReport : t.tabSettings}
            </button>
          ))}
        </div>
      )}
      {tab === 'report' && svc.report === 'soon' ? (
        <ReportSoon id={svc.id} t={t} />
      ) : tab === 'report' && svc.report ? (
        <ServiceReport id={svc.id} />
      ) : (
        <>
          {svc.status === 'soon' && (
            <>
              <h3 className="mb-1 font-bold">{t.preparedSettings}</h3>
              <p className="mb-4 text-sm text-b2b-muted">{t.preparedSettingsHint}</p>
            </>
          )}
          <SettingsEditor key={svc.id} groups={svc.groups} filter={filter} embedded />
        </>
      )}
    </div>
  );
}
