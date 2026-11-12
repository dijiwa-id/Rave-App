import { createHash, timingSafeEqual } from 'node:crypto';
import { getIntegration } from '@rave/service-kit';

// Adapter penyedia pembayaran (payment gateway). Domain finance hanya bicara dengan kontrak ini;
// menyambungkan vendor nyata = menambah satu implementasi + kredensial, tanpa menyentuh ledger, escrow, atau alur refund.
// Penyedia aktif diatur Super Admin (Platform → Integrasi → Payment gateway); bila belum diatur dipakai env
// PAYMENT_PROVIDER / MIDTRANS_* (perilaku lama, default sandbox).

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

export interface CheckoutRequest {
  invoiceId: string;
  amount: number;
  description: string;
  dueAt: Date;
  finishUrl?: string;
}
export interface CheckoutSession {
  token: string;
  redirectUrl: string;
  expiresAt: Date;
}

/** Status pembayaran dari penyedia, dinormalisasi ke event PG internal. `null` = belum final (pending). */
export interface ProviderPaymentStatus {
  eventId: string;
  invoiceId: string;
  status: 'PAID' | 'FAILED';
  amount: number;
  paidAt: string;
  method: string;
}

export interface PaymentProvider {
  name: string;
  /** Lempar error untuk kegagalan sementara (jaringan/5xx) → dicoba ulang; `PermanentRefundError` → langsung FAILED. */
  requestRefund(r: RefundRequest): Promise<RefundDispatch>;
  /** Halaman pembayaran hosted (redirect). Sandbox tidak punya — web memakai simulasi (dev). */
  createCheckout?(c: CheckoutRequest): Promise<CheckoutSession>;
  /** Tarik status terkini (rekonsiliasi saat pengguna kembali dari halaman bayar / webhook terlambat). */
  fetchStatus?(invoiceId: string): Promise<ProviderPaymentStatus | null>;
}

