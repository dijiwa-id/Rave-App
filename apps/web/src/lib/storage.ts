/**
 * Akses Web Storage yang aman: mode privat / kuota penuh / cookie diblokir bisa melempar error
 * saat getItem/setItem — jangan sampai merusak render.
 */
type Kind = 'local' | 'session';

function store(kind: Kind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeGet(key: string, kind: Kind = 'local'): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string, kind: Kind = 'local'): void {
  try {
    store(kind)?.setItem(key, value);
  } catch {
    // abaikan (kuota penuh / diblokir)
  }
}

export function safeRemove(key: string, kind: Kind = 'local'): void {
  try {
    store(kind)?.removeItem(key);
  } catch {
    // abaikan
  }
}
