/** Logo GEMA (mark "G" melingkar + wordmark) sesuai mockup UI UX. */
export function GemaMark({ className = 'size-10', invert = false }: { className?: string; invert?: boolean }) {
  const fg = invert ? '#fff' : '#000';
  const bg = invert ? '#000' : '#fff';
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="32" r="31" fill={bg} />
      <path d="M46 21.5A17 17 0 1 0 49 37H33v-7.5h22" fill="none" stroke={fg} strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GemaLogo({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="GEMA">
      <GemaMark className="size-10" invert={dark} />
      <span className={`text-[28px] leading-none font-semibold tracking-tight ${dark ? 'text-black' : 'text-white'}`}>
        Gema<sup className="ml-0.5 text-[10px] align-super">®</sup>
      </span>
    </span>
  );
}
