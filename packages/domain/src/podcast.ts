// Podcast & audio fiksi buatan kreator: status episode dan embed iframe dari platform lain.
//
// Keamanan embed: kode yang ditempel kreator TIDAK pernah disimpan/dirender sebagai HTML. Kita hanya mengambil alamat
// `src` iframe (atau URL halaman episode), memvalidasi host & pola path per platform, lalu membangun ulang URL embed
// kanonik (https, host resmi). Klien merender <iframe src=…> sendiri dengan sandbox — atribut lain dari kode asli dibuang.

export const EMBED_PROVIDERS = {
  spotify: { label: 'Spotify' },
  youtube: { label: 'YouTube' },
  apple: { label: 'Apple Podcasts' },
  soundcloud: { label: 'SoundCloud' },
  anchor: { label: 'Spotify for Creators (Anchor)' },
} as const;
export type EmbedProvider = keyof typeof EMBED_PROVIDERS;
export const EMBED_PROVIDER_KEYS = Object.keys(EMBED_PROVIDERS) as EmbedProvider[];
export const EMBED_PROVIDER_OPTIONS = EMBED_PROVIDER_KEYS.map((value) => ({ value, label: EMBED_PROVIDERS[value].label }));

export interface ParsedEmbed {
  provider: EmbedProvider;
  /** URL embed kanonik (https, host resmi) — satu-satunya yang disimpan. */
  src: string;
  /** Video dirender 16:9; audio memakai tinggi tetap. */
  kind: 'audio' | 'video';
  height: number;
}

export type EmbedError = 'empty' | 'no_url' | 'not_https' | 'unsupported' | 'provider_disabled';
export type EmbedResult = { ok: true; embed: ParsedEmbed } | { ok: false; error: EmbedError; provider?: EmbedProvider };

const decode = (s: string) =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

/** Ambil URL dari kode embed (<iframe src="…">) atau teks URL biasa. */
export function extractEmbedUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/<iframe\b/i.test(raw)) {
    const m = raw.match(/<iframe\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const src = m?.[1] ?? m?.[2] ?? m?.[3];
    return src ? decode(src.trim()) : null;
  }
  if (/^https?:\/\//i.test(raw) && !/\s/.test(raw)) return decode(raw);
  return null;
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

function spotify(u: URL): ParsedEmbed | null {
  if (host(u) !== 'open.spotify.com') return null;
  const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/|embed-podcast\/)?(episode|show)\/([A-Za-z0-9]{22})\/?$/);
  if (!m) return null;
  return { provider: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: 'audio', height: m[1] === 'episode' ? 152 : 352 };
}

function youtube(u: URL): ParsedEmbed | null {
  const h = host(u);
  const ID = /^[\w-]{11}$/;
  let id: string | null = null;
  let list: string | null = null;
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'music.youtube.com'].includes(h)) {
    const p = u.pathname;
    // `/embed/videoseries` dulu: "videoseries" juga 11 karakter dan lolos pola ID video.
    const m = p.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})\/?$/);
    if (p === '/playlist' || p.replace(/\/$/, '') === '/embed/videoseries') list = u.searchParams.get('list');
    else if (m) id = m[1];
    else if (p === '/watch') id = u.searchParams.get('v');
  } else return null;
  if (list && /^[\w-]{10,64}$/.test(list)) return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, kind: 'video', height: 315 };
  if (!id || !ID.test(id)) return null;
  return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}`, kind: 'video', height: 315 };
}

function apple(u: URL): ParsedEmbed | null {
  const h = host(u);
  if (h !== 'podcasts.apple.com' && h !== 'embed.podcasts.apple.com') return null;
  const m = u.pathname.match(/^\/([a-z]{2})\/podcast\/(?:([\w%.-]+)\/)?(id\d{3,15})\/?$/i);
  if (!m) return null;
  const ep = u.searchParams.get('i');
  const epOk = ep && /^\d{3,20}$/.test(ep);
  const slug = m[2] ? `${m[2]}/` : '';
  return {
    provider: 'apple',
    src: `https://embed.podcasts.apple.com/${m[1].toLowerCase()}/podcast/${slug}${m[3]}${epOk ? `?i=${ep}` : ''}`,
    kind: 'audio',
    height: epOk ? 175 : 450,
  };
}

