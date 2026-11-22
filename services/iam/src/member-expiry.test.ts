// S1 (P-7): masa Premium berakhir alami → iam.user.member_changed (EXPIRED) sekali per masa.
import { describe, expect, it } from 'vitest';
import { fakeDb } from '@rave/service-kit/testing';
import { memberChangeRevokes } from '@rave/domain/offline';
import { MEMBER_EXPIRY_BATCH, announceExpiredMembers, memberExpiryJob } from './member-expiry.js';

const HOUR = 3600_000;
const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

interface U {
  id: string;
  member_type: string;
  member_until: Date | null;
  member_expiry_announced_until: Date | null;
  deleted_at: Date | null;
  locked?: boolean;
}

/** Tiruan tabel users yang menjalankan predikat query job (bukan sekadar mencocokkan string). */
function usersDb(users: U[]) {
  const f = fakeDb((sql, p) => {
    if (!sql.startsWith('UPDATE users u SET member_expiry_announced_until = u.member_until')) return undefined;
    // Predikat harus sama dengan indeks parsial migrasi 018.
    expect(sql).toContain(
      "WHERE member_until IS NOT NULL AND member_type <> 'FREE' AND deleted_at IS NULL AND member_expiry_announced_until IS DISTINCT FROM member_until AND member_until <= now()",
    );
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    const now = Date.now();
    const due = users
      .filter((u) => !u.locked && u.member_until && u.member_type !== 'FREE' && !u.deleted_at)
      .filter((u) => u.member_expiry_announced_until?.getTime() !== u.member_until!.getTime())
      .filter((u) => u.member_until!.getTime() <= now)
      .sort((a, b) => a.member_until!.getTime() - b.member_until!.getTime())
      .slice(0, p[0]);
    for (const u of due) u.member_expiry_announced_until = u.member_until;
    return due.map((u) => ({ id: u.id, member_type: u.member_type, member_until: u.member_until }));
  });
  return f;
}

const base = (n: number, o: Partial<U>): U => ({ id: id(n), member_type: 'INDIVIDUAL', member_until: null, member_expiry_announced_until: null, deleted_at: null, ...o });

describe('job member-expiry', () => {
  it('mengumumkan masa yang lewat sekali; tidak menyentuh Premium aktif, tanpa batas, FREE, terhapus, atau baris terkunci', async () => {
    const past = new Date(Date.now() - HOUR);
    const users = [
      base(1, { member_type: 'DUO', member_until: past }),
      base(2, { member_until: new Date(Date.now() + HOUR) }), // masih aktif
      base(3, { member_until: null }), // tanpa batas
      base(4, { member_type: 'FREE', member_until: null }),
      base(5, { member_until: past, deleted_at: new Date() }),
      base(6, { member_until: past, locked: true }), // dipegang replika lain / PATCH admin
    ];
    const f = usersDb(users);
    expect(await announceExpiredMembers(f.db)).toBe(1);
    expect(f.events).toEqual([
      { topic: 'iam.user.member_changed', key: id(1), payload: { userId: id(1), memberType: 'DUO', memberUntil: past.toISOString(), premium: false, reason: 'EXPIRED' } },
    ]);
    // Putaran berikutnya (replika lain / interval berikut): tidak dobel.
    expect(await announceExpiredMembers(f.db)).toBe(0);
    expect(f.events).toHaveLength(1);
    // Kunci dilepas → baris itu diumumkan sekali pada putaran berikutnya.
    users[5].locked = false;
    expect(await announceExpiredMembers(f.db)).toBe(1);
    expect(f.events.map((e) => e.key)).toEqual([id(1), id(6)]);
  });

  it('diperpanjang lalu berakhir lagi → masa baru diumumkan sekali lagi', async () => {
    const u = base(1, { member_until: new Date(Date.now() - 2 * HOUR) });
    const f = usersDb([u]);
    await announceExpiredMembers(f.db);
    u.member_until = new Date(Date.now() + HOUR); // Super Admin memperpanjang
    expect(await announceExpiredMembers(f.db)).toBe(0);
    u.member_until = new Date(Date.now() - 1000); // masa baru habis
    expect(await announceExpiredMembers(f.db)).toBe(1);
    expect(await announceExpiredMembers(f.db)).toBe(0);
    expect(f.events.map((e) => e.payload.memberUntil)).toHaveLength(2);
  });

  it('berbatch: lebih dari satu batch diproses dalam satu putaran, tiap batch satu transaksi', async () => {
    const past = Date.now() - HOUR;
    const users = Array.from({ length: MEMBER_EXPIRY_BATCH + 5 }, (_, i) => base(i + 1, { member_until: new Date(past - i * 1000) }));
    const f = usersDb(users);
    let logged: any;
    await memberExpiryJob.run({ db: f.db, log: { info: (o: any) => (logged = o) } } as any);
    expect(f.events).toHaveLength(MEMBER_EXPIRY_BATCH + 5);
    expect(new Set(f.events.map((e) => e.key)).size).toBe(MEMBER_EXPIRY_BATCH + 5);
    expect(logged).toEqual({ announced: MEMBER_EXPIRY_BATCH + 5 });
    expect(f.queries.filter((q) => q.startsWith('UPDATE users u')).length).toBe(2);
  });

  it('transaksi gagal → outbox dibuang, penanda tidak tersimpan (diulang putaran berikutnya)', async () => {
    const f = fakeDb(() => {
      throw new Error('db down');
    });
    await expect(announceExpiredMembers(f.db)).rejects.toThrow('db down');
    expect(f.events).toHaveLength(0);
  });

  it('kontrak konsumen playback: payload EXPIRED mencabut lisensi (MEMBERSHIP), termasuk jenis berbayar yang diizinkan', () => {
    const policy = { enabled: true, allowUserIds: [], tiers: ['INDIVIDUAL', 'STUDENT', 'DUO'], podcastEnabled: true };
    const payload = { userId: id(1), memberType: 'DUO' as const, memberUntil: new Date(Date.now() - HOUR).toISOString(), premium: false, reason: 'EXPIRED' as const };
    expect(memberChangeRevokes(policy, payload)).toBe(true);
    // Pembanding: perpanjangan oleh Super Admin (jalur ADMIN, masih berlaku) tidak mencabut.
    const renewed = { ...payload, premium: true, memberUntil: new Date(Date.now() + HOUR).toISOString(), reason: 'ADMIN' as const };
    expect(memberChangeRevokes(policy, renewed)).toBe(false);
  });
});
