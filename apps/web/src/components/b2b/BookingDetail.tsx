import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, FileSignature, Lock, MessageSquare, ShieldCheck } from 'lucide-react';
import HoldButton from '@/components/reactbits/HoldButton';
import PeekRating from '@/components/reactbits/PeekRating';
import { api, fmt } from '@/lib/api';
import type { Booking, Contract, EscrowStatus } from '@/lib/types';
import { Badge, Button, Card, cx, ErrorState, Field, Input, Modal, PageLoader, Textarea, toast } from '@/components/ui';
import { BookingStatusBadge, bookingStatusLabel, categoryLabel, formatLabel, SimpleMarkdown } from './common';
import { PayInvoice } from './PayInvoice';
import type { BookingStatus } from '@rave/domain/booking';
import { expectedSigner, type ContractStatus } from '@rave/domain/contract';
import { useDict } from '@/lib/i18n';

const HAPPY: BookingStatus[] = ['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT', 'SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'SHOW_DAY', 'COMPLETED', 'SETTLED'];
const POST_SIGN: string[] = ['SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK'];
const RATING_KEYS = {
  promotor: ['ketepatan_waktu', 'kualitas_penampilan', 'profesionalisme', 'kepatuhan_rider'],
  management: ['ketepatan_bayar', 'kualitas_produksi', 'hospitality', 'komunikasi'],
} as const;

/** Respons GET /v1/booking/contracts/:id/preview-url (signed URL privat berbatas waktu). */
interface ContractPreview {
  url: string;
  expires_in: number;
  kind: 'DRAFT' | 'FINAL';
  sha256: string;
  draft_sha256: string | null;
  final_sha256: string | null;
  final_pending?: boolean;
  contract_no: string | null;
  version: number;
  status: string;
  status_label: string;
  verify_path: string;
  filename: string;
}

/** Kontrak lama (templat booking-v1, tanpa PDF) — tetap ditampilkan sebagai teks. */
const isLegacyContract = (k: Contract) => k.template_version === 'booking-v1' || ['SENT', 'SIGNED', 'VOID'].includes(k.status);

/** Signed URL PDF kontrak. Di-cache < TTL agar tidak membuat jejak audit "view" berulang; final yang masih dirender dipoll. */
function useContractPreview(k: Contract | null, enabled: boolean, kind: 'AUTO' | 'DRAFT' = 'AUTO') {
  return useQuery({
    queryKey: ['contract-preview', k?.id, kind, k?.status],
    queryFn: () => api<ContractPreview>(`/v1/booking/contracts/${k!.id}/preview-url`, { query: { kind: kind === 'DRAFT' ? 'DRAFT' : undefined } }),
    enabled: !!k && enabled && !!k.pdf_ready && !isLegacyContract(k),
    staleTime: 4 * 60_000,
    refetchInterval: (q) => (q.state.data?.final_pending ? 5_000 : 4 * 60_000),
    retry: 1,
  });
}

function ShaLine({ label, sha }: { label: string; sha: string }) {
  const d = useDict('b2b').booking.contractDoc;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-b2b-muted">{label}</p>
      <div className="mt-0.5 flex items-start gap-2">
        <code className="min-w-0 flex-1 font-mono text-[11px] break-all">{sha}</code>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-b2b-muted hover:text-b2b-ink"
          onClick={() => void navigator.clipboard?.writeText(sha).then(() => toast.success(d.copied), () => undefined)}
          aria-label={`${d.copy} ${label}`}
        >
          <Copy className="size-3.5" /> {d.copy}
        </button>
      </div>
    </div>
  );
}