function soundcloud(u: URL): ParsedEmbed | null {
  const h = host(u);
  let target: URL | null = null;
  if (h === 'w.soundcloud.com' && u.pathname.replace(/\/$/, '') === '/player') {
    try {
      target = new URL(u.searchParams.get('url') ?? '');
    } catch {
      return null;
    }
  } else if (h === 'soundcloud.com' || h === 'm.soundcloud.com') target = u;
  else return null;
  const th = host(target);
  const ok =
    (th === 'api.soundcloud.com' && /^\/(tracks|playlists)\/\d{1,20}\/?$/.test(target.pathname)) ||
    ((th === 'soundcloud.com' || th === 'm.soundcloud.com') && /^\/[\w-]{1,80}\/(?:sets\/)?[\w-]{1,200}\/?$/.test(target.pathname));
  if (!ok) return null;
  const canon = `https://${th === 'm.soundcloud.com' ? 'soundcloud.com' : th}${target.pathname.replace(/\/$/, '')}`;
  return { provider: 'soundcloud', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(canon)}&visual=false`, kind: 'audio', height: 166 };
}

function anchor(u: URL): ParsedEmbed | null {
  const h = host(u);
  if (h === 'anchor.fm') {
    const m = u.pathname.match(/^\/([\w.-]{1,80})\/embed(\/episodes\/[\w.-]{1,200})?\/?$/);
    return m ? { provider: 'anchor', src: `https://anchor.fm/${m[1]}/embed${m[2] ?? ''}`, kind: 'audio', height: 161 } : null;
  }
  if (h === 'podcasters.spotify.com' || h === 'creators.spotify.com') {
    const m = u.pathname.match(/^\/pod\/show\/([\w.-]{1,80})\/embed(\/episodes\/[\w.-]{1,200})?\/?$/);
    return m ? { provider: 'anchor', src: `https://${h}/pod/show/${m[1]}/embed${m[2] ?? ''}`, kind: 'audio', height: 161 } : null;
  }
  return null;
}

const PARSERS: Record<EmbedProvider, (u: URL) => ParsedEmbed | null> = { spotify, youtube, apple, soundcloud, anchor };

/**
 * Validasi kode embed / URL episode dari platform lain. `allowed` = daftar platform dari pengaturan
 * `podcast.embed_providers`; platform dikenali tetapi tidak diizinkan → `provider_disabled`.
 */
export function parseEmbed(input: string, allowed: readonly string[] = EMBED_PROVIDER_KEYS): EmbedResult {
  if (!input?.trim()) return { ok: false, error: 'empty' };
  const raw = extractEmbedUrl(input.slice(0, 4000));
  if (!raw) return { ok: false, error: 'no_url' };
  let u: URL;
  try {
    u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    return { ok: false, error: 'no_url' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'not_https' };
  if (u.username || u.password || (u.port && u.port !== '443')) return { ok: false, error: 'unsupported' };
  for (const key of EMBED_PROVIDER_KEYS) {
    const e = PARSERS[key](u);
    if (!e) continue;
    if (!allowed.includes(key)) return { ok: false, error: 'provider_disabled', provider: key };
    return { ok: true, embed: e };
  }
  return { ok: false, error: 'unsupported' };
}

/** Status episode buatan kreator. Data katalog lama (seed) = PUBLISHED. */
export const EPISODE_STATUSES = ['DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];
export const SHOW_STATUSES = ['ACTIVE', 'HIDDEN'] as const;
export type ShowStatus = (typeof SHOW_STATUSES)[number];

/** Status ketika kreator menekan "Terbitkan": ditinjau dulu bila `podcast.require_review` aktif. */
export const publishTarget = (requireReview: boolean): EpisodeStatus => (requireReview ? 'PENDING' : 'PUBLISHED');
