import { useId } from 'react';

/**
 * Kaset pita realistis (SVG murni, proporsi kaset kompak 100,4 × 63,8 mm) untuk keadaan "belum memutar":
 * cangkang plastik asap transparan bertekstur, bevel & kilau, 5 sekrup Phillips logam, label kertas krem dengan pita
 * ungu RAVE + sisi "A" + garis tulis, jendela kaca berisi gulungan pita cokelat (cincin lilitan halus) dan hub bergigi,
 * area head bawah dengan lubang capstan, bantalan felt & pita yang tampak. Gulungan berputar pelan saat di-hover
 * (dimatikan oleh prefers-reduced-motion). Dipakai web & desktop (salinan identik).
 */
/** Warna cangkang (3 stop atas→bawah) & pita label (3 stop kiri→kanan). `smoke` = tampilan asli. */
const TONES = {
  smoke: { shell: ['#35303d', '#221f28', '#141217'], band: ['#4a2259', '#5B2A6E', '#6d3584'] },
  mustard: { shell: ['#f7d35a', '#e0ab12', '#a87c05'], band: ['#2a1233', '#3d1a4a', '#5B2A6E'] },
  berry: { shell: ['#b04456', '#8A2F3F', '#5a1a26'], band: ['#141217', '#1e1b22', '#2a2630'] },
  teal: { shell: ['#3f8a7d', '#1F5C52', '#103a33'], band: ['#a87c05', '#e0ab12', '#F4C21F'] },
  paper: { shell: ['#f3eee2', '#ddd5c2', '#b8ae98'], band: ['#8A2F3F', '#a23a4c', '#b04456'] },
} as const;
export type CassetteTone = keyof typeof TONES;

