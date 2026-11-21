import { Link } from 'react-router-dom';
import { Apple, Download as DownloadIcon, Monitor, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui';
import { BTN_PRIMARY } from '@/pages/public/marketing';
import { CompanyPage } from '@/pages/company/shell';
import { useDict } from '@/lib/i18n';
import { fmtSize, useAppDownloads, type AppAsset } from '@/lib/appDownloads';

/** Halaman /unduh: installer Windows & APK Android terbaru dari /downloads/manifest.json (iOS: segera). */
export default function Download() {
  const d = useDict('common').apps;
  const q = useAppDownloads();
  const m = q.data ?? {};
  return (
    <CompanyPage title={d.title}>
      <section className="rave-crumple relative isolate overflow-hidden bg-[radial-gradient(110%_90%_at_80%_0%,#4a1f5c_0,#2a1233_45%,#181818_100%)] px-4 pt-[8.5rem] pb-12 md:pt-[9.5rem]">
        <div className="mx-auto max-w-[82.5rem]">
          <h1 className="text-6xl leading-[0.9] md:text-8xl">{d.title}</h1>
          <p className="mt-5 max-w-xl text-lg text-[#cfc4d8]">{d.subtitle}</p>
        </div>
      </section>
      <section className="px-4 py-14">
        <div className="mx-auto grid max-w-[82.5rem] gap-6 md:grid-cols-3">
          <AppCard
            icon={<Monitor className="size-7" />}
            name={d.windows}
            hint={d.windowsHint}
            version={m.desktop?.version}
            loading={q.isLoading}
            primary={m.desktop?.installer}
            primaryLabel={d.downloadExe}
            secondary={m.desktop?.msi}
            secondaryLabel={d.downloadMsi}
            steps={d.exeSteps}
          />
          <AppCard
            icon={<Smartphone className="size-7" />}
            name={d.android}
            hint={d.androidHint(m.android?.min_android ?? '7.0')}
            version={m.android?.version}
            loading={q.isLoading}
            primary={m.android?.apk}
            primaryLabel={d.downloadApk}
            steps={d.apkSteps}
          />
          <AppCard icon={<Apple className="size-7" />} name={d.ios} hint="App Store" loading={false} primaryLabel="" steps={[]} />
        </div>
        <p className="mx-auto mt-10 max-w-[82.5rem]">
          <Link to="/app" className="font-bold text-rave-primary-text underline decoration-2 underline-offset-4">
            {d.webPlayer} →
          </Link>
        </p>
      </section>
    </CompanyPage>
  );
}

function AppCard(p: {
  icon: ReactNode;
  name: string;
  hint: string;
  version?: string;
  loading: boolean;
  primary?: AppAsset;
  primaryLabel: string;
  secondary?: AppAsset;
  secondaryLabel?: string;
  steps: readonly string[];
}) {
  const d = useDict('common').apps;
  return (
    <article className="flex flex-col border-2 border-rave-ink bg-[#1e1c1f] p-6 shadow-[6px_6px_0_#5B2A6E]">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center border-2 border-rave-ink bg-rave-purple text-rave-paper">{p.icon}</span>
        <div>
          <h2 className="font-display text-3xl leading-none uppercase">{p.name}</h2>
          <p className="mt-1 text-sm text-white/60">{p.hint}</p>
        </div>
      </div>
      {p.primary ? (
        <>
          <p className="mt-5 font-label text-[11px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">
            {p.version && d.version(p.version)} · {fmtSize(p.primary.size)}
          </p>
          <a href={p.primary.url} download={p.primary.file} className={cx(BTN_PRIMARY, 'mt-3 justify-center')}>
            <DownloadIcon className="size-4" /> {p.primaryLabel}
          </a>
          {p.secondary && (
            <a href={p.secondary.url} download={p.secondary.file} className="mt-3 text-sm font-bold text-white/70 underline underline-offset-4 hover:text-rave-paper">
              {p.secondaryLabel} · {fmtSize(p.secondary.size)}
            </a>
          )}
          <p className="mt-6 rave-label !text-[11px] text-white/50">{d.howTo}</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-white/75">
            {p.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-auto pt-6 font-mono text-[10px] break-all text-white/35" title={d.checksum}>
            {d.checksum}: {p.primary.sha256}
          </p>
        </>
      ) : (
        <p className="mt-5 text-sm text-white/55">{p.loading ? '…' : d.unavailable}</p>
      )}
    </article>
  );
}
