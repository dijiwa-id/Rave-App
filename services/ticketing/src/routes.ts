import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { QR_STEP_SECONDS, quoteTicketRefund, RESERVATION_MINUTES, rotatingCode, verifyRotatingCode, type TicketRefundReason } from '@rave/domain';
import {
  assertOrg,
  audit,
  badRequest,
  conflict,
  forbidden,
  HttpError,
  isAdmin,
  notFound,
  publish,
  requireAuth,
  requirePermission,
  requireService,
  settings,
  slugify,
  unprocessable,
  uuidv7,
  z,
  type Client,
  type ServiceContext,
} from '@rave/service-kit';
import { detailOut, orderOut, refundCancelledOrders, refundOut, refundPolicy, releasePendingOrder, releaseReservation, requestInvoice, requestRefund, summaryOut, SUMMARY_SQL, type Q } from './shared.js';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const ticketTypeBody = z.object({
  name: z.string().min(1).max(60),
  price: z.number().int().min(0),
  quota: z.number().int().min(1).max(200_000),
  max_per_account: z.number().int().min(1).max(20).default(4),
  sale_starts_at: z.string().datetime({ offset: true }).nullable().optional(),
  presale: z.boolean().optional(),
});
const eventBody = z.object({
  org_id: z.string().uuid(),
  booking_id: z.string().uuid().nullable().optional(),
  title: z.string().min(3).max(140),
  description: z.string().max(5000).default(''),
  city: z.string().min(2).max(80),
  venue_name: z.string().min(2).max(140),
  venue_address: z.string().max(300).default(''),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  poster_url: z.string().url().nullable().optional(),
  artist_ids: z.array(z.string().uuid()).max(30).default([]),
  rules: z.string().max(3000).nullable().optional(),
  ticket_types: z.array(ticketTypeBody).max(20).default([]),
});

