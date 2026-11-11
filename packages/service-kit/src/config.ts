import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Muat .env dari root monorepo (jika ada) tanpa dependensi tambahan.
// `.env.example` hanya fallback dev — di produksi konfigurasi wajib eksplisit.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of process.env.NODE_ENV === 'production' ? ['.env'] : ['.env', '.env.example']) {
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
  databaseUrl: env('DATABASE_URL', 'postgres://rave:rave@127.0.0.1:55432/rave'),
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
    live: Number(env('LIVE_PORT', '4010')),
    ads: Number(env('ADS_PORT', '4011')),
  },
};

/** Nilai bawaan dev yang tidak boleh terbawa ke produksi (siapa pun yang tahu bisa menerbitkan token service). */
const DEV_DEFAULTS: [name: string, value: string][] = [
  ['JWT_SECRET', 'dev-only-change-me-please-32-bytes-min'],
  ['MEDIA_SIGNING_SECRET', 'dev-media-signing-secret'],
  ['PG_WEBHOOK_SECRET', 'dev-pg-webhook-secret'],
  ['INTERNAL_SERVICE_SECRET', 'dev-internal-service-secret'],
];
if (!config.isDev) {
  const bad = DEV_DEFAULTS.filter(([n, v]) => (process.env[n] ?? v) === v).map(([n]) => n);
  if (!process.env.KYC_KEY) bad.push('KYC_KEY');
  if (process.env.RAVE_FAST_CLOCK === '1') bad.push('RAVE_FAST_CLOCK (tidak boleh 1 di produksi)');
  // Kredensial DB bawaan dev (rave:rave) dan secret pendek tidak boleh dipakai di produksi.
  if (/\/\/rave:rave@/.test(config.databaseUrl)) bad.push('DATABASE_URL (masih memakai password dev rave:rave)');
  for (const n of ['JWT_SECRET', 'INTERNAL_SERVICE_SECRET', 'MEDIA_SIGNING_SECRET', 'KYC_KEY']) {
    const v = process.env[n];
    if (v && v.length < 32) bad.push(`${n} (minimal 32 karakter)`);
  }
  if (bad.length) throw new Error(`NODE_ENV=production: set nilai produksi untuk ${bad.join(', ')}`);
}

export type ServiceName = keyof typeof config.ports;

export function serviceUrl(name: Exclude<ServiceName, 'gateway'>): string {
  const override = process.env[`${name.toUpperCase()}_URL`];
  return override ?? `http://127.0.0.1:${config.ports[name]}`;
}

/**
 * Identitas instance (replika) proses ini — unik per start. Dipakai di log, `/internal/stats`,
 * dan kepemilikan sumber daya per instance (mis. siaran live). Bisa dipaksa via env INSTANCE_ID.
 */
export const INSTANCE_ID = process.env.INSTANCE_ID || `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
