// Bagikan lagu ke media sosial — kontrak bersama server (catalog) & klien. Teks & tagar diatur Super Admin
// (grup pengaturan `share`); tautan intent X/Facebook dibangun di server agar web, desktop & mobile konsisten.

export const SHARE_PLATFORMS = ['instagram', 'x', 'facebook'] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];
/** Platform yang dicatat statistiknya: tiga media sosial + salin tautan + share sheet sistem. */
export const SHARE_EVENT_PLATFORMS = [...SHARE_PLATFORMS, 'copy', 'system'] as const;
export type ShareEventPlatform = (typeof SHARE_EVENT_PLATFORMS)[number];
export const SHARE_CLIENTS = ['web', 'desktop', 'android', 'ios'] as const;
export type ShareClient = (typeof SHARE_CLIENTS)[number];

/** Data siap pakai untuk tombol bagikan (GET /v1/catalog/tracks/:id/share). */
export interface TrackShare {
  track_id: string;
  title: string;
  artist: string;
  /** Halaman bagikan publik (meta Open Graph untuk pratinjau kartu) → mengarahkan ke lagu di web player. */
  url: string;
  /** Teks siap tempel (template Super Admin) tanpa URL. */
  text: string;
  hashtags: string[];
  /** Sampul absolut (untuk kartu cerita Instagram yang dibuat klien). */
  image_url: string | null;
  /** Platform yang diaktifkan Super Admin + tautan intent (Instagram tanpa intent web → klien membuat kartu cerita). */
  platforms: { id: SharePlatform; url: string | null }[];
}

/** Ganti `{title}`, `{artist}`, `{app}` di template; spasi rapat dipangkas. */
export function renderShareText(template: string, v: { title: string; artist: string; app?: string }): string {
  return template
    .replace(/\{title\}/g, v.title)
    .replace(/\{artist\}/g, v.artist)
    .replace(/\{app\}/g, v.app ?? 'RAVE')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** "RAVE, #MusikIndie  ,x y" → ['RAVE','MusikIndie','xy'] (tanpa #, alfanumerik/underscore, maks 5). */
export function parseHashtags(raw: string): string[] {
  return [...new Set(raw.split(/[,\s]+/).map((h) => h.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 5);
}

export function shareIntentUrl(platform: SharePlatform, s: { url: string; text: string; hashtags: string[] }): string | null {
  if (platform === 'x') {
    const q = new URLSearchParams({ text: s.text, url: s.url });
    if (s.hashtags.length) q.set('hashtags', s.hashtags.join(','));
    return `https://twitter.com/intent/tweet?${q}`;
  }
  if (platform === 'facebook') return `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: s.url })}`;
  return null; // Instagram tidak punya intent web: kartu cerita + share sheet / salin tautan
}
