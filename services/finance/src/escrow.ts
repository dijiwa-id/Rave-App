import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { LedgerAccounts, allocate, pct, ticketRefundAmount, withholdingTax, type PaymentPurpose } from '@rave/domain';
import { badRequest, config, conflict, notFound, publish, settings, unauthorized, uuidv7, type Client } from '@rave/service-kit';
import { C, D, payableAccount, post } from './ledger.js';

export const ESCROW_BANK = LedgerAccounts.escrowBank('mitra-sandbox');

export function invoiceView(r: any) {
  return {
    id: r.id,
    purpose: r.purpose,
    reference_id: r.reference_id,
    amount: r.amount,
    status: r.status,
    due_at: r.due_at,
    paid_at: r.paid_at,
    payer_user_id: r.payer_user_id,
    payer_org_id: r.payer_org_id,
    description: r.description,
    va_number: r.va_number,
    qris_payload: r.qris_payload,
    provider: r.provider ?? 'sandbox',
    checkout_url: r.checkout_url && r.checkout_expires_at && new Date(r.checkout_expires_at).getTime() > Date.now() ? r.checkout_url : null,
    escrow_amount: r.escrow_amount,
    fee_amount: r.fee_amount,
    depends_on: r.depends_on,
  };
}

export async function createInvoice(
  c: Client,
  i: {
    purpose: PaymentPurpose;
    referenceId: string;
    escrowAmount: number;
    feeAmount?: number;
    payerUserId: string;
    payerOrgId?: string | null;
    description: string;
    dueAt: Date;
    dependsOn?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const id = uuidv7();
  const amount = i.escrowAmount + (i.feeAmount ?? 0);
  // VA & QRIS di-generate mitra PG di produksi; di sandbox dibuat lokal.
  const va = `8808${String(randomInt(0, 1e9)).padStart(9, '0')}${String(randomInt(0, 1e3)).padStart(3, '0')}`;
  const r = await c.query(
    `INSERT INTO invoices (id, purpose, reference_id, amount, escrow_amount, fee_amount, payer_user_id, payer_org_id, description, due_at, va_number, qris_payload, depends_on, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (purpose, reference_id) DO UPDATE SET purpose = EXCLUDED.purpose RETURNING *`,
    [id, i.purpose, i.referenceId, amount, i.escrowAmount, i.feeAmount ?? 0, i.payerUserId, i.payerOrgId ?? null, i.description, i.dueAt, va,
      `00020101021226590014ID.CO.RAVE.WWW0118RAVE${id.slice(0, 8)}5204599953033605405${amount}5802ID5904RAVE6007JAKARTA6304`, i.dependsOn ?? null,
      JSON.stringify(i.metadata ?? {})],
  );
  return r.rows[0];
}

// ---------------- Webhook PG (TDD §7.2 langkah 3) ----------------
export interface PgEvent {
  event_id: string;
  intent_id: string;
  status: 'PAID' | 'FAILED';
  amount: number;
  paid_at: string;
  method?: string;
}

/** Signature: header `x-pg-signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. */
export function signPayload(raw: string, ts = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', config.pgWebhookSecret).update(`${ts}.${raw}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}
export function verifySignature(raw: string, header: string | undefined) {
  if (!header) throw unauthorized('Signature webhook tidak ada');
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw unauthorized('Timestamp webhook di luar toleransi');
  const expected = createHmac('sha256', config.pgWebhookSecret).update(`${ts}.${raw}`).digest();
  const got = Buffer.from(parts.v1 ?? '', 'hex');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw unauthorized('Signature webhook tidak valid');
}

/** Proses event PG: idempoten per event_id → ledger escrow hold → finance.payment.succeeded. */
export async function processPgEvent(c: Client, provider: string, ev: PgEvent) {
  const dup = await c.query(
    `INSERT INTO pg_webhook_events (event_id, provider, invoice_id, status, payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1`,
    [ev.event_id, provider, ev.intent_id, ev.status, JSON.stringify(ev)],
  );
  if (!dup.rowCount) return { duplicate: true };
  const inv = (await c.query(`SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, [ev.intent_id])).rows[0];
  if (!inv) throw notFound('Invoice');
  // Dana diterima lewat penyedia ini → refund kelak lewat penyedia yang sama (juga untuk pembayaran yang dikembalikan).
  inv.provider = provider;
  if (inv.status === 'PAID') return { duplicate: true };
  if (ev.status === 'FAILED') {
    await c.query(`UPDATE invoices SET status='FAILED' WHERE id=$1`, [inv.id]);
    await publish(c, 'finance.payment.failed', inv.reference_id, {
      intentId: inv.id,
      purpose: inv.purpose,
      referenceId: inv.reference_id,
      payerUserId: inv.payer_user_id,
      amount: Number(inv.amount),
    });
    return { duplicate: false };
  }
  if (Number(ev.amount) !== Number(inv.amount)) throw badRequest(`Jumlah pembayaran ${ev.amount} ≠ tagihan ${inv.amount}`);

  // Booking: tagihan sudah kedaluwarsa (booking batal / dicairkan lewat mediasi) atau escrow sudah final →
  // dana TIDAK dimasukkan kembali ke escrow (akan tersangkut), melainkan dikembalikan ke pembayar.
  if (inv.purpose === 'BOOKING_DP' || inv.purpose === 'BOOKING_SETTLEMENT') {
    const hold = (await c.query(`SELECT status FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [inv.reference_id])).rows[0];
    if (inv.status === 'EXPIRED' || (hold && TERMINAL_HOLD.includes(hold.status))) {
      await refundUnappliedPayment(c, inv, ev, inv.status === 'EXPIRED' ? 'Pembayaran untuk tagihan yang sudah tidak berlaku' : `Pembayaran setelah escrow berstatus ${hold.status}`);
      return { duplicate: false };
    }
  }

  const lines = [D(ESCROW_BANK, inv.amount)];
  let holdRef = inv.reference_id;
  if (inv.purpose === 'BOOKING_DP' || inv.purpose === 'BOOKING_SETTLEMENT') {
    lines.push(C(LedgerAccounts.escrowBooking(inv.reference_id), inv.escrow_amount));
    if (inv.fee_amount) lines.push(C(LedgerAccounts.serviceFeeOffair(), inv.fee_amount));
  } else if (inv.purpose === 'TICKET_ORDER') {
    const eventId = ticketEventId(inv);
    holdRef = `event:${eventId}`;
    lines.push(C(LedgerAccounts.escrowEvent(eventId), inv.escrow_amount));
    if (inv.fee_amount) lines.push(C(LedgerAccounts.ticketFee(), inv.fee_amount));
  } else {
    lines.push(C(`revenue:${inv.purpose.toLowerCase()}`, inv.amount));
  }
  await post(c, { key: `pg:${ev.event_id}`, kind: `payment.${inv.purpose.toLowerCase()}`, referenceId: inv.reference_id, description: inv.description, lines });
  await c.query(`UPDATE invoices SET status='PAID', paid_at=$2, provider=$3 WHERE id=$1`, [inv.id, ev.paid_at, provider]);
  inv.provider = provider;

  if (inv.purpose === 'TICKET_ORDER') {
    await c.query(
      `INSERT INTO escrow_holds (reference_id, kind, promotor_org_id, held, status) VALUES ($1,'EVENT',$2,$3,'HELD')
       ON CONFLICT (reference_id) DO UPDATE SET held = escrow_holds.held + EXCLUDED.held,
         status = CASE WHEN escrow_holds.status = 'REFUNDED' THEN 'HELD' ELSE escrow_holds.status END, updated_at=now()`,
      [holdRef, inv.metadata?.promotor_org_id ?? null, inv.escrow_amount],
    );
  } else if (inv.escrow_amount > 0) {
    await c.query(
      `UPDATE escrow_holds SET held = held + $2, status = CASE WHEN held + $2 >= fee THEN 'PAID_IN_FULL' ELSE 'DP_RECEIVED' END, updated_at=now() WHERE reference_id=$1`,
      [holdRef, inv.escrow_amount],
    );
  }
  await publish(c, 'finance.payment.succeeded', inv.reference_id, {
    intentId: inv.id,
    purpose: inv.purpose,
    referenceId: inv.reference_id,
    amount: inv.amount,
    payerUserId: inv.payer_user_id,
  });
  return { duplicate: false };
}

/**
 * Event pemilik escrow tiket. Invoice lama (sebelum ticketing mengirim metadata) tercatat per order —
 * rumus yang sama dipakai saat bayar dan saat refund agar dana selalu ditemukan di hold yang benar.
 */
export const ticketEventId = (inv: { metadata?: any; reference_id: string }): string => inv.metadata?.event_id ?? inv.reference_id;

/** Status escrow booking yang sudah final: tidak menerima dana baru dan tidak dapat dicairkan/direfund lagi. */
export const TERMINAL_HOLD = ['RELEASED', 'REFUNDED', 'PARTIAL_REFUND'];

/**
 * Pembayaran masuk yang tidak boleh diterapkan ke escrow (tagihan kedaluwarsa / escrow final): dana dicatat sebagai
 * utang ke pembayar dan diantrekan refund penuh lewat penyedia (job `refund-dispatch`). Idempoten per invoice.
 */
async function refundUnappliedPayment(c: Client, inv: any, ev: PgEvent, reason: string) {
  const amount = Number(inv.amount);
  await post(c, {
    key: `pg:${ev.event_id}`,
    kind: 'payment.unapplied',
    referenceId: inv.reference_id,
    description: `${inv.description} — ${reason}`,
    lines: [D(ESCROW_BANK, amount), C(LedgerAccounts.refundPayable(inv.payer_user_id), amount)],
  });
  await c.query(`UPDATE invoices SET status='PAID', paid_at=$2, provider=$3 WHERE id=$1`, [inv.id, ev.paid_at, inv.provider ?? 'sandbox']);
  await c.query(
    `INSERT INTO refunds (id, invoice_id, purpose, reference_id, payer_user_id, escrow_amount, fee_amount, amount, escrow_pct, reason, status, provider)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,100,$9,'REQUESTED',$10) ON CONFLICT (invoice_id) DO NOTHING`,
    [uuidv7(), inv.id, inv.purpose, inv.reference_id, inv.payer_user_id, Number(inv.escrow_amount), Number(inv.fee_amount), amount, reason, inv.provider ?? 'sandbox'],
  );
}

// ---------------- Refund ke pembeli (REQ-TIX-05) ----------------
/**
 * Minta refund satu invoice tiket PAID: porsi `escrowPct` dari bagian escrow (sisanya tetap di escrow event → milik
 * promotor) + biaya layanan bila `refundFee`. Idempoten per invoice (UNIQUE refunds.invoice_id).
 * Jurnal akrual: escrow event (+ pendapatan biaya layanan) → `liability:refund:<pembeli>`. Uang baru keluar dari
 * rekening escrow saat penyedia mengonfirmasi (`settleRefund`); pengiriman ke penyedia dikerjakan job `refund-dispatch`.
 * Tidak dapat diproses (mis. escrow sudah dicairkan ke promotor) → `finance.refund.failed` tanpa baris refund.
 */
export async function refundTicketOrder(c: Client, p: { orderId: string; escrowPct: number; refundFee: boolean; reason: string }) {
  const inv = (await c.query(`SELECT * FROM invoices WHERE purpose='TICKET_ORDER' AND reference_id=$1 FOR UPDATE`, [p.orderId])).rows[0];
  const reject = async (error: string) => {
    await publish(c, 'finance.refund.failed', p.orderId, { invoiceId: inv?.id ?? null, purpose: 'TICKET_ORDER', referenceId: p.orderId, reason: p.reason, error });
    return null;
  };
  if (!inv) return reject('Invoice order tidak ditemukan');
  const prev = (await c.query(`SELECT * FROM refunds WHERE invoice_id=$1`, [inv.id])).rows[0];
  if (prev) return prev; // event dikirim ulang → tidak ada refund ganda
  if (inv.status !== 'PAID') return reject(`Invoice berstatus ${inv.status}, bukan PAID`);

  const amt = ticketRefundAmount({ escrowAmount: Number(inv.escrow_amount), feeAmount: Number(inv.fee_amount) }, p);
  const eventId = ticketEventId(inv);
  const ref = `event:${eventId}`;
  const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [ref])).rows[0];
  const available = h ? Number(h.held) - Number(h.released) - Number(h.refunded) : 0;
  if (amt.escrow > available) return reject(`Dana escrow event tidak cukup (tersedia ${available}, perlu ${amt.escrow}) — kemungkinan sudah dicairkan ke promotor`);

  const id = uuidv7();
  if (amt.total > 0) {
    const lines = [];
    if (amt.escrow) lines.push(D(LedgerAccounts.escrowEvent(eventId), amt.escrow));
    if (amt.fee) lines.push(D(LedgerAccounts.ticketFee(), amt.fee)); // biaya layanan dibalik dari pendapatan
    lines.push(C(LedgerAccounts.refundPayable(inv.payer_user_id), amt.total)); // utang ke pembeli sampai dana terkirim
    await post(c, { key: `refund:invoice:${inv.id}`, kind: 'refund.ticket', referenceId: p.orderId, description: `Refund tiket — ${p.reason}`, lines });
  }
  if (h && amt.escrow) {
    await c.query(
      // Status tetap: escrow event menerima penjualan berikutnya dan dicairkan setelah event selesai.
      `UPDATE escrow_holds SET refunded = refunded + $2, updated_at = now() WHERE reference_id = $1`,
      [ref, amt.escrow],
    );
  }
  const r = (
    await c.query(
      `INSERT INTO refunds (id, invoice_id, purpose, reference_id, payer_user_id, escrow_amount, fee_amount, amount, escrow_pct, reason, status, provider)
       VALUES ($1,$2,'TICKET_ORDER',$3,$4,$5,$6,$7,$8,$9,'REQUESTED',$10) RETURNING *`,
      [id, inv.id, p.orderId, inv.payer_user_id, amt.escrow, amt.fee, amt.total, p.escrowPct, p.reason, inv.provider ?? 'sandbox'],
    )
  ).rows[0];
  // Nominal nol (mis. porsi 0%) tidak perlu dikirim ke penyedia.
  if (amt.total === 0) return settleRefund(c, r, { status: 'COMPLETED', settledBy: 'system' });
  return r;
}

