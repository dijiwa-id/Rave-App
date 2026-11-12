import type { FastifyRequest } from 'fastify';
import {
  assertContractTransition,
  bookingInvoice,
  expectedSigner,
  isContractLocked,
  statusAfterSign,
  type ContractStatus,
  type SignParty,
} from '@rave/domain';
import { audit, conflict, forbidden, managedArtistIds, notFound, publish, unprocessable, type AuthUser, type Client, type Db } from '@rave/service-kit';
import { commissionPolicy, isPromotorMember, type BookingRow } from './common.js';
import { enqueueContractJob } from './contract-jobs.js';
import { contractAudit } from './routes-contracts.js';
import { loadBooking, managementOrgId, transition, freezeReleaseTerms } from './repo.js';
import { getProvider, type SignContext, type SignatureRequest } from './signature-provider.js';

const PARTY_LABEL: Record<SignParty, string> = { promotor: 'Promotor', management: 'Manajemen', artist: 'Artis' };

/** Apakah pengguna berhak bertindak sebagai `party` pada booking ini (RBAC per pihak). */
export function canSignAs(u: AuthUser | null, b: BookingRow, party: SignParty): boolean {
  if (!u) return false;
  if (party === 'promotor') return isPromotorMember(u, b.promotor_org_id);
  if (party === 'management') return managedArtistIds(u).includes(b.artist_id);
  return !!b.artist_org_id && u.orgs.some((o) => o.id === b.artist_org_id && o.type === 'ARTIST');
}

/** Pihak yang sedang ditunggu & boleh dimainkan pengguna; melempar 403/409 bila bukan gilirannya. */
async function resolveTurn(db: Db, u: AuthUser | null, contractId: string) {
  const k = await db.one(`SELECT * FROM contracts WHERE id=$1`, [contractId]);
  if (!k) throw notFound('Kontrak');
  const b = (await db.one<BookingRow>(`SELECT * FROM bookings WHERE id=$1`, [k.booking_id]))!;
  const turn = expectedSigner(k.status as ContractStatus);
  const involved = (['promotor', 'management', 'artist'] as const).some((p) => canSignAs(u, b, p));
  if (!involved) throw forbidden('Bukan pihak dalam kontrak ini');
  if (!turn) throw conflict(isContractLocked(k.status) ? `Kontrak sudah final (${k.status})` : `Kontrak belum menunggu tanda tangan (${k.status})`);
  if (!canSignAs(u, b, turn)) throw conflict(`Saat ini giliran ${PARTY_LABEL[turn]} menandatangani`);
  if (!k.draft_key || !k.draft_sha256) throw conflict('Dokumen PDF belum siap; coba lagi sebentar');
  const dup = await db.one(`SELECT 1 FROM signatures WHERE contract_id=$1 AND signer_user_id=$2`, [contractId, u!.sub]);
  if (dup) throw conflict('Anda sudah menandatangani kontrak ini (satu akun tidak boleh mewakili dua pihak)');
  return { k, b, party: turn };
}

const ctxOf = (u: AuthUser, k: any, party: SignParty): SignContext => ({
  contractId: k.id,
  party,
  userId: u.sub,
  destination: { channel: 'email', value: u.email ?? '' },
  docSha256: k.draft_sha256,
});

export async function requestSignOtp(db: Db, req: FastifyRequest, contractId: string): Promise<SignatureRequest & { party: SignParty }> {
  const u = req.user!;
  if (!u.email) throw unprocessable('Akun Anda tidak punya alamat email untuk menerima OTP');
  const { k, party } = await resolveTurn(db, u, contractId);
  const out = await getProvider().requestSignature(db, ctxOf(u, k, party));
  await contractAudit(db, { contractId, action: 'sign.otp_requested', actorId: u.sub, party, req, data: { channel: out.channel } });
  req.log.info({ contractId, party, to: out.destination_masked }, 'OTP tanda tangan diterbitkan');
  return { ...out, party };
}

