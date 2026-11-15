// Backfill amplop spektrum LCD pemutar untuk lagu LIVE yang belum punya (worker catalog `track-spectrum`, 1 lagu sekaligus).
// Pakai: npm run spectrum:backfill [-- --limit 500] [--retry-failed] [--wait]
// Butuh JWT_SECRET yang sama dengan stack (dev: .env) — mencetak token Super Admin sementara lalu memanggil
// POST /v1/admin/catalog/spectrum/backfill lewat gateway (GATEWAY, default http://127.0.0.1:8080).
import { signAccessToken } from '@rave/service-kit';
import { SEED } from '@rave/domain';

const BASE = process.env.GATEWAY ?? 'http://127.0.0.1:8080';
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf('--limit') + 1]) || 500;
const retry = args.includes('--retry-failed');
const wait = args.includes('--wait');
const token = await signAccessToken({ sub: SEED.users.superadmin, roles: ['admin', 'superadmin'] as any, orgs: [], kyc: true }, 900);
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return data;
};
console.log('antre:', await call('POST', '/v1/admin/catalog/spectrum/backfill', { limit, retry_failed: retry }));
for (;;) {
  // Service bisa sedang dimuat ulang (watch dev) → coba lagi sebentar.
  const s = await call('GET', '/v1/admin/catalog/spectrum/status').catch(async (e) => {
    if (!wait) throw e;
    await new Promise((r) => setTimeout(r, 3000));
    return call('GET', '/v1/admin/catalog/spectrum/status');
  });
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(s.by_status), `/ ${s.live_tracks} lagu LIVE`);
  if (!wait || !((s.by_status.pending ?? 0) + (s.by_status.processing ?? 0))) break;
  await new Promise((r) => setTimeout(r, 3000));
}
