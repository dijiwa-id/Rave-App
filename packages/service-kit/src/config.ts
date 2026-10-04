import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Muat .env dari root monorepo (jika ada) tanpa dependensi tambahan.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['.env', '.env.example']) {
  const p = join(root, f);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* abaikan */
    }
    break;
  }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Env ${name} wajib di-set`);
  return v;
}

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  isDev: env('NODE_ENV', 'development') !== 'production',
  databaseUrl: env('DATABASE_URL', 'postgres://gema:gema@127.0.0.1:55432/gema'),
  jwtSecret: env('JWT_SECRET', 'dev-only-change-me-please-32-bytes-min'),
  busDriver: env('BUS_DRIVER', 'pg') as 'pg' | 'kafka',
  kafkaBrokers: env('KAFKA_BROKERS', '127.0.0.1:19092').split(','),
  mediaSigningSecret: env('MEDIA_SIGNING_SECRET', 'dev-media-signing-secret'),
  pgWebhookSecret: env('PG_WEBHOOK_SECRET', 'dev-pg-webhook-secret'),
  internalSecret: env('INTERNAL_SERVICE_SECRET', 'dev-internal-service-secret'),
  ports: {
    gateway: Number(env('GATEWAY_PORT', '8080')),
    iam: Number(env('IAM_PORT', '4001')),
    catalog: Number(env('CATALOG_PORT', '4002')),
    library: Number(env('LIBRARY_PORT', '4003')),
    playback: Number(env('PLAYBACK_PORT', '4004')),
    booking: Number(env('BOOKING_PORT', '4005')),
    finance: Number(env('FINANCE_PORT', '4006')),
    ticketing: Number(env('TICKETING_PORT', '4007')),
    notification: Number(env('NOTIFICATION_PORT', '4008')),
    platform: Number(env('PLATFORM_PORT', '4009')),
  },
};

export type ServiceName = keyof typeof config.ports;

export function serviceUrl(name: Exclude<ServiceName, 'gateway'>): string {
  const override = process.env[`${name.toUpperCase()}_URL`];
  return override ?? `http://127.0.0.1:${config.ports[name]}`;
}
