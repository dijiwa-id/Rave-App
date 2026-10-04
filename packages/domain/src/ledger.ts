// Ledger double-entry — TDD §11.1. debit total harus = kredit total per transaksi.

export type EntrySide = 'DEBIT' | 'CREDIT';
export interface LedgerLine {
  account: string; // mis. "asset:escrow_bank:mitra-x", "liability:escrow:booking:<id>"
  side: EntrySide;
  amount: number;
}

export class UnbalancedTransactionError extends Error {}

export function assertBalanced(lines: LedgerLine[]): void {
  if (lines.length < 2) throw new UnbalancedTransactionError('Transaksi minimal 2 baris');
  let d = 0;
  let c = 0;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount) || l.amount <= 0) throw new UnbalancedTransactionError(`Jumlah tidak valid: ${l.amount}`);
    if (l.side === 'DEBIT') d += l.amount;
    else c += l.amount;
  }
  if (d !== c) throw new UnbalancedTransactionError(`Debit ${d} ≠ kredit ${c}`);
}

export const LedgerAccounts = {
  escrowBank: (partner = 'mitra-sandbox') => `asset:escrow_bank:${partner}`,
  escrowBooking: (bookingId: string) => `liability:escrow:booking:${bookingId}`,
  escrowEvent: (eventId: string) => `liability:escrow:event:${eventId}`,
  payable: (partyId: string) => `liability:payable:${partyId}`,
  taxWithholding: () => 'liability:tax_withholding:pph',
  commissionOffair: () => 'revenue:commission:offair',
  serviceFeeOffair: () => 'revenue:service_fee:offair',
  ticketFee: () => 'revenue:service_fee:ticket',
  refundPayable: (partyId: string) => `liability:refund:${partyId}`,
  payoutClearing: () => 'asset:payout_clearing',
};
