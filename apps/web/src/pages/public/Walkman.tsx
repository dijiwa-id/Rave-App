import { useId } from 'react';

/**
 * Pemutar kaset portabel vintage (gaya 80-an, tanpa merek pihak ketiga) — SVG murni untuk kolase landing.
 * Badan aluminium sikat (tekstur serat horizontal), bevel & kilau, pintu kaset berkaca asap dengan kaset RAVE di dalamnya
 * (gulungan pita cokelat + hub), deretan tombol mekanis di atas (huruf oranye), roda volume bergerigi di sisi, jack &
 * kabel headphone spiral, headphone ber-busa oranye di atasnya. Gulungan berputar pelan saat di-hover (lihat
 * `.rave-cassette__reel`; dimatikan oleh prefers-reduced-motion).
 */
export function Walkman({ className }: { className?: string }) {
  const u = useId().replace(/:/g, '');
  const id = (n: string) => `${u}-${n}`;
  const keys = ['REW', 'PLAY', 'FF', 'STOP'];
  return (
    <svg viewBox="0 0 340 480" className={`rave-cassette ${className ?? ''}`} role="img" aria-hidden>
      <defs>
        <linearGradient id={id('alu')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8f939b" />
          <stop offset="0.18" stopColor="#d9dce1" />
          <stop offset="0.45" stopColor="#b4b8bf" />
          <stop offset="0.7" stopColor="#e6e8ec" />
          <stop offset="1" stopColor="#7d8189" />
        </linearGradient>
        <linearGradient id={id('aluV')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.12" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.88" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
        {/* Serat aluminium sikat: noise yang diregangkan horizontal */}
        <filter id={id('brush')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.9" numOctaves="2" seed="3" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.22" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.12" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id={id('shadow')} x="-15%" y="-10%" width="130%" height="125%">
          <feDropShadow dx="0" dy="12" stdDeviation="10" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id={id('soft')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
        <linearGradient id={id('smoke')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b3540" stopOpacity="0.55" />
          <stop offset="1" stopColor="#121014" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id={id('glare')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.28" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.85" stopColor="#fff" stopOpacity="0.08" />
        </linearGradient>
        <radialGradient id={id('tape')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.3" stopColor="#4a2c1c" />
          <stop offset="0.85" stopColor="#2d1a10" />
          <stop offset="1" stopColor="#1c100a" />
        </radialGradient>
        <linearGradient id={id('key')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f3f5" />
          <stop offset="0.55" stopColor="#b9bcc3" />
          <stop offset="1" stopColor="#7c8088" />
        </linearGradient>
        <radialGradient id={id('foam')} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffb25c" />
          <stop offset="0.6" stopColor="#f07d1f" />
          <stop offset="1" stopColor="#b4520c" />
        </radialGradient>
        <filter id={id('foamTex')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="5" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.35" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <linearGradient id={id('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3e5e9" />
          <stop offset="0.5" stopColor="#9a9ea6" />
          <stop offset="1" stopColor="#5d6168" />
        </linearGradient>
        <clipPath id={id('win')}>
          <rect x="58" y="214" width="224" height="132" rx="10" />
        </clipPath>
        <g id={id('hub')}>
          <circle r="11" fill="#ebe7df" stroke="#b9b3a6" strokeWidth="0.8" />
          <circle r="6.2" fill="#17151a" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <rect key={a} x="-1.2" y="-6.4" width="2.4" height="3.2" rx="0.5" fill="#ebe7df" transform={`rotate(${a})`} />
          ))}
        </g>
      </defs>

      {/* Headphone: bando logam + busa oranye */}
      <g filter={`url(#${id('shadow')})`}>
        <path d="M58 150 C58 40 282 40 282 150" fill="none" stroke="#2b2830" strokeWidth="13" strokeLinecap="round" />
        <path d="M58 150 C58 40 282 40 282 150" fill="none" stroke={`url(#${id('band')})`} strokeWidth="8" strokeLinecap="round" />
        <path d="M66 140 C70 58 270 58 274 140" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" />
        {[
          [52, 162],
          [288, 162],
        ].map(([cx, cy], i) => (
          <g key={i}>
            <rect x={cx - 5} y={cy - 34} width="10" height="22" rx="3" fill="#3a3640" />
            <ellipse cx={cx} cy={cy} rx="30" ry="34" fill={`url(#${id('foam')})`} />
            <ellipse cx={cx} cy={cy} rx="30" ry="34" fill="#fff" filter={`url(#${id('foamTex')})`} />
            <ellipse cx={cx} cy={cy} rx="30" ry="34" fill="none" stroke="#7a3606" strokeOpacity="0.6" />
            <ellipse cx={cx - 8} cy={cy - 12} rx="10" ry="7" fill="#fff" opacity="0.18" filter={`url(#${id('soft')})`} />
          </g>
        ))}
      </g>

      {/* Kabel spiral dari headphone kanan ke jack */}
      <path
        d="M288 196 C300 214 312 220 306 238 C300 256 318 262 312 280 C306 298 322 304 316 322 C312 334 300 336 296 348"
        fill="none"
        stroke="#141216"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M288 196 C300 214 312 220 306 238 C300 256 318 262 312 280 C306 298 322 304 316 322 C312 334 300 336 296 348"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.18"
        strokeWidth="1"
      />

      <g filter={`url(#${id('shadow')})`}>
        {/* Tombol mekanis di atas badan */}
        {keys.map((k, i) => {
          const x = 64 + i * 52;
          const pressed = k === 'PLAY';
          return (
            <g key={k}>
              <rect x={x} y={pressed ? 184 : 176} width="42" height="26" rx="3" fill="#4a4d54" />
              <rect x={x} y={pressed ? 182 : 174} width="42" height="24" rx="3" fill={`url(#${id('key')})`} stroke="#5d6067" strokeWidth="0.8" />
              <rect x={x + 2} y={pressed ? 183.5 : 175.5} width="38" height="3" rx="1.5" fill="#fff" opacity="0.55" />
            </g>
          );
        })}

        {/* Badan aluminium */}
        <rect x="34" y="196" width="272" height="262" rx="16" fill="#3b3e44" />
        <rect x="34" y="194" width="272" height="260" rx="16" fill={`url(#${id('alu')})`} />
        <rect x="34" y="194" width="272" height="260" rx="16" fill="#fff" filter={`url(#${id('brush')})`} />
        <rect x="34" y="194" width="272" height="260" rx="16" fill={`url(#${id('aluV')})`} />
        <rect x="35.5" y="195.5" width="269" height="257" rx="14.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.2" />
        <rect x="34" y="194" width="272" height="260" rx="16" fill="none" stroke="#2c2e33" strokeWidth="1.6" />

        {/* Label tombol (oranye) */}
        {keys.map((k, i) => (
          <text key={k} x={85 + i * 52} y="208" textAnchor="middle" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="7" letterSpacing="0.8" fill="#e5671b">
            {k === 'PLAY' ? '▶ PLAY' : k === 'FF' ? '▶▶' : k === 'REW' ? '◀◀' : '■ STOP'}
          </text>
        ))}

        {/* Pintu kaset: bingkai + kaset di dalam + kaca asap */}
        <rect x="52" y="208" width="236" height="144" rx="13" fill="#1d1b20" stroke="#0b0a0c" strokeWidth="1.5" />
        <g clipPath={`url(#${id('win')})`}>
          <rect x="58" y="214" width="224" height="132" fill="#26232a" />
          {/* Label kaset di balik kaca */}
          <rect x="66" y="222" width="208" height="82" rx="5" fill="#ece5d4" />
          <rect x="66" y="222" width="208" height="82" rx="5" fill="#7a6a4a" filter={`url(#${id('grain')})`} />
          <rect x="66" y="222" width="208" height="20" fill="#5B2A6E" />
          <rect x="66" y="242" width="208" height="3" fill="#F4C21F" />
          <text x="76" y="237" fontFamily="Staatliches, Impact, sans-serif" fontSize="15" letterSpacing="1.2" fill="#EDEDED">
            RAVE · MIXTAPE
          </text>
          <text x="266" y="236" textAnchor="end" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="7" fill="#F4C21F">
            C-90
          </text>
          {/* Jendela gulungan */}
          <rect x="104" y="254" width="132" height="40" rx="8" fill="#0d0b0f" />
          <path d="M128 290 L212 290" stroke="#2a1810" strokeWidth="1.6" />
          <g className="rave-cassette__reel">
            <circle cx="128" cy="274" r="19" fill={`url(#${id('tape')})`} />
            {Array.from({ length: 4 }, (_, i) => (
              <circle key={i} cx="128" cy="274" r={12 + i * 2} fill="none" stroke="#7a4a2c" strokeOpacity="0.2" strokeWidth="0.5" />
            ))}
            <use href={`#${id('hub')}`} x="128" y="274" />
          </g>
          <g className="rave-cassette__reel">
            <circle cx="212" cy="274" r="14" fill={`url(#${id('tape')})`} />
            <use href={`#${id('hub')}`} x="212" y="274" />
          </g>
          {/* Bagian bawah kaset (area head) */}
          <path d="M100 346 L110 314 L230 314 L240 346 Z" fill="#141217" />
          <circle cx="132" cy="332" r="5" fill="#050406" />
          <circle cx="208" cy="332" r="5" fill="#050406" />
          {/* Kaca asap + pantulan */}
          <rect x="58" y="214" width="224" height="132" fill={`url(#${id('smoke')})`} />
          <rect x="58" y="214" width="224" height="132" fill={`url(#${id('glare')})`} />
          <path d="M70 344 L132 214" stroke="#fff" strokeOpacity="0.12" strokeWidth="14" />
          <path d="M150 344 L196 214" stroke="#fff" strokeOpacity="0.06" strokeWidth="6" />
        </g>
        <rect x="58" y="214" width="224" height="132" rx="10" fill="none" stroke="#fff" strokeOpacity="0.12" />

        {/* Pelat nama & lampu */}
        <rect x="52" y="366" width="236" height="1.2" fill="#000" opacity="0.25" />
        <text x="60" y="390" fontFamily="Staatliches, Impact, sans-serif" fontSize="22" letterSpacing="2.5" fill="#2a2c31">
          RAVE
        </text>
        <text x="60" y="404" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="7" letterSpacing="1.6" fill="#4a4d54">
          STEREO CASSETTE PLAYER
        </text>
        <rect x="236" y="380" width="52" height="18" rx="3" fill="#2a2c31" />
        <text x="262" y="392.5" textAnchor="middle" fontFamily="'Space Mono', ui-monospace, monospace" fontWeight="700" fontSize="7" letterSpacing="1" fill="#e5671b">
          DOLBY·B
        </text>
        <circle cx="222" cy="389" r="3.6" fill="#ff3b2f" />
        <circle cx="222" cy="389" r="6" fill="#ff3b2f" opacity="0.25" filter={`url(#${id('soft')})`} />
        {/* Kisi speaker kecil */}
        {Array.from({ length: 4 }, (_, r) =>
          Array.from({ length: 16 }, (_, c) => <circle key={`${r}-${c}`} cx={64 + c * 13.5} cy={420 + r * 8} r="1.6" fill="#2a2c31" opacity="0.75" />),
        )}

        {/* Roda volume bergerigi di sisi kanan */}
        <rect x="302" y="232" width="12" height="64" rx="4" fill="#2a2c31" />
        {Array.from({ length: 13 }, (_, i) => (
          <rect key={i} x="303" y={235 + i * 4.6} width="10" height="2.4" rx="1" fill={i % 2 ? '#8b8f97' : '#cfd2d7'} />
        ))}
        <text x="318" y="308" fontFamily="'Space Mono', ui-monospace, monospace" fontSize="6" fill="#d9dce1" transform="rotate(90 318 308)">
          VOL
        </text>
        {/* Jack headphone */}
        <rect x="290" y="340" width="16" height="14" rx="3" fill="#1d1b20" />
        <rect x="292" y="343" width="10" height="8" rx="2" fill="#9a9ea6" />
      </g>
    </svg>
  );
}
