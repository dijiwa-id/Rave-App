import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SlideCommit from '@/components/reactbits/SlideCommit';
import { api, fmt } from '@/lib/api';
import type { Invoice } from '@/lib/types';
import { Badge, cx, toast } from '@/components/ui';

const PURPOSE: Record<string, string> = { BOOKING_DP: 'DP Booking', BOOKING_SETTLEMENT: 'Pelunasan Booking', TICKET_ORDER: 'Order Tiket' };
const METHODS = [
  { id: 'VA', label: 'Virtual Account' },
  { id: 'QRIS', label: 'QRIS' },
  { id: 'EWALLET', label: 'E-wallet' },
  { id: 'CARD', label: 'Kartu' },
] as const;

export function InvoiceStatus({ status }: { status: Invoice['status'] }) {
  const map = { PENDING: ['amber', 'Menunggu bayar'], PAID: ['green', 'Lunas'], EXPIRED: ['neutral', 'Kedaluwarsa'], FAILED: ['red', 'Gagal'] } as const;
  const [tone, label] = map[status] ?? ['neutral', status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Kartu invoice + bayar (sandbox PG: simulate-pay → webhook HMAC → escrow). */
export function PayInvoice({ invoice, onPaid }: { invoice: Invoice; onPaid?: () => void }) {
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('VA');
  const qc = useQueryClient();
  return (
    <div className="rounded-xl border border-b2b-line bg-b2b-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-b2b-muted uppercase">{PURPOSE[invoice.purpose] ?? invoice.purpose}</p>
          <p className="text-xl font-extrabold">{fmt.idr(invoice.amount)}</p>
          <p className="text-xs text-b2b-muted">{invoice.description}</p>
        </div>
        <InvoiceStatus status={invoice.status} />
      </div>
      <p className="mt-2 text-xs text-b2b-muted">
        Jatuh tempo {fmt.dateTime(invoice.due_at)}
        {invoice.paid_at && ` · dibayar ${fmt.dateTime(invoice.paid_at)}`}
      </p>
      {invoice.status === 'PENDING' && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Metode pembayaran">
            {METHODS.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={method === m.id}
                onClick={() => setMethod(m.id)}
                className={cx('rounded-full border px-3 py-1.5 text-xs font-bold', method === m.id ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted')}
              >
                {m.label}
              </button>
            ))}
          </div>
          {method === 'VA' && invoice.va_number && (
            <p className="rounded-lg bg-b2b-bg px-3 py-2 font-mono text-sm">
              VA: <strong>{invoice.va_number}</strong>
            </p>
          )}
          <p className="text-xs text-b2b-muted">Dana masuk ke rekening bersama (escrow) mitra berizin — bukan rekening operasional GEMA.</p>
          <SlideCommit
            label={`Geser untuk bayar ${fmt.idrShort(invoice.amount)}`}
            doneLabel="Pembayaran diterima"
            errorLabel="Gagal, coba lagi"
            width={320}
            trackColor="#111111"
            handleColor="#DA1C5C"
            onConfirm={() => api(`/v1/finance/invoices/${invoice.id}/simulate-pay`, { body: { method }, idempotencyKey: true })}
            onDone={() => {
              toast.success('Pembayaran berhasil masuk escrow');
              qc.invalidateQueries();
              onPaid?.();
            }}
            onError={(e) => toast.error(e)}
          />
          <p className="text-[11px] text-b2b-muted">Mode sandbox: pembayaran disimulasikan melalui webhook payment gateway bertanda tangan.</p>
        </div>
      )}
    </div>
  );
}
