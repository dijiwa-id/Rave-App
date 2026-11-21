import { Crown } from 'lucide-react';
import { cx } from '@/components/ui';

/** Badge kecil "PRO" — organisasi berlangganan RAVE Pro / tarif Pro pada booking. */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 border border-b2b-ink bg-rave-mustard px-1.5 py-px text-[10px] leading-4 font-extrabold tracking-wider text-rave-ink', className)}>
      <Crown className="size-3" aria-hidden /> PRO
    </span>
  );
}
