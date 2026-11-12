// Ikon merek (lucide-react v1 tidak lagi menyertakan logo merek).
type P = { className?: string };

export const Facebook = ({ className = 'size-5' }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />
  </svg>
);
export const Instagram = ({ className = 'size-5' }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);
export const AppleLogo = ({ className = 'size-5' }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M16.37 12.75c-.02-2.23 1.82-3.3 1.9-3.35-1.04-1.52-2.65-1.72-3.22-1.75-1.37-.14-2.68.81-3.37.81-.7 0-1.77-.79-2.9-.77-1.49.02-2.87.87-3.64 2.2-1.55 2.69-.4 6.67 1.11 8.85.74 1.07 1.62 2.27 2.77 2.22 1.11-.04 1.53-.72 2.88-.72 1.34 0 1.72.72 2.9.7 1.2-.02 1.96-1.09 2.69-2.16.85-1.24 1.2-2.44 1.22-2.5-.03-.01-2.33-.9-2.34-3.53zM14.15 6.2c.61-.74 1.03-1.77.91-2.8-.88.04-1.95.59-2.58 1.33-.57.65-1.07 1.7-.93 2.71.98.08 1.99-.5 2.6-1.24z" />
  </svg>
);

/** Ikon Google Play (segitiga empat warna disederhanakan, satu warna untuk gaya sablon). */
export const GooglePlay = ({ className = 'size-5' }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M3.6 2.2c-.3.3-.5.8-.5 1.4v16.8c0 .6.2 1.1.5 1.4l.1.1 9.4-9.4v-.2L3.7 2.1l-.1.1z" />
    <path d="m16.2 15.6-3.1-3.1v-.2l3.1-3.1.1.1 3.7 2.1c1.1.6 1.1 1.6 0 2.2l-3.7 2.1-.1-.1z" opacity=".78" />
    <path d="M16.3 15.5 13.1 12.4 3.6 21.8c.4.4.9.4 1.6.1l11.1-6.4" opacity=".6" />
    <path d="M16.3 9.3 5.2 2.9c-.7-.4-1.2-.3-1.6.1l9.5 9.4 3.2-3.1z" opacity=".9" />
  </svg>
);
