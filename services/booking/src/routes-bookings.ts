import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  BOOKING_STATUS_LABEL,
  EVENT_CATEGORIES,
  PERFORMANCE_FORMATS,
  bookingInvoice,
  computeCancellation,
  contactRevealed,
  type BookingStatus,
} from '@gema/domain';
import {
  audit,
  badRequest,
  conflict,
  forbidden,
  idempotent,
  isAdmin,
  managedArtistIds,
  notFound,
  publish,
  requireAuth,
  settings,
  uuidv7,
  z,
  type AuthUser,
  type Client,
  type Db,
  type ServiceContext,
} from '@gema/service-kit';
import { FAST_CLOCK, RATING_REVEAL_DAYS, commissionPolicy, daysUntil, isPromotorMember, partyOf, requireParty, todayWib, type BookingRow, type Party } from './common.js';
import { renderContract } from './contract.js';
import { SPK_TEMPLATE_VERSION, buildContractData } from './contract-data.js';
import { enqueueContractJob } from './contract-jobs.js';
import { contractAudit } from './routes-contracts.js';
import { feeSplits, loadBooking, managementOrgId, transition } from './repo.js';

const SUMMARY_SQL = `SELECT b.*, a.name AS artist_name, a.image_url AS artist_image, a.city AS artist_city, coalesce(o.name, 'Promotor') AS promotor_name
  FROM bookings b JOIN artists a ON a.id=b.artist_id LEFT JOIN orgs o ON o.id=b.promotor_org_id`;

export function toSummary(r: any) {
  return {
    id: r.id,
    status: r.status,
    status_label: BOOKING_STATUS_LABEL[r.status as BookingStatus] ?? r.status,
    artist: { id: r.artist_id, name: r.artist_name, image_url: r.artist_image },
    promotor_org: { id: r.promotor_org_id, name: r.promotor_name },
    event_name: r.event_name,
    event_date: r.event_date,
    city: r.city,
    venue: r.venue,
    category: r.category,
    format: r.format,
    latest_fee: r.agreed_fee ?? r.latest_fee,
    budget: r.budget,
    updated_at: r.updated_at,
  };
}

const mask = (s?: string) => (s ? '***' : '');