/**
 * Hasil akhir refund (idempoten: hanya dari REQUESTED/PENDING). COMPLETED → utang ke pembeli lunas, kas escrow keluar,
 * `finance.refund.completed`. FAILED → utang tetap tercatat (dana masih milik pembeli) untuk dicoba ulang / transfer manual.
 */
export async function settleRefund(
  c: Client,
  r: any,
  o: { status: 'COMPLETED' | 'FAILED'; settledBy: string; manualRef?: string | null; error?: string | null },
) {
  const upd = await c.query(
    `UPDATE refunds SET status = $2, completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() END, settled_by = $3, manual_ref = coalesce($4, manual_ref), error = $5
     WHERE id = $1 AND status IN ('REQUESTED','DISPATCHING','PENDING','FAILED') AND ($2 = 'COMPLETED' OR status <> 'FAILED') RETURNING *`,
    [r.id, o.status, o.settledBy, o.manualRef ?? null, o.error ?? null],
  );
  if (!upd.rowCount) return null; // sudah final (webhook dikirim ulang)
  const row = upd.rows[0];
  if (o.status === 'COMPLETED') {
    if (Number(row.amount) > 0)
      await post(c, {
        key: `refund-settle:${row.id}`,
        kind: 'refund.settle',
        referenceId: row.reference_id,
        description: o.manualRef ? `Refund ditransfer manual (${o.manualRef})` : `Refund dikonfirmasi penyedia (${row.provider_ref ?? row.provider})`,
        lines: [D(LedgerAccounts.refundPayable(row.payer_user_id), Number(row.amount)), C(ESCROW_BANK, Number(row.amount))],
      });
    await publish(c, 'finance.refund.completed', row.reference_id, {
      refundId: row.id,
      invoiceId: row.invoice_id,
      purpose: row.purpose,
      referenceId: row.reference_id,
      amount: Number(row.amount),
      payerUserId: row.payer_user_id,
      reason: row.reason,
    });
  } else {
    await publish(c, 'finance.refund.failed', row.reference_id, {
      invoiceId: row.invoice_id,
      purpose: row.purpose,
      referenceId: row.reference_id,
      reason: row.reason,
      error: o.error ?? 'Ditolak penyedia pembayaran',
    });
  }
  return row;
}

