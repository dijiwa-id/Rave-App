// Regresi M1 (review keamanan P-7): OFFLINE_KEY kosong tidak boleh menghasilkan kunci offline yang bisa dihitung publik.
import { afterEach, describe, expect, it, vi } from 'vitest';

const PROD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'j'.repeat(40),
  INTERNAL_SERVICE_SECRET: 'i'.repeat(40),
  MEDIA_SIGNING_SECRET: 'm'.repeat(40),
  PG_WEBHOOK_SECRET: 'w'.repeat(40),
  KYC_KEY: 'k'.repeat(40),
  PUBLIC_WEB_URL: 'https://rave.example.id',
  DATABASE_URL: 'postgres://app:s3cret-password@db:5432/rave',
};

async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...PROD, ...env })) vi.stubEnv(k, v as string);
  return import('./offline.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('bahan kunci offline (M1)', () => {
  it('produksi: OFFLINE_KEY="" → gagal start (config menolak)', async () => {
    await expect(loadWith({ OFFLINE_KEY: '' })).rejects.toThrow(/OFFLINE_KEY/);
  });

  it('produksi: OFFLINE_KEY pendek / spasi / sama dengan secret lain → gagal start', async () => {
    await expect(loadWith({ OFFLINE_KEY: 'pendek' })).rejects.toThrow(/OFFLINE_KEY/);
    await expect(loadWith({ OFFLINE_KEY: ' '.repeat(40) })).rejects.toThrow(/OFFLINE_KEY/);
    await expect(loadWith({ OFFLINE_KEY: PROD.KYC_KEY })).rejects.toThrow(/OFFLINE_KEY \(sama/);
  });

  it('produksi: OFFLINE_KEY tidak diset → diturunkan dari KYC_KEY (bukan JWT secret)', async () => {
    const m = await loadWith({});
    delete process.env.OFFLINE_KEY;
    expect(m.offlineBaseSecret()).toBe(PROD.KYC_KEY);
    const withKyc = m.licensePublicKey().kid;
    const m2 = await loadWith({ OFFLINE_KEY: 'o'.repeat(40) });
    expect(m2.offlineBaseSecret()).toBe('o'.repeat(40));
    expect(m2.licensePublicKey().kid).not.toBe(withKyc);
  });

  it('produksi: tanpa OFFLINE_KEY & KYC_KEY kosong saat dipakai → melempar, tidak jatuh ke JWT secret', async () => {
    const m = await loadWith({});
    delete process.env.OFFLINE_KEY;
    vi.stubEnv('KYC_KEY', '');
    expect(() => m.offlineBaseSecret()).toThrow(/wajib/);
    expect(() => m.sealCek(Buffer.alloc(32))).toThrow(/wajib/);
  });

  it('dev: OFFLINE_KEY="" diabaikan (pakai KYC_KEY), bukan kunci dari string kosong', async () => {
    const m = await loadWith({ NODE_ENV: 'test', OFFLINE_KEY: '', KYC_KEY: 'x'.repeat(40) });
    expect(m.offlineBaseSecret()).toBe('x'.repeat(40));
  });
});
