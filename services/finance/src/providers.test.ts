import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateIntegration, setIntegrationLoader } from '@rave/service-kit';
import { mapMidtransStatus, midtransProvider, paymentSettings, PermanentRefundError, testMidtrans, verifyMidtransSignature } from './providers.js';

const SK = 'SB-Mid-server-unit';
const m = midtransProvider({ serverKey: SK, production: false });
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setIntegrationLoader(null);
  invalidateIntegration();
});

describe('Midtrans', () => {
  it('signature notifikasi SHA-512 diverifikasi (dan ditolak bila dipalsukan)', () => {
    const n = { order_id: 'inv-1', status_code: '200', gross_amount: '150000.00' };
    const sig = createHash('sha512').update(`inv-1200150000.00${SK}`).digest('hex');
    expect(verifyMidtransSignature({ ...n, signature_key: sig }, SK)).toBe(true);
    expect(verifyMidtransSignature({ ...n, signature_key: sig }, 'kunci-lain')).toBe(false);
    expect(verifyMidtransSignature({ ...n, gross_amount: '1.00', signature_key: sig }, SK)).toBe(false);
    expect(verifyMidtransSignature({ ...n }, SK)).toBe(false);
  });

  it('status transaksi → event internal', () => {
    const base = { order_id: 'inv-1', transaction_id: 'tx1', gross_amount: '150000.00', payment_type: 'qris' };
    expect(mapMidtransStatus({ ...base, transaction_status: 'settlement' })).toMatchObject({ status: 'PAID', amount: 150000, invoiceId: 'inv-1', method: 'qris' });
    expect(mapMidtransStatus({ ...base, transaction_status: 'capture', fraud_status: 'accept' })?.status).toBe('PAID');
    expect(mapMidtransStatus({ ...base, transaction_status: 'capture', fraud_status: 'challenge' })).toBeNull();
    expect(mapMidtransStatus({ ...base, transaction_status: 'pending' })).toBeNull();
    expect(mapMidtransStatus({ ...base, transaction_status: 'expire' })?.status).toBe('FAILED');
    // event id stabil per transaksi+hasil → notifikasi ulang idempoten
    expect(mapMidtransStatus({ ...base, transaction_status: 'settlement' })!.eventId).toBe(mapMidtransStatus({ ...base, transaction_status: 'settlement' })!.eventId);
  });

  it('checkout Snap: basic auth server key, order_id = invoice, URL sandbox', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { token: 'snap-tok', redirect_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-tok' }));
    const s = await m.createCheckout!({ invoiceId: 'inv-9', amount: 75000, description: 'Tiket Reguler', dueAt: new Date(Date.now() + 15 * 60_000), finishUrl: 'https://rave.id/app/tickets?invoice=inv-9' });
    expect(s.redirectUrl).toContain('snap-tok');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://app.sandbox.midtrans.com/snap/v1/transactions');
    expect((init.headers as any).authorization).toBe('Basic ' + Buffer.from(`${SK}:`).toString('base64'));
    const body = JSON.parse(init.body as string);
    expect(body.transaction_details).toEqual({ order_id: 'inv-9', gross_amount: 75000 });
    expect(body.callbacks.finish).toContain('invoice=inv-9');
    expect(body.expiry.unit).toBe('minute');
  });

  it('kunci ditolak (401) → galat jelas, bukan retry', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { status_message: 'Unauthorized' }));
    await expect(m.createCheckout!({ invoiceId: 'x', amount: 1, description: 'd', dueAt: new Date(Date.now() + 3600_000) })).rejects.toMatchObject({ retryable: false });
  });

  it('refund: QRIS lewat endpoint direct; VA → PermanentRefundError (transfer manual)', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { status_code: '200', refund_key: 'rf-1' }));
    const ok = await m.requestRefund({ refundId: 'rf-1', invoiceId: 'inv-1', amount: 50000, reason: 'Event batal', payment: { method: 'qris', vaNumber: null, paidAt: null, providerPaymentRef: null } });
    expect(ok).toEqual({ status: 'COMPLETED', providerRef: 'rf-1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.sandbox.midtrans.com/v2/inv-1/refund/online/direct');
    await expect(
      m.requestRefund({ refundId: 'rf-2', invoiceId: 'inv-2', amount: 50000, reason: 'x', payment: { method: 'bank_transfer', vaNumber: '123', paidAt: null, providerPaymentRef: null } }),
    ).rejects.toBeInstanceOf(PermanentRefundError);
  });

  it('uji koneksi: 404 order acak = kunci valid; 401 = ditolak', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { status_code: '404', status_message: "Transaction doesn't exist." }));
    expect((await testMidtrans({ serverKey: SK, production: false })).ok).toBe(true);
    fetchMock.mockResolvedValueOnce(reply(200, { status_code: '401', status_message: 'Unauthorized' }));
    expect((await testMidtrans({ serverKey: SK, production: true })).ok).toBe(false);
    expect(fetchMock.mock.calls[1]![0]).toMatch(/^https:\/\/api\.midtrans\.com\/v2\//);
  });

  it('konfigurasi dasbor menentukan penyedia aktif & mode', async () => {
    setIntegrationLoader(async () => ({ kind: 'payment', provider: 'midtrans', config: { MIDTRANS_MODE: 'production' }, secrets: { MIDTRANS_SERVER_KEY: 'Mid-server-x' }, updated_at: '' }));
    invalidateIntegration();
    const s = await paymentSettings();
    expect(s).toMatchObject({ source: 'dashboard', provider: 'midtrans', midtrans: { serverKey: 'Mid-server-x', production: true } });
  });
});
