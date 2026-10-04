import { SETTINGS_BY_KEY, settingDefaults } from '@gema/domain/settings';
import { serviceToken } from './auth.js';
import { serviceUrl } from './config.js';

/**
 * Klien pengaturan platform (dikelola Super Admin di service `platform`).
 * - Nilai awal = default registri, lalu ditimpa snapshot dari `GET /internal/settings`.
 * - Diperbarui real-time oleh event `platform.settings.updated` (dikonsumsi otomatis oleh createService)
 *   dan disegarkan berkala sebagai jaring pengaman.
 * Service yang tidak bisa menjangkau `platform` tetap jalan dengan default (degradasi aman).
 */
const values: Record<string, unknown> = settingDefaults();
let loadedAt: number | null = null;

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
  loadedAt: () => loadedAt,
};

export async function refreshSettings(from: string): Promise<boolean> {
  try {
    const res = await fetch(serviceUrl('platform') + '/internal/settings', {
      headers: { authorization: `Bearer ${await serviceToken(from)}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { values: Record<string, unknown> };
    settings.apply(body.values ?? {});
    return true;
  } catch {
    return false;
  }
}

/** Untuk proses tanpa event bus (mis. gateway): muat lalu polling. */
export function startSettingsPolling(from: string, everyMs = 10_000) {
  void refreshSettings(from);
  return setInterval(() => void refreshSettings(from), everyMs);
}
