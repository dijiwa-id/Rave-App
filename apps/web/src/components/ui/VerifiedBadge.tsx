import { useId } from 'react';
import { useDict } from '@/lib/i18n';
import { cx } from './index';

/** Titik bintang sobek 12 sudut (stiker sablon RAVE) di kotak 24×24. */
const BURST = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 8.4 : 11;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(' ');
})();

/**
 * Badge "Verified" khas RAVE: stiker bintang-sobek mustard bergaris tinta + bayangan sablon tinta, dengan tanda centang
 * tebal bersudut tajam yang miring seperti huruf "V" pada logo RAVE. Hanya penanda identitas — tidak mengubah tier.
 * Tetap terbaca di 12–14 px (inline di samping nama) hingga 64 px (kartu profil).
 */
export function VerifiedBadge({ size = 16, className, title }: { size?: number; className?: string; title?: string }) {
  const d = useDict('common');
  const label = title ?? d.verified.label;
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="-0.6 -0.6 25.6 25.6" width={size} height={size} className={cx('inline-block shrink-0 align-[-0.15em]', className)} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <linearGradient id={`${u}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD84A" />
          <stop offset="1" stopColor="#F4C21F" />
        </linearGradient>
      </defs>
      {/* Bayangan sablon (offset tinta) */}
      <polygon points={BURST} transform="translate(1.3 1.3)" fill="#0b0a0c" />
      <polygon points={BURST} fill={`url(#${u}-g)`} stroke="#181818" strokeWidth="1.3" strokeLinejoin="miter" />
      {/* Cincin dalam putus-putus — kesan cap/segel */}
      {size >= 28 && <circle cx="12" cy="12" r="6.4" fill="none" stroke="#181818" strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="1.2 1.1" />}
      {/* Centang "V" RAVE: kaki kiri pendek, kaki kanan panjang miring */}
      <path d="M7.1 11.9 L10.5 15.6 L17.3 7.6" fill="none" stroke="#181818" strokeWidth={size <= 16 ? 2.9 : 2.5} strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

/**
 * Cap "VERIFIED" (label + badge) untuk kepala profil / panel verifikasi: blok tinta miring sedikit, teks mustard,
 * bayangan sablon — senada dengan stiker & cap lain di RAVE.
 */
export function VerifiedStamp({ className }: { className?: string }) {
  const d = useDict('common');
  return (
    <span
      className={cx(
        'inline-flex -rotate-2 items-center gap-1.5 border-2 border-[#181818] bg-[#181818] py-0.5 pr-2 pl-1 font-label text-[10.5px] font-bold tracking-[0.12em] text-[#F4C21F] uppercase shadow-[3px_3px_0_#F4C21F]',
        className,
      )}
    >
      <VerifiedBadge size={16} />
      {d.verified.stamp}
    </span>
  );
}
