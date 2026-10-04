import { useAuth } from '@/stores/auth';

/** Error RFC 9457 dari gateway/service. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public problem: { title?: string; detail?: string; errors?: { path: string; message: string }[]; [k: string]: unknown },
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
}

type Opts = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Kirim Idempotency-Key (wajib untuk POST transaksi — lihat docs/API.md). `true` = generate otomatis. */
  idempotencyKey?: string | true;
  auth?: boolean; // default true bila ada token
  raw?: boolean;
};

let refreshing: Promise<boolean> | null = null;

async function refreshToken(): Promise<boolean> {
  const { refreshToken: rt, setSession, clear } = useAuth.getState();
  if (!rt) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/v1/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt }),
      });
      if (!res.ok) {
        clear();
        return false;
      }
      setSession(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
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
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey === true ? crypto.randomUUID() : opts.idempotencyKey;
    return fetch(url.pathname + url.search, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body === undefined ? undefined : opts.body instanceof Blob ? opts.body : JSON.stringify(opts.body),
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

export const fmt = {
  idr: (n: number | null | undefined) => (n == null ? '—' : 'Rp ' + Math.round(n).toLocaleString('id-ID')),
  idrShort: (n: number | null | undefined) => {
    if (n == null) return '—';
    if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
    if (n >= 1_000) return `Rp ${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
    return `Rp ${n}`;
  },
  num: (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('id-ID')),
  compact: (n: number | null | undefined) => (n == null ? '—' : Intl.NumberFormat('id-ID', { notation: 'compact' }).format(n)),
  duration: (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  },
  minutes: (ms: number) => `${Math.round(ms / 60000)} mnt`,
  date: (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    iso ? new Date(iso).toLocaleDateString('id-ID', opts) : '—',
  dateTime: (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB' : '—',
};
