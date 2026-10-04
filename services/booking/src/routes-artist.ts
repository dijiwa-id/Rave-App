import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  EVENT_CATEGORIES,
  PERFORMANCE_FORMATS,
  RATE_ZONES,
  audienceMatchScore,
  contactRevealed,
  kSafe,
  validateShares,
  type BookingStatus,
} from '@gema/domain';
import {
  audit,
  badRequest,
  callService,
  conflict,
  notFound,
  requireAuth,
  requireRole,
  uuidv7,
  z,
  type AuthUser,
  type Db,
  type ServiceContext,
} from '@gema/service-kit';
import { assertManageArtist, canManageArtist, isVerifiedPromotor } from './common.js';

const METRIC_KEYS = ['monthly_listeners', 'growth_90d_pct', 'top_cities', 'age_groups', 'shows_12m', 'avg_rating', 'on_time_rate'] as const;

interface PlaybackEpk {
  monthly_listeners: number;
  growth_90d_pct: number;
  top_cities: { city: string; listeners: number }[];
  age_groups: { group: string; pct: number }[];
  engagement_rate: number;
}
const EMPTY_STATS: PlaybackEpk = { monthly_listeners: 0, growth_90d_pct: 0, top_cities: [], age_groups: [], engagement_rate: 0 };

export async function playbackEpk(artistId: string, log?: { warn: (o: object, m: string) => void }): Promise<PlaybackEpk> {
  try {
    return { ...EMPTY_STATS, ...(await callService<PlaybackEpk>('booking', 'playback', `/internal/analytics/artists/${artistId}/epk`)) };
  } catch (e: any) {
    log?.warn({ err: e?.message, artistId }, 'playback epk tidak tersedia, pakai fallback');
    return EMPTY_STATS;
  }
}

export async function artistRow(db: Db, idOrSlug: string) {
  const a = await db.one(`SELECT * FROM artists WHERE id::text=$1 OR slug=$1`, [idOrSlug]);
  if (!a) throw notFound('Artis');
  return a;
}

export function artistSummary(a: any, monthly = 0) {
  return { id: a.id, slug: a.slug, name: a.name, image_url: a.image_url, city: a.city, genres: a.genres, verified: a.verified, monthly_listeners: monthly };
}

/** Statistik off-air dari booking & rating (REQ-B2B-01 data off-air). */
export async function offairStats(db: Db, artistId: string) {
  const r = await db.one(
    `SELECT
       (SELECT count(*)::int FROM bookings WHERE artist_id=$1 AND status IN ('COMPLETED','SETTLED') AND event_date > current_date - interval '12 months') AS shows_12m,
       (SELECT round(avg(overall)::numeric, 2) FROM ratings r JOIN bookings b ON b.id=r.booking_id WHERE b.artist_id=$1 AND r.by_party='promotor') AS avg_rating,
       (SELECT round(avg(CASE WHEN (scores->>'ketepatan_waktu')::numeric >= 4 THEN 1 ELSE 0 END)::numeric, 2)
          FROM ratings r JOIN bookings b ON b.id=r.booking_id WHERE b.artist_id=$1 AND r.by_party='promotor' AND scores ? 'ketepatan_waktu') AS on_time_rate`,
    [artistId],
  );
  return { shows_12m: r?.shows_12m ?? 0, avg_rating: r?.avg_rating ?? null, on_time_rate: r?.on_time_rate ?? null };
}

/** Item rate card yang boleh dilihat viewer sesuai visibilitas (REQ-B2B-03). */
export async function visibleRateCard(db: Db, artistId: string, u: AuthUser | null) {
  const rc = await db.one(`SELECT * FROM rate_cards WHERE artist_id=$1`, [artistId]);
  if (!rc) return { artist_id: artistId, visibility: 'BY_REQUEST', valid_from: null, valid_to: null, from_fee: null, items: [] as any[] };
  const items = await db.query(
    `SELECT category, format, zone, duration_min, fee, rider_estimate, accommodation_by_promotor, transport_by_promotor FROM rate_card_items WHERE artist_id=$1 ORDER BY fee`,
    [artistId],
  );
  const manage = canManageArtist(u, artistId);
  const allowed = rc.visibility === 'PUBLIC' || manage || (rc.visibility === 'VERIFIED_PROMOTOR' && isVerifiedPromotor(u));
  const minFee = items.length ? Math.min(...items.map((i) => i.fee)) : null;
  return {
    artist_id: artistId,
    visibility: rc.visibility,
    valid_from: rc.valid_from,
    valid_to: rc.valid_to,
    // "mulai dari" tampil publik untuk PUBLIC; VERIFIED_PROMOTOR hanya ke promotor terverifikasi; BY_REQUEST disembunyikan.
    from_fee: allowed ? minFee : null,
    items: allowed ? items : [],
  };
}

