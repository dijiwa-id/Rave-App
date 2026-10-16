import { useBranding } from '@/lib/platform';

/** Ikon platform (lingkaran "G"): unggahan Super Admin (`branding.icon_url`) atau ikon resmi bawaan. */
export function GemaMark({ className = 'size-10' }: { className?: string }) {
  const { icon } = useBranding();
  return <img src={icon} alt="" aria-hidden className={`${className} object-contain`} />;
}

/**
 * Logo lengkap. `dark` = untuk latar terang (wordmark gelap) → `branding.logo_url`;
 * tanpa `dark` = latar gelap → `branding.logo_dark_url`. Tanpa unggahan: logo resmi GEMA bawaan.
 */
export function GemaLogo({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const b = useBranding();
  return <img src={dark ? b.logo : b.logoDark} alt={b.name} className={`h-10 w-auto max-w-[220px] object-contain ${className}`} />;
}
