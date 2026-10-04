import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { QR_STEP_SECONDS, RESERVATION_MINUTES, rotatingCode, verifyRotatingCode } from '@gema/domain';
import {
  assertOrg,
  audit,
  badRequest,
  callService,
  conflict,
  forbidden,
  idempotent,
  isAdmin,
  notFound,
  publish,
  requireAuth,
  slugify,
  unprocessable,
  uuidv7,
  z,
  type Client,
  type ServiceContext,
} from '@gema/service-kit';
import { detailOut, orderOut, summaryOut, SUMMARY_SQL, type Q } from './shared.js';

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
      await db.tx(async (tx) => {
        const cols = ['title', 'description', 'city', 'venue_name', 'venue_address', 'starts_at', 'ends_at', 'poster_url', 'artist_ids', 'rules', 'booking_id'] as const;
        for (const c of cols) if (c in b) await tx.query(`UPDATE events SET ${c} = $2 WHERE id = $1`, [e.id, (b as any)[c] ?? null]);
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

    // ---- Fan: order tiket (REQ-TIX-02) ----
    a.post('/v1/ticketing/orders', async (req, reply) => {
      const b = z
        .object({
          event_id: z.string().uuid(),
          items: z.array(z.object({ ticket_type_id: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).min(1).max(10),
        })
        .parse(req.body);
      return idempotent(db, req, reply, 'ticketing.order', async (tx) => {
        const e = (await tx.query(`SELECT * FROM events WHERE id = $1`, [b.event_id])).rows[0];
        if (!e || e.status !== 'PUBLISHED') throw notFound('Event');
        if (new Date(e.starts_at) < new Date()) throw unprocessable('Penjualan tiket untuk event ini sudah ditutup');
        const orderId = uuidv7();
        const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000);
        let total = 0;
        const lines: { id: string; quantity: number; price: number; name: string }[] = [];
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
              [req.user!.sub, typeId],
            )
          ).rows[0].n;
          if (owned + qty > t.max_per_account) throw unprocessable(`Maksimal ${t.max_per_account} tiket ${t.name} per akun`);
          // Reservasi atomik: tidak pernah oversell
          const ok = await tx.query(`UPDATE ticket_types SET reserved = reserved + $2 WHERE id = $1 AND sold + reserved + $2 <= quota RETURNING id`, [typeId, qty]);
          if (!ok.rowCount) throw conflict(`Tiket ${t.name} habis atau sisa kuota tidak cukup`);
          total += Number(t.price) * qty;
          lines.push({ id: typeId, quantity: qty, price: Number(t.price), name: t.name });
        }
        await tx.query(`INSERT INTO orders (id, event_id, user_id, holder_name, total, reserved_until) VALUES ($1,$2,$3,$4,$5,$6)`, [
          orderId,
          e.id,
          req.user!.sub,
          req.user!.name ?? 'Pemegang tiket',
          total,
          reservedUntil,
        ]);
        for (const l of lines)
          await tx.query(`INSERT INTO order_items (order_id, ticket_type_id, quantity, price) VALUES ($1,$2,$3,$4)`, [orderId, l.id, l.quantity, l.price]);
        // Tagihan dibuat finance-service (dana tiket ditahan escrow event — §7.6). Gagal → rollback reservasi.
        const invoice = await callService<any>('ticketing', 'finance', '/internal/invoices', {
          method: 'POST',
          body: {
            purpose: 'TICKET_ORDER',
            reference_id: orderId,
            amount: total,
            payer_user_id: req.user!.sub,
            payer_org_id: null,
            description: `Tiket ${e.title} — ${lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}`,
            due_at: reservedUntil.toISOString(),
          },
        });
        await tx.query(`UPDATE orders SET invoice_id = $2 WHERE id = $1`, [orderId, invoice.id]);
        const o = (await tx.query(`SELECT * FROM orders WHERE id = $1`, [orderId])).rows[0];
        return { status: 201, body: { order: await orderOut(tx, o), invoice } };
      });
    });

    a.get('/v1/ticketing/orders/:id', async (req) => {
      const o = await db.one(`SELECT * FROM orders WHERE id = $1`, [(req.params as any).id]);
      if (!o || (o.user_id !== req.user!.sub && !isAdmin(req.user))) throw notFound('Order');
      return orderOut(pool, o);
    });

    a.get('/v1/ticketing/tickets/mine', async (req) => {
      const rows = await db.query(
        `SELECT tk.id, tk.status, tk.holder_name, tk.event_id, tt.name AS type_name, c.checked_in_at
         FROM tickets tk JOIN ticket_types tt ON tt.id = tk.ticket_type_id LEFT JOIN checkins c ON c.ticket_id = tk.id
         WHERE tk.user_id = $1 ORDER BY tk.created_at DESC`,
        [req.user!.sub],
      );
      const evIds = [...new Set(rows.map((r) => r.event_id))];
      const evs = evIds.length ? await db.query(`${SUMMARY_SQL} WHERE e.id = ANY($1)`, [evIds]) : [];
      const em = new Map(evs.map((e) => [e.id, summaryOut(e)]));
      return {
        data: rows
          .map((r) => ({ id: r.id, event: em.get(r.event_id), type_name: r.type_name, status: r.status, holder_name: r.holder_name, checked_in_at: r.checked_in_at }))
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
      return { payload: `GEMA1.${t.id}.${rotatingCode(t.secret, now)}`, expires_in: expiresIn };
    });

    // ---- Check-in gate (REQ-TIX-04): anti duplikasi multi-gate ----
    a.post('/v1/ticketing/checkin', async (req) => {
      const b = z.object({ event_id: z.string().uuid(), payload: z.string().min(5).max(200), gate: z.string().min(1).max(40) }).parse(req.body);
      const e = await findEvent(b.event_id);
      if (!e) throw notFound('Event');
      assertStaff(req, e);
      const log = (tx: Client | null, ticketId: string | null, ok: boolean, reason?: string) =>
        (tx ?? (db.pool as any)).query(`INSERT INTO scan_attempts (event_id, ticket_id, gate, ok, reason, scanned_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
          e.id,
          ticketId,
          b.gate,
          ok,
          reason ?? null,
          req.user!.sub,
        ]);
      const m = /^GEMA1\.([0-9a-f-]{36})\.(\d{6})$/i.exec(b.payload.trim());
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