/** Webhook refund dari penyedia: `{ event_id, refund_ref, status: COMPLETED|FAILED, failure_reason? }` (dedupe per event_id). */
export async function processRefundEvent(c: Client, provider: string, ev: { event_id: string; refund_ref: string; status: 'COMPLETED' | 'FAILED'; failure_reason?: string }) {
  const r = (await c.query(`SELECT * FROM refunds WHERE provider = $1 AND provider_ref = $2 FOR UPDATE`, [provider, ev.refund_ref])).rows[0];
  if (!r) throw notFound('Refund');
  const dup = await c.query(
    `INSERT INTO pg_webhook_events (event_id, provider, invoice_id, status, payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1`,
    [ev.event_id, provider, r.invoice_id, `REFUND_${ev.status}`, JSON.stringify(ev)],
  );
  if (!dup.rowCount) return { duplicate: true };
  await settleRefund(c, r, { status: ev.status, settledBy: 'provider', error: ev.status === 'FAILED' ? (ev.failure_reason ?? 'Ditolak penyedia') : null });
  return { duplicate: false };
}

// ---------------- Pencairan & refund (§7.2 langkah 6, §7.3) ----------------
export async function releaseEscrow(
  c: Client,
  ref: string,
  p: { fee: number; splits: { partyId: string; pct: number }[]; payeeType: 'individual' | 'company' },
  note = 'Pencairan escrow sesuai split',
) {
  const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [ref])).rows[0];
  // Dipanggil dari consumer/job: kondisi "tidak ada yang dicairkan" = no-op (melempar → dead letter).
  if (!h || TERMINAL_HOLD.includes(h.status)) return null;
  // Tagihan tersisa (mis. pelunasan saat dispute diputus) tidak berlaku lagi; bila tetap dibayar → dikembalikan.
  await c.query(`UPDATE invoices SET status='EXPIRED' WHERE reference_id=$1 AND status='PENDING'`, [ref]);
  const amount = h.held - h.released - h.refunded;
  if (amount <= 0) return null;
  const commission = Math.min(amount, pct(p.fee || amount, settings.num('commission.artist_commission_pct')));
  const net = amount - commission;
  const parts = allocate(net, p.splits).filter((x) => x.amount > 0);
  const lines = [D(LedgerAccounts.escrowBooking(ref), amount), C(LedgerAccounts.commissionOffair(), commission)];
  let taxTotal = 0;
  const out: { partyId: string; amount: number }[] = [];
  for (const x of parts) {
    const tax = withholdingTax(x.amount, p.payeeType);
    taxTotal += tax;
    lines.push(C(payableAccount(x.partyId, 'offair'), x.amount - tax));
    out.push({ partyId: x.partyId, amount: x.amount - tax });
    await c.query(`INSERT INTO disbursements (id, reference_id, party_id, gross, tax, net, source) VALUES ($1,$2,$3,$4,$5,$6,'offair')`, [
      uuidv7(), ref, x.partyId, x.amount, tax, x.amount - tax,
    ]);
  }
  if (taxTotal) lines.push(C(LedgerAccounts.taxWithholding(), taxTotal));
  await post(c, { key: `release:${ref}`, kind: 'escrow.release', referenceId: ref, description: note, lines });
  await c.query(`UPDATE escrow_holds SET released = released + $2, status='RELEASED', frozen=false, release_at=null, updated_at=now() WHERE reference_id=$1`, [ref, amount]);
  await publish(c, 'finance.escrow.released', ref, { referenceId: ref, amount, lines: out });
  return { amount, commission, tax: taxTotal, lines: out };
}

