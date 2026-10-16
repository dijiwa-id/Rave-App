import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSignature, Lock, MessageSquare, ShieldCheck } from 'lucide-react';
import HoldButton from '@/components/reactbits/HoldButton';
import PeekRating from '@/components/reactbits/PeekRating';
import { api, fmt } from '@/lib/api';
import type { Booking, EscrowStatus } from '@/lib/types';
import { Badge, Button, Card, cx, ErrorState, Field, Input, Modal, PageLoader, Textarea, toast } from '@/components/ui';
import { BookingStatusBadge, CATEGORY_LABEL, FORMAT_LABEL, SimpleMarkdown } from './common';
import { PayInvoice } from './PayInvoice';
import { BOOKING_STATUS_LABEL, type BookingStatus } from '@gema/domain/booking';

const HAPPY: BookingStatus[] = ['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT', 'SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'SHOW_DAY', 'COMPLETED', 'SETTLED'];
const POST_SIGN: string[] = ['SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK'];
const ESCROW_LABEL: Record<string, string> = {
  AWAITING_DP: 'Menunggu DP',
  DP_RECEIVED: 'DP Diterima',
  PAID_IN_FULL: 'Lunas',
  HELD: 'Ditahan',
  RELEASED: 'Dicairkan',
  REFUNDED: 'Direfund',
  PARTIAL_REFUND: 'Refund sebagian',
};
const RATING_KEYS = {
  promotor: [
    ['ketepatan_waktu', 'Ketepatan waktu'],
    ['kualitas_penampilan', 'Kualitas penampilan'],
    ['profesionalisme', 'Profesionalisme'],
    ['kepatuhan_rider', 'Kepatuhan rider'],
  ],
  management: [
    ['ketepatan_bayar', 'Ketepatan bayar'],
    ['kualitas_produksi', 'Kualitas produksi'],
    ['hospitality', 'Hospitality'],
    ['komunikasi', 'Komunikasi'],
  ],
} as const;

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
  const stepIdx = HAPPY.indexOf(b.status);
  const pendingInvoices = (escrow.data?.invoices ?? []).filter((i) => i.status === 'PENDING');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {b.artist.image_url && <img src={b.artist.image_url} alt="" className="size-16 rounded-xl object-cover" />}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{b.event_name || 'Booking'}</h1>
              <BookingStatusBadge status={b.status} />
            </div>
            <p className="mt-1 text-sm text-b2b-muted">
              {b.artist.name} × {b.promotor_org.name} · {fmt.date(b.event_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {b.city}
            </p>
          </div>
        </div>
        {b.hold_expires_at && negotiable && (
          <Badge tone="amber">Hold berakhir {fmt.dateTime(b.hold_expires_at)}</Badge>
        )}
      </div>

      {/* Progres state machine */}
      <Card>
        <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Tahapan booking">
          {HAPPY.map((s, i) => (
            <li key={s} className="min-w-[88px] flex-1">
              <div className={cx('h-1.5 rounded-full', stepIdx >= i ? 'bg-emerald-500' : stepIdx === -1 ? 'bg-stone-200' : 'bg-b2b-bg')} />
              <p className={cx('mt-1.5 text-[11px] leading-tight font-semibold', stepIdx === i ? 'text-b2b-ink' : 'text-b2b-muted')}>{BOOKING_STATUS_LABEL[s]}</p>
            </li>
          ))}
        </ol>
        {stepIdx === -1 && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-600">
            <AlertTriangle className="size-4" /> {BOOKING_STATUS_LABEL[b.status as BookingStatus] ?? b.status}
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Aksi utama sesuai status */}
          {b.status === 'CONTRACT_SENT' && (
            <Card title={<span className="flex items-center gap-2"><FileSignature className="size-4" /> Kontrak menunggu tanda tangan</span>}>
              <p className="text-sm text-b2b-muted">
                Kontrak digenerate otomatis dari hasil negosiasi (templat {b.contract?.template_version}). Tanda tangan elektronik tersertifikasi melalui PSrE (mode sandbox).
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="outline-ink" onClick={() => setContractOpen(true)}>
                  Baca kontrak
                </Button>
                {iSigned ? (
                  <Badge tone="green">Anda sudah menandatangani</Badge>
                ) : (
                  <HoldButton
                    holdTime={1400}
                    backgroundColor="#111111"
                    fillColor="#DA1C5C"
                    textColor="#ffffff"
                    fillTextColor="#000000"
                    doneLabel="Ditandatangani"
                    disabled={busy === 'sign'}
                    onHold={() => void run('sign', '/sign', { signer_name: b.contact.name || 'Penandatangan' }, { idem: true, ok: 'Kontrak ditandatangani' })}
                  >
                    Tahan untuk tanda tangan
                  </HoldButton>
                )}
              </div>
              <ul className="mt-3 space-y-1 text-xs text-b2b-muted">
                {b.signatures.map((s) => (
                  <li key={s.party}>
                    ✓ {s.party === 'promotor' ? 'Promotor' : 'Manajemen'} — {s.signer_name}, {fmt.dateTime(s.signed_at)}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {me === 'promotor' && pendingInvoices.length > 0 && (
            <Card title="Tagihan escrow">
              <div className="space-y-3">
                {pendingInvoices.map((inv) => (
                  <PayInvoice key={inv.id} invoice={inv} onPaid={() => q.refetch()} />
                ))}
              </div>
            </Card>
          )}

          {(b.status === 'SHOW_DAY' || b.status === 'BOOKED_AND_SECURED') && (
            <Card title="Hari-H">
              <p className="text-sm text-b2b-muted">Konfirmasi "Show Done" dari kedua pihak memindahkan status ke Selesai dan membuka rating. Dana dicairkan H+1 bila tidak ada dispute.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="ink"
                  disabled={b.show_done[myParty as 'promotor' | 'management'] || b.status !== 'SHOW_DAY'}
                  loading={busy === 'done'}
                  onClick={() => run('done', '/show-done', {}, { ok: 'Konfirmasi tersimpan' })}
                >
                  <CheckCircle2 className="size-4" /> Show Done
                </Button>
                <span className="text-xs text-b2b-muted">
                  Promotor {b.show_done.promotor ? '✓' : '—'} · Manajemen {b.show_done.management ? '✓' : '—'}
                </span>
                {b.status !== 'SHOW_DAY' && <span className="text-xs text-b2b-muted">Tersedia pada hari acara.</span>}
              </div>
            </Card>
          )}

          {['COMPLETED', 'SETTLED'].includes(b.status) && me !== 'admin' && <RatingCard booking={b} run={run} busy={busy} />}

          {/* Thread negosiasi */}
          <Card title={<span className="flex items-center gap-2"><MessageSquare className="size-4" /> Negosiasi</span>}>
            <Thread booking={b} />
            {negotiable && <OfferForm booking={b} run={run} busy={busy} />}
            {negotiable && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-b2b-line pt-4">
                <Button variant="ink" disabled={!canAccept} loading={busy === 'accept'} onClick={() => run('accept', '/accept', {}, { ok: 'Disepakati — kontrak sedang digenerate' })}>
                  Terima offer {latest ? fmt.idrShort(latest.fee) : ''}
                </Button>
                <Button
                  variant="outline-ink"
                  loading={busy === 'decline'}
                  onClick={() => {
                    const reason = prompt('Alasan menolak?');
                    if (reason) void run('decline', '/decline', { reason }, { ok: 'Booking ditolak' });
                  }}
                >
                  Tolak
                </Button>
                {!canAccept && latest && <p className="self-center text-xs text-b2b-muted">Menunggu respons pihak lawan atas offer terakhir Anda.</p>}
                {!latest && <p className="self-center text-xs text-b2b-muted">Belum ada offer — kirim offer untuk mulai negosiasi.</p>}
              </div>
            )}
          </Card>

          <Card title="Riwayat status">
            <ol className="space-y-3 border-l-2 border-b2b-line pl-4">
              {b.timeline.map((t, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-b2b-ink" />
                  <p className="font-semibold">{BOOKING_STATUS_LABEL[t.to_status as BookingStatus] ?? t.to_status}</p>
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
          <Card title="Detail acara">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
              {[
                ['Tanggal', fmt.date(b.event_date)],
                ['Jam', `${b.start_time ?? '—'} · ${b.duration_min} mnt`],
                ['Venue', b.venue],
                ['Kota', b.city],
                ['Kapasitas', fmt.num(b.capacity)],
                ['Kategori', CATEGORY_LABEL[b.category] ?? b.category],
                ['Format', FORMAT_LABEL[b.format] ?? b.format],
                ['Budget', fmt.idr(b.budget)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-b2b-muted">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {b.notes && <p className="mt-3 rounded-lg bg-b2b-bg p-3 text-sm">{b.notes}</p>}
          </Card>

          {b.invoice && (
            <Card title="Rincian nilai">
              <dl className="space-y-1.5 text-sm">
                <Row k="Fee artis" v={fmt.idr(b.invoice.dp + b.invoice.settlement)} />
                <Row k="DP" v={fmt.idr(b.invoice.dp)} />
                <Row k="Pelunasan" v={fmt.idr(b.invoice.settlement)} />
                <Row k="Service fee promotor" v={fmt.idr(b.invoice.service_fee)} />
                <Row k="Total dibayar promotor" v={fmt.idr(b.invoice.total_promotor)} strong />
                {me !== 'promotor' && <Row k="Komisi platform (artis)" v={`− ${fmt.idr(b.invoice.artist_commission)}`} />}
              </dl>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><ShieldCheck className="size-4" /> Rekening bersama</span>}>
            {escrow.data ? (
              <div className="space-y-2 text-sm">
                <Badge tone={escrow.data.status === 'RELEASED' ? 'green' : escrow.data.status.includes('REFUND') ? 'red' : 'blue'}>{ESCROW_LABEL[escrow.data.status] ?? escrow.data.status}</Badge>
                <Row k="Ditahan" v={fmt.idr(escrow.data.held_amount)} />
                <Row k="Dicairkan" v={fmt.idr(escrow.data.released_amount)} />
                <Row k="Direfund" v={fmt.idr(escrow.data.refunded_amount)} />
              </div>
            ) : (
              <p className="text-sm text-b2b-muted">Escrow aktif setelah kontrak ditandatangani dan invoice DP terbit.</p>
            )}
          </Card>

          <Card title="Kontak">
            {b.contact.email?.includes('*') || b.contact.phone?.includes('*') ? (
              <p className="flex items-start gap-2 text-sm text-b2b-muted">
                <Lock className="mt-0.5 size-4 shrink-0" /> Kontak pribadi dibuka setelah status BOOKED (DP diterima) untuk melindungi kedua pihak.
              </p>
            ) : null}
            <p className="mt-2 text-sm font-semibold">{b.contact.name}</p>
            <p className="text-sm text-b2b-muted">{b.contact.email}</p>
            <p className="text-sm text-b2b-muted">{b.contact.phone}</p>
          </Card>

          {b.contract && (
            <Card title="Kontrak">
              <p className="text-xs text-b2b-muted">Versi templat {b.contract.template_version}</p>
              <p className="mt-1 font-mono text-[11px] break-all text-b2b-muted">SHA-256 {b.contract.sha256}</p>
              <Button variant="outline-ink" size="sm" className="mt-3" onClick={() => setContractOpen(true)}>
                Lihat kontrak
              </Button>
            </Card>
          )}

          {b.dispute && (
            <Card title="Sengketa">
              <Badge tone={b.dispute.status === 'OPEN' ? 'red' : 'neutral'}>{b.dispute.status === 'OPEN' ? 'Dalam mediasi' : 'Selesai'}</Badge>
              <p className="mt-2 text-sm">{b.dispute.reason}</p>
              {b.dispute.outcome && <p className="mt-1 text-xs text-b2b-muted">Keputusan: {b.dispute.outcome} — {b.dispute.note}</p>}
            </Card>
          )}

          {me !== 'admin' && (
            <div className="flex flex-col gap-2">
              {POST_SIGN.includes(b.status) && (
                <Button variant="outline-ink" onClick={() => setCancelOpen(true)}>
                  Batalkan booking
                </Button>
              )}
              {[...POST_SIGN, 'SHOW_DAY', 'COMPLETED'].includes(b.status) && !b.dispute && (
                <Button variant="outline-ink" onClick={() => setDisputeOpen(true)}>
                  Ajukan sengketa
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={contractOpen} onClose={() => setContractOpen(false)} title="Kontrak Booking" wide>
        {b.contract ? <SimpleMarkdown text={b.contract.body_markdown} /> : <p>Belum ada kontrak.</p>}
      </Modal>

      <Modal open={cancelOpen} onClose={() => { setCancelOpen(false); setCancelResult(null); }} title="Batalkan booking">
        {cancelResult ? (
          <div className="space-y-2 text-sm">
            <p className="font-bold">Booking dibatalkan ({cancelResult.rule})</p>
            <Row k="Ke artis" v={fmt.idr(cancelResult.toArtist ?? cancelResult.to_artist)} />
            <Row k="Refund ke promotor" v={fmt.idr(cancelResult.refundToPromotor ?? cancelResult.refund_to_promotor)} />
            {!!(cancelResult.artistPenalty ?? cancelResult.artist_penalty) && <Row k="Kompensasi dari artis" v={fmt.idr(cancelResult.artistPenalty ?? cancelResult.artist_penalty)} />}
          </div>
        ) : (
          <CancelForm
            busy={busy === 'cancel'}
            onSubmit={async (reason, fm) => {
              const r: any = await run('cancel', '/cancel', { reason, force_majeure: fm });
              setCancelResult(r?.cancellation ?? {});
            }}
          />
        )}
      </Modal>

      <Modal open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Ajukan sengketa">
        <DisputeForm
          busy={busy === 'dispute'}
          onSubmit={async (reason) => {
            await run('dispute', '/disputes', { reason }, { ok: 'Sengketa diajukan — dana dibekukan sampai keputusan mediasi' });
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
        {items.length === 0 && <li className="text-sm text-b2b-muted">Belum ada percakapan.</li>}
        {items.map((it, i) =>
          it.kind === 'offer' ? (
            <li key={i} className={cx('flex', mine(it.o.by_party) ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-xl border p-3', mine(it.o.by_party) ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line bg-b2b-bg')}>
                <p className="text-[11px] font-bold tracking-wide uppercase opacity-70">{it.o.by_party === 'promotor' ? 'Offer promotor' : 'Offer manajemen'}</p>
                <p className="text-lg font-extrabold">{fmt.idr(it.o.fee)}</p>
                <p className="text-xs opacity-80">
                  DP {it.o.dp_pct}% · pelunasan H-{it.o.settlement_days_before}
                </p>
                {it.o.rider_notes && <p className="mt-1 text-xs opacity-80">Rider: {it.o.rider_notes}</p>}
                {it.o.message && <p className="mt-1 text-sm">{it.o.message}</p>}
                <p className="mt-1 text-[10px] opacity-60">{fmt.dateTime(it.o.created_at)}</p>
              </div>
            </li>
          ) : (
            <li key={i} className={cx('flex', mine(it.m.by_party) ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm', mine(it.m.by_party) ? 'bg-emerald-50' : 'bg-b2b-bg')}>
                <p className="text-[11px] font-bold text-b2b-muted">{it.m.author_name}</p>
                <p className="whitespace-pre-wrap">{it.m.body}</p>
                <p className="mt-0.5 text-[10px] text-b2b-muted">{fmt.dateTime(it.m.created_at)}</p>
              </div>
            </li>
          ),
        )}
      </ul>
      <div className="mt-3 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} placeholder="Tulis pesan… (nomor kontak disamarkan sampai BOOKED)" />
        <Button variant="ink" loading={sending} onClick={send}>
          Kirim
        </Button>
      </div>
    </div>
  );
}

function OfferForm({ booking: b, run, busy }: { booking: Booking; run: ReturnType<typeof useAction>['run']; busy: string | null }) {
  const last = b.offers[b.offers.length - 1];
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fee: last?.fee ?? b.budget, dp_pct: last?.dp_pct ?? 50, settlement_days_before: last?.settlement_days_before ?? 7, rider_notes: '', message: '' });
  if (!open)
    return (
      <Button variant="outline-ink" size="sm" className="mt-4" onClick={() => setOpen(true)}>
        {b.offers.length ? 'Kirim counter-offer' : 'Kirim offer'}
      </Button>
    );
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border border-b2b-line p-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run('offer', '/offers', { ...f, fee: Number(f.fee) }, { idem: true, ok: 'Offer terkirim' });
        setOpen(false);
      }}
    >
      <Field label="Fee (Rp)">
        <Input type="number" min={0} step={500000} required value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} />
      </Field>
      <Field label="DP (%)">
        <Input type="number" min={10} max={100} value={f.dp_pct} onChange={(e) => setF({ ...f, dp_pct: Number(e.target.value) })} />
      </Field>
      <Field label="Pelunasan H-">
        <Input type="number" min={1} max={60} value={f.settlement_days_before} onChange={(e) => setF({ ...f, settlement_days_before: Number(e.target.value) })} />
      </Field>
      <div className="sm:col-span-3">
        <Field label="Catatan rider">
          <Input value={f.rider_notes} onChange={(e) => setF({ ...f, rider_notes: e.target.value })} placeholder="mis. backline disediakan promotor" />
        </Field>
      </div>
      <div className="sm:col-span-3">
        <Field label="Pesan">
          <Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button variant="ink" type="submit" loading={busy === 'offer'}>
          Kirim offer
        </Button>
        <Button variant="outline-ink" type="button" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}

function RatingCard({ booking: b, run, busy }: { booking: Booking; run: ReturnType<typeof useAction>['run']; busy: string | null }) {
  const keys = RATING_KEYS[b.my_party === 'promotor' ? 'promotor' : 'management'];
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  return (
    <Card title={b.my_party === 'promotor' ? 'Nilai artis' : 'Nilai promotor'}>
      {b.rating.mine_submitted ? (
        <div className="text-sm">
          <Badge tone="green">Penilaian Anda terkirim</Badge>
          {b.rating.revealed && b.rating.received ? (
            <div className="mt-3 space-y-1">
              <p className="font-bold">Penilaian yang Anda terima</p>
              {Object.entries(b.rating.received.scores).map(([k, v]) => (
                <p key={k} className="flex justify-between">
                  <span className="text-b2b-muted">{k.replace(/_/g, ' ')}</span>
                  <span>{'★'.repeat(v)}</span>
                </p>
              ))}
              {b.rating.received.comment && <p className="italic">“{b.rating.received.comment}”</p>}
            </div>
          ) : (
            <p className="mt-2 text-b2b-muted">Double-blind: penilaian pihak lain dibuka setelah keduanya mengisi atau setelah 14 hari.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{label}</span>
              <PeekRating value={scores[k] ?? 0} onChange={(v) => setScores({ ...scores, [k]: v })} size={24} activeColor="#f59b23" idleColor="#e7e5e4" ariaLabel={label} />
            </div>
          ))}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Komentar (opsional)" />
          <Button
            variant="ink"
            disabled={keys.some(([k]) => !scores[k])}
            loading={busy === 'rate'}
            onClick={() => run('rate', '/ratings', { scores, comment: comment || undefined }, { ok: 'Terima kasih atas penilaiannya' })}
          >
            Kirim penilaian
          </Button>
        </div>
      )}
    </Card>
  );
}

function CancelForm({ onSubmit, busy }: { onSubmit: (reason: string, fm: boolean) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState('');
  const [fm, setFm] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(reason, fm).catch(() => {});
      }}
    >
      <p className="text-sm text-b2b-muted">
        Pengembalian dana dihitung otomatis sesuai matriks pembatalan kontrak (BRD §7.3): pihak yang membatalkan dan jarak hari ke acara menentukan porsi DP/pelunasan yang hangus.
      </p>
      <Field label="Alasan">
        <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fm} onChange={(e) => setFm(e.target.checked)} /> Force majeure (wajib dibuktikan dokumen; diputus tim mediasi)
      </label>
      <Button variant="danger" type="submit" loading={busy}>
        Konfirmasi pembatalan
      </Button>
    </form>
  );
}

function DisputeForm({ onSubmit, busy }: { onSubmit: (reason: string) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(reason).catch(() => {});
      }}
    >
      <p className="text-sm text-b2b-muted">Sengketa diajukan maksimal 24 jam setelah acara. Dana dibekukan; tim GEMA memediasi dengan SLA keputusan 14 hari kerja.</p>
      <Field label="Uraian masalah">
        <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button variant="danger" type="submit" loading={busy}>
        Ajukan sengketa
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
  const filters = [
    ['', 'Semua'],
    ['INQUIRY', 'Inquiry'],
    ['NEGOTIATING', 'Negosiasi'],
    ['CONTRACT_SENT', 'Kontrak'],
    ['BOOKED', 'Booked'],
    ['BOOKED_AND_SECURED', 'Secured'],
    ['COMPLETED', 'Selesai'],
  ];
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={cx('rounded-full border px-3 py-1.5 text-xs font-bold', status === v ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line bg-b2b-card text-b2b-muted')}>
            {l}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <div className="rounded-xl border border-dashed border-b2b-line bg-b2b-card p-10 text-center text-sm text-b2b-muted">Belum ada booking.</div>
      ) : (
        <ul className="divide-y divide-b2b-line overflow-hidden rounded-xl border border-b2b-line bg-b2b-card">
          {q.data.data.map((b) => (
            <li key={b.id}>
              <Link to={`${basePath}/${b.id}`} className="flex flex-wrap items-center gap-4 px-4 py-3.5 hover:bg-b2b-bg/60">
                {b.artist.image_url ? <img src={b.artist.image_url} alt="" className="size-10 rounded-lg object-cover" /> : <div className="size-10 rounded-lg bg-b2b-bg" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{b.event_name || `${b.artist.name} × ${b.promotor_org.name}`}</p>
                  <p className="truncate text-xs text-b2b-muted">
                    {side === 'artist' ? b.promotor_org.name : b.artist.name} · {fmt.date(b.event_date)} · {b.city} · {CATEGORY_LABEL[b.category] ?? b.category}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold">{fmt.idrShort(b.latest_fee ?? b.budget)}</p>
                  <p className="text-[11px] text-b2b-muted">{b.latest_fee ? 'offer terakhir' : 'budget'}</p>
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
