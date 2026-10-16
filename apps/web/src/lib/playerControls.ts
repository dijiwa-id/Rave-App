import { useEffect } from 'react';
import { usePlayer } from '@/stores/player';

/**
 * Media Session API: kontrol di layar kunci/notifikasi, tombol media headset & keyboard, serta metadata (judul, artis,
 * sampul) di OS. Semua aksi lewat store yang sama dengan UI, jadi aturan jeda iklan tetap berlaku.
 */
export function useMediaSession() {
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const st = () => usePlayer.getState();

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => !st().playing && st().toggle()],
      ['pause', () => st().playing && st().toggle()],
      ['previoustrack', () => st().prev()],
      ['nexttrack', () => st().next()],
      ['seekbackward', (d) => st().seekBy(-(d.seekOffset ?? 10) * 1000)],
      ['seekforward', (d) => st().seekBy((d.seekOffset ?? 10) * 1000)],
      ['seekto', (d) => d.seekTime != null && st().seek(d.seekTime * 1000)],
    ];
    for (const [a, h] of handlers) {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* aksi tidak didukung browser ini */
      }
    }

    let lastPos = 0;
    const unsub = usePlayer.subscribe((s, prev) => {
      if (s.current !== prev.current) {
        ms.metadata = s.current
          ? new MediaMetadata({
              title: s.current.title,
              artist: s.current.subtitle,
              artwork: s.current.image_url ? [{ src: s.current.image_url }] : [],
            })
          : null;
      }
      if (s.playing !== prev.playing || s.current !== prev.current) ms.playbackState = !s.current ? 'none' : s.playing ? 'playing' : 'paused';
      // Posisi diperbarui paling cepat 1×/dtk agar tidak membebani OS.
      const now = performance.now();
      if (s.current && s.durationMs > 0 && (s.durationMs !== prev.durationMs || now - lastPos > 1000)) {
        lastPos = now;
        try {
          ms.setPositionState({ duration: s.durationMs / 1000, position: Math.min(s.positionMs, s.durationMs) / 1000, playbackRate: 1 });
        } catch {
          /* nilai di luar rentang saat transisi lagu */
        }
      }
    });
    return () => {
      unsub();
      for (const [a] of handlers) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* noop */
        }
      }
      ms.metadata = null;
    };
  }, []);
}

/** Elemen yang menangani tombol/ketikannya sendiri — pintasan tidak boleh mencurinya. */
function isInteractive(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el?.closest) return false;
  return !!el.closest('input:not([type="range"]), textarea, select, [contenteditable="true"], [role="dialog"], video');
}

/**
 * Pintasan keyboard global: Spasi putar/jeda, ←/→ mundur/maju 5 dtk, Shift+←/→ lagu sebelumnya/berikutnya,
 * M bisukan (↑/↓ dibiarkan untuk scroll halaman). Tidak aktif saat mengetik atau memakai kombinasi Ctrl/Alt/Cmd.
 */
export function usePlayerShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isInteractive(e.target)) return;
      const s = usePlayer.getState();
      if (!s.current) return;
      const onButton = (e.target as HTMLElement)?.closest?.('button, a, [role="button"]');
      switch (e.key) {
        case ' ':
          if (onButton) return; // Spasi pada tombol/tautan = klik, bukan putar/jeda
          s.toggle();
          break;
        case 'ArrowLeft':
          e.shiftKey ? s.prev() : s.seekBy(-5000);
          break;
        case 'ArrowRight':
          e.shiftKey ? s.next() : s.seekBy(5000);
          break;
        case 'm':
        case 'M':
          s.toggleMute();
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
