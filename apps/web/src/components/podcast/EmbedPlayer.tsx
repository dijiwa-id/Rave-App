import { ExternalLink } from 'lucide-react';
import { useDict } from '@/lib/i18n';
import type { EpisodeEmbed } from '@/lib/types';

/** Nama platform embed (sama dengan EMBED_PROVIDERS di packages/domain/src/podcast.ts). */
export const EMBED_LABEL: Record<string, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube',
  apple: 'Apple Podcasts',
  soundcloud: 'SoundCloud',
  anchor: 'Spotify for Creators',
};

/**
 * Pemutar episode embed dari platform lain. `src` sudah dinormalisasi server (host resmi, https) — di sini hanya
 * dirender sebagai iframe ber-sandbox; tidak ada HTML dari kreator yang dirender.
 */
export function EmbedPlayer({ embed, title, className }: { embed: EpisodeEmbed; title: string; className?: string }) {
  const d = useDict('common').embed;
  const video = embed.kind === 'video';
  return (
    <figure className={className}>
      <div className={video ? 'relative aspect-video w-full' : 'w-full'} style={video ? undefined : { height: embed.height }}>
        <iframe
          src={embed.src}
          title={`${title} — ${EMBED_LABEL[embed.provider] ?? embed.provider}`}
          className={video ? 'absolute inset-0 size-full' : 'size-full'}
          style={{ border: 0, colorScheme: 'normal' }}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        />
      </div>
      <figcaption className="mt-1.5 flex items-center gap-1 text-xs text-current/60 opacity-70">
        <ExternalLink className="size-3" /> {d.via(EMBED_LABEL[embed.provider] ?? embed.provider)}
      </figcaption>
    </figure>
  );
}