/** Penampil dokumen kontrak: PDF spk-v2 (draf/final) + hash yang ditandatangani + verifikasi publik; kontrak lama = teks. */
function ContractDocument({ contract }: { contract: Contract }) {
  const d = useDict('b2b').booking.contractDoc;
  const [kind, setKind] = useState<'AUTO' | 'DRAFT'>('AUTO');
  const p = useContractPreview(contract, true, kind);
  // Penampil memakai URL pertama per jenis dokumen: penyegaran signed URL (untuk tombol unduh) tidak memuat ulang PDF yang sedang dibaca.
  const [viewer, setViewer] = useState<{ kind: string; url: string } | null>(null);
  useEffect(() => {
    if (p.data && viewer?.kind !== p.data.kind) setViewer({ kind: p.data.kind, url: p.data.url });
  }, [p.data, viewer?.kind]);
  if (isLegacyContract(contract))
    return (
      <div className="space-y-3">
        <div className="border border-b2b-line bg-b2b-bg p-3 text-sm">
          <p className="font-semibold">{d.legacyTitle}</p>
          <p className="mt-1 text-b2b-muted">{d.legacyNote}</p>
          <div className="mt-2"><ShaLine label={d.legacySha} sha={contract.sha256} /></div>
        </div>
        <SimpleMarkdown text={contract.body_markdown} />
      </div>
    );
  if (!contract.pdf_ready) return <Badge tone="amber">{d.notReady}</Badge>;
  if (p.isLoading) return <p className="text-sm text-b2b-muted">{d.loading}</p>;
  if (p.error || !p.data) return <ErrorState error={p.error} retry={() => p.refetch()} />;
  const v = p.data;
  const final = v.kind === 'FINAL';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-b2b-line pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-b2b-muted">{d.title}</p>
          <p className="mt-0.5 font-mono text-sm font-bold break-all">{v.contract_no ?? contract.contract_no ?? contract.id}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={final ? 'green' : 'amber'}>{final ? d.final : d.draft}</Badge>
            <Badge>{d.version(String(v.version))}</Badge>
            <span className="text-xs text-b2b-muted">{v.status_label}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={v.url} download={v.filename} className="inline-flex items-center gap-1.5 border border-b2b-ink px-3 py-1.5 text-sm font-semibold hover:bg-b2b-bg">
            <Download className="size-4" /> {d.download}
          </a>
          <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border border-b2b-line px-3 py-1.5 text-sm hover:border-b2b-ink">
            <ExternalLink className="size-4" /> {d.openPdf}
          </a>
          <a href={v.verify_path} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 border border-b2b-line px-3 py-1.5 text-sm hover:border-b2b-ink">
            <ShieldCheck className="size-4" /> {d.verify}
          </a>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {final ? (
          <>
            <ShaLine label={d.shaFinalLabel} sha={v.sha256} />
            {v.draft_sha256 && <ShaLine label={d.shaSignedDraftLabel} sha={v.draft_sha256} />}
          </>
        ) : (
          <ShaLine label={d.shaDraftLabel} sha={v.sha256} />
        )}
      </div>
      {v.final_pending && <Badge tone="blue">{d.finalPending}</Badge>}
      {(final || kind === 'DRAFT') && v.final_sha256 && (
        <button type="button" className="text-xs font-semibold underline underline-offset-2" onClick={() => setKind(kind === 'DRAFT' ? 'AUTO' : 'DRAFT')}>
          {kind === 'DRAFT' ? d.viewFinal : d.viewSignedDraft}
        </button>
      )}
      <object key={viewer?.url ?? v.url} data={viewer?.url ?? v.url} type="application/pdf" className="h-[70vh] min-h-[420px] w-full border border-b2b-line bg-white" aria-label={d.frameTitle(v.contract_no ?? '')}>
        <div className="grid h-full place-items-center p-6 text-center text-sm text-b2b-muted">
          <p>{d.fallback}</p>
        </div>
      </object>
    </div>
  );
}

/** Ringkas: dokumen & hash yang akan ditandatangani (ditampilkan tepat di atas tombol OTP). */
function SigningTarget({ contract }: { contract: Contract }) {
  const d = useDict('b2b').booking.contractDoc;
  const p = useContractPreview(contract, true);
  if (!p.data || p.data.kind !== 'DRAFT') return null;
  return <p className="w-full border-l-2 border-b2b-ink bg-b2b-bg px-3 py-2 text-xs break-all">{d.signingNote(String(p.data.version), p.data.sha256)}</p>;
}

