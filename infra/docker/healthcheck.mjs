// HEALTHCHECK kontainer: GET /healthz pada port service ini (SERVICE + <NAMA>_PORT, default sama dengan service-kit).
const DEFAULT_PORTS = { gateway: 8080, iam: 4001, catalog: 4002, library: 4003, playback: 4004, booking: 4005, finance: 4006, ticketing: 4007, notification: 4008, platform: 4009, live: 4010, ads: 4011 };
const svc = process.env.SERVICE ?? '';
const port = process.env[`${svc.toUpperCase()}_PORT`] ?? DEFAULT_PORTS[svc];
if (!port) { console.error(`healthcheck: service tidak dikenal "${svc}"`); process.exit(1); }
try {
  const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
  process.exit(r.ok ? 0 : 1);
} catch {
  process.exit(1);
}
