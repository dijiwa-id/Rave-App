import type { ReactNode } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BOOKING_STATUS_LABEL, type BookingStatus } from '@gema/domain/booking';
import { artistOrgs, promotorOrgs, useAuth } from '@/stores/auth';
import type { OrgClaim } from '@/lib/types';
import { Badge, cx, ErrorState, Spinner } from '@/components/ui';

// ---------- Konteks org aktif (Studio: artis, Promotor: org promotor) ----------
export const useB2BContext = create<{ artistOrgId: string | null; promotorOrgId: string | null; set: (p: Partial<{ artistOrgId: string; promotorOrgId: string }>) => void }>()(
  persist((set) => ({ artistOrgId: null, promotorOrgId: null, set: (p) => set(p) }), { name: 'gema-b2b-context' }),
);

/** Artis yang sedang dikelola di Artist Studio (org dengan artist_id). */
export function useCurrentArtist(): OrgClaim | null {
  const user = useAuth((s) => s.user);
  const id = useB2BContext((s) => s.artistOrgId);
  const orgs = artistOrgs(user);
  return orgs.find((o) => o.id === id) ?? orgs[0] ?? null;
}

export function useCurrentPromotor(): OrgClaim | null {
  const user = useAuth((s) => s.user);
  const id = useB2BContext((s) => s.promotorOrgId);
  const orgs = promotorOrgs(user);
  return orgs.find((o) => o.id === id) ?? orgs[0] ?? null;
}

export function OrgSwitcher({ orgs, value, onChange, label }: { orgs: OrgClaim[]; value: string | undefined; onChange: (id: string) => void; label: string }) {
  if (!orgs.length) return null;
  return (
    <label className="block">
      <span className="mb-1 block px-1 text-[11px] font-bold tracking-wide text-b2b-muted uppercase">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-b2b-line bg-b2b-bg px-3 py-2 text-sm font-bold text-b2b-ink">
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------- Status booking ----------
const TONE: Partial<Record<BookingStatus, 'neutral' | 'green' | 'blue' | 'amber' | 'red' | 'purple'>> = {
  INQUIRY: 'blue',
  NEGOTIATING: 'amber',
  AGREED: 'purple',
  CONTRACT_SENT: 'purple',
  SIGNED: 'purple',
  BOOKED: 'green',
  BOOKED_AND_SECURED: 'green',
  AT_RISK: 'red',
  SHOW_DAY: 'green',
  COMPLETED: 'green',
  SETTLED: 'green',
  DECLINED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED_BY_PROMOTOR: 'red',
  CANCELLED_BY_ARTIST: 'red',
  FORCE_MAJEURE: 'amber',
  DISPUTED: 'red',
};
export function BookingStatusBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status as BookingStatus] ?? 'neutral'}>{BOOKING_STATUS_LABEL[status as BookingStatus] ?? status}</Badge>;
}

export const CATEGORY_LABEL: Record<string, string> = {
  KAMPUS: 'Kampus',
  PENSI: 'Pensi Sekolah',
  FESTIVAL: 'Festival',
  KORPORAT: 'Korporat',
  WEDDING: 'Wedding/Private',
  CAFE_CLUB: 'Café/Club',
  SHOWCASE: 'Showcase',
};
export const FORMAT_LABEL: Record<string, string> = { FULL_BAND: 'Full Band', AKUSTIK: 'Akustik', DJ_SOLO: 'DJ/Solo' };
export const ZONE_LABEL: Record<string, string> = { DALAM_KOTA: 'Dalam kota', JAWA: 'Jawa', LUAR_JAWA: 'Luar Jawa', LUAR_NEGERI: 'Luar negeri' };
export const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo'];
export const GENRES = ['indie-pop', 'folk', 'akustik', 'rock', 'post-punk', 'indie-rock', 'r-n-b', 'soul', 'shoegaze', 'dream-pop', 'hip-hop', 'pop', 'electronic', 'jazz'];

// ---------- Query wrapper ----------
export function QueryState({ q, children, empty }: { q: { isLoading: boolean; error: unknown; data?: unknown; refetch: () => unknown }; children: ReactNode; empty?: ReactNode }) {
  if (q.isLoading)
    return (
      <div className="grid place-items-center py-12">
        <Spinner />
      </div>
    );
  // Refetch latar belakang yang gagal (polling) tetap menyimpan data lama — tampilkan data itu, bukan galat.
  if (q.error && q.data === undefined) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  return <>{empty ?? children}</>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-xl border border-b2b-line bg-b2b-card', className)}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-b2b-line bg-b2b-bg/60 text-xs font-bold tracking-wide text-b2b-muted uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-b2b-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-b2b-line bg-b2b-card px-6 py-12 text-center">
      <p className="font-bold text-b2b-ink">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-b2b-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Meter Audience Match 0–100. */
export function Meter({ value, label }: { value: number; label?: string }) {
  const tone = value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-stone-400';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-b2b-muted">{label ?? 'Audience Match'}</span>
        <span className="text-base font-extrabold text-b2b-ink">{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-b2b-bg" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Audience Match'}>
        <div className={cx('h-2 rounded-full', tone)} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
    </div>
  );
}

/** Render markdown sederhana (judul, tebal, daftar, paragraf) untuk kontrak — tanpa innerHTML. */
export function SimpleMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
  return (
    <div className="space-y-3 text-sm leading-relaxed text-b2b-ink">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (/^#{1,3} /.test(b)) {
          const level = b.match(/^#+/)![0].length;
          const content = lines[0].replace(/^#+ /, '');
          const rest = lines.slice(1).join('\n');
          return (
            <div key={i}>
              <p className={cx('font-extrabold', level === 1 ? 'text-lg' : 'text-base')}>{content}</p>
              {rest && <p className="mt-1 whitespace-pre-wrap">{inline(rest)}</p>}
            </div>
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.) /.test(l)))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.) /, ''))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b)}
          </p>
        );
      })}
    </div>
  );
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
