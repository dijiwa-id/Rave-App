import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui';

// Elemen bersama halaman pemasaran (landing, premium): warna merek, kerangka section, dan judul seragam.

/** Gradien merek RAVE: ungu → plum → berry (dipakai sebagai isian latar, bukan teks). */
export const BRAND_GRADIENT = 'bg-gradient-to-r from-[#5B2A6E] via-[#2A1233] to-[#8A2F3F]';

/** Tombol pemasaran seragam (rave-website .btn): pil label kapital berspasi; mustard = aksi utama, ghost = sekunder. */
const BTN_BASE = 'rave-label group inline-flex items-center justify-center gap-2.5 rounded-none border-2 px-7 py-4 !text-[12px] shadow-[4px_4px_0_#0b0a0c] transition duration-300 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#0b0a0c] disabled:pointer-events-none disabled:opacity-60';
export const BTN_PRIMARY = `${BTN_BASE} border-rave-primary bg-rave-primary text-rave-on-primary hover:border-rave-paper hover:bg-rave-paper`;
export const BTN_GHOST = `${BTN_BASE} border-rave-paper/70 text-rave-paper hover:border-rave-paper hover:bg-rave-paper hover:text-rave-ink`;
/** Versi ringkas untuk dalam kartu/form. */
export const BTN_PRIMARY_SM = BTN_PRIMARY.replace('px-7 py-4', 'px-5 py-3').replace('!text-[12px]', '!text-[11px]');
export const BTN_GHOST_SM = BTN_GHOST.replace('px-7 py-4', 'px-5 py-3').replace('!text-[11px]', '!text-[11px]').replace('!text-[12px]', '!text-[11px]');
/** Judul kartu/sub-bagian bergaya poster. */
export const CARD_TITLE = 'font-display uppercase leading-[0.95] tracking-[0.01em]';

/**
 * Muncul halus (fade + blur) saat pertama masuk layar — IntersectionObserver + transisi CSS, tanpa library animasi.
 * Pengguna dengan "kurangi gerakan" langsung melihat konten.
 */
function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setShown(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cx(
        'transition-[opacity,filter] duration-700 ease-out motion-reduce:opacity-100 motion-reduce:blur-none motion-reduce:transition-none',
        shown ? 'opacity-100 blur-none' : 'opacity-0 blur-[10px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Kerangka section: lebar, jarak, dan animasi masuk seragam. */
export function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx('scroll-mt-20 px-4 py-20 md:py-24', className)}>
      <Reveal className="mx-auto max-w-[82.5rem]">{children}</Reveal>
    </section>
  );
}

export function Heading({ kicker, title, body, center, action }: { kicker: string; title: ReactNode; body?: string; center?: boolean; action?: ReactNode }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-6', center && 'flex-col items-center text-center')}>
      <div className={cx('max-w-2xl', center && 'mx-auto')}>
        <p className={cx('rave-label rave-eyebrow !text-[12px]', center && 'justify-center')}>{kicker}</p>
        <h2 className="mt-5 text-[2.75rem] leading-[0.95] text-balance text-rave-paper md:text-[4.25rem]">{title}</h2>
        {body && <p className="mt-5 text-lg text-[#c4c4c4]">{body}</p>}
      </div>
      {action}
    </div>
  );
}


/** Teks ransom-note punk: tiap huruf potongan kertas (warna/miring bergantian). Dibaca utuh oleh screen reader. */
export function RansomText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cx('rave-ransom align-middle', className)} role="img" aria-label={text}>
      {[...text].map((ch, i) => (ch === ' ' ? <span key={i} className="!bg-transparent !shadow-none" aria-hidden>&nbsp;</span> : <span key={i} aria-hidden>{ch}</span>))}
    </span>
  );
}
