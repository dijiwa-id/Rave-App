/**
 * Tautan sosial/streaming profil artis (Artist Studio → Profil artis). Fungsi murni — dipakai PATCH
 * /v1/studio/artists/:artistId dan diuji unit. Hanya https, host harus cocok dengan platform (kecuali `website`),
 * tanpa kredensial di URL, maks. {@link MAX_ARTIST_LINKS} tautan, tiap platform (selain `website`) sekali saja.
 */
export const ARTIST_LINK_HOSTS = {
  instagram: ['instagram.com', 'instagr.am'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
  spotify: ['spotify.com', 'spotify.link'],
  apple_music: ['music.apple.com'],
  soundcloud: ['soundcloud.com', 'on.soundcloud.com'],
  bandcamp: ['bandcamp.com'],
  x: ['x.com', 'twitter.com'],
  facebook: ['facebook.com', 'fb.com'],
  website: null,
} as const satisfies Record<string, readonly string[] | null>;

export type ArtistLinkPlatform = keyof typeof ARTIST_LINK_HOSTS;
export const MAX_ARTIST_LINKS = 8;
export const MAX_ARTIST_LINK_URL = 500;

export interface ArtistLink {
  platform: ArtistLinkPlatform;
  url: string;
}

const LABEL: Record<ArtistLinkPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  website: 'Situs web',
};

const hostMatches = (host: string, allowed: readonly string[]) => allowed.some((h) => host === h || host.endsWith(`.${h}`));
const isIpOrLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.startsWith('[') || !host.includes('.');

/** Normalkan & validasi satu URL untuk platform tertentu. Mengembalikan URL ternormalisasi atau pesan galat. */
export function normalizeArtistLink(platform: string, raw: string): { ok: true; link: ArtistLink } | { ok: false; error: string } {
  if (!(platform in ARTIST_LINK_HOSTS)) return { ok: false, error: `Platform tautan tidak dikenal: ${platform}` };
  const p = platform as ArtistLinkPlatform;
  let v = (raw ?? '').trim();
  if (!v) return { ok: false, error: `Tautan ${LABEL[p]} kosong` };
  if (v.length > MAX_ARTIST_LINK_URL) return { ok: false, error: `Tautan ${LABEL[p]} terlalu panjang (maks. ${MAX_ARTIST_LINK_URL} karakter)` };
  // Tanpa skema ("instagram.com/x") → anggap https.
  if (!/^[a-z][a-z\d+.-]*:/i.test(v)) v = `https://${v}`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, error: `Tautan ${LABEL[p]} bukan URL yang valid` };
  }
  if (u.protocol !== 'https:') return { ok: false, error: `Tautan ${LABEL[p]} harus diawali https://` };
  if (u.username || u.password) return { ok: false, error: `Tautan ${LABEL[p]} tidak boleh memuat kredensial` };
  const host = u.hostname.toLowerCase();
  if (isIpOrLocal(host)) return { ok: false, error: `Tautan ${LABEL[p]} harus memakai nama domain publik` };
  const allowed = ARTIST_LINK_HOSTS[p];
  if (allowed && !hostMatches(host, allowed)) return { ok: false, error: `Tautan ${LABEL[p]} harus mengarah ke ${allowed[0]}` };
  if (u.port) return { ok: false, error: `Tautan ${LABEL[p]} tidak boleh memakai port khusus` };
  u.hash = u.hash.length > 1 ? u.hash : '';
  return { ok: true, link: { platform: p, url: u.toString() } };
}

/** Validasi daftar tautan (urutan dipertahankan). Galat pertama dikembalikan bersama indeksnya. */
export function normalizeArtistLinks(
  input: { platform: string; url: string }[],
): { ok: true; links: ArtistLink[] } | { ok: false; index: number; error: string } {
  if (input.length > MAX_ARTIST_LINKS) return { ok: false, index: MAX_ARTIST_LINKS, error: `Maksimal ${MAX_ARTIST_LINKS} tautan` };
  const out: ArtistLink[] = [];
  const seenPlatform = new Set<string>();
  const seenUrl = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const r = normalizeArtistLink(input[i].platform, input[i].url);
    if (!r.ok) return { ok: false, index: i, error: r.error };
    const { platform, url } = r.link;
    if (platform !== 'website' && seenPlatform.has(platform)) return { ok: false, index: i, error: `Tautan ${LABEL[platform]} hanya boleh satu` };
    if (seenUrl.has(url)) return { ok: false, index: i, error: 'Tautan yang sama dimasukkan dua kali' };
    seenPlatform.add(platform);
    seenUrl.add(url);
    out.push(r.link);
  }
  return { ok: true, links: out };
}
