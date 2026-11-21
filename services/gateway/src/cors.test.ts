import { describe, expect, it } from 'vitest';
import { APP_ORIGINS, corsOrigins } from './cors.js';

describe('CORS gateway', () => {
  it('produksi tanpa CORS_ORIGINS: origin web + origin aplikasi desktop (Tauri)', () => {
    expect(corsOrigins({ PUBLIC_WEB_URL: 'https://rave.id/app' }, false)).toEqual(['https://rave.id', ...APP_ORIGINS]);
  });
  it('daftar eksplisit tetap ditambah origin aplikasi; bisa dimatikan', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://a.id/, https://b.id' }, false)).toEqual(['https://a.id', 'https://b.id', ...APP_ORIGINS]);
    expect(corsOrigins({ CORS_ORIGINS: 'https://a.id', CORS_APP_ORIGINS: '0' }, false)).toEqual(['https://a.id']);
  });
  it('wildcard & dev = semua origin', () => {
    expect(corsOrigins({ CORS_ORIGINS: '*' }, false)).toBe(true);
    expect(corsOrigins({}, true)).toBe(true);
  });
  it('tanpa konfigurasi apa pun di produksi: hanya origin aplikasi', () => {
    expect(corsOrigins({}, false)).toEqual([...APP_ORIGINS]);
    expect(corsOrigins({ CORS_APP_ORIGINS: '0' }, false)).toBe(false);
  });
});