/** Tanda tangan elektronik: minta OTP ke email akun → masukkan kode → tanda tangan (urutan ditegakkan backend). */
function SignOtp({ contractId, onDone }: { contractId: string; onDone: () => void }) {
  const [sent, setSent] = useState<{ destination_masked: string; expires_in: number; dev_code?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const d = useDict('b2b').booking;
  async function request() {
    setBusy(true);
    try {
      setSent(await api(`/v1/booking/contracts/${contractId}/sign/request-otp`, { body: {} }));
      setCode('');
      toast.success(d.otpSent);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    try {
      await api(`/v1/booking/contracts/${contractId}/sign/verify-otp`, { body: { code } });
      toast.success(d.contractSigned);
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  if (!sent)
    return (
      <Button onClick={request} disabled={busy}>
        {d.requestOtp}
      </Button>
    );
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={d.otpLabel(sent.destination_masked)}>
        <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder={d.otpPlaceholder} />
      </Field>
      <Button onClick={verify} disabled={busy || code.length !== 6}>
        {d.verifySign}
      </Button>
      <Button variant="outline-ink" onClick={request} disabled={busy}>
        {d.resend}
      </Button>
      {sent.dev_code && <span className="text-xs text-b2b-muted">{d.devCode} <b>{sent.dev_code}</b></span>}
    </div>
  );
}

function useAction(id: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(name: string, path: string, body: unknown = {}, opts: { idem?: boolean; ok?: string } = {}) {
    setBusy(name);
    try {
      const r = await api(`/v1/booking/bookings/${id}${path}`, { body, idempotencyKey: opts.idem ? true : undefined });
      await qc.invalidateQueries({ queryKey: ['booking', id] });
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['escrow', id] });
      if (opts.ok) toast.success(opts.ok);
      return r;
    } catch (e) {
      toast.error(e);
      throw e;
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

/** Detail booking bersama untuk Artist Studio & Promotor Hub (REQ-B2B-04/05/06/08/11/12). */
export function BookingDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['booking', id], queryFn: () => api<Booking>(`/v1/booking/bookings/${id}`), refetchInterval: 15_000 });
  const escrow = useQuery({
    queryKey: ['escrow', id],
    queryFn: () => api<EscrowStatus>(`/v1/finance/escrow/${id}`),
    enabled: !!q.data && !['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT', 'DRAFT', 'DECLINED', 'EXPIRED'].includes(q.data.status),
    retry: false,
  });
  const { busy, run } = useAction(id);
  const d = useDict('b2b').booking;
  const partyName = (p: string) => (d.party as Record<string, string>)[p] ?? p;
  const [contractOpen, setContractOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [cancelResult, setCancelResult] = useState<any>(null);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const b = q.data;
  const me = b.my_party;
  const myParty = me === 'admin' ? 'management' : me;
  const latest = b.offers[b.offers.length - 1];
  const negotiable = b.status === 'INQUIRY' || b.status === 'NEGOTIATING';
  const canAccept = negotiable && latest && latest.by_party !== myParty;
  const iSigned = b.signatures.some((s) => s.party === myParty);
  const turn = b.contract ? expectedSigner(b.contract.status as ContractStatus) : null;
  const stepIdx = HAPPY.indexOf(b.status);
  const pendingInvoices = (escrow.data?.invoices ?? []).filter((i) => i.status === 'PENDING');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {b.artist.image_url && <img src={b.artist.image_url} alt="" className="size-16 rounded-none object-cover" />}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{b.event_name || d.fallbackTitle}</h1>
              <BookingStatusBadge status={b.status} />
            </div>
            <p className="mt-1 text-sm text-b2b-muted">
              {b.artist.name} × {b.promotor_org.name} · {fmt.date(b.event_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {b.city}
            </p>
          </div>
        </div>
        {b.hold_expires_at && negotiable && (
          <Badge tone="amber">{d.holdUntil(fmt.dateTime(b.hold_expires_at))}</Badge>
        )}
      </div>

      {/* Progres state machine */}
      <Card>
        <ol className="flex gap-1 overflow-x-auto pb-1" aria-label={d.stagesAria}>
          {HAPPY.map((s, i) => (
            <li key={s} className="min-w-[88px] flex-1">
              <div className={cx('h-1.5 rounded-full', stepIdx >= i ? 'bg-emerald-500' : stepIdx === -1 ? 'bg-stone-200' : 'bg-b2b-bg')} />
              <p className={cx('mt-1.5 text-[11px] leading-tight font-semibold', stepIdx === i ? 'text-b2b-ink' : 'text-b2b-muted')}>{bookingStatusLabel(s)}</p>
            </li>
          ))}
        </ol>
        {stepIdx === -1 && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-600">
            <AlertTriangle className="size-4" /> {bookingStatusLabel(b.status)}
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Aksi utama sesuai status */}
          {b.status === 'CONTRACT_SENT' && (
            <Card title={<span className="flex items-center gap-2"><FileSignature className="size-4" /> {d.contractAwaiting}</span>}>
              <p className="text-sm text-b2b-muted">
                {d.contractAutoNote(String(b.contract?.template_version ?? ''))}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="outline-ink" onClick={() => setContractOpen(true)}>
                  {d.readContract}
                </Button>
                {b.contract?.status === 'SENT' ? (
                  iSigned ? (
                    <Badge tone="green">{d.youSigned}</Badge>
                  ) : (
                    <HoldButton
                      holdTime={1400}
                      backgroundColor="#111111"
                      fillColor="#5B2A6E"
                      textColor="#ffffff"
                      fillTextColor="#000000"
                      doneLabel={d.signed}
                      disabled={busy === 'sign'}
                      onHold={() => void run('sign', '/sign', { signer_name: b.contact.name || d.signerFallback }, { idem: true, ok: d.contractSigned })}
                    >
                      {d.holdToSign}
                    </HoldButton>
                  )
                ) : turn === me ? (
                  b.contract?.pdf_ready ? (
                    <div className="flex w-full flex-col gap-3">
                      <SigningTarget contract={b.contract} />
                      <SignOtp contractId={b.contract.id} onDone={() => { void q.refetch(); }} />
                    </div>
                  ) : (
                    <Badge tone="amber">{d.pdfRendering}</Badge>
                  )
                ) : (
                  <Badge tone="neutral">{turn ? d.waitingFor(partyName(turn)) : d.waiting}</Badge>
                )}
              </div>
              <ul className="mt-3 space-y-1 text-xs text-b2b-muted">
                {b.signatures.map((s) => (
                  <li key={s.party}>
                    ✓ {partyName(s.party)} — {s.signer_name}, {fmt.dateTime(s.signed_at)}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {me === 'promotor' && pendingInvoices.length > 0 && (
            <Card title={d.escrowInvoices}>
              <div className="space-y-3">
                {pendingInvoices.map((inv) => (
                  <PayInvoice key={inv.id} invoice={inv} onPaid={() => q.refetch()} />
                ))}
              </div>
            </Card>
          )}

          {(b.status === 'SHOW_DAY' || b.status === 'BOOKED_AND_SECURED') && (
            <Card title={d.showDay}>
              <p className="text-sm text-b2b-muted">{d.showDayNote}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="ink"
                  disabled={b.show_done[myParty as 'promotor' | 'management'] || b.status !== 'SHOW_DAY'}
                  loading={busy === 'done'}
                  onClick={() => run('done', '/show-done', {}, { ok: d.confirmSaved })}
                >
                  <CheckCircle2 className="size-4" /> {d.showDone}
                </Button>
                <span className="text-xs text-b2b-muted">
                  {d.showDoneState(b.show_done.promotor ? '✓' : '—', b.show_done.management ? '✓' : '—')}
                </span>
                {b.status !== 'SHOW_DAY' && <span className="text-xs text-b2b-muted">{d.availableOnShowDay}</span>}
              </div>
            </Card>
          )}

          {['COMPLETED', 'SETTLED'].includes(b.status) && me !== 'admin' && <RatingCard booking={b} run={run} busy={busy} />}

          {/* Thread negosiasi */}
          <Card title={<span className="flex items-center gap-2"><MessageSquare className="size-4" /> {d.negotiation}</span>}>
            <Thread booking={b} />
            {negotiable && <OfferForm booking={b} run={run} busy={busy} />}
            {negotiable && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-b2b-line pt-4">
                <Button variant="ink" disabled={!canAccept} loading={busy === 'accept'} onClick={() => run('accept', '/accept', {}, { ok: d.acceptedToast })}>
                  {d.acceptOffer(latest ? fmt.idrShort(latest.fee) : '')}
                </Button>
                <Button
                  variant="outline-ink"
                  loading={busy === 'decline'}
                  onClick={() => {
                    const reason = prompt(d.declinePrompt);
                    if (reason) void run('decline', '/decline', { reason }, { ok: d.declinedToast });
                  }}
                >
                  {d.decline}
                </Button>
                {!canAccept && latest && <p className="self-center text-xs text-b2b-muted">{d.awaitingCounterparty}</p>}
                {!latest && <p className="self-center text-xs text-b2b-muted">{d.noOfferYet}</p>}
              </div>
            )}
          </Card>

          <Card title={d.statusHistory}>
            <ol className="space-y-3 border-l-2 border-b2b-line pl-4">
              {b.timeline.map((t, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-b2b-ink" />
                  <p className="font-semibold">{bookingStatusLabel(t.to_status)}</p>
                  <p className="text-xs text-b2b-muted">
                    {fmt.dateTime(t.created_at)} · {t.actor}
                    {t.note ? ` · ${t.note}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card title={d.eventDetails}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
              {[
                [d.date, fmt.date(b.event_date)],
                [d.time, `${b.start_time ?? '—'} · ${d.minutes(b.duration_min)}`],
                [d.venue, b.venue],
                [d.city, b.city],
                [d.capacity, fmt.num(b.capacity)],
                [d.category, categoryLabel(b.category)],
                [d.format, formatLabel(b.format)],
                [d.budget, fmt.idr(b.budget)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-b2b-muted">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {b.notes && <p className="mt-3 rounded-none bg-b2b-bg p-3 text-sm">{b.notes}</p>}
          </Card>

          {b.invoice && (
            <Card title={d.valueBreakdown}>
              <dl className="space-y-1.5 text-sm">
                <Row k={d.artistFee} v={fmt.idr(b.invoice.dp + b.invoice.settlement)} />
                <Row k={d.dp} v={fmt.idr(b.invoice.dp)} />
                <Row k={d.settlement} v={fmt.idr(b.invoice.settlement)} />
                <Row k={d.promotorServiceFee} v={fmt.idr(b.invoice.service_fee)} />
                <Row k={d.promotorTotal} v={fmt.idr(b.invoice.total_promotor)} strong />
                {me !== 'promotor' && <Row k={d.platformCommission} v={`− ${fmt.idr(b.invoice.artist_commission)}`} />}
              </dl>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><ShieldCheck className="size-4" /> {d.escrowAccount}</span>}>
            {escrow.data ? (
              <div className="space-y-2 text-sm">
                <Badge tone={escrow.data.status === 'RELEASED' ? 'green' : escrow.data.status.includes('REFUND') ? 'red' : 'blue'}>{(d.escrow as Record<string, string>)[escrow.data.status] ?? escrow.data.status}</Badge>
                <Row k={d.held} v={fmt.idr(escrow.data.held_amount)} />
                <Row k={d.released} v={fmt.idr(escrow.data.released_amount)} />
                <Row k={d.refunded} v={fmt.idr(escrow.data.refunded_amount)} />
              </div>
            ) : (
              <p className="text-sm text-b2b-muted">{d.escrowInactive}</p>
            )}
          </Card>

          <Card title={d.contact}>
            {b.contact.email?.includes('*') || b.contact.phone?.includes('*') ? (
              <p className="flex items-start gap-2 text-sm text-b2b-muted">
                <Lock className="mt-0.5 size-4 shrink-0" /> {d.contactLocked}
              </p>
            ) : null}
            <p className="mt-2 text-sm font-semibold">{b.contact.name}</p>
            <p className="text-sm text-b2b-muted">{b.contact.email}</p>
            <p className="text-sm text-b2b-muted">{b.contact.phone}</p>
          </Card>

          {b.contract && (
            <Card title={d.contract}>
              <p className="text-xs text-b2b-muted">{d.templateVersion(String(b.contract.template_version))}</p>
              {isLegacyContract(b.contract) ? (
                <p className="mt-1 font-mono text-[11px] break-all text-b2b-muted">SHA-256 {b.contract.sha256}</p>
              ) : (
                b.contract.contract_no && <p className="mt-1 font-mono text-[11px] break-all text-b2b-muted">{b.contract.contract_no} · v{b.contract.version ?? 1}</p>
              )}
              <Button variant="outline-ink" size="sm" className="mt-3" onClick={() => setContractOpen(true)}>
                {d.viewContract}
              </Button>
            </Card>
          )}

          {b.dispute && (
            <Card title={d.dispute}>
              <Badge tone={b.dispute.status === 'OPEN' ? 'red' : 'neutral'}>{b.dispute.status === 'OPEN' ? d.inMediation : d.resolved}</Badge>
              <p className="mt-2 text-sm">{b.dispute.reason}</p>
              {b.dispute.outcome && <p className="mt-1 text-xs text-b2b-muted">{d.decision(String(b.dispute.outcome), String(b.dispute.note ?? ''))}</p>}
            </Card>
          )}

          {me !== 'admin' && (
            <div className="flex flex-col gap-2">
              {POST_SIGN.includes(b.status) && (
                <Button variant="outline-ink" onClick={() => setCancelOpen(true)}>
                  {d.cancelBooking}
                </Button>
              )}
              {[...POST_SIGN, 'SHOW_DAY', 'COMPLETED'].includes(b.status) && !b.dispute && (
                <Button variant="outline-ink" onClick={() => setDisputeOpen(true)}>
                  {d.fileDispute}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={contractOpen} onClose={() => setContractOpen(false)} title={d.contractModal} wide>
        {b.contract ? <ContractDocument contract={b.contract} /> : <p>{d.noContract}</p>}
      </Modal>

      <Modal open={cancelOpen} onClose={() => { setCancelOpen(false); setCancelResult(null); }} title={d.cancelBooking}>
        {cancelResult ? (
          <div className="space-y-2 text-sm">
            <p className="font-bold">{d.cancelled(String(cancelResult.rule))}</p>
            <Row k={d.toArtist} v={fmt.idr(cancelResult.toArtist ?? cancelResult.to_artist)} />
            <Row k={d.refundToPromotor} v={fmt.idr(cancelResult.refundToPromotor ?? cancelResult.refund_to_promotor)} />
            {!!(cancelResult.artistPenalty ?? cancelResult.artist_penalty) && <Row k={d.artistPenalty} v={fmt.idr(cancelResult.artistPenalty ?? cancelResult.artist_penalty)} />}
          </div>
        ) : (
          <CancelForm
            busy={busy === 'cancel'}
            onSubmit={async (reason, fm, evidence, costs) => {
              const r: any = await run('cancel', '/cancel', fm ? { reason, force_majeure: true, evidence, incurred_costs: costs || undefined } : { reason });
              // Klaim force majeure → diteruskan ke mediasi (bukan pembatalan langsung).
              if (r?.force_majeure_claim) {
                toast.success(d.fmClaimSent);
                setCancelOpen(false);
                return;
              }
              setCancelResult(r?.cancellation ?? {});
            }}
          />
        )}
      </Modal>

      <Modal open={disputeOpen} onClose={() => setDisputeOpen(false)} title={d.fileDispute}>
        <DisputeForm
          busy={busy === 'dispute'}
          onSubmit={async (reason) => {
            await run('dispute', '/disputes', { reason }, { ok: d.disputeFiled });
            setDisputeOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between gap-3', strong && 'border-t border-b2b-line pt-1.5 font-extrabold')}>
      <dt className={strong ? '' : 'text-b2b-muted'}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function Thread({ booking: b }: { booking: Booking }) {
  const [body, setBody] = useState('');
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const d = useDict('b2b').booking;
  const items = [
    ...b.offers.map((o) => ({ kind: 'offer' as const, at: o.created_at, o })),
    ...b.messages.map((m) => ({ kind: 'msg' as const, at: m.created_at, m })),
  ].sort((a, z) => a.at.localeCompare(z.at));
  async function send() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await api(`/v1/booking/bookings/${b.id}/messages`, { body: { body } });
      setBody('');
      qc.invalidateQueries({ queryKey: ['booking', b.id] });
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  }
  const mine = (party: string) => party === b.my_party;
  return (
    <div>
      <ul className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {items.length === 0 && <li className="text-sm text-b2b-muted">{d.noConversation}</li>}
        {items.map((it, i) =>
          it.kind === 'offer' ? (
            <li key={i} className={cx('flex', mine(it.o.by_party) ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-none border p-3', mine(it.o.by_party) ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line bg-b2b-bg')}>
                <p className="text-[11px] font-bold tracking-wide uppercase opacity-70">{it.o.by_party === 'promotor' ? d.promotorOffer : d.managementOffer}</p>
                <p className="text-lg font-extrabold">{fmt.idr(it.o.fee)}</p>
                <p className="text-xs opacity-80">
                  {d.offerTerms(it.o.dp_pct, it.o.settlement_days_before)}
                </p>
                {it.o.rider_notes && <p className="mt-1 text-xs opacity-80">{d.rider(it.o.rider_notes)}</p>}
                {it.o.message && <p className="mt-1 text-sm">{it.o.message}</p>}
                <p className="mt-1 text-[10px] opacity-60">{fmt.dateTime(it.o.created_at)}</p>
              </div>
            </li>
          ) : (
            <li key={i} className={cx('flex', mine(it.m.by_party) ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-none px-3.5 py-2 text-sm', mine(it.m.by_party) ? 'bg-emerald-50' : 'bg-b2b-bg')}>
                <p className="text-[11px] font-bold text-b2b-muted">{it.m.author_name}</p>
                <p className="whitespace-pre-wrap">{it.m.body}</p>
                <p className="mt-0.5 text-[10px] text-b2b-muted">{fmt.dateTime(it.m.created_at)}</p>
              </div>
            </li>
          ),
        )}
      </ul>
      <div className="mt-3 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} placeholder={d.messagePlaceholder} />
        <Button variant="ink" loading={sending} onClick={send}>
          {d.send}
        </Button>
      </div>
    </div>
  );
}

function OfferForm({ booking: b, run, busy }: { booking: Booking; run: ReturnType<typeof useAction>['run']; busy: string | null }) {
  const last = b.offers[b.offers.length - 1];
  const [open, setOpen] = useState(false);
  const d = useDict('b2b').booking;
  const c = useDict('b2b').common;
  const [f, setF] = useState({ fee: last?.fee ?? b.budget, dp_pct: last?.dp_pct ?? 50, settlement_days_before: last?.settlement_days_before ?? 7, rider_notes: '', message: '' });
  if (!open)
    return (
      <Button variant="outline-ink" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        {b.offers.length ? d.sendCounter : d.sendOffer}
      </Button>
    );
  return (
    <form
      className="mt-4 grid gap-3 rounded-none border border-b2b-line p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run('offer', '/offers', { ...f, fee: Number(f.fee) }, { idem: true, ok: d.offerSent });
        setOpen(false);
      }}
    >
      <Field label={d.feeRp}>
        <Input type="number" min={0} step={500000} required value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} />
      </Field>
      <Field label={d.dpPct}>
        <Input type="number" min={10} max={100} value={f.dp_pct} onChange={(e) => setF({ ...f, dp_pct: Number(e.target.value) })} />
      </Field>
      <Field label={d.settlementDays}>
        <Input type="number" min={1} max={60} value={f.settlement_days_before} onChange={(e) => setF({ ...f, settlement_days_before: Number(e.target.value) })} />
      </Field>
      <div className="sm:col-span-3">
        <Field label={d.riderNotes}>
          <Input value={f.rider_notes} onChange={(e) => setF({ ...f, rider_notes: e.target.value })} placeholder={d.riderPlaceholder} />
        </Field>
      </div>
      <div className="sm:col-span-3">
        <Field label={d.message}>
          <Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button variant="ink" type="submit" loading={busy === 'offer'}>
          {d.sendOffer}
        </Button>
        <Button variant="outline-ink" type="button" onClick={() => setOpen(false)}>
          {c.cancel}
        </Button>
      </div>
    </form>
  );
}

function RatingCard({ booking: b, run, busy }: { booking: Booking; run: ReturnType<typeof useAction>['run']; busy: string | null }) {
  const keys = RATING_KEYS[b.my_party === 'promotor' ? 'promotor' : 'management'];
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const d = useDict('b2b').booking;
  return (
    <Card title={b.my_party === 'promotor' ? d.rateArtist : d.ratePromotor}>
      {b.rating.mine_submitted ? (
        <div className="text-sm">
          <Badge tone="green">{d.ratingSent}</Badge>
          {b.rating.revealed && b.rating.received ? (
            <div className="mt-3 space-y-1">
              <p className="font-bold">{d.ratingReceived}</p>
              {Object.entries(b.rating.received.scores).map(([k, v]) => (
                <p key={k} className="flex justify-between">
                  <span className="text-b2b-muted">{(d.ratingKeys as Record<string, string>)[k] ?? k.replace(/_/g, ' ')}</span>
                  <span>{'★'.repeat(v)}</span>
                </p>
              ))}
              {b.rating.received.comment && <p className="italic">“{b.rating.received.comment}”</p>}
            </div>
          ) : (
            <p className="mt-2 text-b2b-muted">{d.doubleBlind}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => {
            const label = d.ratingKeys[k];
            return (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{label}</span>
              <PeekRating value={scores[k] ?? 0} onChange={(v) => setScores({ ...scores, [k]: v })} size={24} activeColor="#f59b23" idleColor="#e7e5e4" ariaLabel={label} />
            </div>
            );
          })}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={d.commentOptional} />
          <Button
            variant="ink"
            disabled={keys.some((k) => !scores[k])}
            loading={busy === 'rate'}
            onClick={() => run('rate', '/ratings', { scores, comment: comment || undefined }, { ok: d.ratingThanks })}
          >
            {d.sendRating}
          </Button>
        </div>
      )}
    </Card>
  );
}

function CancelForm({ onSubmit, busy }: { onSubmit: (reason: string, fm: boolean, evidence: string, costs: number) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState('');
  const [fm, setFm] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [costs, setCosts] = useState(0);
  const d = useDict('b2b').booking;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(reason, fm, evidence, costs).catch(() => {});
      }}
    >
      <p className="text-sm text-b2b-muted">
        {d.cancelNote}
      </p>
      <Field label={d.reason}>
        <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fm} onChange={(e) => setFm(e.target.checked)} /> {d.forceMajeure}
      </label>
      {fm && (
        <div className="space-y-3 border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs text-b2b-muted">{d.fmNote}</p>
          <Field label={d.fmEvidence} hint={d.fmEvidenceHint}>
            <Textarea required minLength={20} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <Field label={d.fmCosts} hint={d.fmCostsHint}>
            <Input type="number" min={0} value={costs || ''} onChange={(e) => setCosts(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
      )}
      <Button variant="danger" type="submit" loading={busy} disabled={fm && evidence.trim().length < 20}>
        {fm ? d.fmSubmit : d.confirmCancel}
      </Button>
    </form>
  );
}

function DisputeForm({ onSubmit, busy }: { onSubmit: (reason: string) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState('');
  const d = useDict('b2b').booking;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(reason).catch(() => {});
      }}
    >
      <p className="text-sm text-b2b-muted">{d.disputeNote}</p>
      <Field label={d.problemDesc}>
        <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button variant="danger" type="submit" loading={busy}>
        {d.fileDispute}
      </Button>
    </form>
  );
}

export function BookingList({ side, artistId, orgId, basePath }: { side: 'artist' | 'promotor'; artistId?: string; orgId?: string; basePath: string }) {
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['bookings', side, artistId, orgId, status],
    queryFn: () => api<{ data: import('@/lib/types').BookingSummary[] }>('/v1/booking/bookings', { query: { side, artist_id: artistId, org_id: orgId, status } }),
    enabled: !!(artistId || orgId),
  });
  const d = useDict('b2b').booking;
  const filters = [
    ['', d.filters.all],
    ['INQUIRY', d.filters.INQUIRY],
    ['NEGOTIATING', d.filters.NEGOTIATING],
    ['CONTRACT_SENT', d.filters.CONTRACT_SENT],
    ['BOOKED', d.filters.BOOKED],
    ['BOOKED_AND_SECURED', d.filters.BOOKED_AND_SECURED],
    ['COMPLETED', d.filters.COMPLETED],
  ];
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={cx('rounded-none border px-3 py-1.5 text-xs font-bold', status === v ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line bg-b2b-card text-b2b-muted')}>
            {l}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <div className="rounded-none border border-dashed border-b2b-line bg-b2b-card p-10 text-center text-sm text-b2b-muted">{d.noBookings}</div>
      ) : (
        <ul className="divide-y divide-b2b-line overflow-hidden rounded-none border border-b2b-line bg-b2b-card">
          {q.data.data.map((b) => (
            <li key={b.id}>
              <Link to={`${basePath}/${b.id}`} className="flex flex-wrap items-center gap-4 px-4 py-3.5 hover:bg-b2b-bg/60">
                {b.artist.image_url ? <img src={b.artist.image_url} alt="" className="size-10 rounded-none object-cover" /> : <div className="size-10 rounded-none bg-b2b-bg" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{b.event_name || `${b.artist.name} × ${b.promotor_org.name}`}</p>
                  <p className="truncate text-xs text-b2b-muted">
                    {side === 'artist' ? b.promotor_org.name : b.artist.name} · {fmt.date(b.event_date)} · {b.city} · {categoryLabel(b.category)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold">{fmt.idrShort(b.latest_fee ?? b.budget)}</p>
                  <p className="text-[11px] text-b2b-muted">{b.latest_fee ? d.lastOffer : d.budgetLower}</p>
                </div>
                <BookingStatusBadge status={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
