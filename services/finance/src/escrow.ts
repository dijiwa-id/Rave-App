import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { DEFAULT_COMMISSION, LedgerAccounts, allocate, pct, withholdingTax, type PaymentPurpose } from '@gema/domain';
import { badRequest, config, conflict, notFound, publish, unauthorized, uuidv7, type Client } from '@gema/service-kit';
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
      `00020101021226590014ID.CO.GEMA.WWW0118GEMA${id.slice(0, 8)}5204599953033605405${amount}5802ID5904GEMA6007JAKARTA6304`, i.dependsOn ?? null,
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
  if (inv.status === 'PAID') return { duplicate: true };
  if (ev.status === 'FAILED') {
    await c.query(`UPDATE invoices SET status='FAILED' WHERE id=$1`, [inv.id]);
    await publish(c, 'finance.payment.failed', inv.reference_id, { intentId: inv.id, purpose: inv.purpose, referenceId: inv.reference_id });
    return { duplicate: false };
  }
  if (Number(ev.amount) !== Number(inv.amount)) throw badRequest(`Jumlah pembayaran ${ev.amount} ≠ tagihan ${inv.amount}`);

  const lines = [D(ESCROW_BANK, inv.amount)];
  let holdRef = inv.reference_id;
  if (inv.purpose === 'BOOKING_DP' || inv.purpose === 'BOOKING_SETTLEMENT') {
    lines.push(C(LedgerAccounts.escrowBooking(inv.reference_id), inv.escrow_amount));
    if (inv.fee_amount) lines.push(C(LedgerAccounts.serviceFeeOffair(), inv.fee_amount));
  } else if (inv.purpose === 'TICKET_ORDER') {
    const eventId = inv.metadata?.event_id ?? inv.reference_id;
    holdRef = `event:${eventId}`;
    lines.push(C(LedgerAccounts.escrowEvent(eventId), inv.escrow_amount));
    if (inv.fee_amount) lines.push(C(LedgerAccounts.ticketFee(), inv.fee_amount));
  } else {
    lines.push(C(`revenue:${inv.purpose.toLowerCase()}`, inv.amount));
  }
  await post(c, { key: `pg:${ev.event_id}`, kind: `payment.${inv.purpose.toLowerCase()}`, referenceId: inv.reference_id, description: inv.description, lines });
  await c.query(`UPDATE invoices SET status='PAID', paid_at=$2 WHERE id=$1`, [inv.id, ev.paid_at]);

  if (inv.purpose === 'TICKET_ORDER') {
    await c.query(
      `INSERT INTO escrow_holds (reference_id, kind, promotor_org_id, held, status) VALUES ($1,'EVENT',$2,$3,'HELD')
       ON CONFLICT (reference_id) DO UPDATE SET held = escrow_holds.held + EXCLUDED.held, updated_at=now()`,
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

// ---------------- Pencairan & refund (§7.2 langkah 6, §7.3) ----------------
export async function releaseEscrow(
  c: Client,
  ref: string,
  p: { fee: number; splits: { partyId: string; pct: number }[]; payeeType: 'individual' | 'company' },
  note = 'Pencairan escrow sesuai split',
) {
  const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [ref])).rows[0];
  if (!h) throw notFound('Escrow');
  if (h.status === 'RELEASED' || h.status === 'REFUNDED') return null;
  const amount = h.held - h.released - h.refunded;
  if (amount <= 0) throw conflict('Tidak ada dana escrow untuk dicairkan');
  const commission = Math.min(amount, pct(p.fee || amount, DEFAULT_COMMISSION.artistCommissionPct));
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

export async function refundEscrow(c: Client, ref: string, toArtist: number, artistParty: string | null, reason: string) {
  const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [ref])).rows[0];
  if (!h) return null;
  // Tagihan yang belum dibayar tidak berlaku lagi.
  await c.query(`UPDATE invoices SET status='EXPIRED' WHERE reference_id=$1 AND status='PENDING'`, [ref]);
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
  await publish(c, 'finance.escrow.refunded', ref, { referenceId: ref, amount: refund });
  if (forfeit) await publish(c, 'finance.escrow.released', ref, { referenceId: ref, amount: forfeit, lines: [{ partyId: party, amount: forfeit }] });
  return { refund, toArtist: forfeit };
}
