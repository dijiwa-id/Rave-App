import { createElement, Fragment, useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { coerceLanding, LANDING_DEFAULT, pick, type L10n, type LandingContent } from '@rave/domain/landing';
import type { PartnerEntry } from '@rave/domain/settings';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useLocale } from '@/lib/i18n';

/** Pesan pratinjau dari Editor Landing (Super Admin) ke iframe landing. */
export const PREVIEW_MSG = 'rave:landing-preview';
export const isPreview = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('cms_preview');

function safe(v: unknown): LandingContent {
  try {
    return coerceLanding(v);
  } catch {
    return LANDING_DEFAULT;
  }
}

/**
 * Konten landing dari CMS (`content.landing`), selalu valid (jatuh ke default bila kosong/rusak).
 * Mode pratinjau (`?cms_preview=1` di dalam iframe editor): memakai draf yang dikirim editor lewat postMessage
 * (hanya dari origin yang sama), sehingga perubahan terlihat sebelum disimpan.
 */
export function useLanding(): LandingContent {
  const stored = setting<unknown>(usePlatformConfig(), 'content.landing', LANDING_DEFAULT);
  const [draft, setDraft] = useState<LandingContent | null>(null);
  useEffect(() => {
    if (!isPreview()) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== PREVIEW_MSG) return;
      setDraft(safeDraft(e.data.content));
    };
    window.addEventListener('message', onMsg);
    window.parent?.postMessage({ type: `${PREVIEW_MSG}:ready` }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return draft ?? safe(stored);
}

/** Draf boleh belum lengkap saat diketik — isi yang kosong diambil dari default agar pratinjau tidak pecah. */
function safeDraft(v: unknown): LandingContent {
  try {
    return coerceLanding(v);
  } catch {
    return deepFill(v, LANDING_DEFAULT) as LandingContent;
  }
}
function deepFill(v: unknown, d: unknown): unknown {
  if (Array.isArray(d)) return Array.isArray(v) && v.length ? v : d;
  if (d && typeof d === 'object') {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(d).map(([k, dv]) => [k, deepFill(o[k], dv)]));
  }
  return typeof v === typeof d && v !== '' ? v : d;
}

/** Draf partner dari Editor Landing (mode pratinjau saja); null = belum ada draf → pakai nilai tersimpan. */
const usePreviewPartners = create<{ partners: PartnerEntry[] | null }>(() => ({ partners: null }));

/**
 * Partner pita kuning (`content.partners`, dikelola di Editor Landing): hanya entri bernama, urutan dipertahankan.
 * Mode pratinjau memakai draf editor sehingga logo terlihat sebelum dipublikasikan.
 */
export function usePartners(): PartnerEntry[] {
  const stored = setting<unknown>(usePlatformConfig(), 'content.partners', []);
  const preview = usePreviewPartners((s) => s.partners);
  const list = preview ?? (Array.isArray(stored) ? (stored as PartnerEntry[]) : []);
  return list.filter((p) => p && typeof p.name === 'string' && p.name.trim());
}

/** Hook: pemilih teks dwibahasa mengikuti bahasa aktif (EN kosong → teks ID). */
export function usePick() {
  const locale = useLocale((s) => s.locale);
  return (v: L10n | undefined) => pick(v, locale);
}

// ---------------------------------------------------------------------------------------------
// Pratinjau interaktif (mode builder): pilih section dengan klik di kanvas, sorot saat hover.
// Pesan: editor → iframe `${PREVIEW_MSG}:select` { id } · iframe → editor `${PREVIEW_MSG}:pick` { id }.
// ---------------------------------------------------------------------------------------------
export const usePreviewSel = create<{ selected: string | null; hovered: string | null }>(() => ({ selected: null, hovered: null }));

if (typeof window !== 'undefined' && isPreview()) {
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== PREVIEW_MSG) return;
    if (Array.isArray(e.data.partners)) usePreviewPartners.setState({ partners: e.data.partners as PartnerEntry[] });
  });
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== `${PREVIEW_MSG}:select`) return;
    const id = e.data.id as string | null;
    usePreviewSel.setState({ selected: id });
    if (id) document.querySelector(`[data-cms-block="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // Di kanvas editor, tautan & formulir tidak boleh membawa pergi dari pratinjau.
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement).closest('a, button[type="submit"]');
      if (a && !(e.target as HTMLElement).closest('[data-cms-allow]')) e.preventDefault();
    },
    true,
  );
  document.addEventListener('submit', (e) => e.preventDefault(), true);
}

/** Pembungkus section landing. Di luar pratinjau: tanpa elemen tambahan. */
export function CmsBlock({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const preview = isPreview();
  const selected = usePreviewSel((s) => s.selected === id);
  const hovered = usePreviewSel((s) => s.hovered === id);
  if (!preview) return createElement(Fragment, null, children);
  const pick = () => {
    usePreviewSel.setState({ selected: id });
    window.parent?.postMessage({ type: `${PREVIEW_MSG}:pick`, id }, window.location.origin);
  };
  return createElement(
    'div',
    {
      'data-cms-block': id,
      className: 'relative cursor-pointer scroll-mt-20',
      onClickCapture: pick,
      onMouseEnter: () => usePreviewSel.setState({ hovered: id }),
      onMouseLeave: () => usePreviewSel.getState().hovered === id && usePreviewSel.setState({ hovered: null }),
    },
    children,
    (selected || hovered) &&
      createElement(
        'div',
        {
          'aria-hidden': true,
          className: `pointer-events-none absolute inset-0 z-[60] ${selected ? 'outline-[3px] -outline-offset-[3px] outline-[#F4C21F] outline' : 'outline-2 -outline-offset-2 outline-dashed outline-[#F4C21F]/70'}`,
        },
        createElement(
          'span',
          { className: 'absolute top-0 left-0 bg-[#F4C21F] px-2 py-1 font-label text-[11px] font-bold tracking-[0.12em] text-[#181818] uppercase' },
          label,
        ),
      ),
  );
}
