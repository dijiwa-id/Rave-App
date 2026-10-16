// QR e-ticket berputar (TOTP-like) — REQ-TIX-02, TDD §11.1 tickets.secret.
import { createHmac } from 'node:crypto';

export const QR_STEP_SECONDS = 15;

export function rotatingCode(secret: string, atMs: number = Date.now(), step = QR_STEP_SECONDS): string {
  const counter = Math.floor(atMs / 1000 / step);
  const h = createHmac('sha256', secret).update(String(counter)).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Validasi kode dengan toleransi ±1 langkah untuk clock skew di gate. */
export function verifyRotatingCode(secret: string, code: string, atMs: number = Date.now(), window = 1): boolean {
  for (let w = -window; w <= window; w++) {
    if (rotatingCode(secret, atMs + w * QR_STEP_SECONDS * 1000) === code) return true;
  }
  return false;
}

export const RESERVATION_MINUTES = 10;

// ---------------- Refund tiket (REQ-TIX-05) ----------------

/** Alasan refund — menentukan porsi yang kembali dan isi notifikasi ke pembeli. */
export type TicketRefundReason = 'event_cancelled' | 'rescheduled' | 'buyer_request' | 'late_payment' | 'admin';

export const TICKET_REFUND_REASON_LABEL: Record<TicketRefundReason, string> = {
  event_cancelled: 'Event dibatalkan penyelenggara',
  rescheduled: 'Jadwal atau venue event berubah',
  buyer_request: 'Permintaan pembeli',
  late_payment: 'Pembayaran diterima setelah reservasi berakhir',
  admin: 'Keputusan tim GEMA',
};

/** Kebijakan dari pengaturan Super Admin (`refund.*`). */
export interface TicketRefundPolicy {
  buyerRequestEnabled: boolean;
  buyerDeadlineDays: number;
  buyerRefundPct: number;
  rescheduleOptOutDays: number;
}

export interface TicketRefundQuote {
  eligible: boolean;
  reason?: TicketRefundReason;
  /** Persentase harga tiket (bagian escrow) yang dikembalikan. */
  escrowPct: number;
  /** Biaya layanan ikut dikembalikan (hanya bila kesalahan bukan di pembeli). */
  refundFee: boolean;
  /** Batas akhir pengajuan untuk alasan ini. */
  deadline?: Date;
  /** Penjelasan untuk pembeli (layak maupun tidak). */
  message: string;
}

const DAY = 86_400_000;

/**
 * Kelayakan refund atas permintaan pembeli untuk satu order PAID pada event yang masih PUBLISHED.
 * Prioritas: perubahan jadwal/venue (penuh + biaya layanan, selama masa opt-out) → permintaan biasa (porsi kebijakan,
 * tanpa biaya layanan, sampai H-n). Pembatalan event & pembayaran terlambat diproses otomatis, bukan lewat fungsi ini.
 */
export function quoteTicketRefund(
  o: { startsAt: Date; rescheduledAt?: Date | null; checkedIn: boolean },
  policy: TicketRefundPolicy,
  now: Date = new Date(),
): TicketRefundQuote {
  if (o.checkedIn) return { eligible: false, escrowPct: 0, refundFee: false, message: 'Tiket di order ini sudah dipakai check-in.' };
  if (now >= o.startsAt) return { eligible: false, escrowPct: 0, refundFee: false, message: 'Event sudah dimulai.' };
  if (o.rescheduledAt && policy.rescheduleOptOutDays > 0) {
    const deadline = new Date(Math.min(o.rescheduledAt.getTime() + policy.rescheduleOptOutDays * DAY, o.startsAt.getTime()));
    if (now < deadline)
      return { eligible: true, reason: 'rescheduled', escrowPct: 100, refundFee: true, deadline, message: 'Jadwal atau venue berubah — kamu berhak refund penuh, termasuk biaya layanan.' };
  }
  if (!policy.buyerRequestEnabled)
    return { eligible: false, escrowPct: 0, refundFee: false, message: 'Tiket tidak dapat direfund kecuali event dibatalkan atau jadwalnya berubah.' };
  const deadline = new Date(o.startsAt.getTime() - policy.buyerDeadlineDays * DAY);
  if (now > deadline) return { eligible: false, escrowPct: 0, refundFee: false, deadline, message: `Batas pengajuan refund adalah H-${policy.buyerDeadlineDays} sebelum event.` };
  return {
    eligible: true,
    reason: 'buyer_request',
    escrowPct: policy.buyerRefundPct,
    refundFee: false,
    deadline,
    message: `${policy.buyerRefundPct}% harga tiket dikembalikan; biaya layanan tidak dikembalikan.`,
  };
}

/** Nominal refund dari rincian tagihan (bagian escrow + biaya layanan) — dipakai finance & pratinjau UI. */
export function ticketRefundAmount(inv: { escrowAmount: number; feeAmount: number }, q: { escrowPct: number; refundFee: boolean }) {
  const escrow = Math.floor((inv.escrowAmount * Math.round(q.escrowPct * 100)) / 10000);
  const fee = q.refundFee ? inv.feeAmount : 0;
  return { escrow, fee, total: escrow + fee };
}
