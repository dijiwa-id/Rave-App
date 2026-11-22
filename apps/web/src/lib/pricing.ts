import { SETTINGS_BY_KEY } from '@rave/domain/settings';
import { setting, usePlatformConfig } from '@/lib/platform';
import { currentLocale, dict, localeTag } from '@/lib/i18n';

const num = (cfg: ReturnType<typeof usePlatformConfig>, key: string) => setting<number>(cfg, key, SETTINGS_BY_KEY[key].default as number);
const idr = (n: number) => n.toLocaleString(localeTag());
const pct = (n: number) => `${currentLocale() === 'en' ? String(n) : String(n).replace('.', ',')}%`;
/** Rentang persen "3–4%" (sama → satu angka) untuk ringkasan komisi standar vs RAVE Pro. */
const pctRange = (a: number, b: number) => {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  return lo === hi ? pct(lo) : `${pct(lo).replace('%', '')}–${pct(hi)}`;
};

/**
 * Harga & komisi publik dari Super Admin (`subscription.*`, `commission.*`) dengan default registri pengaturan —
 * satu sumber untuk Landing, Premium, dan halaman perusahaan agar angka tidak pernah berbeda antarhalaman.
 */
export function usePricing() {
  const cfg = usePlatformConfig();
  const trialDays = num(cfg, 'subscription.trial_days');
  const t = dict('common').pricing;
  return {
    open: setting<boolean>(cfg, 'subscription.enabled', false),
    individual: idr(num(cfg, 'subscription.price_individual_idr')),
    student: idr(num(cfg, 'subscription.price_student_idr')),
    duo: idr(num(cfg, 'subscription.price_duo_idr')),
    trialDays,
    /** "1 bulan" untuk kelipatan 30 hari, selain itu "n hari"; kosong bila tanpa masa coba. */
    trial: !trialDays ? '' : trialDays % 30 === 0 ? t.months(trialDays / 30) : t.days(trialDays),
    studentMonths: num(cfg, 'subscription.student_verify_months'),
    devices: num(cfg, 'subscription.download_devices'),
    /** Unduhan offline (P-7) dibuka Super Admin (`download.enabled`) — mati = tetap "segera hadir" di halaman publik. */
    downloads: setting<boolean>(cfg, 'download.enabled', false),
    /** Paket berbayar yang berhak mengunduh (`download.tiers`). */
    downloadTiers: setting<string[]>(cfg, 'download.tiers', SETTINGS_BY_KEY['download.tiers'].default as string[]),
    /** Batas lagu/episode per perangkat (`download.max_tracks_per_device`). */
    downloadItems: num(cfg, 'download.max_tracks_per_device'),
    artistCommission: pct(num(cfg, 'commission.artist_commission_pct')),
    promotorFee: pct(num(cfg, 'commission.promotor_service_fee_pct')),
    proArtistCommission: pct(num(cfg, 'subscription.pro_artist_commission_pct')),
    proPromotorFee: pct(num(cfg, 'subscription.pro_promotor_service_fee_pct')),
    /** Harga paket Pro per bulan (belum termasuk PPN). */
    proPrice: idr(num(cfg, 'subscription.pro_price_pro_idr')),
    promotorFeeRange: pctRange(num(cfg, 'subscription.pro_promotor_service_fee_pct'), num(cfg, 'commission.promotor_service_fee_pct')),
    artistCommissionRange: pctRange(num(cfg, 'subscription.pro_artist_commission_pct'), num(cfg, 'commission.artist_commission_pct')),
  };
}
