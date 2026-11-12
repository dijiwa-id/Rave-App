import { AtSign, AudioLines, Camera, Cloud, Disc3, Globe, MonitorPlay, Music, Music2, Users, type LucideIcon } from 'lucide-react';
import type { ArtistLink, ArtistLinkPlatform } from '@/lib/types';

/** Urutan platform di pemilih tautan (selaras dengan validator server `services/catalog/src/artist-links.ts`). */
export const LINK_PLATFORMS: ArtistLinkPlatform[] = ['instagram', 'tiktok', 'youtube', 'spotify', 'apple_music', 'soundcloud', 'bandcamp', 'x', 'facebook', 'website'];
export const MAX_LINKS = 8;
export const MAX_GENRES = 10;
export const BIO_MAX = 5000;
export const BIO_GOOD = 150;

/** Ikon generik per platform (lucide tidak menyertakan logo merek). */
export const LINK_ICON: Record<ArtistLinkPlatform, LucideIcon> = {
  instagram: Camera,
  tiktok: Music2,
  youtube: MonitorPlay,
  spotify: AudioLines,
  apple_music: Music,
  soundcloud: Cloud,
  bandcamp: Disc3,
  x: AtSign,
  facebook: Users,
  website: Globe,
};

/** Ukuran minimum gambar profil (px). */
export const IMAGE_MIN = { photo: { w: 600, h: 600 }, banner: { w: 1600, h: 600 } } as const;

export interface ProfileDraft {
  bio: string;
  image_url: string;
  cover_url: string;
  city: string;
  genres: string[];
  links: ArtistLink[];
}

export type CompletenessKey = 'photo' | 'banner' | 'bio' | 'city' | 'genres' | 'links';
/** Anchor bagian formulir untuk tiap butir kelengkapan. */
export const COMPLETENESS_ANCHOR: Record<CompletenessKey, string> = {
  photo: 'profile-identity',
  banner: 'profile-identity',
  city: 'profile-identity',
  genres: 'profile-identity',
  bio: 'profile-bio',
  links: 'profile-links',
};

/** Kelengkapan profil: daftar butir + persentase (dibulatkan). */
export function profileCompleteness(f: ProfileDraft): { items: { key: CompletenessKey; done: boolean }[]; pct: number } {
  const items: { key: CompletenessKey; done: boolean }[] = [
    { key: 'photo', done: !!f.image_url },
    { key: 'banner', done: !!f.cover_url },
    { key: 'bio', done: f.bio.trim().length >= BIO_GOOD },
    { key: 'city', done: !!f.city },
    { key: 'genres', done: f.genres.length > 0 },
    { key: 'links', done: f.links.some((l) => l.url.trim()) },
  ];
  return { items, pct: Math.round((items.filter((i) => i.done).length / items.length) * 100) };
}

/** Bandingkan draf (untuk deteksi perubahan belum disimpan). */
export const sameDraft = (a: ProfileDraft, b: ProfileDraft) => JSON.stringify(a) === JSON.stringify(b);

/** Baca dimensi gambar lokal sebelum diunggah. */
export function readImageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gambar tidak dapat dibaca'));
    };
    img.src = url;
  });
}