/** Verifikasi OTP lalu catat tanda tangan + majukan status kontrak dalam satu transaksi. */
export async function verifySignOtp(db: Db, req: FastifyRequest, contractId: string, code: string) {
  const u = req.user!;
  const { k, party } = await resolveTurn(db, u, contractId);
  const provider = getProvider();
  const ctx = ctxOf(u, k, party);
  let result;
  try {
    result = await provider.verify(db, ctx, { code });
  } catch (e) {
    await contractAudit(db, { contractId, action: 'sign.otp_failed', actorId: u.sub, party, req });
    throw e;
  }
  return db.tx(async (c) => {
    // Cek ulang di bawah kunci: status & giliran bisa berubah sejak resolveTurn.
    const b = await loadBooking(c, k.booking_id, true);
    const cur = (await c.query(`SELECT * FROM contracts WHERE id=$1 FOR UPDATE`, [contractId])).rows[0];
    if (expectedSigner(cur.status) !== party) throw conflict('Status kontrak berubah; muat ulang halaman');
    if (cur.draft_sha256 !== k.draft_sha256) throw conflict('Dokumen berubah sejak OTP diminta; minta OTP baru');
    const name = u.name ?? u.email ?? 'Penandatangan';
    const ins = await c.query(
      `INSERT INTO signatures (contract_id, party, signer_name, signer_user_id, provider_ref, method, status, ip_address, user_agent, otp_verified_at, doc_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,'SIGNED',$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [contractId, party, name, u.sub, result.providerRef, result.method, req.ip, (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null, result.verifiedAt, cur.draft_sha256],
    );
    if (ins.rowCount === 0) throw conflict('Pihak ini sudah menandatangani');
    const next = statusAfterSign(cur.status, party, cur.require_artist_ack);
    assertContractTransition(cur.status, next, 'system');
    await c.query(`UPDATE contracts SET status=$2, signed_at = CASE WHEN $2='ACTIVE' THEN now() ELSE signed_at END WHERE id=$1`, [contractId, next]);
    await contractAudit(c, { contractId, action: party === 'artist' ? 'ack' : 'sign', actorId: u.sub, party, req, data: { method: result.method, doc_sha256: cur.draft_sha256, status: next } });
    await audit(c, { actorId: u.sub, action: 'contract.sign', entity: 'contract', entityId: contractId, data: { party, sha256: cur.draft_sha256 }, ip: req.ip });
    if (next === 'ACTIVE') {
      await activateBooking(c, b, contractId, cur.draft_sha256);
      await enqueueContractJob(c, contractId, 'RENDER_FINAL'); // PDF final + lembar pengesahan (contract-jobs.ts)
    } else {
      await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor, actor_id, note) VALUES ($1,$2,$2,$3,$4,$5)`, [
        b.id, b.status, party === 'artist' ? 'management' : party, u.sub, `Ditandatangani oleh ${PARTY_LABEL[party]} (${name}); menunggu ${PARTY_LABEL[expectedSigner(next)!]}`,
      ]);
      // Beri tahu pihak berikutnya bahwa sekarang gilirannya menandatangani (audit go-live: sebelumnya tidak ada notifikasi).
      const nextParty = expectedSigner(next);
      if (nextParty)
        await publish(c, 'booking.contract.sign_requested', b.id, {
          bookingId: b.id, contractId, artistId: b.artist_id, promotorOrgId: b.promotor_org_id, signedBy: PARTY_LABEL[party], nextParty: nextParty as 'promotor' | 'management' | 'artist', eventName: b.event_name,
        });
    }
    return { contract_id: contractId, party, status: next, signed: true };
  });
}

/** Semua pihak selesai: booking → SIGNED dan event ke finance (invoice DP & pelunasan). Dipakai juga alur lama (status SENT). */
export async function activateBooking(c: Client, b: BookingRow, contractId: string, sha: string) {
  const nb = await transition(c, b, 'SIGNED', 'system', { note: `Ditandatangani semua pihak · sha256 ${sha.slice(0, 12)}…` });
  await freezeReleaseTerms(c, nb, contractId);
  const inv = bookingInvoice(nb.agreed_fee!, nb.dp_pct, commissionPolicy());
  await publish(c, 'booking.contract.signed', nb.id, {
    bookingId: nb.id,
    contractId,
    fee: inv.fee,
    dpAmount: inv.dp,
    settlementAmount: inv.settlement,
    serviceFee: inv.serviceFee,
    promotorOrgId: nb.promotor_org_id,
    artistId: nb.artist_id,
    managementOrgId: await managementOrgId(c, nb),
    artistOrgId: nb.artist_org_id,
    promotorUserId: nb.promotor_user_id,
    eventDate: nb.event_date,
    settlementDaysBefore: nb.settlement_days_before,
    eventName: nb.event_name,
  });
  return nb;
}
