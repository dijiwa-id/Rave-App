import { SETTINGS_BY_KEY, settingDefaults } from '@rave/domain/settings';
import pg from 'pg';
import { serviceHeaders } from './auth.js';
import { config, serviceUrl } from './config.js';

/**
 * Klien pengaturan platform (dikelola Super Admin di service `platform`).
 * - Nilai awal = default registri, lalu ditimpa snapshot dari `GET /internal/settings`.
 * - Diperbarui real-time di SETIAP replika lewat Postgres LISTEN/NOTIFY kanal `rave_settings`
 *   (`startSettingsListener`), plus event `platform.settings.updated` (consumer group → satu replika per service)
 *   dan refresh berkala sebagai jaring pengaman.
 * Service yang tidak bisa menjangkau `platform` tetap jalan dengan default (degradasi aman).
 */
const values: Record<string, unknown> = settingDefaults();
let loadedAt: number | null = null;
let version: number | null = null;
/** Pemuat alternatif (service `platform` membaca DB-nya sendiri, bukan HTTP ke dirinya). */
let loader: (() => Promise<{ version: number; values: Record<string, unknown> }>) | null = null;

/** Kanal NOTIFY Postgres; payload = versi pengaturan. Dikirim platform di dalam transaksi applyChanges. */
export const SETTINGS_CHANNEL = 'rave_settings';

export const settings = {
  get<T = unknown>(key: string): T {
    if (!(key in SETTINGS_BY_KEY)) throw new Error(`Pengaturan tidak dikenal: ${key}`);
    return values[key] as T;
  },
  num(key: string): number {
    return Number(this.get(key));
  },
  bool(key: string): boolean {
    return Boolean(this.get(key));
  },
  all(): Record<string, unknown> {
    return { ...values };
  },
  apply(changes: Record<string, unknown>) {
    for (const [k, v] of Object.entries(changes)) if (k in SETTINGS_BY_KEY) values[k] = v;
    loadedAt = Date.now();
  },
  /** Terapkan snapshot/diff berversi; yang lebih lama dari versi terkini diabaikan (urutan jalur NOTIFY vs bus vs polling). */
  applyVersioned(changes: Record<string, unknown>, v: number | undefined | null): boolean {
    if (typeof v === 'number' && version !== null && v < version) return false;
    this.apply(changes);
    if (typeof v === 'number') version = v;
    return true;
  },
  loadedAt: () => loadedAt,
  version: () => version,
};

export function setSettingsLoader(fn: typeof loader) {
  loader = fn;
}

export async function refreshSettings(from: string): Promise<boolean> {
  try {
    if (loader) {
      const s = await loader();
      settings.applyVersioned(s.values, s.version);
      return true;
    }
    const res = await fetch(serviceUrl('platform') + '/internal/settings', {
      headers: await serviceHeaders(from),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { version?: number; values: Record<string, unknown> };
    settings.applyVersioned(body.values ?? {}, body.version);
    return true;
  } catch {
    return false;
  }
}

/** Jaring pengaman: muat lalu polling (gateway tidak punya event bus; createService memakai interval sendiri). */
export function startSettingsPolling(from: string, everyMs = 10_000) {
  void refreshSettings(from);
  return setInterval(() => void refreshSettings(from), everyMs);
}

/**
 * Fan-out pengaturan ke SEMUA replika: koneksi pg khusus yang LISTEN `rave_settings`; setiap notifikasi →
 * refreshSettings (di-debounce & diserialkan agar respons lama tidak menimpa yang baru). Putus → sambung ulang
 * dengan backoff, lalu refresh sekali untuk mengejar perubahan yang terlewat. Timer di-unref.
 */
export function startSettingsListener(from: string, opts: { debounceMs?: number; log?: (o: object, m: string) => void } = {}) {
  const debounceMs = opts.debounceMs ?? 200;
  let client: pg.Client | null = null;
  let closed = false;
  let connectedOnce = false;
  let backoff = 1000;
  let debounce: NodeJS.Timeout | null = null;
  let retry: NodeJS.Timeout | null = null;
  let running = false;
  let again = false;

  const run = async () => {
    if (running) return void (again = true);
    running = true;
    try {
      do {
        again = false;
        // Platform sesaat tak terjangkau → coba ulang singkat; selebihnya ditangani refresh berkala.
        for (let i = 0; i < 3 && !closed; i++) {
          if (await refreshSettings(from)) break;
          await new Promise((r) => setTimeout(r, 1000).unref());
        }
      } while (again && !closed);
    } finally {
      running = false;
    }
  };
  const trigger = () => {
    if (closed || debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void run();
    }, debounceMs);
    debounce.unref();
  };

  async function connect() {
    if (closed) return;
    const c = new pg.Client({ connectionString: config.databaseUrl, application_name: `rave-${from}-settings`.slice(0, 63) });
    let gone = false;
    const lost = (err?: Error) => {
      if (gone) return;
      gone = true;
      if (client === c) client = null;
      c.end().catch(() => {});
      if (closed) return;
      opts.log?.({ err: err?.message, retryMs: backoff }, 'koneksi LISTEN pengaturan terputus — menyambung ulang');
      retry = setTimeout(() => void connect(), backoff);
      retry.unref();
      backoff = Math.min(backoff * 2, 30_000);
    };
    c.on('error', lost);
    c.on('end', () => lost());
    c.on('notification', (n) => n.channel === SETTINGS_CHANNEL && trigger());
    try {
      await c.connect();
      await c.query(`LISTEN ${SETTINGS_CHANNEL}`);
      if (closed) return void (await c.end().catch(() => {}));
      client = c;
      backoff = 1000;
      if (connectedOnce) trigger(); // kejar perubahan selama terputus
      connectedOnce = true;
    } catch (e: any) {
      lost(e);
    }
  }
  void connect();

  return {
    async close() {
      closed = true;
      if (debounce) clearTimeout(debounce);
      if (retry) clearTimeout(retry);
      const c = client;
      client = null;
      await c?.end().catch(() => {});
    },
  };
}
