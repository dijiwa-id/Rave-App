import { useBranding } from '@/lib/platform';

/** Ikon platform (stiker piringan hitam "V" RAVE): unggahan Super Admin (`branding.icon_url`) atau ikon resmi bawaan. */
export function RaveMark({ className = 'size-10' }: { className?: string }) {
  const { icon } = useBranding();
  return <img src={icon} alt="" aria-hidden className={`${className} object-contain`} />;
}

/** Tagline lockup resmi (3 baris setelah slash). */
export const LOCKUP_LINES = ['Rolliemonkie', 'Audio Visual', 'Experiment'] as const;
/** Rasio lebar:tinggi lockup (viewBox 410×100) — untuk menyiapkan slot/dock animasi. */
export const LOCKUP_RATIO = 410 / 100;

/**
 * Lockup logo RAVE: wordmark / slash / "ROLLIEMONKIE · AUDIO VISUAL · EXPERIMENT" (3 baris).
 * SVG inline agar proporsi slash & teks tetap presisi di ukuran apa pun; atur tinggi lewat `className` (mis. `h-10`),
 * lebar mengikuti rasio. Warna slash & teks = `currentColor` (paper di latar gelap, ink di latar terang).
 */
export function RaveLockup({ src, label, className = '', tone = 'light' }: { src: string; label: string; className?: string; tone?: 'light' | 'dark' }) {
  const height = /(^|\s)!?h-/.test(className) ? '' : 'h-10';
  return (
    <svg
      viewBox="0 0 410 100"
      role="img"
      aria-label={`${label} — ${LOCKUP_LINES.join(' ')}`}
      className={`block ${height} w-auto shrink-0 ${tone === 'dark' ? 'text-[#181818]' : 'text-[#EDEDED]'} ${className}`}
    >
      <image href={src} x="0" y="0" width="171" height="100" preserveAspectRatio="xMinYMid meet" />
      <line x1="194" y1="94" x2="216" y2="6" stroke="currentColor" strokeWidth="4" strokeLinecap="square" opacity="0.55" />
      <g fill="currentColor" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="22" letterSpacing="1.4">
        {LOCKUP_LINES.map((t, i) => (
          <text key={t} x="232" y={31 + i * 28}>
            {t.toUpperCase()}
          </text>
        ))}
      </g>
    </svg>
  );
}

/**
 * Logo lengkap (lockup). `dark` = untuk latar terang (wordmark gelap) → `branding.logo_url`;
 * tanpa `dark` = latar gelap → `branding.logo_dark_url`. Tanpa unggahan: logo resmi RAVE bawaan.
 */
export function RaveLogo({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const b = useBranding();
  return <RaveLockup src={dark ? b.logo : b.logoDark} label={b.name} tone={dark ? 'dark' : 'light'} className={className} />;
}