/** Representasi lengkap booking untuk pihak terkait (docs/API.md §5 `Booking`). */
export async function bookingView(db: Db | Client, id: string, u: AuthUser | null) {
  const q = (sql: string, p: unknown[]) => (db as any).query(sql, p).then((r: any) => (Array.isArray(r) ? r : r.rows));
  const [r] = await q(`${SUMMARY_SQL} WHERE b.id=$1`, [id]);
  if (!r) throw notFound('Booking');
  const party = partyOf(u, r);
  if (!party) throw forbidden('Bukan pihak dalam booking ini');
  const [offers, messages, timeline, contracts, ratings, disputes, epk] = await Promise.all([
    q(`SELECT id, by_party, fee, dp_pct, settlement_days_before, rider_notes, message, created_at FROM offers WHERE booking_id=$1 ORDER BY created_at`, [id]),
    q(`SELECT id, by_party, author_name, body, created_at FROM messages WHERE booking_id=$1 ORDER BY created_at`, [id]),
    q(`SELECT from_status, to_status, actor, note, created_at FROM booking_events WHERE booking_id=$1 ORDER BY id`, [id]),
    q(`SELECT * FROM contracts WHERE booking_id=$1`, [id]),
    q(`SELECT by_party, scores, comment, created_at FROM ratings WHERE booking_id=$1`, [id]),
    q(`SELECT * FROM disputes WHERE booking_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]),
    q(`SELECT contact FROM epk WHERE artist_id=$1`, [r.artist_id]),
  ]);
  const contract = contracts[0] ?? null;
  const signatures = contract
    ? await q(`SELECT party, signer_name, signed_at FROM signatures WHERE contract_id=$1 ORDER BY signed_at`, [contract.id])
    : [];
  const fee = r.agreed_fee ?? r.latest_fee;
  // Kontak pihak lawan disamarkan sampai BOOKED (REQ-B2B-08)
  const reveal = contactRevealed(r.status) || party === 'admin';
  const other = party === 'promotor' ? (epk[0]?.contact ?? {}) : (r.promotor_contact ?? {});
  const contact = reveal
    ? { name: other.name ?? '', email: other.email ?? '', phone: other.phone ?? '' }
    : { name: other.name ?? (party === 'promotor' ? 'Manajemen' : r.promotor_name), email: mask(other.email), phone: mask(other.phone) };
  const mine = ratings.find((x: any) => x.by_party === party);
  const theirs = ratings.find((x: any) => x.by_party !== party);
  const first = ratings.map((x: any) => new Date(x.created_at).getTime()).sort()[0];
  const revealed = ratings.length >= 2 || (!!first && Date.now() - first > RATING_REVEAL_DAYS * 86400_000);
  return {
    ...toSummary(r),
    start_time: r.start_time,
    duration_min: r.duration_min,
    capacity: r.capacity,
    notes: r.notes,
    hold_expires_at: r.hold_expires_at,
    offers,
    messages,
    timeline,
    contract: contract
      ? { id: contract.id, booking_id: id, template_version: contract.template_version, body_markdown: contract.body_markdown, sha256: contract.sha256, status: contract.status, created_at: contract.created_at, signed_at: contract.signed_at }
      : null,
    invoice: fee ? invoiceDto(bookingInvoice(fee, r.dp_pct, commissionPolicy())) : null,
    contact,
    my_party: party,
    signatures,
    show_done: { promotor: r.show_done_promotor, management: r.show_done_management },
    rating: { mine_submitted: !!mine, revealed, ...(revealed && theirs ? { received: { scores: theirs.scores, comment: theirs.comment } } : {}) },
    dispute: disputes[0] ? pickDispute(disputes[0]) : null,
    cancellation: r.cancellation ?? null,
    payment: { dp_paid: r.dp_paid, settlement_paid: r.settlement_paid },
  };
}

export const pickDispute = (d: any) => ({
  id: d.id,
  booking_id: d.booking_id,
  by_party: d.by_party,
  reason: d.reason,
  status: d.status,
  outcome: d.outcome,
  note: d.note,
  created_at: d.created_at,
});

const inquirySchema = z.object({
  artist_id: z.string().uuid(),
  promotor_org_id: z.string().uuid(),
  event_name: z.string().min(3).max(160),
  event_date: z.string().date(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_min: z.number().int().min(10).max(600),
  city: z.string().min(2).max(80),
  venue: z.string().min(2).max(160),
  capacity: z.number().int().positive().max(1_000_000),
  category: z.enum(EVENT_CATEGORIES),
  format: z.enum(PERFORMANCE_FORMATS),
  budget: z.number().int().positive(),
  notes: z.string().max(4000).optional(),
  hold: z.boolean().optional(),
});

const offerSchema = z.object({
  fee: z.number().int().positive(),
  dp_pct: z.number().int().min(10).max(100).default(() => settings.num('booking.default_dp_pct')),
  settlement_days_before: z.number().int().min(1).max(60).default(() => settings.num('booking.settlement_days_before')),
  rider_notes: z.string().max(4000).optional(),
  message: z.string().max(4000).optional(),
});

async function ensureContract(c: Client, b: BookingRow, who: { actorId?: string; req?: FastifyRequest } = {}) {
  const off = b.latest_offer_id ? (await c.query(`SELECT rider_notes FROM offers WHERE id=$1`, [b.latest_offer_id])).rows[0] : null;
  const version = 1; // revisi (Tahap 6) membuat versi berikutnya
  const data = await buildContractData(c, b, { version, riderNotes: off?.rider_notes ?? null });
  // Teks markdown lama dipertahankan untuk kompatibilitas API/UI sampai viewer PDF menggantikannya (Tahap 7).
  const { body, sha256 } = renderContract({
    b,
    fee: b.agreed_fee!,
    artistName: data.artist.stage_name,
    artistCity: data.artist.city,
    promotorName: data.promotor.legal_name,
    rider: { ...data.rider.hospitality, ...data.rider.technical },
    riderNotes: data.rider.notes,
  });
  const id = uuidv7();
  await c.query(
    `INSERT INTO contracts (id, booking_id, template_version, body_markdown, sha256, version, contract_no, template_id, terms, data_snapshot, require_artist_ack, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + make_interval(days => $12))`,
    [id, b.id, data.template.version, body, sha256, version, data.contract_no, data.template.id, JSON.stringify(data.terms), JSON.stringify(data), data.terms.require_artist_ack, settings.num('contract.sign_window_days')],
  );
  await enqueueContractJob(c, id, 'RENDER_DRAFT');
  await contractAudit(c, { contractId: id, action: 'generate', actorId: who.actorId, req: who.req, data: { template: data.template, version } });
}

export async function bookingRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.addHook('preHandler', requireAuth);
  const view = (id: string, u: AuthUser | null, c?: Client) => bookingView(c ?? db, id, u);

  // ---------- Inquiry (REQ-B2B-08) ----------
  app.post('/v1/booking/inquiries', async (req, reply) => {
    const p = inquirySchema.parse(req.body);
    const u = req.user!;
    if (!isPromotorMember(u, p.promotor_org_id) && !isAdmin(u)) throw forbidden('Anda bukan anggota organisasi promotor ini');
    if (!u.kyc && !isAdmin(u)) throw forbidden('Verifikasi KYC/KYB wajib sebelum mengirim inquiry (REQ-IAM-04)');
    if (p.event_date <= todayWib()) throw badRequest('Tanggal acara harus di masa depan');
    return idempotent(db, req, reply, 'inquiry', async (c) => {
      const a = (await c.query(`SELECT * FROM artists WHERE id=$1`, [p.artist_id])).rows[0];
      if (!a) throw notFound('Artis');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cal:${p.artist_id}`]);
      const slots = (await c.query(`SELECT status FROM calendar_slots WHERE artist_id=$1 AND period @> $2::date`, [p.artist_id, p.event_date])).rows;
      if (slots.some((s) => !s.status.startsWith('HOLD') && s.status !== 'TRAVEL'))
        throw conflict('Tanggal tidak tersedia (Booked/Blocked). Pilih tanggal lain.', { type: 'https://gema.id/problems/schedule-conflict' });
      const id = uuidv7();
      const holdRank = slots.some((s) => s.status === 'HOLD_1') ? (slots.some((s) => s.status === 'HOLD_2') ? null : 'HOLD_2') : 'HOLD_1';
      if (p.hold && !holdRank) throw conflict('Sudah ada 1st & 2nd hold pada tanggal ini');
      const holdHours = settings.num('booking.hold_hours');
      const holdExpires = p.hold ? new Date(Date.now() + holdHours * 3600_000).toISOString() : null;
      await c.query(
        `INSERT INTO bookings (id, artist_id, artist_org_id, promotor_org_id, promotor_user_id, promotor_contact, status, event_name, event_date, start_time,
           duration_min, city, venue, capacity, category, format, budget, notes, hold_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [id, p.artist_id, a.org_id, p.promotor_org_id, u.sub, JSON.stringify({ name: u.name ?? '', email: u.email ?? '', phone: '' }), p.event_name, p.event_date,
          p.start_time, p.duration_min, p.city, p.venue, p.capacity, p.category, p.format, p.budget, p.notes ?? null, holdExpires],
      );
      const b = await loadBooking(c, id);
      await transition(c, b, 'INQUIRY', 'promotor', { actorId: u.sub, note: p.hold ? `Hold ${holdRank} ${holdHours} jam` : null });
      if (p.hold)
        await c.query(`INSERT INTO calendar_slots (id, artist_id, period, status, booking_id, note) VALUES ($1,$2, daterange($3::date,$3::date,'[]'), $4, $5, $6)`, [
          uuidv7(), p.artist_id, p.event_date, holdRank, id, p.event_name,
        ]);
      await publish(c, 'booking.inquiry.created', id, { bookingId: id, artistId: p.artist_id, promotorOrgId: p.promotor_org_id, eventDate: p.event_date, city: p.city, budget: p.budget });
      return { status: 201, body: await view(id, u, c) };
    });
  });

  // ---------- List & detail ----------
  app.get('/v1/booking/bookings', async (req) => {
    const q = z
      .object({ side: z.enum(['artist', 'promotor']).optional(), artist_id: z.string().uuid().optional(), org_id: z.string().uuid().optional(), status: z.string().optional() })
      .parse(req.query);
    const u = req.user!;
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('$?', `$${params.length}`));
    };
    if (!isAdmin(u)) {
      const artistIds = managedArtistIds(u);
      const orgIds = u.orgs.filter((o) => o.type === 'PROMOTOR').map((o) => o.id);
      if (q.side === 'artist') add('b.artist_id = ANY($?)', q.artist_id ? artistIds.filter((x) => x === q.artist_id) : artistIds);
      else if (q.side === 'promotor') add('b.promotor_org_id = ANY($?)', q.org_id ? orgIds.filter((x) => x === q.org_id) : orgIds);
      else {
        params.push(artistIds, orgIds);
        where.push(`(b.artist_id = ANY($${params.length - 1}) OR b.promotor_org_id = ANY($${params.length}))`);
      }
    } else {
      if (q.artist_id) add('b.artist_id = $?', q.artist_id);
      if (q.org_id) add('b.promotor_org_id = $?', q.org_id);
    }
    if (q.status) add('b.status = ANY($?)', q.status.split(','));
    const rows = await db.query(`${SUMMARY_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.updated_at DESC LIMIT 200`, params);
    return { data: rows.map(toSummary), next_cursor: null };
  });

  app.get('/v1/booking/bookings/:id', async (req) => view((req.params as any).id, req.user));

  // ---------- Offer / counter-offer ----------
  app.post('/v1/booking/bookings/:id/offers', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = offerSchema.parse(req.body);
    return idempotent(db, req, reply, `offer:${id}`, async (c) => {
      let b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      if (!['INQUIRY', 'NEGOTIATING'].includes(b.status)) throw conflict(`Tidak bisa mengirim offer pada status ${b.status}`);
      const offerId = uuidv7();
      await c.query(
        `INSERT INTO offers (id, booking_id, by_party, author_id, fee, dp_pct, settlement_days_before, rider_notes, message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [offerId, id, party, req.user!.sub, p.fee, p.dp_pct, p.settlement_days_before, p.rider_notes ?? null, p.message ?? null],
      );
      const set = { latest_offer_id: offerId, latest_fee: p.fee, dp_pct: p.dp_pct, settlement_days_before: p.settlement_days_before };
      if (b.status === 'INQUIRY') b = await transition(c, b, 'NEGOTIATING', party, { actorId: req.user!.sub, note: `Offer ${p.fee}`, set });
      else await c.query(`UPDATE bookings SET latest_offer_id=$2, latest_fee=$3, dp_pct=$4, settlement_days_before=$5, updated_at=now() WHERE id=$1`, [id, offerId, p.fee, p.dp_pct, p.settlement_days_before]);
      if (p.message)
        await c.query(`INSERT INTO messages (id, booking_id, by_party, author_id, author_name, body) VALUES ($1,$2,$3,$4,$5,$6)`, [uuidv7(), id, party, req.user!.sub, req.user!.name ?? party, p.message]);
      await publish(c, 'booking.offer.sent', id, { bookingId: id, artistId: b.artist_id, promotorOrgId: b.promotor_org_id, byParty: party, fee: p.fee });
      return { status: 201, body: await view(id, req.user, c) };
    });
  });

  app.post('/v1/booking/bookings/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body } = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);
    const b = await db.tx((c) => loadBooking(c, id));
    const party = requireParty(req.user, b);
    const m = await db.one(
      `INSERT INTO messages (id, booking_id, by_party, author_id, author_name, body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, by_party, author_name, body, created_at`,
      [uuidv7(), id, party, req.user!.sub, req.user!.name ?? party, body],
    );
    await db.query(`UPDATE bookings SET updated_at=now() WHERE id=$1`, [id]);
    reply.status(201);
    return m;
  });

  // ---------- Accept → AGREED → kontrak → CONTRACT_SENT ----------
  app.post('/v1/booking/bookings/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    return db.tx(async (c) => {
      let b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      if (b.status !== 'NEGOTIATING' || !b.latest_offer_id) throw conflict('Belum ada offer untuk disetujui');
      const offer = (await c.query(`SELECT * FROM offers WHERE id=$1`, [b.latest_offer_id])).rows[0];
      if (offer.by_party === party) throw conflict('Offer terakhir dikirim oleh pihak Anda; tunggu respons pihak lawan');
      b = await transition(c, b, 'AGREED', party, { actorId: req.user!.sub, note: `Fee disepakati ${offer.fee}`, set: { agreed_fee: offer.fee, hold_expires_at: null } });
      await audit(c, { actorId: req.user!.sub, action: 'booking.offer.accept', entity: 'booking', entityId: id, data: { offer_id: offer.id, fee: offer.fee }, ip: req.ip });
      await ensureContract(c, b, { actorId: req.user!.sub, req });
      await transition(c, b, 'CONTRACT_SENT', 'system', { note: `Kontrak ${SPK_TEMPLATE_VERSION} dibuat; PDF dirender & dikirim ke PSrE (sandbox)` });
      return view(id, req.user, c);
    });
  });

  app.post('/v1/booking/bookings/:id/decline', async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(1).max(1000) }).parse(req.body ?? {});
    return db.tx(async (c) => {
      const b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      await transition(c, b, 'DECLINED', party, { actorId: req.user!.sub, note: reason });
      return view(id, req.user, c);
    });
  });

  // ---------- Tanda tangan (PSrE mock) ----------
  app.post('/v1/booking/bookings/:id/sign', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { signer_name } = z.object({ signer_name: z.string().min(2).max(120) }).parse(req.body);
    return idempotent(db, req, reply, `sign:${id}`, async (c) => {
      let b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      if (b.status !== 'CONTRACT_SENT') throw conflict(`Kontrak tidak menunggu tanda tangan (status ${b.status})`);
      const k = (await c.query(`SELECT * FROM contracts WHERE booking_id=$1`, [id])).rows[0];
      const ins = await c.query(
        `INSERT INTO signatures (contract_id, party, signer_name, signer_user_id, provider_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [k.id, party, signer_name, req.user!.sub, `psre-sandbox-${randomUUID()}`],
      );
      if (ins.rowCount === 0) throw conflict('Pihak Anda sudah menandatangani');
      await audit(c, { actorId: req.user!.sub, action: 'contract.sign', entity: 'contract', entityId: k.id, data: { party, sha256: k.sha256 }, ip: req.ip });
      const n = (await c.query(`SELECT count(*)::int AS n FROM signatures WHERE contract_id=$1`, [k.id])).rows[0].n;
      if (n >= 2) {
        await c.query(`UPDATE contracts SET status='SIGNED', signed_at=now() WHERE id=$1`, [k.id]);
        b = await transition(c, b, 'SIGNED', 'system', { note: `Ditandatangani semua pihak · sha256 ${k.sha256.slice(0, 12)}…` });
        const inv = bookingInvoice(b.agreed_fee!, b.dp_pct, commissionPolicy());
        await publish(c, 'booking.contract.signed', id, {
          bookingId: id,
          contractId: k.id,
          fee: inv.fee,
          dpAmount: inv.dp,
          settlementAmount: inv.settlement,
          serviceFee: inv.serviceFee,
          promotorOrgId: b.promotor_org_id,
          artistId: b.artist_id,
          managementOrgId: await managementOrgId(c, b),
          artistOrgId: b.artist_org_id,
          promotorUserId: b.promotor_user_id,
          eventDate: b.event_date,
          settlementDaysBefore: b.settlement_days_before,
          eventName: b.event_name,
        });
      } else {
        await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor, actor_id, note) VALUES ($1,$2,$2,$3,$4,$5)`, [
          id, b.status, party, req.user!.sub, `Ditandatangani oleh ${party} (${signer_name})`,
        ]);
      }
      return { body: await view(id, req.user, c) };
    });
  });

  // ---------- Hari-H: Show Done (REQ-B2B-10) ----------
  app.post('/v1/booking/bookings/:id/show-done', async (req) => {
    const { id } = req.params as { id: string };
    return db.tx(async (c) => {
      let b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      if (b.status === 'BOOKED_AND_SECURED') {
        if (!FAST_CLOCK && b.event_date > todayWib()) throw conflict('Show Done hanya bisa dikonfirmasi pada/after hari-H');
        b = await transition(c, b, 'SHOW_DAY', 'system', { set: { show_day_at: new Date().toISOString() }, note: FAST_CLOCK ? 'Hari-H (fast clock dev)' : 'Hari-H' });
      }
      if (b.status !== 'SHOW_DAY') throw conflict(`Show Done tidak berlaku pada status ${b.status}`);
      const col = party === 'promotor' ? 'show_done_promotor' : 'show_done_management';
      b = (await c.query(`UPDATE bookings SET ${col}=true, updated_at=now() WHERE id=$1 RETURNING *`, [id])).rows[0];
      if (b.show_done_promotor && b.show_done_management) await completeBooking(c, b, 'both', req.user!.sub);
      return view(id, req.user, c);
    });
  });

  // ---------- Pembatalan (REQ-B2B-11, matriks §7.3) ----------
  app.post('/v1/booking/bookings/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    const p = z.object({ reason: z.string().min(3).max(2000), force_majeure: z.boolean().optional(), incurred_costs: z.number().int().min(0).optional() }).parse(req.body);
    return db.tx(async (c) => {
      const b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      if (['DRAFT', 'INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT'].includes(b.status)) {
        // Sebelum kontrak sah: cukup tolak/batalkan negosiasi (tanpa dana); kontrak yang belum ditandatangani di-VOID.
        await c.query(`UPDATE contracts SET status='VOID' WHERE booking_id=$1 AND status='SENT'`, [id]);
        await transition(c, b, 'DECLINED', party, { actorId: req.user!.sub, note: p.reason });
        return view(id, req.user, c);
      }
      const cancelParty = p.force_majeure ? 'force_majeure' : party === 'promotor' ? 'promotor' : 'artist';
      const to: BookingStatus = p.force_majeure ? 'FORCE_MAJEURE' : party === 'promotor' ? 'CANCELLED_BY_PROMOTOR' : 'CANCELLED_BY_ARTIST';
      const days = daysUntil(b.event_date);
      const out = computeCancellation({
        party: cancelParty,
        daysBeforeEvent: days,
        dpPaid: b.dp_paid,
        settlementPaid: b.settlement_paid,
        fee: b.agreed_fee ?? 0,
        artistPenaltyPct: 25,
        incurredCosts: p.incurred_costs,
      });
      // Force majeure diajukan salah satu pihak; bila tidak sepakat diputus mediasi (dispute).
      await transition(c, b, to, p.force_majeure ? 'both' : party, { actorId: req.user!.sub, note: p.reason, set: { cancellation: JSON.stringify({ ...out, days_before_event: days, reason: p.reason }) } });
      await audit(c, { actorId: req.user!.sub, action: 'booking.cancel', entity: 'booking', entityId: id, data: out, ip: req.ip });
      await publish(c, 'booking.cancelled', id, {
        bookingId: id,
        party: cancelParty,
        daysBeforeEvent: days,
        toArtist: out.toArtist,
        refundToPromotor: out.refundToPromotor,
        artistPenalty: out.artistPenalty,
        holdForReschedule: out.holdForReschedule,
        artistId: b.artist_id,
        artistOrgId: b.artist_org_id,
        promotorOrgId: b.promotor_org_id,
      });
      return { ...(await view(id, req.user, c)), cancellation: out };
    });
  });

  // ---------- Rating dua arah double-blind (REQ-B2B-06) ----------
  app.post('/v1/booking/bookings/:id/ratings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z.object({ scores: z.record(z.number().int().min(1).max(5)).refine((s) => Object.keys(s).length >= 1), comment: z.string().max(2000).optional() }).parse(req.body);
    const b = await db.tx((c) => loadBooking(c, id));
    const party = requireParty(req.user, b, false);
    if (!['COMPLETED', 'SETTLED'].includes(b.status)) throw conflict('Rating hanya untuk booking yang telah selesai');
    const vals = Object.values(p.scores);
    const overall = Math.round((vals.reduce((a, x) => a + x, 0) / vals.length) * 100) / 100;
    const r = await db.query(
      `INSERT INTO ratings (booking_id, by_party, author_id, scores, overall, comment) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING 1`,
      [id, party, req.user!.sub, JSON.stringify(p.scores), overall, p.comment ?? null],
    );
    if (!r.length) throw conflict('Anda sudah memberi rating');
    const n = await db.one(`SELECT count(*)::int AS n FROM ratings WHERE booking_id=$1`, [id]);
    reply.status(201);
    return { submitted: true, revealed: n.n >= 2 };
  });

  // ---------- Dispute (REQ-B2B-12) ----------
  app.post('/v1/booking/bookings/:id/disputes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().min(10).max(4000) }).parse(req.body);
    return db.tx(async (c) => {
      const b = await loadBooking(c, id, true);
      const party = requireParty(req.user, b, false) as Exclude<Party, 'admin'>;
      if (b.status === 'COMPLETED' && b.completed_at && !FAST_CLOCK && Date.now() - new Date(b.completed_at).getTime() > 24 * 3600_000)
        throw conflict('Jendela dispute (24 jam setelah acara) sudah lewat');
      const disputeId = uuidv7();
      await transition(c, b, 'DISPUTED', party, { actorId: req.user!.sub, note: reason, set: { prev_status: b.status } });
      await c.query(`INSERT INTO disputes (id, booking_id, by_party, author_id, reason) VALUES ($1,$2,$3,$4,$5)`, [disputeId, id, party, req.user!.sub, reason]);
      await publish(c, 'booking.dispute.opened', id, { bookingId: id, disputeId, byParty: party });
      reply.status(201);
      return pickDispute((await c.query(`SELECT * FROM disputes WHERE id=$1`, [disputeId])).rows[0]);
    });
  });

  app.get('/v1/booking/contracts/:id', async (req) => {
    const k = await db.one(`SELECT * FROM contracts WHERE id=$1`, [(req.params as any).id]);
    if (!k) throw notFound('Kontrak');
    const b = await db.tx((c) => loadBooking(c, k.booking_id));
    requireParty(req.user, b);
    return { id: k.id, booking_id: k.booking_id, template_version: k.template_version, body_markdown: k.body_markdown, sha256: k.sha256, status: k.status, created_at: k.created_at, signed_at: k.signed_at };
  });
}

/** SHOW_DAY → COMPLETED + event booking.completed (memicu jendela dispute & pencairan di finance). */
export async function completeBooking(c: Client, b: BookingRow, actor: 'both' | 'system', actorId?: string) {
  const nb = await transition(c, b, 'COMPLETED', actor, { actorId, set: { completed_at: new Date().toISOString() }, note: actor === 'system' ? 'Otomatis: 24 jam tanpa keberatan' : 'Show Done dikonfirmasi kedua pihak' });
  await publish(c, 'booking.completed', b.id, { bookingId: b.id, artistId: b.artist_id, fee: nb.agreed_fee!, splits: await feeSplits(c, nb), payeeType: 'individual' });
  return nb;
}

/** Respons API wajib snake_case (docs/API.md § Konvensi). */
function invoiceDto(i: ReturnType<typeof bookingInvoice>) {
  return {
    fee: i.fee,
    service_fee: i.serviceFee,
    dp: i.dp,
    settlement: i.settlement,
    total_promotor: i.totalPromotor,
    artist_commission: i.artistCommission,
  };
}
