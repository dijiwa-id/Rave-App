import { SETTINGS_BY_KEY } from '@gema/domain/settings';
import { setting, usePlatformConfig } from '@/lib/platform';

const num = (cfg: ReturnType<typeof usePlatformConfig>, key: string) => setting<number>(cfg, key, SETTINGS_BY_KEY[key].default as number);
const idr = (n: number) => n.toLocaleString('id-ID');
const pct = (n: number) => `${String(n).replace('.', ',')}%`;

/**
 * Harga & komisi publik dari Super Admin (`subscription.*`, `commission.*`) dengan default registri pengaturan —
 * satu sumber untuk Landing, Premium, dan halaman perusahaan agar angka tidak pernah berbeda antarhalaman.
 */
export function usePricing() {
  const cfg = usePlatformConfig();
  const trialDays = num(cfg, 'subscription.trial_days');
  return {
    open: setting<boolean>(cfg, 'subscription.enabled', false),
    individual: idr(num(cfg, 'subscription.price_individual_idr')),
    student: idr(num(cfg, 'subscription.price_student_idr')),
    duo: idr(num(cfg, 'subscription.price_duo_idr')),
    trialDays,
    /** "1 bulan" untuk kelipatan 30 hari, selain itu "n hari"; kosong bila tanpa masa coba. */
    trial: !trialDays ? '' : trialDays % 30 === 0 ? `${trialDays / 30} bulan` : `${trialDays} hari`,
    studentMonths: num(cfg, 'subscription.student_verify_months'),
    devices: num(cfg, 'subscription.download_devices'),
    artistCommission: pct(num(cfg, 'commission.artist_commission_pct')),
    promotorFee: pct(num(cfg, 'commission.promotor_service_fee_pct')),
    proArtistCommission: pct(num(cfg, 'subscription.pro_artist_commission_pct')),
    proPromotorFee: pct(num(cfg, 'subscription.pro_promotor_service_fee_pct')),
  };
}
