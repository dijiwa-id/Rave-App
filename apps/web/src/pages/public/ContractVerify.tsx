import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { setting, usePlatformConfig } from '@/lib/platform';
import { Badge, PageLoader } from '@/components/ui';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { useDict } from '@/lib/i18n';

/** Respons publik GET /v1/booking/verify/:id — tanpa data sensitif. */
interface VerifyResult {
  contract_no: string | null;
  version: number;
  status: string;
  status_label: string;
  document: 'DRAFT' | 'FINAL';
  sha256: string;
  draft_sha256: string | null;
  final_sha256: string | null;
  final_rendered_at: string | null;
  template_version: string;
  event: { name: string; date: string } | null;
  parties: { promotor: string; management: string; artist: string } | null;
  signatures: { party: string; signed_at: string; method?: string | null }[];
  created_at: string;
  signed_at: string | null;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Halaman verifikasi publik kontrak (`/verify/:contractId`) — tujuan QR di setiap halaman PDF kontrak.
 * Menampilkan status & SHA-256 (draf yang ditandatangani + final), dan memeriksa berkas PDF secara lokal (tidak diunggah).
 * Legalitas platform hanya tampil untuk kolom `legal.*` yang diisi Super Admin.
 */
export default function ContractVerify() {
  const { contractId = '' } = useParams();
  const d = useDict('b2b').booking;
  const t = d.verifyPage;
  const cfg = usePlatformConfig();
  const [check, setCheck] = useState<{ name: string; which: string | null } | null>(null);
  const q = useQuery({
    queryKey: ['contract-verify', contractId],
    queryFn: () => api<VerifyResult>(`/v1/booking/verify/${encodeURIComponent(contractId)}`, { auth: false }),
    retry: false,
  });
  const legal = {
    entity: setting<string>(cfg, 'legal.entity_name', '').trim(),
    nib: setting<string>(cfg, 'legal.nib', '').trim(),
    npwp: setting<string>(cfg, 'legal.npwp', '').trim(),
    address: setting<string>(cfg, 'legal.address', '').trim(),
    pse: setting<string>(cfg, 'legal.pse_registration', '').trim(),
    psre: setting<string>(cfg, 'legal.psre_name', '').trim(),
    logos: [setting<string>(cfg, 'legal.pse_logo', ''), setting<string>(cfg, 'legal.psre_logo', '')].filter((u) => u.startsWith('/v1/platform/branding/')),
  };
  const hasLegal = !!(legal.entity || legal.nib || legal.npwp || legal.address || legal.pse || legal.psre || legal.logos.length);

  async function onFile(f: File | undefined) {
    if (!f || !q.data) return;
    const h = await sha256Hex(f);
    const which = h === q.data.final_sha256 ? t.docFinal : h === q.data.draft_sha256 ? t.docDraft : null;
    setCheck({ name: f.name, which });
  }

  const v = q.data;
  return (
    <div className="min-h-full bg-b2b-bg text-b2b-ink">
      <header className="flex items-center justify-between border-b border-b2b-line bg-b2b-card px-4 py-4 md:px-8">
        <Link to="/" aria-label="RAVE">
          <RaveLogo dark className="h-8" />
        </Link>
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-b2b-muted">
          <ShieldCheck className="size-4" /> {t.title}
        </span>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t.title}</h1>
          <p className="mt-1 text-sm text-b2b-muted">{t.subtitle}</p>
        </div>
        {q.isLoading && <PageLoader />}
        {q.isError && <div className="border border-dashed border-b2b-line bg-b2b-card px-6 py-10 text-center text-sm">{t.notFound}</div>}
        {v && (
          <>
            <section className="border border-b2b-line bg-b2b-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={v.document === 'FINAL' ? 'green' : 'amber'}>{v.document === 'FINAL' ? t.docFinal : t.docDraft}</Badge>
                <span className="text-sm text-b2b-muted">{v.status_label}</span>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Row k={t.contractNo} v={<span className="font-mono">{v.contract_no ?? '-'}</span>} />
                <Row k={t.version} v={`${v.version} · ${v.template_version}`} />
                {v.event && <Row k={t.event} v={`${v.event.name} · ${fmt.date(v.event.date, { day: 'numeric', month: 'long', year: 'numeric' })}`} />}
                {v.parties && <Row k={t.parties} v={`${v.parties.promotor} · ${v.parties.management} · ${v.parties.artist}`} />}
              </dl>
              <div className="mt-4 space-y-3 border-t border-b2b-line pt-4">
                {v.final_sha256 && <Hash label={t.finalSha} sha={v.final_sha256} />}
                {v.draft_sha256 && <Hash label={t.draftSha} sha={v.draft_sha256} />}
              </div>
            </section>

            <section className="border border-b2b-line bg-b2b-card p-5">
              <h2 className="font-bold">{t.signatures}</h2>
              {v.signatures.length === 0 ? (
                <p className="mt-2 text-sm text-b2b-muted">{t.noSignatures}</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {v.signatures.map((s) => (
                    <li key={s.party} className="flex flex-wrap gap-x-2">
                      <CheckCircle2 className="mt-0.5 size-4 text-green-600" />
                      <b>{(d.party as Record<string, string>)[s.party] ?? s.party}</b>
                      <span className="text-b2b-muted">{fmt.dateTime(s.signed_at)}{s.method ? ` · ${s.method}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border border-b2b-line bg-b2b-card p-5">
              <h2 className="font-bold">{t.checkFile}</h2>
              <p className="mt-1 text-sm text-b2b-muted">{t.howTo}</p>
              <input type="file" accept="application/pdf,.pdf" className="mt-3 block w-full text-sm" onChange={(e) => void onFile(e.target.files?.[0])} />
              {check && (
                <p className={`mt-3 flex items-start gap-2 text-sm font-semibold ${check.which ? 'text-green-700' : 'text-red-700'}`}>
                  {check.which ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                  <span className="break-all">
                    {check.name}: {check.which ? t.match(check.which) : t.noMatch}
                  </span>
                </p>
              )}
            </section>
          </>
        )}
        {hasLegal && (
          <footer className="border-t border-b2b-line pt-4 text-xs text-b2b-muted">
            <p className="font-semibold uppercase tracking-wide">{t.legal}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {legal.entity && <span className="font-semibold text-b2b-ink">{legal.entity}</span>}
              {legal.nib && <span>NIB {legal.nib}</span>}
              {legal.npwp && <span>NPWP {legal.npwp}</span>}
              {legal.pse && <span>PSE {legal.pse}</span>}
              {legal.psre && <span>PSrE {legal.psre}</span>}
              {legal.address && <span>{legal.address}</span>}
              {legal.logos.map((u) => (
                <img key={u} src={u} alt="" className="h-7 w-auto" />
              ))}
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-b2b-muted">{k}</dt>
      <dd className="mt-0.5">{v}</dd>
    </div>
  );
}

function Hash({ label, sha }: { label: string; sha: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-b2b-muted">{label}</p>
      <code className="font-mono text-xs break-all">{sha}</code>
    </div>
  );
}
