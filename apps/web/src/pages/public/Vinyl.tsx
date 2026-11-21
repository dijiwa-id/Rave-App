import { useId, type ReactNode } from 'react';
import { motion, type MotionStyle } from 'motion/react';
import { cx } from '@/components/ui';

const RING_TEXT = 'rolliemonkie audio visual experiment';
/** Mask cincin piringan (tanpa label & tepi) untuk lapisan kilau. */
const DISC_MASK = 'radial-gradient(circle,transparent 0 34.5%,#000 35% 99%,transparent 99.5%)';
/** Tekstur vintage hyperrealistic — dibuat `scripts/vinyl-textures.ts` (alur, debu, baret, patina; label kertas tua). */
export const VINYL_DISC_TEXTURE = '/textures/vinyl-disc.webp';
export const VINYL_LABEL_TEXTURE = '/textures/vinyl-label.webp';
/** Kilau lampu hangat (tungsten) — lapisan diam agar putaran terbaca. */
export const VINYL_SHEEN =
  'conic-gradient(from 115deg,transparent 0deg,rgba(255,232,200,0.17) 18deg,rgba(255,232,200,0.035) 42deg,transparent 60deg,transparent 180deg,rgba(255,232,200,0.12) 198deg,rgba(255,232,200,0.025) 222deg,transparent 240deg)';

/**
 * Label piringan vintage: tinta ungu RAVE yang memudar, kertas menguning (tekstur `multiply`), teks cetak melingkar,
 * SIDE A / 33⅓ RPM, dan lubang spindle dengan cincin aus. `children` (mis. cover lagu) menggantikan warna dasar.
 */
export function VinylLabel({ className, children }: { className?: string; children?: ReactNode }) {
  const id = useId().replace(/:/g, '');
  const r = 70;
  const ring = `M100,100 m-${r},0 a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 -${r * 2},0`;
  return (
    <div className={cx('overflow-hidden rounded-full shadow-[0_0_0_1.5px_#0b0908,inset_0_0_14px_rgba(40,20,5,0.45)]', className)}>
      {children ?? <span className="absolute inset-0 bg-[radial-gradient(circle_at_40%_35%,#77507f,#5f3a6b_55%,#46294f)]" />}
      <img src={VINYL_LABEL_TEXTURE} alt="" draggable={false} className="absolute inset-0 size-full mix-blend-multiply" />
      {/* pudar matahari: sedikit sepia di atas tinta */}
      <span className="absolute inset-0 bg-[#c9a46a] opacity-[0.12] mix-blend-color" />
      {!children && (
        <svg viewBox="0 0 200 200" className="absolute inset-0 size-full">
          <defs>
            <path id={`${id}-l`} d={ring} />
          </defs>
          <g fill="#efe3cc" fillOpacity="0.72" fontFamily="Space Mono, ui-monospace, monospace" fontWeight="700">
            <text fontSize="9.5" letterSpacing="1.6">
              <textPath href={`#${id}-l`} startOffset="2%">
                {RING_TEXT.toUpperCase()}
              </textPath>
            </text>
            <text x="100" y="62" fontSize="11" letterSpacing="3" textAnchor="middle">
              SIDE A
            </text>
            <text x="100" y="148" fontSize="7.5" letterSpacing="1.4" textAnchor="middle" fillOpacity="0.6">
              33⅓ RPM · STEREO
            </text>
          </g>
        </svg>
      )}
      <span className="absolute top-1/2 left-1/2 size-[9%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#050403_45%,#2a2520_62%,rgba(40,30,20,0.35)_100%)]" />
    </div>
  );
}

/**
 * Piringan hitam vintage hyperrealistic (hero, "Kenapa memilih", login, lirik): tekstur alur mikro + dinamika musik,
 * debu, baret, patina, label kertas tua. `discStyle`/`discClassName` diterapkan ke lapisan yang berputar (CSS animation
 * atau motion value), sedangkan kilau lampu hangat tetap diam agar putaran terbaca.
 * Posisi: `relative` bawaan, kecuali pemanggil memberi `absolute`/`fixed` (agar tidak saling menimpa).
 */
export function Vinyl({ className, discClassName, discStyle, shadow = true }: { className?: string; discClassName?: string; discStyle?: MotionStyle; shadow?: boolean }) {
  return (
    <div className={cx('pointer-events-none aspect-square', /\b(absolute|fixed)\b/.test(className ?? '') ? null : 'relative', className)} aria-hidden>
      {shadow && <div className="absolute inset-[2%] translate-x-[1.5%] translate-y-[2.5%] rounded-full bg-black/75 blur-2xl" />}
      <motion.div className={cx('absolute inset-0 rounded-full will-change-transform', discClassName)} style={discStyle}>
        <img src={VINYL_DISC_TEXTURE} alt="" draggable={false} className="absolute inset-0 size-full rounded-full bg-[#100d0b]" />
        <VinylLabel className="absolute inset-[34.5%]" />
      </motion.div>
      <div className="absolute inset-0 rounded-full" style={{ background: VINYL_SHEEN, maskImage: DISC_MASK, WebkitMaskImage: DISC_MASK }} />
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,236,210,0.07),transparent_45%)]" style={{ maskImage: DISC_MASK, WebkitMaskImage: DISC_MASK }} />
    </div>
  );
}
