import { SEED, seedId } from '@gema/domain';
import type { ServiceContext } from '@gema/service-kit';

/**
 * Data demo (idempoten): 3 promosi internal GEMA, 2 kampanye berbayar fiktif yang sudah disetujui,
 * 1 kampanye keuangan menunggu tinjauan. Merek fiktif; tautan luar memakai example.com.
 */
const CAMPAIGNS = [
  { n: 1, advertiser: 'GEMA', name: 'Promosi Premium', category: 'music', title: 'Lebih banyak cerita, tanpa jeda', body: 'Podcast & audio fiksi eksklusif, bebas iklan. Gratis 1 bulan saat peluncuran.', click: '/premium', cta: 'Lihat Premium', color: '#7c3aed', dur: 10, house: true, status: 'APPROVED' },
  { n: 2, advertiser: 'GEMA', name: 'Promosi event Bandung', category: 'events', title: 'Pulang ke Utara Tour — Bandung', body: 'Senja Kolektif & Arunika, 24 Oktober di Dago Tea House. Presale fan setia dibuka.', click: '/app/events/pulang-ke-utara-tour-bandung', cta: 'Beli tiket', color: '#da1c5c', dur: 10, house: true, status: 'APPROVED' },
  { n: 3, advertiser: 'GEMA', name: 'Promosi live streaming', category: 'events', title: 'Ada yang sedang live', body: 'Tonton sesi studio dan konser langsung dari artis favoritmu.', click: '/app/live', cta: 'Tonton', color: '#f6851f', dur: 8, house: true, status: 'APPROVED' },
  { n: 4, advertiser: 'Kopi Tepi Kota', name: 'Gula aren musim hujan', category: 'food_beverage', title: 'Kopi susu gula aren, teman lagu sore', body: 'Diskon 20% di semua gerai dengan menunjukkan aplikasi GEMA.', click: 'https://example.com/kopi-tepi-kota', cta: 'Lihat promo', color: '#8b5a2b', dur: 10, genres: ['indie-pop', 'folk', 'akustik', 'r-n-b', 'soul'], status: 'APPROVED', priority: 6 },
  { n: 5, advertiser: 'Sinyal Nusantara', name: 'Paket kuota streaming', category: 'telco', title: 'Kuota streaming 30 GB, Rp 50 rb', body: 'Dengar lossless tanpa khawatir kuota. Khusus pelanggan baru.', click: 'https://example.com/sinyal-nusantara', cta: 'Aktifkan', color: '#0f766e', dur: 12, cities: ['Bandung', 'Jakarta', 'Surabaya'], status: 'APPROVED', priority: 5 },
  { n: 6, advertiser: 'Dana Kilat', name: 'Pinjaman modal kreator', category: 'finance', license: 'KEP-123/D.05/2026 (demo)', title: 'Modal alat musik, cicilan ringan', body: 'Pembiayaan berizin & diawasi OJK. Bunga transparan sejak awal.', click: 'https://example.com/dana-kilat', cta: 'Pelajari', color: '#1d4ed8', dur: 12, status: 'PENDING_REVIEW', priority: 4 },
] as const;

export async function seed({ db, log }: ServiceContext) {
  for (const c of CAMPAIGNS) {
    const house = 'house' in c && c.house;
    await db.query(
      `INSERT INTO campaigns (id, advertiser, name, category, license_ref, type, title, body, click_url, cta_label, theme_color, duration_s,
         target_genres, target_cities, priority, is_house, status, reviewed_by, reviewed_by_name, reviewed_at, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,'display',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO NOTHING`,
      [
        seedId(900, c.n), c.advertiser, c.name, c.category, 'license' in c ? c.license : null, c.title, c.body, c.click, c.cta, c.color, c.dur,
        'genres' in c ? c.genres : [], 'cities' in c ? c.cities : [], 'priority' in c ? c.priority : 3, house, c.status,
        c.status === 'APPROVED' ? SEED.users.superadmin : null, c.status === 'APPROVED' ? 'Super Admin GEMA' : null, c.status === 'APPROVED' ? new Date() : null,
        house ? SEED.users.superadmin : SEED.users.admin, house ? 'Super Admin GEMA' : 'Admin GEMA',
      ],
    );
  }
  log.info(`seed ads: ${CAMPAIGNS.length} kampanye (3 promosi internal)`);
}