/** Escrow penjualan tiket `event:<id>` → payable promotor (sumber `ticket`). Biaya layanan tiket sudah dipotong saat pembayaran. */
export async function releaseEventEscrow(c: Client, ref: string, note = 'Pencairan hasil penjualan tiket') {
  const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [ref])).rows[0];
  if (!h || h.kind !== 'EVENT' || h.frozen || h.status !== 'HELD') return null;
  if (!h.promotor_org_id) throw conflict('Escrow event tanpa org promotor');
  const amount = h.held - h.released - h.refunded;
  if (amount <= 0) return null;
  const party = h.promotor_org_id;
  await post(c, {
    key: `release:${ref}`,
    kind: 'escrow.release',
    referenceId: ref,
    description: note,
    lines: [D(LedgerAccounts.escrowEvent(ref.slice('event:'.length)), amount), C(payableAccount(party, 'ticket'), amount)],
  });
  await c.query(`INSERT INTO disbursements (id, reference_id, party_id, gross, tax, net, source) VALUES ($1,$2,$3,$4,0,$4,'ticket')`, [uuidv7(), ref, party, amount]);
  await c.query(`UPDATE escrow_holds SET released = released + $2, status='RELEASED', release_at=null, updated_at=now() WHERE reference_id=$1`, [ref, amount]);
  await publish(c, 'finance.escrow.released', ref, { referenceId: ref, amount, lines: [{ partyId: party, amount }] });
  return { amount };
}

