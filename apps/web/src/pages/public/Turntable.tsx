import { useId } from 'react';

/**
 * Pemutar piringan hitam vintage (gaya hi-fi 70-an, tanpa merek pihak ketiga) — SVG murni untuk kolase landing,
 * dilihat dari atas sedikit miring. Plinth kayu walnut (serat kayu dari noise), pelat atas aluminium sikat, platter
 * dengan tepi strobo, piringan hitam beralur + kilau anisotropik, label RAVE ungu, lengan tonearm krom berpemberat,
 * headshell & jarum di atas piringan, tuas cueing, kenop 33/45 & lampu power. Piringan berputar pelan saat di-hover
 * (`.rave-cassette__reel`; dimatikan oleh prefers-reduced-motion).
 */
export function Turntable({ className }: { className?: string }) {
  const u = useId().replace(/:/g, '');
  const id = (n: string) => `${u}-${n}`;
  const cx = 168;
  const cy = 150;
  return (
    <svg viewBox="0 0 400 300" className={`rave-cassette ${className ?? ''}`} role="img" aria-hidden>
      <defs>
        <linearGradient id={id('wood')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a4a2a" />
          <stop offset="0.5" stopColor="#5a3218" />
          <stop offset="1" stopColor="#3a1f0e" />
        </linearGradient>
        {/* Serat kayu: noise diregangkan horizontal, diwarnai cokelat tua */}
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.18" numOctaves="3" seed="9" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 1.4 -0.45" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <linearGradient id={id('alu')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9ebee" />
          <stop offset="0.4" stopColor="#c3c6cc" />
          <stop offset="0.75" stopColor="#dfe1e5" />
          <stop offset="1" stopColor="#a7abb2" />
        </linearGradient>
        <filter id={id('brush')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.005 0.8" numOctaves="2" seed="4" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.2" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id={id('shadow')} x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id={id('soft')} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <radialGradient id={id('vinyl')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#1b1a1d" />
          <stop offset="0.96" stopColor="#0c0b0d" />
          <stop offset="1" stopColor="#1e1d20" />
        </radialGradient>
        {/* Kilau anisotropik khas piringan (dua "dasi kupu-kupu" cahaya) */}
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.42" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.58" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('chrome')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdfdfd" />
          <stop offset="0.45" stopColor="#9fa3aa" />
          <stop offset="0.55" stopColor="#6d7178" />
          <stop offset="1" stopColor="#d6d8dc" />
        </linearGradient>
        <radialGradient id={id('knob')} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#f4f4f4" />
          <stop offset="0.5" stopColor="#a9acb2" />
          <stop offset="1" stopColor="#4c4f55" />
        </radialGradient>
        <clipPath id={id('disc')}>
          <circle cx={cx} cy={cy} r="104" />
        </clipPath>
      </defs>

      <g filter={`url(#${id('shadow')})`}>
        {/* Plinth kayu walnut */}
        <rect x="4" y="18" width="392" height="274" rx="10" fill={`url(#${id('wood')})`} />
        <rect x="4" y="18" width="392" height="274" rx="10" fill="#fff" filter={`url(#${id('grain')})`} />
        <rect x="4" y="18" width="392" height="274" rx="10" fill="none" stroke="#1d0f06" strokeWidth="2" />
        <rect x="6" y="20" width="388" height="4" rx="2" fill="#fff" opacity="0.18" />
        {/* Pelat atas aluminium */}
        <rect x="18" y="30" width="364" height="246" rx="6" fill={`url(#${id('alu')})`} />
        <rect x="18" y="30" width="364" height="246" rx="6" fill="#fff" filter={`url(#${id('brush')})`} />
        <rect x="18.75" y="30.75" width="362.5" height="244.5" rx="5.5" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.5" />
        <rect x="18" y="30" width="364" height="246" rx="6" fill="none" stroke="#5d6168" strokeWidth="1" />

        {/* Platter: tepi strobo */}
        <circle cx={cx} cy={cy + 3} r="112" fill="#000" opacity="0.35" filter={`url(#${id('soft')})`} />
        <circle cx={cx} cy={cy} r="112" fill="#2a2c31" />
        <circle cx={cx} cy={cy} r="112" fill="none" stroke="#c9ccd2" strokeWidth="5" strokeDasharray="2.2 2.2" />
        <circle cx={cx} cy={cy} r="109" fill="#16151a" />

        {/* Piringan hitam */}
        <g className="rave-cassette__reel">
          <circle cx={cx} cy={cy} r="104" fill={`url(#${id('vinyl')})`} />
          {Array.from({ length: 34 }, (_, i) => (
            <circle key={i} cx={cx} cy={cy} r={42 + i * 1.82} fill="none" stroke="#fff" strokeOpacity={i % 9 === 0 ? 0.08 : 0.025} strokeWidth={i % 9 === 0 ? 1.4 : 0.6} />
          ))}
          {/* Label tengah */}
          <circle cx={cx} cy={cy} r="38" fill="#5B2A6E" />
          <circle cx={cx} cy={cy} r="38" fill="none" stroke="#F4C21F" strokeWidth="2.5" />
          <circle cx={cx} cy={cy} r="31" fill="none" stroke="#EDEDED" strokeOpacity="0.25" strokeWidth="0.8" />
          <text x={cx} y={cy - 9} textAnchor="middle" fontFamily="Staatliches, Impact, sans-serif" fontSize="17" letterSpacing="2" fill="#EDEDED">
            RAVE
          </text>
          <text x={cx} y={cy + 21} textAnchor="middle" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="6.5" letterSpacing="1.2" fill="#F4C21F">
            33⅓ RPM · SIDE A
          </text>
          <circle cx={cx} cy={cy} r="3.5" fill="#d9dce1" stroke="#4c4f55" />
        </g>
        <g clipPath={`url(#${id('disc')})`} pointerEvents="none">
          <rect x={cx - 104} y={cy - 104} width="208" height="208" fill={`url(#${id('sheen')})`} />
        </g>

        {/* Tonearm: dudukan, pemberat, lengan krom, headshell */}
        <circle cx="330" cy="72" r="24" fill="#2a2c31" />
        <circle cx="330" cy="72" r="20" fill={`url(#${id('knob')})`} />
        <circle cx="330" cy="72" r="9" fill="#1d1b20" />
        <rect x="320" y="34" width="20" height="26" rx="4" fill="#26282d" transform="rotate(-18 330 72)" />
        <rect x="322" y="36" width="16" height="6" rx="2" fill="#5d6168" transform="rotate(-18 330 72)" />
        <path d="M330 72 L306 178 Q302 194 286 202 L246 212" fill="none" stroke="#2a2c31" strokeWidth="7" strokeLinecap="round" />
        <path d="M330 72 L306 178 Q302 194 286 202 L246 212" fill="none" stroke={`url(#${id('chrome')})`} strokeWidth="5" strokeLinecap="round" />
        <path d="M329 76 L307 174" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" />
        <g transform="rotate(-14 240 214)">
          <rect x="222" y="206" width="30" height="15" rx="2.5" fill="#17151a" />
          <rect x="224" y="208" width="26" height="4" rx="1.5" fill="#5d6168" />
          <rect x="230" y="220" width="8" height="5" rx="1" fill="#F4C21F" />
        </g>
        {/* Bayangan lengan di pelat/piringan */}
        <path d="M336 80 L312 186 Q308 202 292 210 L252 220" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="6" strokeLinecap="round" filter={`url(#${id('soft')})`} />
        {/* Sandaran lengan & tuas cueing */}
        <rect x="318" y="184" width="16" height="10" rx="3" fill="#2a2c31" />
        <rect x="352" y="118" width="6" height="30" rx="3" fill={`url(#${id('chrome')})`} />
        <circle cx="355" cy="116" r="5" fill="#1d1b20" />

        {/* Kenop kecepatan & lampu */}
        <circle cx="56" cy="250" r="13" fill="#26282d" />
        <circle cx="56" cy="250" r="10.5" fill={`url(#${id('knob')})`} />
        <rect x="55" y="241" width="2" height="7" rx="1" fill="#26282d" />
        <text x="76" y="246" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="7" fill="#3a3d43">
          33
        </text>
        <text x="76" y="258" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="7" fill="#6d7178">
          45
        </text>
        <circle cx="356" cy="254" r="3.6" fill="#ff3b2f" />
        <circle cx="356" cy="254" r="7" fill="#ff3b2f" opacity="0.3" filter={`url(#${id('soft')})`} />
        <text x="344" y="257" textAnchor="end" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="6.5" letterSpacing="1.2" fill="#4a4d54">
          POWER
        </text>
        <text x="200" y="268" textAnchor="middle" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="6.5" letterSpacing="2" fill="#4a4d54">
          RAVE · DIRECT DRIVE STEREO TURNTABLE
        </text>
      </g>
    </svg>
  );
}