/** Penolakan final dari penyedia (mis. metode tidak mendukung refund, transaksi terlalu lama) — tidak dicoba ulang. */
export class PermanentRefundError extends Error {}
/** Kesalahan dari penyedia saat membuat/mengecek pembayaran (pesan aman ditampilkan ke admin). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

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

// ---------------------------------------------------------------- Midtrans
export interface MidtransCredentials {
  serverKey: string;
  clientKey?: string;
  production: boolean;
}

const midtransBase = (m: MidtransCredentials) => ({
  snap: m.production ? 'https://app.midtrans.com/snap/v1' : 'https://app.sandbox.midtrans.com/snap/v1',
  api: m.production ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2',
});
const basic = (key: string) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

async function midtransFetch(url: string, m: MidtransCredentials, init: { method?: string; body?: unknown } = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { authorization: basic(m.serverKey), accept: 'application/json', 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    throw new ProviderError(`Midtrans tidak terjangkau: ${e?.message ?? e}`, true);
  }
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (res.status >= 500 || res.status === 429) throw new ProviderError(`Midtrans HTTP ${res.status}`, true);
  if (res.status === 401) throw new ProviderError('Server key Midtrans ditolak (401) — periksa kunci & mode sandbox/produksi');
  return { httpStatus: res.status, ...json };
}

/** Format waktu Midtrans: "yyyy-MM-dd HH:mm:ss +0700" (WIB). */
function wib(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())} +0700`;
}

/** Signature notifikasi Midtrans: SHA512(order_id + status_code + gross_amount + server_key). */
export function midtransSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string {
  return createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex');
}
export function verifyMidtransSignature(n: { order_id?: string; status_code?: string; gross_amount?: string; signature_key?: string }, serverKey: string): boolean {
  if (!n.order_id || !n.status_code || !n.gross_amount || !n.signature_key) return false;
  const want = Buffer.from(midtransSignature(n.order_id, n.status_code, n.gross_amount, serverKey), 'hex');
  const got = Buffer.from(n.signature_key, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Status transaksi Midtrans → event internal. settlement / capture+accept = PAID; deny/cancel/expire/failure = FAILED;
 * pending / capture+challenge / refund = belum final atau bukan urusan pembayaran → null.
 */
export function mapMidtransStatus(n: any): ProviderPaymentStatus | null {
  const ts = String(n.transaction_status ?? '');
  const fraud = String(n.fraud_status ?? 'accept');
  const paid = ts === 'settlement' || (ts === 'capture' && fraud === 'accept');
  const failed = ['deny', 'cancel', 'expire', 'failure'].includes(ts);
  if (!paid && !failed) return null;
  return {
    eventId: `mt_${n.transaction_id ?? n.order_id}_${paid ? 'paid' : ts}`,
    invoiceId: String(n.order_id),
    status: paid ? 'PAID' : 'FAILED',
    amount: Math.round(Number(n.gross_amount ?? 0)),
    paidAt: new Date(n.settlement_time ? `${String(n.settlement_time).replace(' ', 'T')}+07:00` : Date.now()).toISOString(),
    method: String(n.payment_type ?? 'midtrans'),
  };
}

/** Metode Midtrans yang mendukung refund lewat API; lainnya (VA, gerai) → transfer manual oleh Finance. */
const MIDTRANS_REFUND_DIRECT = new Set(['gopay', 'shopeepay', 'qris']);
const MIDTRANS_REFUND_STANDARD = new Set(['credit_card', 'akulaku', 'kredivo']);

export function midtransProvider(m: MidtransCredentials): PaymentProvider {
  const base = midtransBase(m);
  return {
    name: 'midtrans',
    async createCheckout(c) {
      const minutes = Math.max(5, Math.min(60 * 24 * 7, Math.floor((c.dueAt.getTime() - Date.now()) / 60_000)));
      const r = await midtransFetch(`${base.snap}/transactions`, m, {
        method: 'POST',
        body: {
          transaction_details: { order_id: c.invoiceId, gross_amount: c.amount },
          item_details: [{ id: c.invoiceId.slice(0, 8), price: c.amount, quantity: 1, name: c.description.slice(0, 50) }],
          expiry: { start_time: wib(new Date()), unit: 'minute', duration: minutes },
          ...(c.finishUrl ? { callbacks: { finish: c.finishUrl } } : {}),
        },
      });
      if (!r.token || !r.redirect_url) throw new ProviderError(`Midtrans menolak transaksi: ${(r.error_messages ?? [r.status_message ?? `HTTP ${r.httpStatus}`]).join('; ')}`);
      return { token: r.token, redirectUrl: r.redirect_url, expiresAt: new Date(Date.now() + minutes * 60_000) };
    },
    async fetchStatus(invoiceId) {
      const r = await midtransFetch(`${base.api}/${encodeURIComponent(invoiceId)}/status`, m);
      if (String(r.status_code) === '404') return null; // belum ada transaksi (pengguna belum memilih metode)
      if (String(r.status_code) === '401') throw new ProviderError('Server key Midtrans ditolak');
      return mapMidtransStatus(r);
    },
    async requestRefund(r) {
      if (r.amount <= 0) throw new PermanentRefundError('Nominal refund nol');
      const method = (r.payment.method ?? '').toLowerCase();
      const direct = MIDTRANS_REFUND_DIRECT.has(method);
      if (!direct && !MIDTRANS_REFUND_STANDARD.has(method))
        throw new PermanentRefundError(`Metode ${method || 'tidak diketahui'} tidak mendukung refund otomatis Midtrans — selesaikan dengan transfer manual`);
      const url = `${base.api}/${encodeURIComponent(r.invoiceId)}/refund${direct ? '/online/direct' : ''}`;
      let res: any;
      try {
        res = await midtransFetch(url, m, { method: 'POST', body: { refund_key: r.refundId, amount: r.amount, reason: r.reason.slice(0, 200) } });
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable) throw new PermanentRefundError(e.message);
        throw e;
      }
      const code = String(res.status_code ?? res.httpStatus);
      if (code === '200') return { status: 'COMPLETED', providerRef: String(res.refund_key ?? res.refund_chargeback_id ?? r.refundId) };
      if (code === '201') return { status: 'PENDING', providerRef: String(res.refund_key ?? r.refundId) };
      if (code.startsWith('5')) throw new Error(`Midtrans refund ${code}: ${res.status_message ?? ''}`);
      throw new PermanentRefundError(`Midtrans menolak refund (${code}): ${res.status_message ?? ''}`);
    },
  };
}

/** Uji kredensial tanpa membuat transaksi: cek status order acak → 404 = kunci valid, 401 = ditolak. */
export async function testMidtrans(m: MidtransCredentials): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await midtransFetch(`${midtransBase(m).api}/rave-conn-test-${Date.now()}/status`, m);
    const code = String(r.status_code ?? r.httpStatus);
    if (code === '404') return { ok: true, message: `Kredensial Midtrans ${m.production ? 'PRODUKSI' : 'sandbox'} valid` };
    if (code === '401') return { ok: false, message: 'Server key ditolak Midtrans (401) — periksa kunci & mode sandbox/produksi' };
    return { ok: false, message: `Respons tak terduga dari Midtrans: ${code} ${r.status_message ?? ''}`.trim() };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------- Resolusi penyedia
export interface PaymentSettings {
  source: 'dashboard' | 'env';
  provider: 'sandbox' | 'midtrans';
  midtrans: MidtransCredentials | null;
}

export async function paymentSettings(): Promise<PaymentSettings> {
  const i = await getIntegration('payment');
  const get = i ? (k: string) => i.secrets[k] || i.config[k] || undefined : (k: string) => process.env[k]?.trim() || undefined;
  const provider = ((i ? i.provider : get('PAYMENT_PROVIDER')) ?? 'sandbox').toLowerCase();
  if (provider !== 'sandbox' && provider !== 'midtrans') throw new Error(`Penyedia pembayaran tidak dikenal: ${provider} (tersedia: sandbox, midtrans)`);
  const serverKey = get('MIDTRANS_SERVER_KEY');
  const midtrans = serverKey ? { serverKey, clientKey: get('MIDTRANS_CLIENT_KEY'), production: get('MIDTRANS_MODE') === 'production' } : null;
  return { source: i ? 'dashboard' : 'env', provider, midtrans };
}

/** Penyedia untuk nama tertentu dengan kredensial terkini (refund harus lewat penyedia tempat invoice dibayar). */
export async function providerByName(name: string): Promise<PaymentProvider> {
  if (name === 'sandbox') return sandbox;
  if (name === 'midtrans') {
    const s = await paymentSettings();
    if (!s.midtrans) throw new Error('Kredensial Midtrans belum diatur (Platform → Integrasi)');
    return midtransProvider(s.midtrans);
  }
  throw new Error(`Penyedia pembayaran tidak dikenal: ${name}`);
}

/** Penyedia aktif untuk pembayaran baru. */
export async function activePaymentProvider(): Promise<PaymentProvider> {
  const s = await paymentSettings();
  if (s.provider === 'midtrans') {
    if (!s.midtrans) throw new Error('Midtrans aktif tetapi server key belum diatur (Platform → Integrasi)');
    return midtransProvider(s.midtrans);
  }
  return sandbox;
}