async function contactVisibleToPromotor(db: Db, artistId: string, u: AuthUser | null): Promise<boolean> {
  if (!u) return false;
  const orgIds = u.orgs.filter((o) => o.type === 'PROMOTOR').map((o) => o.id);
  if (!orgIds.length) return false;
  const rows = await db.query(`SELECT status FROM bookings WHERE artist_id=$1 AND promotor_org_id = ANY($2)`, [artistId, orgIds]);
  return rows.some((r) => contactRevealed(r.status as BookingStatus));
}

const mask = (s: string | undefined) => (s ? '***' : '');

const rateItem = z.object({
  category: z.enum(EVENT_CATEGORIES),
  format: z.enum(PERFORMANCE_FORMATS),
  zone: z.enum(RATE_ZONES),
  duration_min: z.number().int().min(10).max(600),
  fee: z.number().int().min(0),
  rider_estimate: z.number().int().min(0).default(0),
  accommodation_by_promotor: z.boolean().default(true),
  transport_by_promotor: z.boolean().default(true),
});

const epkSchema = z.object({
  bio_short: z.string().max(400).default(''),
  bio_long: z.string().max(8000).default(''),
  press_photos: z.array(z.string().url()).max(30).default([]),
  videos: z.array(z.string().url()).max(20).default([]),
  press_quotes: z.array(z.object({ quote: z.string(), source: z.string() })).max(20).default([]),
  achievements: z.array(z.string()).max(30).default([]),
  rider: z.record(z.unknown()).default({}),
  members: z.array(z.object({ name: z.string(), role: z.string() })).max(30).default([]),
  public_metrics: z.array(z.enum(METRIC_KEYS)).default(['monthly_listeners', 'top_cities', 'shows_12m', 'avg_rating']),
  contact: z.object({ name: z.string(), email: z.string(), phone: z.string() }).partial().optional(),
});

