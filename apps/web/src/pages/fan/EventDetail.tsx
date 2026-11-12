import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, Info, MapPin, Minus, Plus, ShieldCheck, Ticket } from 'lucide-react';
import SlideCommit from '@/components/reactbits/SlideCommit';
import { api, fmt } from '@/lib/api';
import type { EventDetail as EventDetailT, Invoice, Order } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { colorFor, DarkError } from '@/components/fan';
import { cx, Modal, PageLoader, toast } from '@/components/ui';
import { EventLiveCard } from '@/components/live/EventLiveCard';
import { setting, usePlatformConfig } from '@/lib/platform';
import { localeTag, useDict } from '@/lib/i18n';
import { returnUrl, useCheckoutInfo } from '@/lib/payment';

const METHODS = ['QRIS', 'VA', 'EWALLET', 'CARD'] as const;

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(until).getTime() - now);
  return <span className={cx('font-mono font-bold tabular-nums', left < 60_000 && 'text-red-400')}>{fmt.duration(left)}</span>;
}

function Checkout({ order, invoice, onClose }: { order: Order; invoice: Invoice; onClose: () => void }) {
  const [method, setMethod] = useState<(typeof METHODS)[number]>('QRIS');
  const d = useDict('fan');
  const nav = useNavigate();
  // Penyedia aktif (Platform → Integrasi): Midtrans → halaman Snap; sandbox → simulasi (dev).
  const gw = useCheckoutInfo(invoice, () => returnUrl(invoice.id, '/app/tickets'));
  async function pay() {
    await api(`/v1/finance/invoices/${invoice.id}/simulate-pay`, { body: { method }, idempotencyKey: `pay-${invoice.id}` });
    // Tiket terbit asinkron (event finance.payment.succeeded → ticketing); tunggu sebentar.
    for (let i = 0; i < 10; i++) {
      const o = await api<Order>(`/v1/ticketing/orders/${order.id}`).catch(() => null);
      if (o?.status === 'PAID') return;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return (
    <div className="space-y-5">
      <div className="rounded-none bg-black/30 p-4 text-sm">
        {order.items.map((it) => (
          <p key={it.ticket_type_id} className="flex justify-between">
            <span>
              {it.quantity}× {it.name}
            </span>
            <span>{fmt.idr(it.price * it.quantity)}</span>
          </p>
        ))}
        <hr className="my-3 border-white/10" />
        <p className="flex justify-between text-base font-bold">
          <span>{d.event.totalDue}</span>
          <span>{fmt.idr(invoice.amount)}</span>
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-rave-muted">
          <Clock className="size-3.5" /> {d.event.heldFor} <Countdown until={order.reserved_until} />
        </p>
      </div>
      {gw.isLoading ? (
        <p className="py-6 text-center text-sm text-rave-muted">{d.event.preparingPay}</p>
      ) : gw.isError ? (
        <DarkError error={gw.error} retry={() => gw.refetch()} />
      ) : gw.data?.provider === 'midtrans' ? (
        <div className="space-y-3">
          <a
            href={gw.data.redirect_url}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-none bg-rave-primary text-sm font-black text-rave-on-primary transition hover:scale-[1.01]"
          >
            <ShieldCheck className="size-4" /> {d.event.payNow} · {fmt.idr(invoice.amount)}
          </a>
          <p className="text-xs leading-relaxed text-rave-muted">{d.event.gatewayNote}</p>
          {gw.data.mode === 'sandbox' && <p className="text-xs font-bold text-amber-300">{d.event.gatewaySandbox}</p>}
        </div>
      ) : gw.data && !gw.data.simulate ? (
        <p className="border border-white/15 p-4 text-sm text-rave-muted">{d.event.payUnavailable}</p>
      ) : (
      <>
      <fieldset>
        <legend className="mb-2 text-sm font-bold">{d.event.paymentMethod}</legend>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((v) => (
            <button key={v} type="button" onClick={() => setMethod(v)} aria-pressed={method === v} className={cx('rounded-none border px-3 py-2.5 text-sm font-bold', method === v ? 'border-rave-primary bg-rave-primary/10 text-rave-primary-text' : 'border-white/20 hover:border-white/50')}>
              {d.event.methods[v]}
            </button>
          ))}
        </div>
        {method === 'VA' && invoice.va_number && <p className="mt-2 text-xs text-rave-muted">{d.event.vaNumber} <span className="font-mono text-white">{invoice.va_number}</span></p>}
      </fieldset>
      <div className="flex justify-center">
        <SlideCommit
          label={d.event.slideToPay(fmt.idrShort(invoice.amount))}
          doneLabel={d.event.paySuccess}
          errorLabel={d.event.payFailed}
          onConfirm={pay}
          onDone={() => {
            toast.success(d.event.ticketsIssued);
            onClose();
            nav('/app/tickets');
          }}
          onError={(e) => toast.error(e)}
          width={340}
          handleColor="#8A2F3F"
          successColor="#8A2F3F"
        />
      </div>
      <p className="flex items-start gap-2 text-xs text-rave-muted">
        <ShieldCheck className="size-4 shrink-0 text-rave-primary-text" />
        {d.event.sandboxNote}
      </p>
      </>
      )}
    </div>
  );
}

/** Ringkasan kebijakan refund platform (`refund.*`) — ditampilkan sebelum pembeli membayar. */
function RefundPolicyNote() {
  const cfg = usePlatformConfig();
  const d = useDict('fan');
  const buyer = setting<boolean>(cfg, 'refund.buyer_request_enabled', false);
  const pct = setting<number>(cfg, 'refund.buyer_refund_pct', 80);
  const days = setting<number>(cfg, 'refund.buyer_deadline_days', 7);
  const sla = setting<number>(cfg, 'refund.event_cancel_sla_days', 14);
  return (
    <p className="mt-3 text-xs leading-relaxed text-rave-muted">
      {buyer ? d.event.refundBuyer(pct, days) : d.event.refundNoBuyer}
      {d.event.refundPolicy(sla)}
    </p>
  );
}

export default function EventDetail() {
  const { idOrSlug = '', slug } = useParams();
  const key = slug ?? idOrSlug;
  const token = useAuth((s) => s.accessToken);
  const nav = useNavigate();
  const d = useDict('fan');
  const q = useQuery({ queryKey: ['event', key], queryFn: () => api<EventDetailT>(`/v1/ticketing/events/${key}`) });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<{ order: Order; invoice: Invoice } | null>(null);

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const e = q.data;
  const total = e.ticket_types.reduce((s, t) => s + (qty[t.id] ?? 0) * t.price, 0);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const start = new Date(e.starts_at);
  const now = Date.now();

  async function order() {
    if (!token) return nav(`/login?next=${encodeURIComponent(`/app/events/${key}`)}`);
    setBusy(true);
    try {
      const r = await api<{ order: Order; invoice: Invoice }>('/v1/ticketing/orders', {
        body: { event_id: e.id, items: Object.entries(qty).filter(([, n]) => n > 0).map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity })) },
        idempotencyKey: true,
      });
      setCheckout(r);
    } catch (err) {
      toast.error(err);
      q.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full pb-12">
      <header className="relative overflow-hidden px-4 pt-24 pb-10 md:px-8">
        {/* Tanpa poster: gradien lokal deterministik (bukan gambar eksternal). */}
        {e.poster_url ? (
          <img src={e.poster_url} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl" />
        ) : (
          <div className="absolute inset-0 opacity-60" style={{ background: `linear-gradient(135deg, ${colorFor(e.id)}, ${colorFor(e.slug)}66)` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#181818]" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-end">
          {e.poster_url ? (
            <img src={e.poster_url} alt={d.event.poster(e.title)} className="size-56 rounded-none object-cover shadow-2xl md:size-72" />
          ) : (
            <div role="img" aria-label={d.event.poster(e.title)} className="grid size-56 shrink-0 place-items-center rounded-none shadow-2xl md:size-72" style={{ background: `linear-gradient(135deg, ${colorFor(e.id)}, ${colorFor(e.slug)})` }}>
              <Ticket className="size-16 text-white/70" />
            </div>
          )}
          <div>
            <p className="text-sm font-bold">{d.event.kicker}</p>
            <h1 className="my-3 text-4xl font-black tracking-tighter md:text-6xl">{e.title}</h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-white/85">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4" /> {start.toLocaleDateString(localeTag(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" /> {start.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })} {d.event.localTime}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" /> {e.venue_name}, {e.city}
              </span>
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-10 px-4 md:px-8 lg:grid-cols-[3fr_2fr]">
        <div>
          <section className="mb-10">
            <h2 className="mb-4 text-2xl font-bold">{d.event.lineup}</h2>
            <div className="flex flex-wrap gap-3">
              {e.artists.map((a) => (
                <Link key={a.id} to={`/app/artist/${a.id}`} className="rounded-none bg-white/10 px-5 py-2 font-bold hover:bg-white/20">
                  {a.name}
                </Link>
              ))}
            </div>
          </section>
          <section className="mb-10">
            <h2 className="mb-4 text-2xl font-bold">{d.event.about}</h2>
            <p className="leading-relaxed whitespace-pre-line text-rave-muted">{e.description}</p>
          </section>
          <section className="mb-10">
            <h2 className="mb-4 text-2xl font-bold">{d.event.venue}</h2>
            <div className="rounded-none bg-white/5 p-5">
              <p className="font-bold">{e.venue_name}</p>
              <p className="text-sm text-rave-muted">{e.venue_address}</p>
              <a href={`https://www.google.com/maps/search/${encodeURIComponent(`${e.venue_name} ${e.venue_address} ${e.city}`)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-rave-primary-text hover:underline">
                {d.event.openMap}
              </a>
            </div>
          </section>
          {e.rules && (
            <section className="mb-10">
              <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
                <Info className="size-6" /> {d.event.rules}
              </h2>
              <p className="text-sm whitespace-pre-line text-rave-muted">{e.rules}</p>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <EventLiveCard eventId={e.id} />
          <div className="rounded-none bg-rave-elevated p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
              <Ticket className="size-5" /> {d.event.tickets}
            </h2>
            {e.status !== 'PUBLISHED' ? (
              <p className="text-sm text-rave-muted">
                {e.status === 'CANCELLED'
                  ? d.event.cancelled
                  : e.status === 'COMPLETED'
                    ? d.event.completed
                    : d.event.notOnSale}
              </p>
            ) : (
            <>
            {!e.ticket_types.length && <p className="text-sm text-rave-muted">{d.event.notOnSale}</p>}
            <ul className="space-y-3">
              {e.ticket_types.map((t) => {
                const n = qty[t.id] ?? 0;
                const notYet = t.sale_starts_at && new Date(t.sale_starts_at).getTime() > now;
                const soldOut = t.remaining <= 0;
                const max = Math.min(t.max_per_account, t.remaining);
                return (
                  <li key={t.id} className="rounded-none border border-white/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">
                          {t.name}
                          {t.presale && <span className="ml-2 rounded-none bg-rave-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-rave-primary-text uppercase">{d.event.presale}</span>}
                        </p>
                        <p className="text-sm">{fmt.idr(t.price)}</p>
                        <p className="text-xs text-rave-muted">
                          {soldOut ? d.event.soldOut : notYet ? d.event.opens(fmt.dateTime(t.sale_starts_at)) : d.event.remaining(fmt.num(t.remaining), t.max_per_account)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button aria-label={d.event.decrease(t.name)} disabled={!n} onClick={() => setQty({ ...qty, [t.id]: n - 1 })} className="grid size-8 place-items-center rounded-full border border-white/30 disabled:opacity-30">
                          <Minus className="size-4" />
                        </button>
                        <span className="w-5 text-center font-bold tabular-nums" aria-live="polite">
                          {n}
                        </span>
                        <button aria-label={d.event.increase(t.name)} disabled={soldOut || !!notYet || n >= max} onClick={() => setQty({ ...qty, [t.id]: n + 1 })} className="grid size-8 place-items-center rounded-full border border-white/30 disabled:opacity-30">
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-sm text-rave-muted">{d.event.ticketCount(count)}</span>
              <span className="text-lg font-black">{fmt.idr(total)}</span>
            </div>
            <button disabled={!count || busy} onClick={order} className="mt-4 w-full rounded-none bg-rave-primary py-3.5 font-bold text-rave-on-primary transition hover:scale-[1.02] disabled:opacity-40">
              {busy ? d.event.holding : token ? d.event.buy : d.event.signInToBuy}
            </button>
            <RefundPolicyNote />
            </>
            )}
          </div>
        </aside>
      </div>

      <Modal open={!!checkout} onClose={() => setCheckout(null)} title={d.event.payment} theme="dark">
        {checkout && <Checkout {...checkout} onClose={() => setCheckout(null)} />}
      </Modal>
    </div>
  );
}