export async function refundEscrow(c: Client, ref: string, toArtist: number, artistParty: string | null, reason: string) {
  const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [ref])).rows[0];
  // Tagihan yang belum dibayar tidak berlaku lagi.
  await c.query(`UPDATE invoices SET status='EXPIRED' WHERE reference_id=$1 AND status='PENDING'`, [ref]);
  // Escrow sudah final (dicairkan / direfund): tidak ada dana yang bisa dipindah — jangan timpa statusnya.
  if (!h || TERMINAL_HOLD.includes(h.status)) return null;
  const amount = h.held - h.released - h.refunded;
  if (amount <= 0) {
    await c.query(`UPDATE escrow_holds SET status='REFUNDED', frozen=false, release_at=null, updated_at=now() WHERE reference_id=$1`, [ref]);
    return { refund: 0, toArtist: 0 };
  }
  const forfeit = Math.min(Math.max(0, toArtist), amount);
  const refund = amount - forfeit;
  const party = artistParty ?? h.artist_org_id ?? h.artist_id;
  const lines = [D(LedgerAccounts.escrowBooking(ref), amount)];
  // Refund dikembalikan ke rekening sumber promotor lewat mitra escrow (dana keluar dari escrow bank).
  if (refund) lines.push(C(ESCROW_BANK, refund));
  if (forfeit) lines.push(C(payableAccount(party, 'offair'), forfeit));
  await post(c, { key: `refund:${ref}`, kind: 'escrow.refund', referenceId: ref, description: reason, lines });
  await c.query(
    `UPDATE escrow_holds SET refunded = refunded + $2, released = released + $3, status=$4, frozen=false, release_at=null, updated_at=now() WHERE reference_id=$1`,
    [ref, refund, forfeit, forfeit ? 'PARTIAL_REFUND' : 'REFUNDED'],
  );
  await publish(c, 'finance.escrow.refunded', ref, { referenceId: ref, amount: refund, promotorOrgId: h.promotor_org_id, promotorUserId: h.promotor_user_id });
  if (forfeit) await publish(c, 'finance.escrow.released', ref, { referenceId: ref, amount: forfeit, lines: [{ partyId: party, amount: forfeit }] });
  return { refund, toArtist: forfeit };
}
