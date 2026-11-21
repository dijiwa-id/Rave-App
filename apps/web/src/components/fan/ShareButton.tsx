import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Link2, Share2, Upload } from 'lucide-react';
import type { ShareEventPlatform, TrackShare } from '@rave/domain/share';
import { api } from '@/lib/api';
import { setting, usePlatformConfig } from '@/lib/platform';
import { cx, Spinner, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { Facebook, Instagram, XLogo } from './BrandIcons';
import { renderStoryCard } from '@/lib/storyCard';

const MENU_W = 248;

/** Catat klik bagikan (statistik Super Admin) — tidak pernah menghalangi atau memunculkan galat. */
function record(trackId: string, platform: ShareEventPlatform) {
  void api(`/v1/catalog/tracks/${trackId}/share`, { body: { platform, client: 'web' } }).catch(() => undefined);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Tombol bagikan yang dipakai SEMUA tempat lagu ditampilkan (ikon Share2 sama dengan desktop; mobile: Icons.share). */
export function useShareEnabled() {
  const cfg = usePlatformConfig();
  return setting<boolean>(cfg, 'share.enabled', true) !== false;
}

/**
 * Bagikan satu lagu: menu (portal) berisi Instagram Story (kartu PNG + salin tautan), X, Facebook (intent dari
 * server, hanya platform yang diaktifkan Super Admin), dan Salin tautan / share sheet sistem bila tersedia.
 */
export function ShareButton({ trackId, trackTitle, className, iconClassName = 'size-[18px]' }: { trackId: string; trackTitle: string; className?: string; iconClassName?: string }) {
  const d = useDict('common').share;
  const enabled = useShareEnabled();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const q = useQuery({
    queryKey: ['track-share', trackId],
    queryFn: () => api<TrackShare>(`/v1/catalog/tracks/${trackId}/share`),
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
  });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom;
    const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      if (e.type === 'scroll' && menu.current?.contains(e.target as Node)) return;
      setOpen(false);
      if (e.type === 'keydown') btn.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!enabled) return null;
  const s = q.data;
  const linkText = s ? `${s.text} ${s.url}` : '';

  function openIntent(url: string, platform: ShareEventPlatform) {
    window.open(url, '_blank', 'noopener,noreferrer,width=640,height=640');
    record(trackId, platform);
    setOpen(false);
  }

  async function instagram() {
    if (!s) return;
    setBusy(true);
    const copied = await copy(s.url);
    try {
      const blob = await renderStoryCard({ title: s.title, artist: s.artist, url: s.url, image_url: s.image_url, tagline: d.nowPlaying + ' RAVE' });
      const file = new File([blob], `RAVE-${s.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.png`, { type: 'image/png' });
      // Ponsel (web): share sheet sistem bisa langsung ke Instagram; desktop: unduh gambar.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: s.url }).catch(() => undefined);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      }
      toast.success(d.igReady);
    } catch {
      toast.info(copied ? d.igFailed : d.unavailable);
    } finally {
      record(trackId, 'instagram');
      setBusy(false);
      setOpen(false);
    }
  }

  async function copyLink() {
    if (!s) return;
    if (await copy(linkText)) toast.success(d.copied);
    record(trackId, 'copy');
    setOpen(false);
  }

  async function system() {
    if (!s) return;
    await navigator.share?.({ title: `${s.title} — ${s.artist}`, text: s.text, url: s.url }).catch(() => undefined);
    record(trackId, 'system');
    setOpen(false);
  }

  const row = 'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-bold text-rave-paper/85 transition hover:bg-rave-primary hover:text-rave-on-primary focus-visible:bg-white/10 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';
  const ICONS = { instagram: Instagram, x: XLogo, facebook: Facebook } as const;

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={d.buttonFor(trackTitle)}
        title={d.button}
        className={cx('grid size-8 place-items-center text-rave-muted transition hover:text-white', open && 'text-rave-primary-text', className)}
      >
        <Share2 className={iconClassName} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={d.title}
            style={{ position: 'fixed', left: pos.left, width: MENU_W, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            className="z-[120] border-2 border-rave-ink bg-[#1e1c1f] text-sm shadow-[6px_6px_0_#F4C21F]"
          >
            <p className="border-b-2 border-dashed border-white/15 px-3 py-2.5 font-label text-[11px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">{d.title}</p>
            {q.isLoading ? (
              <p className="flex items-center gap-2 px-3 py-3 text-white/60">
                <Spinner className="size-4" /> {d.loading}
              </p>
            ) : !s ? (
              <p className="px-3 py-3 text-white/60">{d.unavailable}</p>
            ) : (
              <div className="p-1">
                {s.platforms.map((p) => {
                  const Icon = ICONS[p.id];
                  return (
                    <button
                      key={p.id}
                      role="menuitem"
                      type="button"
                      disabled={busy}
                      className={row}
                      onClick={() => (p.id === 'instagram' ? void instagram() : p.url && openIntent(p.url, p.id))}
                    >
                      {p.id === 'instagram' && busy ? <Spinner className="size-4" /> : <Icon className="size-4" />} {d[p.id]}
                    </button>
                  );
                })}
                <div className="my-1 border-t-2 border-dashed border-white/15" />
                <button role="menuitem" type="button" className={row} onClick={() => void copyLink()}>
                  <Link2 className="size-4" /> {d.copy}
                </button>
                {typeof navigator.share === 'function' && (
                  <button role="menuitem" type="button" className={row} onClick={() => void system()}>
                    <Upload className="size-4" /> {d.system}
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