export async function artistRoutes(app: FastifyInstance, { db, log }: ServiceContext) {
  // ---------- EPK dinamis (REQ-B2B-01) ----------
  app.get('/v1/booking/artists/:artistId/epk', async (req) => {
    const { artistId } = req.params as { artistId: string };
    const { token } = req.query as { token?: string };
    const a = await artistRow(db, artistId);
    const row = await db.one(`SELECT * FROM epk WHERE artist_id=$1`, [a.id]);
    const content = row?.content ?? { bio_short: '', bio_long: '', press_photos: [], videos: [], press_quotes: [], achievements: [], rider: {}, members: [], public_metrics: ['monthly_listeners', 'top_cities'] };
    let shareOk = false;
    if (token) {
      const s = await db.one(`SELECT 1 FROM epk_share_links WHERE token=$1 AND artist_id=$2 AND expires_at > now()`, [token, a.id]);
      if (!s) throw notFound('Link EPK (kedaluwarsa atau tidak valid)');
      shareOk = true;
    }
    const manage = canManageArtist(req.user, a.id);
    const full = manage || shareOk || isVerifiedPromotor(req.user);
    const [pb, off, rc] = await Promise.all([playbackEpk(a.id, log), offairStats(db, a.id), visibleRateCard(db, a.id, req.user)]);
    const stats: Record<string, unknown> = {
      monthly_listeners: pb.monthly_listeners,
      growth_90d_pct: pb.growth_90d_pct,
      // Agregat saja; segmen < k disembunyikan (UU PDP §8.2)
      top_cities: pb.top_cities.filter((c) => kSafe(c.listeners) !== null).slice(0, 10),
      age_groups: pb.age_groups,
      ...off,
    };
    if (!full) for (const k of METRIC_KEYS) if (!content.public_metrics?.includes(k)) stats[k] = Array.isArray(stats[k]) ? [] : null;
    const contact = row?.contact ?? {};
    const reveal = manage || (await contactVisibleToPromotor(db, a.id, req.user));
    return {
      ...content,
      artist: artistSummary(a, pb.monthly_listeners),
      stats,
      rate_card: { from_fee: rc.from_fee, visibility: rc.visibility },
      contact: reveal
        ? { name: contact.name ?? '', email: contact.email ?? '', phone: contact.phone ?? '' }
        : { name: contact.name ?? 'Manajemen', email: mask(contact.email), phone: mask(contact.phone) },
      updated_at: row?.updated_at ?? a.updated_at,
    };
  });

  app.put('/v1/booking/artists/:artistId/epk', { preHandler: requireAuth }, async (req) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    await artistRow(db, artistId);
    const { contact, ...content } = epkSchema.parse(req.body);
    await db.tx(async (c) => {
      await c.query(
        `INSERT INTO epk (artist_id, content, contact) VALUES ($1,$2,coalesce($3,'{}'::jsonb))
         ON CONFLICT (artist_id) DO UPDATE SET content=EXCLUDED.content, contact=coalesce($3, epk.contact), updated_at=now()`,
        [artistId, JSON.stringify(content), contact ? JSON.stringify(contact) : null],
      );
      await audit(c, { actorId: req.user!.sub, action: 'epk.update', entity: 'artist', entityId: artistId, ip: req.ip });
    });
    return app.inject({ method: 'GET', url: `/v1/booking/artists/${artistId}/epk`, headers: { authorization: req.headers.authorization! } }).then((r) => r.json());
  });

  app.post('/v1/booking/artists/:artistId/epk/share', { preHandler: requireAuth }, async (req) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    const { expires_in_days } = z.object({ expires_in_days: z.number().int().min(1).max(90).default(14) }).parse(req.body ?? {});
    const token = randomBytes(18).toString('base64url');
    const r = await db.one(
      `INSERT INTO epk_share_links (token, artist_id, expires_at, created_by) VALUES ($1,$2, now() + make_interval(days => $3), $4) RETURNING expires_at`,
      [token, artistId, expires_in_days, req.user!.sub],
    );
    const a = await artistRow(db, artistId);
    return { url: `/epk/${a.slug}?token=${token}`, token, expires_at: r.expires_at };
  });

  // ---------- Rate card (REQ-B2B-03) ----------
  app.get('/v1/booking/artists/:artistId/rate-card', async (req) => {
    const a = await artistRow(db, (req.params as any).artistId);
    return visibleRateCard(db, a.id, req.user);
  });

  app.put('/v1/booking/artists/:artistId/rate-card', { preHandler: requireAuth }, async (req) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    const body = z
      .object({
        visibility: z.enum(['PUBLIC', 'VERIFIED_PROMOTOR', 'BY_REQUEST']),
        valid_from: z.string().date().nullable().optional(),
        valid_to: z.string().date().nullable().optional(),
        items: z.array(rateItem).max(200),
      })
      .parse(req.body);
    await db.tx(async (c) => {
      const rc = await c.query(
        `INSERT INTO rate_cards (artist_id, visibility, valid_from, valid_to) VALUES ($1,$2,$3,$4)
         ON CONFLICT (artist_id) DO UPDATE SET visibility=$2, valid_from=$3, valid_to=$4, updated_at=now() RETURNING floor_fee`,
        [artistId, body.visibility, body.valid_from ?? null, body.valid_to ?? null],
      );
      const floor = rc.rows[0]?.floor_fee;
      if (floor && body.items.some((i) => i.fee < floor)) throw badRequest(`Fee di bawah batas bawah label (${floor})`);
      await c.query(`DELETE FROM rate_card_items WHERE artist_id=$1`, [artistId]);
      for (const i of body.items) {
        await c.query(
          `INSERT INTO rate_card_items (artist_id, category, format, zone, duration_min, fee, rider_estimate, accommodation_by_promotor, transport_by_promotor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [artistId, i.category, i.format, i.zone, i.duration_min, i.fee, i.rider_estimate, i.accommodation_by_promotor, i.transport_by_promotor],
        );
      }
      await audit(c, { actorId: req.user!.sub, action: 'rate_card.update', entity: 'artist', entityId: artistId, data: body, ip: req.ip });
    });
    return visibleRateCard(db, artistId, req.user);
  });

  // ---------- Kalender (REQ-B2B-02) ----------
  const range = (q: any) => {
    const from = z.string().date().parse(q.from ?? new Date().toISOString().slice(0, 10));
    const to = z.string().date().parse(q.to ?? new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10));
    if (to < from) throw badRequest('to < from');
    if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 370) throw badRequest('Rentang maksimal 370 hari');
    return { from, to };
  };

  app.get('/v1/booking/artists/:artistId/calendar', { preHandler: requireAuth }, async (req) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    const { from, to } = range(req.query);
    const data = await db.query(
      `SELECT id, artist_id, lower(period)::text AS start_date, (upper(period) - 1)::text AS end_date, status, booking_id, note
       FROM calendar_slots WHERE artist_id=$1 AND period && daterange($2::date, $3::date, '[]') ORDER BY lower(period)`,
      [artistId, from, to],
    );
    return { data };
  });

  app.get('/v1/booking/artists/:artistId/availability', async (req) => {
    const a = await artistRow(db, (req.params as any).artistId);
    const { from, to } = range(req.query);
    const slots = await db.query(
      `SELECT lower(period)::text AS s, (upper(period) - 1)::text AS e, status FROM calendar_slots
       WHERE artist_id=$1 AND period && daterange($2::date, $3::date, '[]')`,
      [a.id, from, to],
    );
    const data: { date: string; status: 'AVAILABLE' | 'HOLD' | 'BUSY' }[] = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += 86400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      const hit = slots.filter((s) => s.s <= d && d <= s.e);
      // TRAVEL dianggap sibuk bagi promotor; detail privat tidak dibuka.
      const status = hit.some((s) => !s.status.startsWith('HOLD')) ? 'BUSY' : hit.length ? 'HOLD' : 'AVAILABLE';
      data.push({ date: d, status });
    }
    return { data };
  });

  app.post('/v1/booking/artists/:artistId/calendar/blocks', { preHandler: requireAuth }, async (req, reply) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    const b = z
      .object({ start_date: z.string().date(), end_date: z.string().date(), status: z.enum(['BLOCKED', 'TRAVEL']), note: z.string().max(200).optional() })
      .parse(req.body);
    if (b.end_date < b.start_date) throw badRequest('end_date < start_date');
    const row = await db.one(
      `INSERT INTO calendar_slots (id, artist_id, period, status, note) VALUES ($1,$2, daterange($3::date,$4::date,'[]'), $5, $6)
       RETURNING id, artist_id, lower(period)::text AS start_date, (upper(period)-1)::text AS end_date, status, booking_id, note`,
      [uuidv7(), artistId, b.start_date, b.end_date, b.status, b.note ?? null],
    );
    reply.status(201);
    return row;
  });

  app.delete('/v1/booking/calendar/:slotId', { preHandler: requireAuth }, async (req) => {
    const { slotId } = req.params as { slotId: string };
    const s = await db.one(`SELECT * FROM calendar_slots WHERE id=$1`, [slotId]);
    if (!s) throw notFound('Slot');
    assertManageArtist(req.user, s.artist_id);
    if (s.booking_id) throw conflict('Slot milik booking tidak dapat dihapus manual');
    await db.query(`DELETE FROM calendar_slots WHERE id=$1`, [slotId]);
    return { ok: true };
  });

  // ---------- Split fee band & kru (REQ-B2B-13) ----------
  app.get('/v1/booking/artists/:artistId/fee-splits', { preHandler: requireAuth }, async (req) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    return { items: await db.query(`SELECT label, party_id, pct FROM fee_splits WHERE artist_id=$1 ORDER BY position`, [artistId]) };
  });

  app.put('/v1/booking/artists/:artistId/fee-splits', { preHandler: requireAuth }, async (req) => {
    const { artistId } = req.params as { artistId: string };
    assertManageArtist(req.user, artistId);
    const { items } = z
      .object({ items: z.array(z.object({ label: z.string().min(1).max(80), party_id: z.string().uuid().nullable().optional(), pct: z.number().positive().max(100) })).min(1).max(30) })
      .parse(req.body);
    const v = validateShares(items.map((i) => ({ partyId: i.party_id ?? 'artist', pct: i.pct })));
    if (!v.ok) throw badRequest(`Total split harus 100% (sekarang ${v.total}%)`);
    await db.tx(async (c) => {
      await c.query(`DELETE FROM fee_splits WHERE artist_id=$1`, [artistId]);
      let pos = 0;
      for (const i of items) await c.query(`INSERT INTO fee_splits VALUES ($1,$2,$3,$4,$5)`, [artistId, pos++, i.label, i.party_id ?? null, i.pct]);
      await audit(c, { actorId: req.user!.sub, action: 'fee_splits.update', entity: 'artist', entityId: artistId, data: items, ip: req.ip });
    });
    return { items };
  });

  // ---------- Talent discovery (REQ-B2B-07) ----------
  app.get('/v1/booking/discovery', { preHandler: requireRole('promotor') }, async (req) => {
    const q = z
      .object({
        city: z.string().optional(),
        genre: z.string().optional(),
        budget_max: z.coerce.number().int().positive().optional(),
        date: z.string().date().optional(),
        format: z.enum(PERFORMANCE_FORMATS).optional(),
        category: z.enum(EVENT_CATEGORIES).optional(),
      })
      .parse(req.query);
    const artists = await db.query(`SELECT * FROM artists ${q.genre ? 'WHERE $1 = ANY(genres)' : ''} ORDER BY name`, q.genre ? [q.genre] : []);
    let cityMap = new Map<string, number>();
    if (q.city) {
      try {
        const r = await callService<{ data: { artist_id: string; listeners: number }[] }>('booking', 'playback', `/internal/analytics/city-listeners?city=${encodeURIComponent(q.city)}`);
        cityMap = new Map(r.data.map((x) => [x.artist_id, x.listeners]));
      } catch (e: any) {
        log.warn({ err: e?.message }, 'city-listeners tidak tersedia, fallback ke kota asal artis');
      }
    }
    const results = await Promise.all(
      artists.map(async (a) => {
        const [pb, off, rc] = await Promise.all([playbackEpk(a.id), offairStats(db, a.id), visibleRateCard(db, a.id, req.user)]);
        const items = rc.items.filter((i: any) => (!q.format || i.format === q.format) && (!q.category || i.category === q.category));
        const fromFee = items.length ? Math.min(...items.map((i: any) => i.fee)) : rc.from_fee;
        if (q.budget_max && fromFee !== null && fromFee > q.budget_max) return null;
        let available: boolean | null = null;
        if (q.date) {
          const busy = await db.one(
            `SELECT 1 FROM calendar_slots WHERE artist_id=$1 AND status IN ('PENDING_CONTRACT','BOOKED','BOOKED_AND_SECURED','BLOCKED','TRAVEL') AND period @> $2::date`,
            [a.id, q.date],
          );
          available = !busy;
        }
        const homeCity = q.city && a.city?.toLowerCase() === q.city.toLowerCase();
        const inCity = q.city ? (cityMap.get(a.id) ?? (homeCity ? Math.round(pb.monthly_listeners * 0.3) : 0)) : 0;
        // Tanpa data streaming (playback tidak tersedia) → heuristik kota asal artis.
        const noData = pb.monthly_listeners === 0 && !cityMap.size;
        const score = audienceMatchScore({
          listenersInEventCity: noData ? (homeCity ? 1 : 0) : q.city ? inCity : pb.monthly_listeners * 0.25,
          totalMonthlyListeners: noData ? 1 : Math.max(pb.monthly_listeners, inCity, 1),
          growth90dPct: pb.growth_90d_pct,
          engagementRate: pb.engagement_rate,
          genreFit: q.genre ? 1 : 0.6,
        });
        return {
          artist: artistSummary(a, pb.monthly_listeners),
          from_fee: fromFee,
          audience_match: score,
          listeners_in_city: q.city ? kSafe(inCity) : null,
          avg_rating: off.avg_rating,
          shows_12m: off.shows_12m,
          available,
        };
      }),
    );
    const data = results.filter((r): r is NonNullable<typeof r> => !!r && r.available !== false).sort((x, y) => y.audience_match - x.audience_match);
    return { data };
  });
}
