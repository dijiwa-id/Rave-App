import { currentLocale, dict, localeTag } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { queryClient } from '@/lib/queryClient';

/** Error RFC 9457 dari gateway/service. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public problem: { title?: string; detail?: string; errors?: { path: string; message: string }[]; [k: string]: unknown },
  ) {
    super(problemMessage(status, problem));
  }
}

/** Pesan jelas untuk 503 dari gateway saat mode pemeliharaan / modul dimatikan Super Admin (docs/API.md §9). */
function problemMessage(status: number, p: { title?: string; detail?: string; [k: string]: unknown }) {
  const type = typeof p.type === 'string' ? p.type : '';
  const e = dict('common').errors;
  if (status === 503 && type.endsWith('/maintenance')) return e.maintenance(p.detail ?? e.maintenanceDefault);
  if (status === 503 && type.endsWith('/module-disabled')) return `${e.moduleDisabled}${p.detail ? ' ' + p.detail : ''}`;
  return p.detail ?? p.title ?? `HTTP ${status}`;
}

type Opts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Kirim Idempotency-Key (wajib untuk POST transaksi — lihat docs/API.md). `true` = generate otomatis. */
  idempotencyKey?: string | true;
  auth?: boolean; // default true bila ada token
  raw?: boolean;
  /** Teruskan ke fetch: permintaan tetap terkirim saat halaman ditutup (flush event pagehide). */
  keepalive?: boolean;
};

let refreshing: Promise<boolean> | null = null;

/** Satu refresh pada satu waktu di SEMUA tab (Web Locks); tanpa dukungan → per tab saja. */
function withRefreshLock(fn: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks?.request ? (locks.request('rave-auth-refresh', fn) as unknown as Promise<boolean>) : fn();
}

/**
 * Perbarui access token. Refresh token berotasi dan pemakaian ulang dianggap pencurian (IAM mencabut seluruh family),
 * jadi: (1) dikunci lintas tab, (2) token terbaru dibaca ulang dari storage — bila tab lain baru saja menyegarkan,
 * hasilnya yang dipakai, bukan menukar token lama, (3) sesi hanya dihapus bila server menolak tokennya (400/401/403);
 * gangguan sementara (5xx, 429, jaringan) membiarkan sesi tetap ada.
 */
async function refreshToken(): Promise<boolean> {
  if (!useAuth.getState().refreshToken) return false;
  refreshing ??= withRefreshLock(async () => {
    const before = useAuth.getState().refreshToken;
    await useAuth.persist.rehydrate();
    const rt = useAuth.getState().refreshToken;
    if (!rt) return false;
    if (rt !== before) return true; // tab lain sudah menyegarkan sesi
    try {
      const res = await fetch('/v1/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt }),
      });
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        useAuth.getState().clear();
        // Sesi berakhir: buang data milik pengguna sebelumnya dari cache.
        queryClient.clear();
        return false;
      }
      if (!res.ok) return false;
      useAuth.getState().setSession(await res.json());
      return true;
    } catch {
      return false;
    }
  }).finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const doFetch = () => {
    const token = useAuth.getState().accessToken;
    const headers: Record<string, string> = {};
    if (opts.body !== undefined && !(opts.body instanceof Blob)) headers['content-type'] = 'application/json';
    if (token && opts.auth !== false) headers.authorization = `Bearer ${token}`;
    headers['accept-language'] = currentLocale();
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey === true ? crypto.randomUUID() : opts.idempotencyKey;
    return fetch(url.pathname + url.search, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body === undefined ? undefined : opts.body instanceof Blob ? opts.body : JSON.stringify(opts.body),
      keepalive: opts.keepalive,
    });
  };
  // Idempotency key harus sama saat retry setelah refresh token.
  if (opts.idempotencyKey === true) opts = { ...opts, idempotencyKey: crypto.randomUUID() };

  let res = await doFetch();
  if (res.status === 401 && useAuth.getState().refreshToken && (await refreshToken())) res = await doFetch();
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, data ?? { title: res.statusText });
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return { detail: t };
  }
}

/** Paksa refresh (mis. setelah membuat org agar klaim orgs di JWT terbarui). */
export const forceRefresh = refreshToken;

const T = () => localeTag();
const EN = () => currentLocale() === 'en';

/** Format angka/tanggal mengikuti bahasa aktif (lib/i18n). Mata uang tetap Rupiah. */
export const fmt = {
  idr: (n: number | null | undefined) => (n == null ? '—' : 'Rp ' + Math.round(n).toLocaleString(T())),
  idrShort: (n: number | null | undefined) => {
    if (n == null) return '—';
    const f = (v: number, d: number) => v.toLocaleString(T(), { maximumFractionDigits: d });
    if (n >= 1_000_000_000) return `Rp ${f(n / 1_000_000_000, 1)} ${EN() ? 'B' : 'M'}`;
    if (n >= 1_000_000) return `Rp ${f(n / 1_000_000, 1)} ${EN() ? 'M' : 'jt'}`;
    if (n >= 1_000) return `Rp ${f(n / 1_000, 0)} ${EN() ? 'K' : 'rb'}`;
    return `Rp ${n}`;
  },
  num: (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString(T())),
  compact: (n: number | null | undefined) => (n == null ? '—' : Intl.NumberFormat(T(), { notation: 'compact' }).format(n)),
  duration: (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  },
  minutes: (ms: number) => `${Math.round(ms / 60000)} ${EN() ? 'min' : 'mnt'}`,
  date: (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    iso ? new Date(iso).toLocaleDateString(T(), opts) : '—',
  dateTime: (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(T(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB' : '—',
};

