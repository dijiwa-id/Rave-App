import { describe, expect, it } from 'vitest';
import { ageOf, isoDate, verificationChecklist, VERIFY_KEYS, type Q } from './core.js';

/** Q tiruan: hanya menjawab query identitas milik pengguna. */
const fakeQ = (ids: { provider: string; subject: string }[]): Q => ({ query: async () => ({ rows: ids, rowCount: ids.length }) });

const complete = {
  id: 'u1',
  full_name: 'Quinn Arunika',
  birth_date: '1999-04-12',
  gender: 'female',
  bio: 'Penikmat shoegaze & noise pop dari Bandung.',
  socials: ['https://instagram.com/quinn.ar'],
  avatar_url: '/v1/catalog/media/a.jpg',
  city: 'Bandung',
  email: 'q@rave.test',
  phone: '+6281234500077',
};
const bothIds = [
  { provider: 'email', subject: 'q@rave.test' },
  { provider: 'whatsapp', subject: '+6281234500077' },
];

describe('verifikasi akun — umur & tanggal', () => {
  it('ageOf menghitung tahun penuh (belum ulang tahun → dikurangi satu)', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    expect(ageOf('2013-04-12', now)).toBe(12);
    expect(ageOf('2013-04-11', now)).toBe(13);
  });
  it('isoDate memakai komponen lokal (kolom date node-pg = tengah malam lokal), bukan UTC', () => {
    expect(isoDate(new Date(1999, 3, 12))).toBe('1999-04-12');
    expect(isoDate('1999-04-12T00:00:00.000Z')).toBe('1999-04-12');
    expect(isoDate(null)).toBeNull();
  });
});

describe('verifikasi akun — daftar periksa', () => {
  it('data lengkap + email & WhatsApp tertaut → semua terpenuhi', async () => {
    const c = await verificationChecklist(fakeQ(bothIds), complete);
    expect(VERIFY_KEYS.every((k) => c[k])).toBe(true);
  });
  it('WhatsApp tanpa identitas OTP tidak dianggap terverifikasi', async () => {
    const c = await verificationChecklist(fakeQ([bothIds[0]]), complete);
    expect(c.phone).toBe(false);
    expect(c.email).toBe(true);
  });
  it('email dari login sosial (Google) dianggap terverifikasi', async () => {
    const c = await verificationChecklist(fakeQ([{ provider: 'google', subject: 'sub-123' }]), complete);
    expect(c.email).toBe(true);
  });
  it('bio pendek, usia < 13, tautan bukan http, gender kosong → gagal per butir', async () => {
    const c = await verificationChecklist(fakeQ(bothIds), { ...complete, bio: 'halo', birth_date: '2020-01-01', socials: ['instagram.com/x'], gender: null });
    expect([c.bio, c.birth_date, c.socials, c.gender]).toEqual([false, false, false, false]);
    expect(c.full_name && c.avatar && c.city).toBe(true);
  });
});
