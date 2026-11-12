import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Invoice } from '@/lib/types';

/**
 * Pembayaran lewat payment gateway aktif (diatur Super Admin di Platform → Integrasi).
 * - sandbox: web memakai simulasi (hanya development); di produksi tanpa PG pembayaran tidak tersedia.
 * - midtrans: halaman Snap hosted (redirect). Setelah kembali, status ditarik lewat /sync (webhook tetap sumber utama).
 */
export type CheckoutInfo =
  | { provider: 'sandbox'; simulate: boolean; invoice: Invoice }
  | { provider: 'midtrans'; redirect_url: string; token: string; mode: 'sandbox' | 'production'; invoice: Invoice };

/** Info checkout untuk invoice PENDING (membuat sesi Snap sekali; dipakai ulang selama berlaku). */
export function useCheckoutInfo(invoice: Pick<Invoice, 'id' | 'status'>, finishUrl: () => string) {
  return useQuery({
    queryKey: ['checkout', invoice.id],
    queryFn: () => api<CheckoutInfo>(`/v1/finance/invoices/${invoice.id}/checkout`, { body: { finish_url: finishUrl() } }),
    enabled: invoice.status === 'PENDING',
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Tambahkan ?invoice=<id> ke URL saat ini (halaman kembali setelah bayar). */
export function returnUrl(invoiceId: string, path?: string): string {
  const u = new URL(path ?? window.location.pathname + window.location.search, window.location.origin);
  u.searchParams.set('invoice', invoiceId);
  return u.toString();
}

/**
 * Tarik status invoice dari penyedia secara berkala (tiap 4 dtk, maks 3 menit) sampai final.
 * Dipakai saat pengguna kembali dari halaman bayar; aman dipanggil berulang (idempoten di server).
 */
export function useInvoiceSync(invoiceId: string | null | undefined, onFinal?: (inv: Invoice) => void) {
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'checking' | Invoice['status']>('idle');
  const done = useRef(onFinal);
  done.current = onFinal;
  useEffect(() => {
    if (!invoiceId) return;
    let stop = false;
    const started = Date.now();
    setState('checking');
    (async () => {
      while (!stop && Date.now() - started < 180_000) {
        const inv = await api<Invoice>(`/v1/finance/invoices/${invoiceId}/sync`, { body: {} }).catch(() => null);
        if (inv && inv.status !== 'PENDING') {
          setState(inv.status);
          qc.invalidateQueries();
          done.current?.(inv);
          return;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
      if (!stop) setState('PENDING');
    })();
    return () => {
      stop = true;
    };
  }, [invoiceId, qc]);
  return state;
}
