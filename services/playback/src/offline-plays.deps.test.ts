// T-5 (review keamanan P-7): galat hulu laporan putar offline dipetakan sama dengan /v1/offline/* — detail internal
// iam/catalog tidak bocor ke klien.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@rave/service-kit';

const callService = vi.fn();
vi.mock('@rave/service-kit', async (orig) => ({ ...(await orig<typeof import('@rave/service-kit')>()), callService: (...a: unknown[]) => callService(...a) }));

const { offlinePlayServiceDeps } = await import('./offline-plays.js');
const U = '0190a000-0000-7000-8000-0000000000e1';
const D = '0190a000-0000-7000-8000-0000000000f1';
const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const h = e as HttpError;
    return [h.status, (h.extra as any)?.code, h.detail];
  }
  throw new Error('tidak gagal');
};

describe('offline-plays: pemeta galat hulu (T-5)', () => {
  beforeEach(() => callService.mockReset());

  it('iam: 404 pengguna → 403 account_suspended; 4xx lain → 502 upstream_error tanpa detail internal; 5xx diteruskan', async () => {
    const deps = offlinePlayServiceDeps('playback');
    callService.mockRejectedValueOnce(new HttpError(404, 'Upstream error', 'Pengguna tidak ditemukan'));
    expect((await fail(deps.entitlement(U, D))).slice(0, 2)).toEqual([403, 'account_suspended']);
    callService.mockRejectedValueOnce(new HttpError(403, 'Upstream error', 'Khusus antar-service'));
    const r = await fail(deps.entitlement(U, D));
    expect(r.slice(0, 2)).toEqual([502, 'upstream_error']);
    expect(r[2]).not.toMatch(/antar-service/);
    callService.mockRejectedValueOnce(new HttpError(504, 'Gateway Timeout', 'timeout'));
    expect((await fail(deps.entitlement(U, D)))[0]).toBe(504);
  });

  it('catalog meta: 4xx tak terpetakan → 502 upstream_error; sukses diteruskan apa adanya', async () => {
    const deps = offlinePlayServiceDeps('playback');
    callService.mockRejectedValueOnce(new HttpError(400, 'Upstream error', 'Body tidak valid: tracks'));
    expect((await fail(deps.contentMeta([], []))).slice(0, 2)).toEqual([502, 'upstream_error']);
    callService.mockResolvedValueOnce({ tracks: {}, episodes: {} });
    expect(await deps.contentMeta([], [])).toEqual({ tracks: {}, episodes: {} });
  });
});