export function Cassette({ className, label = 'RAVE', tone = 'smoke' }: { className?: string; label?: string; tone?: CassetteTone }) {
  const pal = TONES[tone];
  const u = useId().replace(/:/g, '');
  const id = (n: string) => `${u}-${n}`;
  const screws: [number, number][] = [
    [22, 22],
    [378, 22],
    [22, 234],
    [378, 234],
    [200, 222],
  ];
  return (
    <svg viewBox="0 0 400 256" className={`rave-cassette ${className ?? ''}`} role="img" aria-hidden>
      <defs>
        <linearGradient id={id('shell')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.shell[0]} />
          <stop offset="0.5" stopColor={pal.shell[1]} />
          <stop offset="1" stopColor={pal.shell[2]} />
        </linearGradient>
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={id('paper')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3eee2" />
          <stop offset="1" stopColor="#e2dac8" />
        </linearGradient>
        <linearGradient id={id('band')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={pal.band[0]} />
          <stop offset="0.55" stopColor={pal.band[1]} />
          <stop offset="1" stopColor={pal.band[2]} />
        </linearGradient>
        <radialGradient id={id('tape')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.3" stopColor="#4a2c1c" />
          <stop offset="0.85" stopColor="#2d1a10" />
          <stop offset="1" stopColor="#1c100a" />
        </radialGradient>
        <radialGradient id={id('metal')} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#f4f4f4" />
          <stop offset="0.45" stopColor="#a9a9ad" />
          <stop offset="1" stopColor="#4c4c52" />
        </radialGradient>
        <linearGradient id={id('glass')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.8" stopColor="#fff" stopOpacity="0.07" />
        </linearGradient>
        <linearGradient id={id('head')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c2833" />
          <stop offset="1" stopColor="#100f13" />
        </linearGradient>
        {/* Tekstur: butir plastik & serat kertas */}
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.09" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id={id('shadow')} x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <clipPath id={id('win')}>
          <rect x="104" y="98" width="192" height="60" rx="9" />
        </clipPath>
        <mask id={id('labelMask')}>
          <rect x="30" y="20" width="340" height="156" rx="7" fill="#fff" />
          <rect x="100" y="94" width="200" height="68" rx="12" fill="#000" />
        </mask>
        {/* Satu gigi hub (diputar 6×) */}
        <g id={id('hub')}>
          <circle r="12.5" fill="#ebe7df" stroke="#b9b3a6" strokeWidth="0.8" />
          <circle r="7.2" fill="#17151a" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <rect key={a} x="-1.4" y="-7.4" width="2.8" height="3.6" rx="0.6" fill="#ebe7df" transform={`rotate(${a})`} />
          ))}
          <circle r="12.5" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6" strokeDasharray="6 30" />
        </g>
      </defs>

      <g filter={`url(#${id('shadow')})`}>
        {/* Cangkang */}
        <rect x="3" y="3" width="394" height="250" rx="15" fill={`url(#${id('shell')})`} stroke="#060507" strokeWidth="2" />
        <rect x="3" y="3" width="394" height="250" rx="15" fill="#fff" filter={`url(#${id('grain')})`} />
        <rect x="6.5" y="6.5" width="387" height="243" rx="12" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="1.2" />
        {/* Alur pegangan di sisi */}
        {Array.from({ length: 7 }, (_, i) => (
          <g key={i} opacity="0.5">
            <rect x="9" y={80 + i * 13} width="10" height="2" rx="1" fill="#0a090c" />
            <rect x="381" y={80 + i * 13} width="10" height="2" rx="1" fill="#0a090c" />
          </g>
        ))}

        {/* Label kertas (berlubang di jendela) */}
        <g mask={`url(#${id('labelMask')})`}>
          <rect x="30" y="20" width="340" height="156" rx="7" fill={`url(#${id('paper')})`} />
          <rect x="30" y="20" width="340" height="156" rx="7" fill="#7a6a4a" filter={`url(#${id('grain')})`} />
          <rect x="30" y="20" width="340" height="38" fill={`url(#${id('band')})`} />
          <rect x="30" y="58" width="340" height="4" fill="#f4c21f" />
          <rect x="30" y="62" width="340" height="1.4" fill="#181818" opacity="0.8" />
          {/* Sisi A */}
          <circle cx="54" cy="39" r="13" fill="#f4c21f" stroke="#181818" strokeWidth="1.5" />
          <text x="54" y="45.5" textAnchor="middle" fontFamily="Staatliches, Impact, sans-serif" fontSize="19" fill="#181818">
            A
          </text>
          <text x="78" y="47" fontFamily="Staatliches, Impact, sans-serif" fontSize="27" letterSpacing="1.5" fill="#EDEDED">
            {label}
          </text>
          <text x="352" y="36" textAnchor="end" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="11" letterSpacing="1.2" fill="#f4c21f">
            C-60
          </text>
          <text x="352" y="50" textAnchor="end" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="7.5" letterSpacing="1" fill="#EDEDED" opacity="0.75">
            TYPE I · NORMAL
          </text>
          {/* Garis tulis kosong */}
          {[76, 88].map((y) => (
            <line key={y} x1="46" y1={y} x2="354" y2={y} stroke="#8d8576" strokeWidth="0.8" strokeOpacity="0.55" />
          ))}
          <text x="200" y="171" textAnchor="middle" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="6.6" letterSpacing="1.6" fill="#5d5649">
            ROLLIEMONKIE · AUDIO VISUAL · EXPERIMENT
          </text>
        </g>
        <rect x="30" y="20" width="340" height="156" rx="7" fill="none" stroke="#000" strokeOpacity="0.35" />

        {/* Jendela: bingkai, gulungan pita, kaca */}
        <rect x="100" y="94" width="200" height="68" rx="12" fill="#0d0b0f" stroke="#050406" strokeWidth="1.5" />
        <g clipPath={`url(#${id('win')})`}>
          <rect x="104" y="98" width="192" height="60" fill="#1a1720" />
          <rect x="104" y="98" width="192" height="60" fill="#fff" filter={`url(#${id('grain')})`} />
          {/* Pita menyeberang antar gulungan */}
          <path d="M140 155 L260 155" stroke="#2a1810" strokeWidth="2" />
          {/* Gulungan kiri (penuh) & kanan (sedikit) */}
          <g className="rave-cassette__reel">
            <circle cx="140" cy="128" r="28" fill={`url(#${id('tape')})`} />
            <circle cx="140" cy="128" r="28" fill="none" stroke="#000" strokeOpacity="0.35" />
            {Array.from({ length: 6 }, (_, i) => (
              <circle key={i} cx="140" cy="128" r={15 + i * 2.2} fill="none" stroke="#7a4a2c" strokeOpacity={0.14 + (i % 3) * 0.05} strokeWidth="0.5" />
            ))}
            <use href={`#${id('hub')}`} x="140" y="128" />
          </g>
          <g className="rave-cassette__reel">
            <circle cx="260" cy="128" r="19" fill={`url(#${id('tape')})`} />
            {Array.from({ length: 3 }, (_, i) => (
              <circle key={i} cx="260" cy="128" r={14 + i * 2} fill="none" stroke="#7a4a2c" strokeOpacity="0.2" strokeWidth="0.5" />
            ))}
            <use href={`#${id('hub')}`} x="260" y="128" />
          </g>
          {/* Skala sisa pita */}
          {Array.from({ length: 9 }, (_, i) => (
            <line key={i} x1={176 + i * 6} y1="100" x2={176 + i * 6} y2={i % 2 ? 104 : 107} stroke="#EDEDED" strokeOpacity="0.45" strokeWidth="0.8" />
          ))}
          <rect x="104" y="98" width="192" height="60" fill={`url(#${id('glass')})`} />
          <path d="M112 152 L150 100" stroke="#fff" strokeOpacity="0.1" strokeWidth="6" />
        </g>

        {/* Area head bawah */}
        <path d="M108 253 L122 196 Q124 190 130 190 L270 190 Q276 190 278 196 L292 253 Z" fill={`url(#${id('head')})`} stroke="#060507" strokeWidth="1.5" />
        <path d="M123 197 L277 197" stroke="#fff" strokeOpacity="0.08" />
        <circle cx="148" cy="226" r="8" fill="#050406" stroke="#3a3540" />
        <circle cx="252" cy="226" r="8" fill="#050406" stroke="#3a3540" />
        <rect x="124" y="232" width="9" height="9" rx="1.5" fill="#050406" />
        <rect x="267" y="232" width="9" height="9" rx="1.5" fill="#050406" />
        <rect x="178" y="236" width="44" height="15" rx="2" fill="#050406" />
        <rect x="190" y="240" width="20" height="7" rx="1" fill="#c9b99a" />
        <rect x="114" y="248.5" width="172" height="3" fill="#3a2214" />

        {/* Sekrup Phillips */}
        {screws.map(([x, y]) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
            <circle r="6.4" fill="#0b0a0d" />
            <circle r="5.2" fill={`url(#${id('metal')})`} />
            <path d="M-3 0 H3 M0 -3 V3" stroke="#2a2a2e" strokeWidth="1.3" strokeLinecap="round" />
          </g>
        ))}

        {/* Kilau plastik menyeluruh */}
        <rect x="3" y="3" width="394" height="250" rx="15" fill={`url(#${id('sheen')})`} pointerEvents="none" />
      </g>
    </svg>
  );
}
