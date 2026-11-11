import { SETTINGS_BY_KEY } from '@rave/domain/settings';
import { setting, usePlatformConfig } from '@/lib/platform';
import { currentLocale, dict, localeTag } from '@/lib/i18n';

const num = (cfg: ReturnType<typeof usePlatformConfig>, key: string) => setting<number>(cfg, key, SETTINGS_BY_KEY[key].default as number);
const idr = (n: number) => n.toLocaleString(localeTag());
const pct = (n: number) => `${currentLocale() === 'en' ? String(n) : String(n).replace('.', ',')}%`;

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
    artistCommission: pct(num(cfg, 'commission.artist_commission_pct')),
    promotorFee: pct(num(cfg, 'commission.promotor_service_fee_pct')),
    proArtistCommission: pct(num(cfg, 'subscription.pro_artist_commission_pct')),
    proPromotorFee: pct(num(cfg, 'subscription.pro_promotor_service_fee_pct')),
  };
}
