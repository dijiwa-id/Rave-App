import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, Info, MapPin, Minus, Plus, ShieldCheck, Ticket } from 'lucide-react';
import SlideCommit from '@/components/reactbits/SlideCommit';
import { api, fmt } from '@/lib/api';
import type { EventDetail as EventDetailT, Invoice, Order } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { DarkError } from '@/components/fan';
import { cx, Modal, PageLoader, toast } from '@/components/ui';

const METHODS = [
  ['QRIS', 'QRIS'],
  ['VA', 'Virtual Account'],
  ['EWALLET', 'E-wallet'],
  ['CARD', 'Kartu'],
] as const;

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
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>('QRIS');
  const nav = useNavigate();
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
      <div className="rounded-lg bg-black/30 p-4 text-sm">
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
          <span>Total tagihan</span>
          <span>{fmt.idr(invoice.amount)}</span>
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-gema-muted">
          <Clock className="size-3.5" /> Kuota ditahan selama <Countdown until={order.reserved_until} />
        </p>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-bold">Metode pembayaran</legend>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMethod(v)} aria-pressed={method === v} className={cx('rounded-lg border px-3 py-2.5 text-sm font-bold', method === v ? 'border-gema-green bg-gema-green/10 text-gema-green' : 'border-white/20 hover:border-white/50')}>
              {l}
            </button>
          ))}
        </div>
        {method === 'VA' && invoice.va_number && <p className="mt-2 text-xs text-gema-muted">No. VA: <span className="font-mono text-white">{invoice.va_number}</span></p>}
      </fieldset>
      <div className="flex justify-center">
        <SlideCommit
          label={`Geser untuk bayar ${fmt.idrShort(invoice.amount)}`}
          doneLabel="Pembayaran berhasil"
          errorLabel="Pembayaran gagal"
          onConfirm={pay}
          onDone={() => {
            toast.success('Tiket terbit! Lihat di Tiket Saya.');
            onClose();
            nav('/app/tickets');
          }}
          onError={(e) => toast.error(e)}
          width={340}
          handleColor="#1ed760"
          successColor="#1ed760"
        />
      </div>
      <p className="flex items-start gap-2 text-xs text-gema-muted">
        <ShieldCheck className="size-4 shrink-0 text-gema-green" />
        Sandbox pembayaran (dev). Dana tiket ditahan dan dicairkan ke promotor setelah acara selesai.
      </p>
    </div>
  );
}

export default function EventDetail() {
  const { idOrSlug = '', slug } = useParams();
  const key = slug ?? idOrSlug;
  const token = useAuth((s) => s.accessToken);
  const nav = useNavigate();
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
        <img src={e.poster_url ?? `https://picsum.photos/seed/gema-ev-${e.id}/1200/600`} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#121212]" />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-end">
          <img src={e.poster_url ?? `https://picsum.photos/seed/gema-ev-${e.id}/600/600`} alt={`Poster ${e.title}`} className="size-56 rounded-lg object-cover shadow-2xl md:size-72" />
          <div>
            <p className="text-sm font-bold">Event</p>
            <h1 className="my-3 text-4xl font-black tracking-tighter md:text-6xl">{e.title}</h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-white/85">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4" /> {start.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" /> {start.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} waktu setempat
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
            <h2 className="mb-4 text-2xl font-bold">Line-up</h2>
            <div className="flex flex-wrap gap-3">
              {e.artists.map((a) => (
                <Link key={a.id} to={`/app/artist/${a.id}`} className="rounded-full bg-white/10 px-5 py-2 font-bold hover:bg-white/20">
                  {a.name}
                </Link>
              ))}
            </div>
          </section>
          <section className="mb-10">
            <h2 className="mb-4 text-2xl font-bold">Tentang event</h2>
            <p className="leading-relaxed whitespace-pre-line text-gema-muted">{e.description}</p>
          </section>
          <section className="mb-10">
            <h2 className="mb-4 text-2xl font-bold">Venue</h2>
            <div className="rounded-lg bg-white/5 p-5">
              <p className="font-bold">{e.venue_name}</p>
              <p className="text-sm text-gema-muted">{e.venue_address}</p>
              <a href={`https://www.google.com/maps/search/${encodeURIComponent(`${e.venue_name} ${e.venue_address} ${e.city}`)}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-gema-green hover:underline">
                Buka di peta →
              </a>
            </div>
          </section>
          {e.rules && (
            <section className="mb-10">
              <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
                <Info className="size-6" /> Aturan masuk
              </h2>
              <p className="text-sm whitespace-pre-line text-gema-muted">{e.rules}</p>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl bg-gema-elevated p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
              <Ticket className="size-5" /> Tiket
            </h2>
            {!e.ticket_types.length && <p className="text-sm text-gema-muted">Penjualan tiket belum dibuka.</p>}
            <ul className="space-y-3">
              {e.ticket_types.map((t) => {
                const n = qty[t.id] ?? 0;
                const notYet = t.sale_starts_at && new Date(t.sale_starts_at).getTime() > now;
                const soldOut = t.remaining <= 0;
                const max = Math.min(t.max_per_account, t.remaining);
                return (
                  <li key={t.id} className="rounded-lg border border-white/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">
                          {t.name}
                          {t.presale && <span className="ml-2 rounded bg-gema-green/20 px-1.5 py-0.5 text-[10px] font-bold text-gema-green uppercase">Presale fan</span>}
                        </p>
                        <p className="text-sm">{fmt.idr(t.price)}</p>
                        <p className="text-xs text-gema-muted">
                          {soldOut ? 'Habis' : notYet ? `Dibuka ${fmt.dateTime(t.sale_starts_at)}` : `Sisa ${fmt.num(t.remaining)} · maks ${t.max_per_account}/akun`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button aria-label={`Kurangi ${t.name}`} disabled={!n} onClick={() => setQty({ ...qty, [t.id]: n - 1 })} className="grid size-8 place-items-center rounded-full border border-white/30 disabled:opacity-30">
                          <Minus className="size-4" />
                        </button>
                        <span className="w-5 text-center font-bold tabular-nums" aria-live="polite">
                          {n}
                        </span>
                        <button aria-label={`Tambah ${t.name}`} disabled={soldOut || !!notYet || n >= max} onClick={() => setQty({ ...qty, [t.id]: n + 1 })} className="grid size-8 place-items-center rounded-full border border-white/30 disabled:opacity-30">
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-sm text-gema-muted">{count} tiket</span>
              <span className="text-lg font-black">{fmt.idr(total)}</span>
            </div>
            <button disabled={!count || busy} onClick={order} className="mt-4 w-full rounded-full bg-gema-green py-3.5 font-bold text-black transition hover:scale-[1.02] disabled:opacity-40">
              {busy ? 'Menahan kuota…' : token ? 'Beli tiket' : 'Masuk untuk membeli'}
            </button>
            <p className="mt-3 text-xs text-gema-muted">Kebijakan refund mengikuti promotor dan ditampilkan sebelum pembayaran. Tiket QR dinamis tidak dapat di-screenshot.</p>
          </div>
        </aside>
      </div>

      <Modal open={!!checkout} onClose={() => setCheckout(null)} title="Pembayaran" theme="dark">
        {checkout && <Checkout {...checkout} onClose={() => setCheckout(null)} />}
      </Modal>
    </div>
  );
}
