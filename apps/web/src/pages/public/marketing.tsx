import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui';

// Elemen bersama halaman pemasaran (landing, premium): warna merek, kerangka section, dan judul seragam.

/** Gradien merek (logo GEMA): ungu → magenta → oranye. */
export const BRAND_GRADIENT = 'bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#f6851f]';

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
      <Reveal className="mx-auto max-w-6xl">{children}</Reveal>
    </section>
  );
}

export function Heading({ kicker, title, body, center, action }: { kicker: string; title: ReactNode; body?: string; center?: boolean; action?: ReactNode }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-6', center && 'flex-col items-center text-center')}>
      <div className={cx('max-w-2xl', center && 'mx-auto')}>
        <p className={cx('inline-block bg-clip-text text-sm font-bold tracking-[0.16em] text-transparent uppercase', BRAND_GRADIENT)}>{kicker}</p>
        <h2 className="mt-3 text-4xl leading-[1.1] font-black tracking-tight text-balance md:text-5xl">{title}</h2>
        {body && <p className="mt-4 text-lg text-white/60">{body}</p>}
      </div>
      {action}
    </div>
  );
}