export async function uniqueEventSlug(q: Q, title: string, city: string) {
  const base = slugify(`${title} ${city}`) || 'event';
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    if (!(await q.query(`SELECT 1 FROM events WHERE slug = $1`, [s])).rows.length) return s;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export async function routes(app: FastifyInstance, { db }: ServiceContext) {
  const pool = db.pool as unknown as Q;

  async function findEvent(idOrSlug: string, q: Q = pool) {
    const r = await q.query(`${SUMMARY_SQL} WHERE ${isUuid(idOrSlug) ? 'e.id = $1' : 'e.slug = $1'}`, [idOrSlug]);
    return r.rows[0] ?? null;
  }
  /** Staf event = anggota org promotor pemilik event (klaim JWT) atau admin. */
  function assertStaff(req: FastifyRequest, e: any) {
    if (isAdmin(req.user)) return;
    assertOrg(req.user, e.org_id);
  }

  // ---------------- Publik ----------------
  app.get('/v1/ticketing/events', async (req) => {
    const q = req.query as { city?: string; artist_id?: string; from?: string; q?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50) || 50, 100);
    const rows = await db.query(
      `${SUMMARY_SQL}
       WHERE e.status = 'PUBLISHED' AND e.ends_at >= coalesce($1::timestamptz, now())
         AND ($2::text IS NULL OR lower(e.city) = lower($2))
         AND ($3::uuid IS NULL OR $3 = ANY(e.artist_ids))
         AND ($4::text IS NULL OR e.title ILIKE '%'||$4||'%' OR e.venue_name ILIKE '%'||$4||'%')
       ORDER BY e.starts_at LIMIT $5`,
      [q.from || null, q.city || null, q.artist_id && isUuid(q.artist_id) ? q.artist_id : null, q.q || null, limit],
    );
    return { data: rows.map(summaryOut), next_cursor: null };
  });

  // Internal: apakah user memegang tiket aktif untuk event (akses siaran live bertiket).
  app.get('/internal/tickets/check', { preHandler: requireService }, async (req) => {
    const q = req.query as { event_id?: string; user_id?: string };
    if (!q.event_id || !q.user_id || !isUuid(q.event_id) || !isUuid(q.user_id)) return { valid: false };
    // Bandingkan uuid native (tanpa ::text) agar indeks (event_id, user_id) terpakai.
    const r = await db.one<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM tickets WHERE event_id = $1 AND user_id = $2 AND status IN ('VALID','CHECKED_IN')) AS ok`,
      [q.event_id, q.user_id],
    );
    return { valid: !!r?.ok };
  });

  app.get('/v1/ticketing/events/:idOrSlug', async (req) => {
    const e = await findEvent((req.params as any).idOrSlug);
    if (!e) throw notFound('Event');
    if (e.status === 'DRAFT') {
      if (!req.user) throw notFound('Event');
      try {
        assertStaff(req, e);
      } catch {
        throw notFound('Event');
      }
    }
    return detailOut(pool, e);
  });

  // ---------------- Butuh login ----------------
  app.register(async (a) => {
    a.addHook('preHandler', requireAuth);

    // ---- Promotor: kelola event ----
    a.get('/v1/ticketing/orgs/:orgId/events', async (req) => {
      const { orgId } = req.params as { orgId: string };
      if (!isAdmin(req.user)) assertOrg(req.user, orgId);
      const rows = await db.query(
        `${SUMMARY_SQL} WHERE e.org_id = $1 ORDER BY e.starts_at DESC`,
        [orgId],
      );
      const stats = await db.query(
        `SELECT e.id,
           (SELECT coalesce(sum(sold),0)::int FROM ticket_types t WHERE t.event_id = e.id) AS sold,
           (SELECT coalesce(sum(total),0) FROM orders o WHERE o.event_id = e.id AND o.status = 'PAID') AS revenue,
           (SELECT count(*)::int FROM checkins c WHERE c.event_id = e.id) AS checked_in
         FROM events e WHERE e.org_id = $1`,
        [orgId],
      );
      const by = new Map(stats.map((s) => [s.id, s]));
      return { data: rows.map((e) => ({ ...summaryOut(e), sold: by.get(e.id)?.sold ?? 0, revenue: by.get(e.id)?.revenue ?? 0, checked_in: by.get(e.id)?.checked_in ?? 0 })) };
    });

    a.post('/v1/ticketing/events', async (req, reply) => {
      const b = eventBody.parse(req.body);
      if (new Date(b.ends_at) <= new Date(b.starts_at)) throw badRequest('ends_at harus setelah starts_at');
      if (!isAdmin(req.user)) {
        const m = assertOrg(req.user, b.org_id, ['OWNER', 'ADMIN', 'MEMBER']);
        if (m.type !== 'PROMOTOR' && m.type !== 'VENUE') throw forbidden('Hanya org promotor yang dapat membuat event');
      }
      const id = uuidv7();
      await db.tx(async (tx) => {
        const slug = await uniqueEventSlug(tx, b.title, b.city);
        await tx.query(
          `INSERT INTO events (id, slug, org_id, booking_id, title, description, city, venue_name, venue_address, starts_at, ends_at, poster_url, artist_ids, rules, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [id, slug, b.org_id, b.booking_id ?? null, b.title, b.description, b.city, b.venue_name, b.venue_address, b.starts_at, b.ends_at, b.poster_url ?? null, b.artist_ids, b.rules ?? null, req.user!.sub],
        );
        await insertTypes(tx, id, b.ticket_types);
        await audit(tx, { actorId: req.user!.sub, action: 'event.create', entity: 'event', entityId: id, data: { title: b.title, org_id: b.org_id } });
      });
      reply.status(201);
      return detailOut(pool, await findEvent(id));
    });

    a.patch('/v1/ticketing/events/:id', async (req) => {
      const e = await findEvent((req.params as any).id);
      if (!e) throw notFound('Event');
      assertStaff(req, e);
      const b = eventBody.omit({ org_id: true, ticket_types: true }).partial().extend({ ticket_types: z.array(ticketTypeBody).max(20).optional() }).parse(req.body);
      if (e.status === 'CANCELLED' || e.status === 'COMPLETED') throw conflict(`Event berstatus ${e.status} tidak dapat diubah`);
      const startsAt = new Date(b.starts_at ?? e.starts_at);
      const endsAt = new Date(b.ends_at ?? e.ends_at);
      if (endsAt <= startsAt) throw badRequest('ends_at harus setelah starts_at');
      // Perubahan jadwal/venue setelah publish membuka masa refund penuh bagi pemegang tiket (refund.reschedule_opt_out_days).
      const rescheduled =
        e.status === 'PUBLISHED' &&
        ((b.starts_at !== undefined && startsAt.getTime() !== new Date(e.starts_at).getTime()) ||
          (b.venue_name !== undefined && b.venue_name !== e.venue_name) ||
          (b.city !== undefined && b.city !== e.city));
      await db.tx(async (tx) => {
        const cols = ['title', 'description', 'city', 'venue_name', 'venue_address', 'starts_at', 'ends_at', 'poster_url', 'artist_ids', 'rules', 'booking_id'] as const;
        // Satu UPDATE untuk semua kolom: constraint ends_at > starts_at diperiksa terhadap nilai akhir (memindah event ke tanggal lain).
        const set = cols.filter((c) => c in b);
        if (set.length)
          await tx.query(`UPDATE events SET ${set.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [e.id, ...set.map((c) => (b as any)[c] ?? null)]);
        if (rescheduled) {
          await tx.query(`UPDATE events SET rescheduled_at = now() WHERE id = $1`, [e.id]);
          const days = settings.num('refund.reschedule_opt_out_days');
          const optOutUntil = days > 0 ? new Date(Math.min(Date.now() + days * 86_400_000, startsAt.getTime())).toISOString() : null;
          const holders = (await tx.query(`SELECT DISTINCT user_id FROM orders WHERE event_id = $1 AND status = 'PAID'`, [e.id])).rows.map((r) => r.user_id);
          for (let i = 0; i < holders.length; i += 1000)
            await publish(tx, 'ticketing.event.rescheduled', e.id, {
              eventId: e.id,
              title: b.title ?? e.title,
              startsAt: startsAt.toISOString(),
              venueName: b.venue_name ?? e.venue_name,
              city: b.city ?? e.city,
              optOutUntil,
              userIds: holders.slice(i, i + 1000),
            });
          await audit(tx, { actorId: req.user!.sub, action: 'event.reschedule', entity: 'event', entityId: e.id, data: { starts_at: b.starts_at, venue_name: b.venue_name, city: b.city, holders: holders.length } });
        }
        if (b.ticket_types) {
          if (e.status !== 'DRAFT') throw conflict('Kategori tiket hanya dapat diganti saat DRAFT');
          await tx.query(`DELETE FROM ticket_types WHERE event_id = $1`, [e.id]);
          await insertTypes(tx, e.id, b.ticket_types);
        }
      });
      return detailOut(pool, await findEvent(e.id));
    });

    a.post('/v1/ticketing/events/:id/publish', async (req) => {
      const e = await findEvent((req.params as any).id);
      if (!e) throw notFound('Event');
      assertStaff(req, e);
      if (e.status !== 'DRAFT') throw conflict(`Event berstatus ${e.status}`);
      const n = await db.one(`SELECT count(*)::int AS n FROM ticket_types WHERE event_id = $1`, [e.id]);
      if (!n?.n) throw unprocessable('Tambahkan minimal satu kategori tiket sebelum publish');
      await db.tx(async (tx) => {
        await tx.query(`UPDATE events SET status = 'PUBLISHED', published_at = now() WHERE id = $1`, [e.id]);
        await publish(tx, 'ticketing.event.published', e.id, {
          eventId: e.id,
          title: e.title,
          city: e.city,
          startsAt: new Date(e.starts_at).toISOString(),
          artistIds: e.artist_ids,
          slug: e.slug,
        });
        await audit(tx, { actorId: req.user!.sub, action: 'event.publish', entity: 'event', entityId: e.id });
      });
      return detailOut(pool, await findEvent(e.id));
    });

    // ---- Pembatalan event (REQ-TIX-05): semua pembeli direfund penuh, termasuk biaya layanan ----
    a.post('/v1/ticketing/events/:id/cancel', async (req) => {
      const e = await findEvent((req.params as any).id);
      if (!e) throw notFound('Event');
      if (!isAdmin(req.user)) assertOrg(req.user, e.org_id, ['OWNER', 'ADMIN']);
      const b = z.object({ reason: z.string().trim().min(10, 'Jelaskan alasan pembatalan (min. 10 karakter)').max(1000) }).parse(req.body);
      if (e.status === 'CANCELLED') throw conflict('Event sudah dibatalkan');
      if (e.status === 'COMPLETED') throw conflict('Event sudah selesai — gunakan mediasi untuk sengketa');
      const result = await db.tx(async (tx) => {
        const locked = (await tx.query(`SELECT status FROM events WHERE id = $1 FOR UPDATE`, [e.id])).rows[0];
        if (locked.status === 'CANCELLED' || locked.status === 'COMPLETED') throw conflict(`Event berstatus ${locked.status}`);
        await tx.query(`UPDATE events SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`, [e.id, b.reason]);
        // Reservasi berjalan dihentikan; bila pembayarannya tetap masuk, consumer pembayaran me-refund otomatis.
        const held = await tx.query(`UPDATE orders SET status = 'CANCELLED' WHERE event_id = $1 AND status = 'RESERVED' RETURNING id`, [e.id]);
        for (const o of held.rows) await releaseReservation(tx, o.id);
        await publish(tx, 'ticketing.event.cancelled', e.id, { eventId: e.id, orgId: e.org_id, title: e.title, reason: b.reason });
        const refunded = await refundCancelledOrders(tx, e.id, 500); // sisanya (event besar) diteruskan job refund-cancelled-events
        const paid = (await tx.query(`SELECT count(*)::int AS n FROM orders WHERE event_id = $1 AND status = 'PAID'`, [e.id])).rows[0].n;
        await audit(tx, { actorId: req.user!.sub, action: 'event.cancel', entity: 'event', entityId: e.id, data: { reason: b.reason, refunded, reservations_released: held.rowCount } });
        return { refunded, remaining: paid };
      });
      return { ...(await detailOut(pool, await findEvent(e.id))), refunds: { requested: result.refunded, queued: result.remaining, sla_days: settings.num('refund.event_cancel_sla_days') } };
    });

    // ---- Fan: order tiket (REQ-TIX-02) ----
    // Dua fase: (1) tx pendek reservasi kuota + order RESERVED tanpa invoice, (2) panggil finance DI LUAR tx
    // (lock ticket_types tidak ditahan selama HTTP), (3) tx pendek tempel invoice_id + simpan respons idempoten.
    a.post('/v1/ticketing/orders', async (req, reply) => {
      const b = z
        .object({
          event_id: z.string().uuid(),
          items: z.array(z.object({ ticket_type_id: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).min(1).max(10),
        })
        .parse(req.body);
      const key = req.headers['idempotency-key'] as string | undefined;
      if (!key) throw badRequest('Header Idempotency-Key wajib untuk operasi ini');
      const userId = req.user!.sub;
      // Scope sama dengan idempotent() sebelumnya → rekaman lama tetap diputar ulang.
      const scope = `ticketing.order:${userId}`;
      const replay = (r: { status_code: number; response: any }) => {
        reply.header('Idempotent-Replayed', 'true').status(r.status_code);
        return r.response;
      };
      const stored = async (q: Q) =>
        (await q.query(`SELECT status_code, response FROM idempotency_keys WHERE scope = $1 AND key = $2`, [scope, key])).rows[0];
      // Duplikat paralel dengan key sama diserialkan per fase (lock dilepas saat commit — bukan selama HTTP).
      const lockKey = (tx: Client) => tx.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [scope, key]);

      const prev = await stored(pool);
      if (prev) return replay(prev);

      // ---- Fase 1: validasi + reservasi atomik (tanpa panggilan keluar) ----
      const p1 = await db.tx(async (tx) => {
        await lockKey(tx);
        const again = await stored(tx);
        if (again) return { replay: again };
        // Retry setelah fase 1 sukses (fase 2/3 gagal atau masih berjalan) → lanjutkan order yang sama.
        const existing = (await tx.query(`SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2`, [userId, key])).rows[0];
        if (existing) return { order: existing, fresh: false };
        const e = (await tx.query(`SELECT * FROM events WHERE id = $1`, [b.event_id])).rows[0];
        if (!e || e.status !== 'PUBLISHED') throw notFound('Event');
        if (new Date(e.starts_at) < new Date()) throw unprocessable('Penjualan tiket untuk event ini sudah ditutup');
        const orderId = uuidv7();
        const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000);
        let total = 0;
        const lines: { id: string; quantity: number; price: number }[] = [];
        // Urutkan id agar urutan lock konsisten (hindari deadlock antar order paralel)
        const merged = new Map<string, number>();
        for (const it of b.items) merged.set(it.ticket_type_id, (merged.get(it.ticket_type_id) ?? 0) + it.quantity);
        for (const [typeId, qty] of [...merged].sort(([x], [y]) => x.localeCompare(y))) {
          const t = (await tx.query(`SELECT * FROM ticket_types WHERE id = $1 AND event_id = $2`, [typeId, e.id])).rows[0];
          if (!t) throw badRequest('Kategori tiket tidak valid');
          if (t.sale_starts_at && new Date(t.sale_starts_at) > new Date()) throw unprocessable(`Penjualan ${t.name} belum dibuka`);
          // Batas pembelian per akun (REQ-TIX-01) — hitung PAID + reservasi aktif
          const owned = (
            await tx.query(
              `SELECT coalesce(sum(oi.quantity),0)::int AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
               WHERE o.user_id = $1 AND oi.ticket_type_id = $2 AND (o.status = 'PAID' OR (o.status = 'RESERVED' AND o.reserved_until > now()))`,
              [userId, typeId],
            )
          ).rows[0].n;
          if (owned + qty > t.max_per_account) throw unprocessable(`Maksimal ${t.max_per_account} tiket ${t.name} per akun`);
          // Reservasi atomik: tidak pernah oversell
          const ok = await tx.query(`UPDATE ticket_types SET reserved = reserved + $2 WHERE id = $1 AND sold + reserved + $2 <= quota RETURNING id`, [typeId, qty]);
          if (!ok.rowCount) throw conflict(`Tiket ${t.name} habis atau sisa kuota tidak cukup`);
          total += Number(t.price) * qty;
          lines.push({ id: typeId, quantity: qty, price: Number(t.price) });
        }
        const o = (
          await tx.query(
            `INSERT INTO orders (id, event_id, user_id, holder_name, total, reserved_until, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [orderId, e.id, userId, req.user!.name ?? 'Pemegang tiket', total, reservedUntil, key],
          )
        ).rows[0];
        for (const l of lines)
          await tx.query(`INSERT INTO order_items (order_id, ticket_type_id, quantity, price) VALUES ($1,$2,$3,$4)`, [orderId, l.id, l.quantity, l.price]);
        return { order: o, fresh: true };
      });
      if ('replay' in p1) return replay(p1.replay);
      const o = p1.order;
      // Order lama yang sudah dilepas tanpa invoice tidak boleh dibuatkan tagihan baru.
      if (!o.invoice_id && o.status !== 'RESERVED') throw conflict('Reservasi order ini sudah tidak berlaku, silakan buat order baru');

      // ---- Fase 2: invoice di finance (di luar tx; idempoten per order id) ----
      let invoice: any;
      try {
        invoice = await requestInvoice(pool, o);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 0;
        // Timeout (504) bersifat ambigu: finance mungkin sudah membuat invoice. Reservasi dipertahankan —
        // klien mengulang dengan Idempotency-Key yang sama, atau job pemulihan menempelkan invoice (idempoten per order id).
        if (status === 504) {
          req.log.warn({ orderId: o.id }, 'invoice timeout — reservasi dipertahankan untuk pemulihan');
          throw new HttpError(503, 'Service Unavailable', 'Layanan pembayaran lambat merespons. Reservasimu aman — coba lagi sebentar.', {
            order_id: o.id,
            retry_after_s: 5,
          });
        }
        // Gagal pasti (tidak terjangkau / ditolak): hanya pembuat order yang melepas reservasi.
        if (p1.fresh) await db.tx((tx) => releasePendingOrder(tx, o.id, 'CANCELLED'));
        req.log.warn({ err: (err as Error)?.message, orderId: o.id }, 'gagal membuat invoice — reservasi dilepas');
        const upstream4xx = status > 0 && status < 500;
        throw new HttpError(
          upstream4xx ? 502 : 503,
          upstream4xx ? 'Bad Gateway' : 'Service Unavailable',
          'Layanan pembayaran sedang tidak tersedia; reservasi tiket dibatalkan. Silakan coba lagi.',
          { order_id: o.id },
        );
      }

      // ---- Fase 3: tempel invoice_id + simpan respons final untuk replay ----
      return db.tx(async (tx) => {
        await lockKey(tx);
        const again = await stored(tx);
        if (again) return replay(again);
        const cur = (await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [o.id])).rows[0];
        if (!cur.invoice_id) {
          if (cur.status !== 'RESERVED') throw conflict('Reservasi order ini sudah tidak berlaku, silakan buat order baru');
          await tx.query(`UPDATE orders SET invoice_id = $2 WHERE id = $1 AND status = 'RESERVED' AND invoice_id IS NULL`, [cur.id, invoice.id]);
          cur.invoice_id = invoice.id;
        }
        const body = { order: await orderOut(tx, cur), invoice };
        await tx.query(`INSERT INTO idempotency_keys (scope, key, status_code, response) VALUES ($1,$2,201,$3) ON CONFLICT DO NOTHING`, [
          scope,
          key,
          JSON.stringify(body),
        ]);
        reply.status(201);
        return body;
      });
    });

    a.get('/v1/ticketing/orders/:id', async (req) => {
      const o = await db.one(`SELECT * FROM orders WHERE id = $1`, [(req.params as any).id]);
      if (!o || (o.user_id !== req.user!.sub && !isAdmin(req.user))) throw notFound('Order');
      return orderOut(pool, o);
    });

    // ---- Refund atas permintaan pembeli (REQ-TIX-05) ----
    async function refundQuote(q: Q, o: any) {
      const ev = (await q.query(`SELECT status, starts_at, rescheduled_at FROM events WHERE id = $1`, [o.event_id])).rows[0];
      const checkedIn = (await q.query(`SELECT 1 FROM tickets WHERE order_id = $1 AND status = 'CHECKED_IN' LIMIT 1`, [o.id])).rows.length > 0;
      if (o.status !== 'PAID' || o.refund_status) return { eligible: false, escrowPct: 0, refundFee: false, message: o.refund_status ? 'Refund untuk order ini sudah diajukan.' : 'Order belum dibayar.' };
      if (ev.status !== 'PUBLISHED') return { eligible: false, escrowPct: 0, refundFee: false, message: ev.status === 'CANCELLED' ? 'Event dibatalkan — refund diproses otomatis.' : 'Event sudah selesai.' };
      return quoteTicketRefund({ startsAt: new Date(ev.starts_at), rescheduledAt: ev.rescheduled_at ? new Date(ev.rescheduled_at) : null, checkedIn }, refundPolicy());
    }
    const quoteOut = (o: any, q: Awaited<ReturnType<typeof refundQuote>>) => ({
      eligible: q.eligible,
      reason: 'reason' in q ? (q.reason ?? null) : null,
      pct: q.escrowPct,
      refund_fee: q.refundFee,
      // Ticketing tidak memungut biaya layanan terpisah: perkiraan = porsi dari total; nominal pasti dari finance.
      amount: q.eligible ? Math.floor((Number(o.total) * Math.round(q.escrowPct * 100)) / 10000) : 0,
      deadline: 'deadline' in q ? (q.deadline ?? null) : null,
      message: q.message,
    });

    a.get('/v1/ticketing/orders/:id/refund', async (req) => {
      const o = await db.one(`SELECT * FROM orders WHERE id = $1`, [(req.params as any).id]);
      if (!o || o.user_id !== req.user!.sub) throw notFound('Order');
      return quoteOut(o, await refundQuote(pool, o));
    });

    a.post('/v1/ticketing/orders/:id/refund', async (req) => {
      const id = (req.params as any).id;
      return db.tx(async (tx) => {
        const o = (await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!o || o.user_id !== req.user!.sub) throw notFound('Order');
        const q = await refundQuote(tx, o);
        if (!q.eligible || !('reason' in q) || !q.reason) throw conflict(q.message);
        await requestRefund(tx, o, { escrowPct: q.escrowPct, refundFee: q.refundFee, reason: q.reason });
        await audit(tx, { actorId: req.user!.sub, action: 'ticket.refund.request', entity: 'order', entityId: o.id, data: { reason: q.reason, pct: q.escrowPct } });
        return orderOut(tx, (await tx.query(`SELECT * FROM orders WHERE id = $1`, [o.id])).rows[0]);
      });
    });

    // ---- Back office: antrean & keputusan refund ----
    a.get('/v1/admin/ticketing/refunds', { preHandler: requirePermission('finance.view') }, async (req) => {
      const { status } = z.object({ status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVIEW']).optional() }).parse(req.query);
      const rows = await db.query(
        `SELECT o.*, e.title AS event_title, e.starts_at AS event_starts_at, e.status AS event_status FROM orders o JOIN events e ON e.id = o.event_id
         WHERE o.refund_status IS NOT NULL ${status ? 'AND o.refund_status = $1' : ''}
         ORDER BY (o.refund_status IN ('REVIEW','FAILED')) DESC, o.refund_requested_at DESC LIMIT 200`,
        status ? [status] : [],
      );
      const counts = await db.query(`SELECT refund_status AS status, count(*)::int AS n FROM orders WHERE refund_status IS NOT NULL GROUP BY 1`);
      return {
        data: rows.map((o) => ({
          order_id: o.id,
          user_id: o.user_id,
          holder_name: o.holder_name,
          total: Number(o.total),
          order_status: o.status,
          event: { id: o.event_id, title: o.event_title, starts_at: o.event_starts_at, status: o.event_status },
          note: o.refund_note,
          refund: refundOut(o),
        })),
        counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      };
    });

    a.post('/v1/admin/ticketing/orders/:id/refund', { preHandler: requirePermission('finance.refund') }, async (req) => {
      const b = z
        .object({ pct: z.number().min(0).max(100), refund_fee: z.boolean(), note: z.string().trim().min(5, 'Catat alasan keputusan (min. 5 karakter)').max(1000) })
        .parse(req.body);
      return db.tx(async (tx) => {
        const o = (await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [(req.params as any).id])).rows[0];
        if (!o) throw notFound('Order');
        // Order PAID biasa, atau pembayaran terlambat yang menunggu keputusan (REVIEW).
        if (!(o.status === 'PAID' && !o.refund_status) && o.refund_status !== 'REVIEW') throw conflict('Order ini tidak dalam status yang dapat direfund');
        const reason: TicketRefundReason = o.refund_status === 'REVIEW' ? (o.refund_reason ?? 'late_payment') : 'admin';
        await requestRefund(tx, o, { escrowPct: b.pct, refundFee: b.refund_fee, reason, note: b.note });
        await audit(tx, { actorId: req.user!.sub, action: 'ticket.refund.admin', entity: 'order', entityId: o.id, data: b });
        return orderOut(tx, (await tx.query(`SELECT * FROM orders WHERE id = $1`, [o.id])).rows[0]);
      });
    });

    a.get('/v1/ticketing/tickets/mine', async (req) => {
      const rows = await db.query(
        `SELECT tk.id, tk.status, tk.holder_name, tk.event_id, tk.order_id, tt.name AS type_name, c.checked_in_at,
                o.refund_status, o.refund_reason, o.refund_pct, o.refund_amount, o.refund_requested_at, o.refunded_at
         FROM tickets tk JOIN ticket_types tt ON tt.id = tk.ticket_type_id JOIN orders o ON o.id = tk.order_id LEFT JOIN checkins c ON c.ticket_id = tk.id
         WHERE tk.user_id = $1 ORDER BY tk.created_at DESC`,
        [req.user!.sub],
      );
      const evIds = [...new Set(rows.map((r) => r.event_id))];
      const evs = evIds.length ? await db.query(`${SUMMARY_SQL} WHERE e.id = ANY($1)`, [evIds]) : [];
      const em = new Map(evs.map((e) => [e.id, summaryOut(e)]));
      return {
        data: rows
          .map((r) => ({ id: r.id, order_id: r.order_id, event: em.get(r.event_id), type_name: r.type_name, status: r.status, holder_name: r.holder_name, checked_in_at: r.checked_in_at, refund: refundOut(r) }))
          .sort((x, y) => +new Date(x.event!.starts_at) - +new Date(y.event!.starts_at)),
      };
    });

    // QR berputar tiap 15 dtk — screenshot jadi tak berguna (REQ-TIX-02)
    a.get('/v1/ticketing/tickets/:id/qr', async (req) => {
      const t = await db.one(`SELECT * FROM tickets WHERE id = $1`, [(req.params as any).id]);
      if (!t || t.user_id !== req.user!.sub) throw notFound('Tiket');
      if (t.status !== 'VALID') throw conflict(t.status === 'CHECKED_IN' ? 'Tiket sudah dipakai check-in' : 'Tiket tidak berlaku');
      const now = Date.now();
      const expiresIn = QR_STEP_SECONDS - (Math.floor(now / 1000) % QR_STEP_SECONDS);
      return { payload: `RAVE1.${t.id}.${rotatingCode(t.secret, now)}`, expires_in: expiresIn };
    });

    // ---- Check-in gate (REQ-TIX-04): anti duplikasi multi-gate ----
    a.post('/v1/ticketing/checkin', async (req) => {
      const b = z.object({ event_id: z.string().uuid(), payload: z.string().min(5).max(200), gate: z.string().min(1).max(40) }).parse(req.body);
      const e = await findEvent(b.event_id);
      if (!e) throw notFound('Event');
      assertStaff(req, e);
      if (e.status !== 'PUBLISHED') throw conflict(e.status === 'COMPLETED' ? 'Event sudah selesai' : `Event berstatus ${e.status}`);
      const log = (tx: Client | null, ticketId: string | null, ok: boolean, reason?: string) =>
        (tx ?? (db.pool as any)).query(`INSERT INTO scan_attempts (event_id, ticket_id, gate, ok, reason, scanned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
          e.id,
          ticketId,
          b.gate,
          ok,
          reason ?? null,
          req.user!.sub,
        ]);
      const m = /^RAVE1\.([0-9a-f-]{36})\.(\d{6})$/i.exec(b.payload.trim());
      if (!m) {
        await log(null, null, false, 'INVALID');
        return { ok: false, reason: 'INVALID' };
      }
      const [, ticketId, code] = m;
      return db.tx(async (tx) => {
        const t = (
          await tx.query(
            `SELECT tk.*, tt.name AS type_name FROM tickets tk JOIN ticket_types tt ON tt.id = tk.ticket_type_id WHERE tk.id = $1 FOR UPDATE OF tk`,
            [ticketId],
          )
        ).rows[0];
        const fail = async (reason: string, ticket?: any) => {
          await log(tx, t ? ticketId : null, false, reason);
          return { ok: false, reason, ...(ticket ? { ticket } : {}) };
        };
        if (!t || t.status === 'REFUNDED') return fail('INVALID');
        if (t.event_id !== e.id) return fail('WRONG_EVENT');
        const info = { id: t.id, holder_name: t.holder_name, type_name: t.type_name, status: t.status };
        if (t.status === 'CHECKED_IN') {
          const c = (await tx.query(`SELECT gate, checked_in_at FROM checkins WHERE ticket_id = $1`, [t.id])).rows[0];
          return fail('DUPLICATE', { ...info, checked_in_at: c?.checked_in_at, gate: c?.gate });
        }
        if (!verifyRotatingCode(t.secret, code)) return fail('EXPIRED_CODE', info);
        const ins = await tx.query(`INSERT INTO checkins (ticket_id, event_id, gate, scanned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING checked_in_at`, [
          t.id,
          e.id,
          b.gate,
          req.user!.sub,
        ]);
        if (!ins.rowCount) return fail('DUPLICATE', info);
        await tx.query(`UPDATE tickets SET status = 'CHECKED_IN' WHERE id = $1`, [t.id]);
        await log(tx, t.id, true);
        await publish(tx, 'ticketing.ticket.checked_in', t.id, { ticketId: t.id, eventId: e.id, gate: b.gate });
        return { ok: true, ticket: { ...info, status: 'CHECKED_IN', checked_in_at: ins.rows[0].checked_in_at, gate: b.gate } };
      });
    });

    a.get('/v1/ticketing/events/:id/checkin-stats', async (req) => {
      const e = await findEvent((req.params as any).id);
      if (!e) throw notFound('Event');
      assertStaff(req, e);
      const sold = await db.one(`SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status <> 'REFUNDED'`, [e.id]);
      const gates = await db.query(`SELECT gate, count(*)::int AS count FROM checkins WHERE event_id = $1 GROUP BY gate ORDER BY gate`, [e.id]);
      const fails = await db.one(`SELECT count(*)::int AS n FROM scan_attempts WHERE event_id = $1 AND NOT ok`, [e.id]);
      return { sold: sold?.n ?? 0, checked_in: gates.reduce((s, g) => s + g.count, 0), by_gate: gates, rejected_scans: fails?.n ?? 0 };
    });
  });
}

async function insertTypes(tx: Client, eventId: string, types: z.infer<typeof ticketTypeBody>[]) {
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    await tx.query(
      `INSERT INTO ticket_types (id, event_id, name, price, quota, max_per_account, sale_starts_at, presale, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv7(), eventId, t.name, t.price, t.quota, t.max_per_account, t.sale_starts_at ?? null, t.presale ?? false, i],
    );
  }
}
