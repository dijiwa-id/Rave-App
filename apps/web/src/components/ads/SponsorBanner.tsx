import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cx } from '@/components/ui';
import { useLanding, usePick } from '@/lib/landing';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useDict } from '@/lib/i18n';

/**
 * Banner sponsor display (statis) untuk landing & Beranda app.
 *
 * Aturan agar tidak mengganggu layout:
 * - tinggi tetap per breakpoint (tidak ada pergeseran/CLS), lebar mengikuti kontainer kontennya;
 * - selalu berlabel "Iklan" + tautan "Tentang iklan" (transparansi, sesuai /iklan);
 * - tautan keluar memakai rel="sponsored".
 *
 * Kebijakan: tidak ada kreatif bawaan. Banner hanya tampil bila Super Admin mengisi kreatif di Editor Landing
 * (`content.landing.sponsor`) DAN penayangan iklan aktif (`ads.enabled`). Pemanggil menentukan audiens
 * (Beranda: hanya pengguna masuk non-Premium). Belum ada placement display di layanan ads, jadi banner ini
 * belum melewati review kampanye & belum mencatat impresi.
 */
export interface SponsorCreative {
  advertiser: string;
  handle: string;
  headline: string;
  body: string;
  cta: string;
  href: string;
}

/** True bila banner sponsor akan tampil: kreatif diisi Super Admin dan penayangan iklan aktif. */
export function useSponsorAvailable(): boolean {
  const { sponsor } = useLanding();
  const adsOn = setting(usePlatformConfig(), 'ads.enabled', false);
  return adsOn && !!sponsor.advertiser;
}

/** Visual netral: monogram pengiklan (tanpa ilustrasi produk tertentu). */
function Monogram({ name }: { name: string }) {
  return (
    <span aria-hidden className="grid size-20 place-items-center border-2 border-rave-mustard/70 font-display text-5xl leading-none text-rave-mustard uppercase">
      {name.trim().charAt(0)}
    </span>
  );
}

export function SponsorBanner({ ad: adProp, className }: { ad?: SponsorCreative; className?: string }) {
  const d = useDict('common');
  const { sponsor } = useLanding();
  const t = usePick();
  // Kreatif dari CMS Super Admin (content.landing.sponsor); kosong = tidak ada banner.
  const cms: SponsorCreative | null = sponsor.advertiser
    ? { advertiser: sponsor.advertiser, handle: sponsor.handle, headline: t(sponsor.headline), body: t(sponsor.body), cta: t(sponsor.cta), href: sponsor.href }
    : null;
  const adsOn = setting(usePlatformConfig(), 'ads.enabled', false);
  const ad = adProp ?? cms;
  if (!ad || !adsOn) return null;
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
        <Monogram name={ad.advertiser} />
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
