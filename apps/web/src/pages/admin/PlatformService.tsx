import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { RAVE_SERVICES } from '@/lib/raveServices';
import { useDict } from '@/lib/i18n';
import { Badge, Card, cx, PageHeader } from '@/components/ui';
import { SettingsEditor } from './PlatformSettings';
import { ServiceReport } from './ServiceReport';

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
  const tab = svc.report && params.get('tab') !== 'settings' ? 'report' : 'settings';
  return (
    <div>
      <PageHeader title={info.name} subtitle={info.description} />
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
      {tab === 'report' && svc.report ? (
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
