import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cx } from '@/components/ui';
import { useLanding, usePick } from '@/lib/landing';
import { dict, useDict } from '@/lib/i18n';

/**
 * Banner sponsor display (statis) untuk landing & Beranda app.
 *
 * Aturan agar tidak mengganggu layout:
 * - tinggi tetap per breakpoint (tidak ada pergeseran/CLS), lebar mengikuti kontainer kontennya;
 * - selalu berlabel "Iklan" + tautan "Tentang iklan" (transparansi, sesuai /iklan);
 * - visual digambar SVG (tanpa foto produk) sehingga ringan dan tajam di semua ukuran;
 * - tautan keluar memakai rel="sponsored".
 *
 * Kreatif di bawah adalah CONTOH. Belum ada placement display di layanan ads (docs/API.md §11 hanya
 * between_tracks & podcast_preroll); bila nanti ada, ganti sampleSponsor() dengan data kampanye.
 */
export interface SponsorCreative {
  advertiser: string;
  handle: string;
  headline: string;
  body: string;
  cta: string;
  href: string;
}

/** Fungsi (bukan konstanta) agar teks mengikuti bahasa aktif saat dipanggil. */
export const sampleSponsor = (): SponsorCreative => {
  const s = dict('common').ads.sample;
  return {
    advertiser: 'BRAP Fibrecase',
    handle: '@brap_fibrecase',
    headline: s.headline,
    body: s.body,
    cta: s.cta,
    href: 'https://www.instagram.com/brap_fibrecase/',
  };
};

/** Hardcase gitar fiberglass: cangkang hitam mengilap, serat anyam tipis, gesper & pegangan mustard. */
function CaseArt({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const d = useDict('common');
  return (
    <svg viewBox="0 0 320 132" className={className} role="img" aria-label={d.ads.caseArtAlt}>
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3a42" />
          <stop offset="0.45" stopColor="#1b1b20" />
          <stop offset="1" stopColor="#0b0b0e" />
        </linearGradient>
        <pattern id={`${id}w`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill="#fff" opacity="0.05" />
        </pattern>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <ellipse cx="72" cy="70" rx="56" ry="52" />
          <ellipse cx="154" cy="70" rx="42" ry="40" />
          <rect x="150" y="51" width="128" height="38" rx="8" />
          <rect x="258" y="44" width="50" height="52" rx="12" />
        </clipPath>
      </defs>
      {/* bayangan lantai */}
      <ellipse cx="166" cy="124" rx="140" ry="6" fill="#000" opacity="0.35" />
      <g clipPath={`url(#${id}c)`}>
        <rect width="320" height="132" fill={`url(#${id}s)`} />
        <rect width="320" height="132" fill={`url(#${id}w)`} />
        {/* kilap cangkang */}
        <ellipse cx="110" cy="34" rx="120" ry="20" fill={`url(#${id}g)`} />
        {/* garis sambungan tutup */}
        <path d="M0 72 H320" stroke="#000" strokeOpacity="0.55" strokeWidth="2" />
        <path d="M0 74 H320" stroke="#fff" strokeOpacity="0.07" strokeWidth="1" />
      </g>
      {/* gesper */}
      {[44, 120, 214, 286].map((x) => (
        <rect key={x} x={x} y="68" width="12" height="9" rx="1.5" fill="#f4c21f" stroke="#181818" strokeWidth="1.5" />
      ))}
      {/* pegangan */}
      <path d="M186 51 v-9 a6 6 0 0 1 6 -6 h26 a6 6 0 0 1 6 6 v9" fill="none" stroke="#f4c21f" strokeWidth="5" strokeLinecap="round" />
      <text x="72" y="104" textAnchor="middle" fontFamily="var(--font-label)" fontSize="9" fontWeight="700" letterSpacing="2.5" fill="#ededed" opacity="0.55">
        BRAP
      </text>
    </svg>
  );
}

export function SponsorBanner({ ad: adProp, className }: { ad?: SponsorCreative; className?: string }) {
  const d = useDict('common');
  const { sponsor } = useLanding();
  const t = usePick();
  // Kreatif dari CMS Super Admin (content.landing.sponsor); contoh bawaan hanya bila CMS belum termuat.
  const cms: SponsorCreative | null = sponsor.advertiser
    ? { advertiser: sponsor.advertiser, handle: sponsor.handle, headline: t(sponsor.headline), body: t(sponsor.body), cta: t(sponsor.cta), href: sponsor.href }
    : null;
  const ad = adProp ?? cms ?? sampleSponsor();
  return (
    <aside
      aria-label={d.ads.adFrom(ad.advertiser)}
      className={cx(
        'relative isolate grid overflow-hidden rounded-none border border-white/10 bg-[#141416] text-rave-paper',
        // mobile: visual di atas (tinggi tetap) · ≥sm: tiga kolom setinggi 128px
        'grid-rows-[7.5rem_auto] sm:h-32 sm:grid-cols-[13rem_1fr_auto] sm:grid-rows-1 md:grid-cols-[16rem_1fr_auto]',
        className,
      )}
    >
      {/* Visual */}
      <div className="relative grid place-items-center overflow-hidden bg-[radial-gradient(80%_90%_at_30%_20%,#2c2c33,#121214)] px-5">
        <span className="pointer-events-none absolute -right-8 -bottom-10 size-32 rounded-full bg-rave-mustard/10 blur-2xl" aria-hidden />
        <CaseArt className="relative h-[5.75rem] w-auto max-w-full drop-shadow-[0_8px_14px_rgb(0_0_0/0.45)]" />
      </div>

      {/* Copy */}
      <div className="flex min-w-0 flex-col justify-center gap-1 px-5 py-4 sm:py-0">
        <p className="flex items-center gap-2 text-[11px] text-white/55">
          <span className="rounded-none bg-white/90 px-1.5 py-px font-label text-[10px] font-bold tracking-[0.14em] text-rave-ink uppercase">{d.ads.ad}</span>
          <span className="truncate font-bold text-white/75">{ad.advertiser}</span>
          <span className="hidden truncate md:inline">{ad.handle}</span>
        </p>
        <p className="font-display text-[1.6rem] leading-[1.02] text-balance uppercase sm:line-clamp-1 md:text-[1.85rem]">{ad.headline}</p>
        <p className="line-clamp-2 text-sm text-white/60 sm:line-clamp-1">{ad.body}</p>
      </div>

      {/* Aksi */}
      <div className="flex items-center justify-between gap-4 border-t border-white/10 px-5 py-3 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:py-0 sm:pl-0">
        <Link to="/iklan" className="order-2 text-[11px] text-white/45 underline-offset-2 hover:text-white/80 hover:underline sm:order-1">
          {d.ads.about}
        </Link>
        <a
          href={ad.href}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="order-1 inline-flex h-10 items-center gap-2 rounded-none bg-rave-mustard px-5 text-sm font-bold whitespace-nowrap text-rave-ink transition hover:brightness-105 sm:order-2"
        >
          {ad.cta} <ArrowUpRight className="size-4" />
        </a>
      </div>
    </aside>
  );
}
