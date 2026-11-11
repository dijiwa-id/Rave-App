import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SlideCommit from '@/components/reactbits/SlideCommit';
import { api, fmt } from '@/lib/api';
import type { Invoice } from '@/lib/types';
import { Badge, cx, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';

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
      {invoice.status === 'PENDING' && (
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
