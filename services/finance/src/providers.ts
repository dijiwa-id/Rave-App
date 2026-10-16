// Adapter penyedia pembayaran (payment gateway). Domain finance hanya bicara dengan kontrak ini;
// menyambungkan vendor nyata (Midtrans, Xendit, DOKU, …) = menambah satu implementasi + kredensial,
// tanpa menyentuh ledger, escrow, atau alur refund.

export interface RefundRequest {
  /** Id refund internal — dipakai sebagai idempotency key ke penyedia (dikirim ulang tidak membuat refund ganda). */
  refundId: string;
  invoiceId: string;
  amount: number;
  reason: string;
  /** Data pembayaran asal agar dana kembali ke metode yang sama (VA, QRIS, e-wallet, kartu). */
  payment: { method: string | null; vaNumber: string | null; paidAt: string | null; providerPaymentRef: string | null };
}

export interface RefundDispatch {
  /** PENDING = diterima penyedia, hasil akhir menyusul lewat webhook; COMPLETED = langsung selesai. */
  status: 'PENDING' | 'COMPLETED';
  providerRef: string;
}

export interface PaymentProvider {
  name: string;
  /** Lempar error untuk kegagalan sementara (jaringan/5xx) → dicoba ulang; `PermanentRefundError` → langsung FAILED. */
  requestRefund(r: RefundRequest): Promise<RefundDispatch>;
}

/** Penolakan final dari penyedia (mis. metode tidak mendukung refund, transaksi terlalu lama) — tidak dicoba ulang. */
export class PermanentRefundError extends Error {}

/**
 * Sandbox: perilaku penyedia nyata disimulasikan — refund diterima (PENDING) lalu dikonfirmasi lewat webhook
 * bertanda tangan oleh job `refund-sandbox-settle`. Tidak ada uang yang berpindah.
 */
const sandbox: PaymentProvider = {
  name: 'sandbox',
  async requestRefund(r) {
    if (r.amount <= 0) throw new PermanentRefundError('Nominal refund nol');
    return { status: 'PENDING', providerRef: `sbx_rf_${r.refundId}` };
  },
};

const PROVIDERS: Record<string, PaymentProvider> = { sandbox };

/** Penyedia aktif dari env `PAYMENT_PROVIDER` (default sandbox). */
export function paymentProvider(): PaymentProvider {
  const name = (process.env.PAYMENT_PROVIDER ?? 'sandbox').toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`PAYMENT_PROVIDER tidak dikenal: ${name} (tersedia: ${Object.keys(PROVIDERS).join(', ')})`);
  return p;
}
