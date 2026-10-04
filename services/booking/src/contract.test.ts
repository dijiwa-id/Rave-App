import { describe, expect, it } from 'vitest';
import { canTransition } from '@gema/domain';
import { renderContract, TEMPLATE_VERSION } from './contract.js';

const b: any = {
  id: 'b-1',
  event_name: 'Pensi Uji',
  event_date: '2026-12-01',
  start_time: '19:30',
  duration_min: 60,
  venue: 'Aula',
  city: 'Bandung',
  capacity: 1000,
  category: 'PENSI',
  format: 'FULL_BAND',
  dp_pct: 50,
  settlement_days_before: 7,
};

describe('templat kontrak booking (§8.7)', () => {
  const { body, sha256 } = renderContract({ b, fee: 20_000_000, artistName: 'Senja', artistCity: 'Bandung', promotorName: 'Pensi', rider: { soundcheck_minutes: 45 }, riderNotes: null });
  it('memuat seluruh klausul wajib', () => {
    for (const h of ['Para Pihak', 'Detail Pertunjukan', 'Fee, Termin & Rekening Bersama', 'Rider', 'Dokumentasi', 'Radius & Eksklusivitas', 'Pembatalan', 'Keamanan', 'Penyelesaian Sengketa']) {
      expect(body).toContain(h);
    }
    expect(body).toContain(TEMPLATE_VERSION);
    expect(body).toContain('Rp 10.000.000'); // DP 50%
  });
  it('hash deterministik', () => {
    expect(renderContract({ b, fee: 20_000_000, artistName: 'Senja', artistCity: 'Bandung', promotorName: 'Pensi', rider: { soundcheck_minutes: 45 }, riderNotes: null }).sha256).toBe(sha256);
  });
  it('batal sebelum tanda tangan diizinkan, setelah SIGNED tidak lewat DECLINED', () => {
    expect(canTransition('CONTRACT_SENT', 'DECLINED', 'promotor')).toBe(true);
    expect(canTransition('SIGNED', 'DECLINED', 'promotor')).toBe(false);
  });
});
