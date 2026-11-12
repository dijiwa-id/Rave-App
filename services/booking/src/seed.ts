import { SEED, SEED_ARTIST_IMAGE, seedId, demoArt } from '@rave/domain';
import { encryptField, maskField, publish, uuidv7, type Client, type ServiceContext } from '@rave/service-kit';
import { renderContract, TEMPLATE_VERSION } from './contract.js';
import type { BookingRow } from './common.js';

const PENSI = SEED.orgs.pensiPromotor;
const NADA = SEED.orgs.nadaManagement;
const SENJA = SEED.artists[0];
const day = (offset: number) => new Date(Date.now() + 7 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const r500 = (n: number) => Math.round(n / 500_000) * 500_000;

// Tier harga per artis (indeks SEED.artists) — Senja sebagai acuan.
const TIER = [1.0, 0.7, 1.4, 0.8, 1.2, 0.6, 0.9, 1.8];
const VISIBILITY = ['PUBLIC', 'PUBLIC', 'PUBLIC', 'PUBLIC', 'BY_REQUEST', 'PUBLIC', 'PUBLIC', 'VERIFIED_PROMOTOR'];
const BASE_ITEMS: [string, string, string, number, number][] = [
  ['KAMPUS', 'FULL_BAND', 'DALAM_KOTA', 60, 15_000_000],
  ['KAMPUS', 'FULL_BAND', 'JAWA', 60, 18_000_000],
  ['KAMPUS', 'FULL_BAND', 'LUAR_JAWA', 60, 24_000_000],
  ['PENSI', 'FULL_BAND', 'DALAM_KOTA', 45, 12_000_000],
  ['PENSI', 'AKUSTIK', 'DALAM_KOTA', 45, 8_000_000],
  ['FESTIVAL', 'FULL_BAND', 'JAWA', 60, 35_000_000],
  ['FESTIVAL', 'FULL_BAND', 'LUAR_JAWA', 60, 45_000_000],
  ['KORPORAT', 'FULL_BAND', 'DALAM_KOTA', 60, 30_000_000],
  ['WEDDING', 'AKUSTIK', 'DALAM_KOTA', 90, 20_000_000],
  ['CAFE_CLUB', 'AKUSTIK', 'DALAM_KOTA', 90, 7_000_000],
  ['SHOWCASE', 'FULL_BAND', 'DALAM_KOTA', 45, 10_000_000],
];

const RIDER = (performers: number) => ({
  personnel: { performers, crew: 3, total_travel: performers + 3 },
  stage: { min_width_m: 8, min_depth_m: 6, riser: ['drum 2x2m h40cm'] },
  pa_system: { min_spl_db: 105, foh_console: ['Yamaha CL5', 'DiGiCo SD9', 'equivalent'] },
  monitors: { wedges: 6, iem_channels: 4 },
  backline: [
    { item: 'Drum kit 5-pc', spec: '22" kick, cymbal stand x4', substitutable: true },
    { item: 'Bass amp', spec: 'Ampeg SVT + 8x10', substitutable: true },
    { item: 'Guitar amp x2', spec: 'Fender Twin Reverb / Vox AC30', substitutable: true },
  ],
  input_list: [
    { ch: 1, source: 'Kick In', mic: 'Beta 91A' },
    { ch: 2, source: 'Kick Out', mic: 'D112' },
    { ch: 3, source: 'Snare', mic: 'SM57' },
    { ch: 4, source: 'Bass DI', mic: 'DI box' },
    { ch: 5, source: 'Gitar 1', mic: 'SM57' },
    { ch: 6, source: 'Vokal utama', mic: 'Beta 58A' },
  ],
  soundcheck_minutes: 60,
  hospitality: { green_room: true, meals: performers + 3, hotel_rooms: Math.ceil((performers + 3) / 2), transport: 'minivan x2' },
});

export async function seed({ db, log }: ServiceContext) {
  await db.tx(async (c) => {
    // Org read model
    const orgs: [string, string, string, boolean][] = [
      [PENSI, 'PROMOTOR', 'Pensi Nusantara', true],
      [NADA, 'MANAGEMENT', 'Nada Manajemen', true],
      [SEED.orgs.indieLabel, 'LABEL', 'Rekam Pinggir', true],
      ...SEED.artists.map((a) => [a.orgId, 'ARTIST', a.name, true] as [string, string, string, boolean]),
    ];
    for (const [id, type, name, verified] of orgs)
      await c.query(`INSERT INTO orgs (id, type, name, verified) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, [id, type, name, verified]);

    for (const [i, a] of SEED.artists.entries()) {
      await c.query(
        `INSERT INTO artists (id, org_id, name, slug, city, genres, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [a.id, a.orgId, a.name, a.slug, a.city, a.genres, SEED_ARTIST_IMAGE(a.slug)],
      );
      // Rate card
      const rc = await c.query(`INSERT INTO rate_cards (artist_id, visibility, valid_from) VALUES ($1,$2,'2026-01-01') ON CONFLICT DO NOTHING RETURNING 1`, [a.id, VISIBILITY[i]]);
      if (rc.rowCount)
        for (const [cat, fmt, zone, dur, fee] of BASE_ITEMS) {
          const f = r500(fee * TIER[i]);
          await c.query(
            `INSERT INTO rate_card_items (artist_id, category, format, zone, duration_min, fee, rider_estimate, accommodation_by_promotor, transport_by_promotor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [a.id, cat, fmt, zone, dur, f, fmt === 'FULL_BAND' ? r500(f * 0.15) : r500(f * 0.05), zone !== 'DALAM_KOTA', zone !== 'DALAM_KOTA'],
          );
        }
      // EPK
      const performers = a.slug === 'mc-rantau' || a.slug === 'nirmala' ? 2 : a.slug === 'arunika' ? 3 : 5;
      await c.query(`INSERT INTO epk (artist_id, content, contact) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [
        a.id,
        JSON.stringify({
          bio_short: `${a.name} — ${a.genres.join(' / ')} dari ${a.city}.`,
          bio_long: `${a.name} adalah unit ${a.genres[0]} asal ${a.city} yang tumbuh dari panggung kampus dan kolektif lokal. Dikenal lewat penampilan live yang hangat dan lirik berbahasa Indonesia yang dekat dengan keseharian, mereka rutin mengisi pensi, festival kampus, dan showcase di berbagai kota.`,
          press_photos: [1, 2, 3].map((n) => demoArt(`press-${a.slug}-${n}`, 1200, 800)),
          videos: [],
          press_quotes: [
            { quote: 'Salah satu penampil paling konsisten di sirkuit panggung kampus tahun ini.', source: 'Catatan Panggung' },
            { quote: 'Energi live yang membuat penonton bernyanyi dari lagu pertama.', source: 'Zine Kolektif Lokal' },
          ],
          achievements: ['Showcase RAVE Indie Kotamu 2026', `Tur ${a.city} & sekitarnya 2025`],
          rider: RIDER(performers),
          members: Array.from({ length: performers }, (_, k) => ({ name: `Personel ${k + 1}`, role: ['Vokal', 'Gitar', 'Bass', 'Drum', 'Keyboard'][k] ?? 'Additional' })),
          public_metrics: ['monthly_listeners', 'top_cities', 'shows_12m', 'avg_rating'],
        }),
        JSON.stringify({ name: a.id === SENJA.id ? 'Nada Manajemen' : `Manajemen ${a.name}`, email: `booking@${a.slug}.id`, phone: `+62 812-0000-${String(1000 + i * 37)}` }),
      ]);
    }

    // Profil legal pihak (data sensitif terenkripsi, hanya versi samar yang tampil) & rider berversi untuk kontrak SPK.
    const legal: [string, string, string, string, string, string, string, string][] = [
      [PENSI, 'PROMOTOR', 'PT Pensi Nusantara Kreatif', 'Raka Wirawan', 'Direktur Utama', '3273012509900001', '09.123.456.7-421.000', 'Jl. Braga No. 21, Bandung'],
      [NADA, 'MANAGEMENT', 'PT Nada Manajemen Indonesia', 'Sekar Maheswari', 'Direktur', '3171014307880002', '02.765.432.1-017.000', 'Jl. Kemang Raya No. 8, Jakarta Selatan'],
    ];
    for (const [org, kind, name, rep, title, nik, npwp, addr] of legal)
      await c.query(
        `INSERT INTO legal_profiles (org_id, kind, legal_name, rep_name, rep_title, nik_enc, nik_mask, npwp_enc, npwp_mask, address, email, whatsapp, bank_name, bank_account_enc, bank_account_mask, bank_holder, mgmt_fee_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING`,
        [org, kind, name, rep, title, encryptField(nik), maskField(nik), encryptField(npwp), maskField(npwp), addr,
         kind === 'PROMOTOR' ? 'legal@pensi.id' : 'legal@nadamanajemen.id', kind === 'PROMOTOR' ? '+6281200001111' : '+6281200002222',
         kind === 'MANAGEMENT' ? 'BCA' : null, kind === 'MANAGEMENT' ? encryptField('8201234567') : null, kind === 'MANAGEMENT' ? maskField('8201234567') : null, kind === 'MANAGEMENT' ? name : null,
         kind === 'MANAGEMENT' ? 20 : null],
      );
    for (const a of SEED.artists) {
      const performers = a.slug === 'mc-rantau' || a.slug === 'nirmala' ? 2 : a.slug === 'arunika' ? 3 : 5;
      const { personnel, hospitality, ...technical } = RIDER(performers);
      for (const [kind, content] of [['hospitality', { personnel, hospitality }], ['technical', technical]] as const)
        await c.query(`INSERT INTO rider_versions (artist_id, kind, version, content, created_by) VALUES ($1,$2,1,$3,'seed') ON CONFLICT DO NOTHING`, [a.id, kind, JSON.stringify(content)]);
    }

    // Split fee Senja: band 80% / manajemen 20%
    await c.query(`INSERT INTO fee_splits VALUES ($1,0,'Personel band',$2,80), ($1,1,'Manajemen fee',$3,20) ON CONFLICT DO NOTHING`, [SENJA.id, SENJA.orgId, NADA]);

    // Blok kalender
    await c.query(
      `INSERT INTO calendar_slots (id, artist_id, period, status, note) SELECT $1,$2, daterange($3::date,$4::date,'[]'),'BLOCKED','Rekaman album'
       WHERE NOT EXISTS (SELECT 1 FROM calendar_slots WHERE artist_id=$2 AND note='Rekaman album')`,
      [uuidv7(), SENJA.id, day(10), day(12)],
    );
    await c.query(
      `INSERT INTO calendar_slots (id, artist_id, period, status, note) SELECT $1,$2, daterange($3::date,$4::date,'[]'),'TRAVEL','Perjalanan tur Sumatra'
       WHERE NOT EXISTS (SELECT 1 FROM calendar_slots WHERE artist_id=$2 AND note='Perjalanan tur Sumatra')`,
      [uuidv7(), SEED.artists[2].id, day(20), day(21)],
    );

    // ---- Booking demo ----
    const promotorContact = JSON.stringify({ name: 'Raka (Pensi Nusantara)', email: 'promotor@rave.id', phone: '+62 811-2222-3333' });
    async function ins(n: number, artistIdx: number, f: Partial<BookingRow> & Record<string, unknown>) {
      const a = SEED.artists[artistIdx];
      const id = seedId(600, n);
      const r = await c.query(
        `INSERT INTO bookings (id, artist_id, artist_org_id, promotor_org_id, promotor_user_id, promotor_contact, status, event_name, event_date, start_time,
           duration_min, city, venue, capacity, category, format, budget, notes, hold_expires_at, latest_fee, agreed_fee, dp_paid, settlement_paid,
           show_done_promotor, show_done_management, completed_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'seed') ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id, a.id, a.orgId, PENSI, SEED.users.promotor, promotorContact, f.status, f.event_name, f.event_date, f.start_time ?? '19:30', f.duration_min ?? 60,
          f.city, f.venue, f.capacity, f.category, f.format ?? 'FULL_BAND', f.budget, f.notes ?? null, f.hold_expires_at ?? null, f.latest_fee ?? null,
          f.agreed_fee ?? null, f.dp_paid ?? 0, f.settlement_paid ?? 0, !!f.agreed_fee && ['COMPLETED', 'SETTLED'].includes(String(f.status)),
          !!f.agreed_fee && ['COMPLETED', 'SETTLED'].includes(String(f.status)), f.completed_at ?? null],
      );
      return { id, inserted: !!r.rowCount, artist: a };
    }
    async function ev(id: string, rows: [string | null, string, string, string | null][]) {
      for (const [from, to, actor, note] of rows)
        await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor, note) VALUES ($1,$2,$3,$4,$5)`, [id, from, to, actor, note]);
    }

    // 1) INQUIRY dengan hold: Pensi SMA di Bandung
    const b1 = await ins(1, 0, {
      status: 'INQUIRY',
      event_name: 'Pensi SMAN 3 Bandung — Gelora Senja',
      event_date: day(42),
      city: 'Bandung',
      venue: 'Aula SMAN 3 Bandung',
      capacity: 1500,
      category: 'PENSI',
      budget: 15_000_000,
      notes: 'Pensi tahunan OSIS. Kami siapkan sound 10K watt & backline lengkap.',
      hold_expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
    });
    if (b1.inserted) {
      await ev(b1.id, [[null, 'DRAFT', 'promotor', null], ['DRAFT', 'INQUIRY', 'promotor', 'Hold HOLD_1 72 jam']]);
      await c.query(`INSERT INTO calendar_slots (id, artist_id, period, status, booking_id, note) VALUES ($1,$2, daterange($3::date,$3::date,'[]'),'HOLD_1',$4,$5)`, [
        uuidv7(), SENJA.id, day(42), b1.id, 'Pensi SMAN 3 Bandung — Gelora Senja',
      ]);
      await publish(c, 'booking.inquiry.created', b1.id, { bookingId: b1.id, artistId: SENJA.id, promotorOrgId: PENSI, eventDate: day(42), city: 'Bandung', budget: 15_000_000 });
    }

    // 2) NEGOTIATING: festival kampus Jakarta
    const b2 = await ins(2, 0, {
      status: 'NEGOTIATING',
      event_name: 'Sorak Raya — Festival Kampus Jakarta',
      event_date: day(60),
      start_time: '20:00',
      city: 'Jakarta',
      venue: 'Lapangan Utama Universitas Nusantara',
      capacity: 5000,
      category: 'KAMPUS',
      budget: 18_000_000,
      latest_fee: 19_500_000,
    });
    if (b2.inserted) {
      const o1 = uuidv7();
      const o2 = uuidv7();
      await c.query(
        `INSERT INTO offers (id, booking_id, by_party, author_id, fee, dp_pct, settlement_days_before, rider_notes, message, created_at) VALUES
         ($1,$3,'management',$4,22000000,50,7,'Transport Bandung–Jakarta untuk 8 orang ditanggung promotor','Fee sesuai rate card zona Jawa + 1 lagu baru.', now() - interval '2 days'),
         ($2,$3,'promotor',$5,19500000,50,7,null,'Budget kami terbatas, bisa di 19,5 jt? Hotel kami siapkan.', now() - interval '1 day')`,
        [o1, o2, b2.id, SEED.users.manager, SEED.users.promotor],
      );
      await c.query(`UPDATE bookings SET latest_offer_id=$2 WHERE id=$1`, [b2.id, o2]);
      await c.query(
        `INSERT INTO messages (id, booking_id, by_party, author_id, author_name, body, created_at) VALUES
         ($1,$3,'promotor',$4,'Raka (Pensi Nusantara)','Halo, kami ingin Senja Kolektif jadi headliner Sorak Raya. Durasi 60 menit.', now() - interval '3 days'),
         ($2,$3,'management',$5,'Nada Manajemen','Terima kasih! Tanggal masih available. Kami kirim offer ya.', now() - interval '2 days')`,
        [uuidv7(), uuidv7(), b2.id, SEED.users.promotor, SEED.users.manager],
      );
      await ev(b2.id, [[null, 'DRAFT', 'promotor', null], ['DRAFT', 'INQUIRY', 'promotor', null], ['INQUIRY', 'NEGOTIATING', 'management', 'Offer 22000000']]);
    }

    // 3) Riwayat show selesai (tanpa ledger; source='seed') untuk statistik reputasi EPK
    const hist: [number, number, number, string, string, string, string, number, string][] = [
      [11, 0, -40, 'Festival Ruang Temu Yogyakarta', 'Yogyakarta', 'Lapangan Kenari', 'FESTIVAL', 25_000_000, 'SETTLED'],
      [12, 0, -95, 'Malam Apresiasi Karyawan Bank Jabar', 'Bandung', 'Trans Convention Hall', 'KORPORAT', 30_000_000, 'SETTLED'],
      [13, 1, -20, 'Pensi SMA Teladan — Jogja Bersenandung', 'Yogyakarta', 'GOR Amongrogo', 'PENSI', 9_000_000, 'SETTLED'],
      [14, 2, -3, 'Rock Kampus ITS', 'Surabaya', 'Graha ITS', 'KAMPUS', 24_000_000, 'COMPLETED'],
    ];
    for (const [n, ai, off, name, city, venue, cat, fee, status] of hist) {
      const b = await ins(n, ai, {
        status,
        event_name: name,
        event_date: day(off),
        city,
        venue,
        capacity: 3000,
        category: cat,
        budget: fee,
        latest_fee: fee,
        agreed_fee: fee,
        dp_paid: fee / 2,
        settlement_paid: fee / 2,
        completed_at: new Date(Date.now() + (off + 1) * 86400_000).toISOString(),
      });
      if (!b.inserted) continue;
      await ev(b.id, [
        [null, 'INQUIRY', 'promotor', 'Data historis (seed)'],
        ['INQUIRY', 'AGREED', 'both', null],
        ['AGREED', 'SIGNED', 'system', null],
        ['SIGNED', 'BOOKED_AND_SECURED', 'system', null],
        ['BOOKED_AND_SECURED', 'COMPLETED', 'both', null],
        ...(status === 'SETTLED' ? ([['COMPLETED', 'SETTLED', 'system', null]] as [string, string, string, null][]) : []),
      ]);
      await c.query(`INSERT INTO calendar_slots (id, artist_id, period, status, booking_id, note) VALUES ($1,$2, daterange($3::date,$3::date,'[]'),'BOOKED_AND_SECURED',$4,$5)`, [
        uuidv7(), b.artist.id, day(off), b.id, name,
      ]);
      const bk = (await c.query(`SELECT * FROM bookings WHERE id=$1`, [b.id])).rows[0];
      const { body, sha256 } = renderContract({ b: bk, fee, artistName: b.artist.name, artistCity: b.artist.city, promotorName: 'Pensi Nusantara', rider: RIDER(5), riderNotes: null });
      const kid = uuidv7();
      await c.query(`INSERT INTO contracts (id, booking_id, template_version, body_markdown, sha256, status, signed_at) VALUES ($1,$2,$3,$4,$5,'SIGNED',now())`, [kid, b.id, TEMPLATE_VERSION, body, sha256]);
      const s = n % 2 ? 5 : 4;
      await c.query(
        `INSERT INTO ratings (booking_id, by_party, author_id, scores, overall, comment) VALUES
         ($1,'promotor',$2,$3,$4,'Tepat waktu, penonton sangat antusias.'),
         ($1,'management',$5,'{"ketepatan_bayar":5,"kualitas_produksi":4,"hospitality":5,"komunikasi":5}',4.75,'Pembayaran lancar lewat escrow.')`,
        [b.id, SEED.users.promotor, JSON.stringify({ ketepatan_waktu: 5, kualitas_penampilan: s, profesionalisme: 5, kepatuhan_rider: 4 }), (5 + s + 5 + 4) / 4, SEED.users.manager],
      );
    }
  });
  log.info('seed booking selesai');
}

export type { Client };
