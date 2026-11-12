import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SlideCommit from '@/components/reactbits/SlideCommit';
import { api, fmt } from '@/lib/api';
import type { Invoice } from '@/lib/types';
import { Badge, cx, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { returnUrl, useCheckoutInfo, useInvoiceSync } from '@/lib/payment';
import { ShieldCheck } from 'lucide-react';

const METHODS = [{ id: 'VA' }, { id: 'QRIS' }, { id: 'EWALLET' }, { id: 'CARD' }] as const;

export function InvoiceStatus({ status }: { status: Invoice['status'] }) {
  const s = useDict('b2b').invoice.status;
  const map = { PENDING: ['amber', s.PENDING], PAID: ['green', s.PAID], EXPIRED: ['neutral', s.EXPIRED], FAILED: ['red', s.FAILED] } as const;
  const [tone, label] = map[status] ?? ['neutral', status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Kartu invoice + bayar (sandbox PG: simulate-pay → webhook HMAC → escrow). */
export function PayInvoice({ invoice, onPaid }: { invoice: Invoice; onPaid?: () => void }) {
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('VA');
  const qc = useQueryClient();
  const d = useDict('b2b').invoice;
  const gw = useCheckoutInfo(invoice, () => returnUrl(invoice.id));
  // Kembali dari halaman bayar (?invoice=<id>) → tarik status dari penyedia sampai final.
  const returning = invoice.status === 'PENDING' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('invoice') === invoice.id;
  const sync = useInvoiceSync(returning ? invoice.id : null, (inv) => {
    if (inv.status === 'PAID') {
      toast.success(d.paidToast);
      onPaid?.();
    }
  });
  return (
    <div className="rounded-none border border-b2b-line bg-b2b-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-b2b-muted uppercase">{(d.purpose as Record<string, string>)[invoice.purpose] ?? invoice.purpose}</p>
          <p className="text-xl font-extrabold">{fmt.idr(invoice.amount)}</p>
          <p className="text-xs text-b2b-muted">{invoice.description}</p>
        </div>
        <InvoiceStatus status={invoice.status} />
      </div>
      <p className="mt-2 text-xs text-b2b-muted">
        {d.due(fmt.dateTime(invoice.due_at))}
        {invoice.paid_at && d.paidAt(fmt.dateTime(invoice.paid_at))}
      </p>
      {invoice.status === 'PENDING' && returning && sync === 'checking' && <p className="mt-3 text-xs font-bold text-b2b-muted">{d.confirming}</p>}
      {invoice.status === 'PENDING' && returning && sync === 'PENDING' && <p className="mt-3 text-xs text-amber-700">{d.notConfirmed}</p>}
      {invoice.status === 'PENDING' && gw.data?.provider === 'midtrans' && (
        <div className="mt-4 space-y-2">
          <a href={gw.data.redirect_url} className="inline-flex h-11 items-center gap-2 rounded-none bg-b2b-ink px-5 text-sm font-bold text-b2b-on-ink transition hover:scale-[1.01]">
            <ShieldCheck className="size-4" /> {d.payNow} · {fmt.idrShort(invoice.amount)}
          </a>
          <p className="text-xs text-b2b-muted">{d.gatewayNote}</p>
          {gw.data.mode === 'sandbox' && <p className="text-xs font-bold text-amber-700">{d.gatewaySandbox}</p>}
        </div>
      )}
      {invoice.status === 'PENDING' && gw.isLoading && <p className="mt-4 text-xs text-b2b-muted">{d.preparing}</p>}
      {invoice.status === 'PENDING' && gw.isError && <p className="mt-4 text-xs text-red-600">{(gw.error as Error).message}</p>}
      {invoice.status === 'PENDING' && gw.data?.provider === 'sandbox' && !gw.data.simulate && <p className="mt-4 text-sm text-b2b-muted">{d.unavailable}</p>}
      {invoice.status === 'PENDING' && gw.data?.provider === 'sandbox' && gw.data.simulate && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={d.methodAria}>
            {METHODS.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={method === m.id}
                onClick={() => setMethod(m.id)}
                className={cx('rounded-none border px-3 py-1.5 text-xs font-bold', method === m.id ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted')}
              >
                {d.methods[m.id]}
              </button>
            ))}
          </div>
          {method === 'VA' && invoice.va_number && (
            <p className="rounded-none bg-b2b-bg px-3 py-2 font-mono text-sm">
              VA: <strong>{invoice.va_number}</strong>
            </p>
          )}
          <p className="text-xs text-b2b-muted">{d.escrowNote}</p>
          <SlideCommit
            label={d.slide(fmt.idrShort(invoice.amount))}
            doneLabel={d.slideDone}
            errorLabel={d.slideError}
            width={320}
            trackColor="#111111"
            handleColor="#5B2A6E"
            onConfirm={() => api(`/v1/finance/invoices/${invoice.id}/simulate-pay`, { body: { method }, idempotencyKey: true })}
            onDone={() => {
              toast.success(d.paidToast);
              qc.invalidateQueries();
              onPaid?.();
            }}
            onError={(e) => toast.error(e)}
          />
          <p className="text-[11px] text-b2b-muted">{d.sandbox}</p>
        </div>
      )}
    </div>
  );
}
