import { useId } from 'react';
import { motion, type MotionStyle } from 'motion/react';
import { cx } from '@/components/ui';

const RING_TEXT = 'rolliemonkie audio visual experiment';
/** Mask cincin piringan (tanpa label & tepi) untuk lapisan kilau. */
const DISC_MASK = 'radial-gradient(circle,transparent 0 34.5%,#000 35% 99%,transparent 99.5%)';

/**
 * Piringan hitam realistis & bersih (dipakai hero & "Kenapa memilih"): alur mikro, celah antar-track, dead wax,
 * bevel tepi, label ungu polos dengan satu teks melingkar kecil. `discStyle`/`discClassName` diterapkan ke lapisan
 * yang berputar (CSS animation atau motion value), sedangkan kilau cahaya tetap diam agar putaran terbaca.
 * Posisi: `relative` bawaan, kecuali pemanggil memberi `absolute`/`fixed` (agar tidak saling menimpa).
 */
export function Vinyl({ className, discClassName, discStyle, shadow = true }: { className?: string; discClassName?: string; discStyle?: MotionStyle; shadow?: boolean }) {
  const id = useId().replace(/:/g, '');
  const r = 70;
  const ring = `M100,100 m-${r},0 a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 -${r * 2},0`;
  return (
    <div className={cx('pointer-events-none aspect-square', /\b(absolute|fixed)\b/.test(className ?? '') ? null : 'relative', className)} aria-hidden>
      {shadow && <div className="absolute inset-[2%] translate-x-[1.5%] translate-y-[2.5%] rounded-full bg-black/70 blur-2xl" />}
      <motion.div className={cx('absolute inset-0 rounded-full will-change-transform', discClassName)} style={discStyle}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: [
              'radial-gradient(circle, transparent 0 46.2%, rgba(255,255,255,0.05) 46.4%, transparent 46.9%, transparent 58.2%, rgba(255,255,255,0.045) 58.4%, transparent 58.9%, transparent 70.6%, rgba(255,255,255,0.05) 70.8%, transparent 71.3%, transparent 82.4%, rgba(255,255,255,0.04) 82.6%, transparent 83.1%)',
              'radial-gradient(circle, transparent 0 27%, #121212 27.2% 33.5%, transparent 34%, transparent 96.2%, #141414 96.6% 100%)',
              'repeating-radial-gradient(circle, #0c0c0c 0 1.2px, #171717 1.2px 2.1px, #101010 2.1px 3px)',
            ].join(','),
            boxShadow: 'inset 0 0 0 2px #050505, inset 0 0 0 4px rgba(255,255,255,0.05), inset 0 0 60px rgba(0,0,0,0.85)',
          }}
        />
        <div className="absolute inset-[34.5%] overflow-hidden rounded-full bg-[radial-gradient(circle_at_40%_35%,#6a3381,#5B2A6E_55%,#47205a)] shadow-[0_0_0_2px_#0b0b0b,inset_0_0_18px_rgba(0,0,0,0.35)]">
          <span className="absolute inset-0 bg-[image:var(--rave-grain)] opacity-25 mix-blend-overlay" />
          <svg viewBox="0 0 200 200" className="absolute inset-0 size-full">
            <defs>
              <path id={`${id}-l`} d={ring} />
            </defs>
            <text fill="#EDEDED" fillOpacity="0.8" fontFamily="Space Mono, ui-monospace, monospace" fontWeight="700" fontSize="9.5" letterSpacing="1.6">
              <textPath href={`#${id}-l`} startOffset="2%">
                {RING_TEXT.toUpperCase()}
              </textPath>
            </text>
          </svg>
        </div>
        <span className="absolute top-1/2 left-1/2 size-[1.6%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_35%_35%,#3a3a3a,#050505)] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" />
      </motion.div>
      <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_115deg,transparent_0deg,rgba(255,255,255,0.17)_18deg,rgba(255,255,255,0.035)_42deg,transparent_60deg,transparent_180deg,rgba(255,255,255,0.12)_198deg,rgba(255,255,255,0.025)_222deg,transparent_240deg)]" style={{ maskImage: DISC_MASK, WebkitMaskImage: DISC_MASK }} />
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.06),transparent_45%)]" style={{ maskImage: DISC_MASK, WebkitMaskImage: DISC_MASK }} />
    </div>
  );
}
