import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Bookmark, BookmarkCheck, MapPin, Star } from 'lucide-react';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import { api, fmt } from '@/lib/api';
import type { DiscoveryResult } from '@/lib/types';
import { Badge, Button, Field, Input, PageHeader, Select } from '@/components/ui';
import { CATEGORY_LABEL, CITIES, Empty, FORMAT_LABEL, GENRES, Meter, QueryState } from '@/components/b2b/common';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KycBanner } from './Dashboard';

export const useShortlist = create<{ ids: string[]; toggle: (id: string) => void }>()(
  persist((set, get) => ({ ids: [], toggle: (id) => set({ ids: get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id] }) }), { name: 'gema-shortlist' }),
);

export default function Discover() {
  const [f, setF] = useState({ city: 'Bandung', genre: '', budget_max: '', date: '', format: '', category: '' });
  const [applied, setApplied] = useState(f);
  const [onlyShortlist, setOnlyShortlist] = useState(false);
  const short = useShortlist();
  const q = useQuery({
    queryKey: ['discovery', applied],
    queryFn: () => api<{ data: DiscoveryResult[] }>('/v1/booking/discovery', { query: { ...applied, budget_max: applied.budget_max ? Number(applied.budget_max) : undefined } }),
  });
  const rows = (q.data?.data ?? []).filter((r) => !onlyShortlist || short.ids.includes(r.artist.id));
  return (
    <div>
      <PageHeader title="Cari Artis" subtitle="Diurutkan berdasarkan Audience Match: pendengar aktif di kota acara, pertumbuhan, engagement, dan kecocokan genre." />
      <KycBanner />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
        className="mb-6 grid gap-3 rounded-xl border border-b2b-line bg-b2b-card p-4 sm:grid-cols-3 lg:grid-cols-7 lg:items-end"
      >
        <Field label="Kota acara">
          <Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
            <option value="">Semua</option>
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Genre">
          <Select value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })}>
            <option value="">Semua</option>
            {GENRES.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="Budget maks.">
          <Input type="number" step={1000000} placeholder="Rp" value={f.budget_max} onChange={(e) => setF({ ...f, budget_max: e.target.value })} />
        </Field>
        <Field label="Tanggal">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Format">
          <Select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
            <option value="">Semua</option>
            {Object.entries(FORMAT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kategori">
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">Semua</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="ink" type="submit">
          Cari
        </Button>
      </form>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-b2b-muted">{q.data ? `${rows.length} artis` : ''}</span>
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={onlyShortlist} onChange={(e) => setOnlyShortlist(e.target.checked)} /> Shortlist saja ({short.ids.length})
        </label>
      </div>
      <QueryState q={q} empty={q.data && !rows.length ? <Empty title="Tidak ada artis yang cocok" body="Longgarkan filter budget atau tanggal." /> : undefined}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <SpotlightCard key={r.artist.id} className="rounded-2xl! border-b2b-line! bg-b2b-card! p-0!" spotlightColor="rgba(218, 28, 92, 0.14)">
              <div className="p-5">
                <div className="flex items-start gap-4">
                  {r.artist.image_url ? <img src={r.artist.image_url} alt="" loading="lazy" decoding="async" width={64} height={64} className="size-16 rounded-xl object-cover" /> : <div className="size-16 rounded-xl bg-b2b-bg" />}
                  <div className="min-w-0 flex-1">
                    <Link to={`/promotor/artists/${r.artist.id}`} className="flex items-center gap-1 text-lg font-extrabold text-b2b-ink hover:underline">
                      <span className="truncate">{r.artist.name}</span>
                      {r.artist.verified && <BadgeCheck className="size-4 shrink-0 text-sky-500" aria-label="Terverifikasi" />}
                    </Link>
                    <p className="flex items-center gap-1 text-xs text-b2b-muted">
                      <MapPin className="size-3" /> {r.artist.city} · {r.artist.genres.slice(0, 2).join(', ')}
                    </p>
                  </div>
                  <button onClick={() => short.toggle(r.artist.id)} aria-label="Shortlist" aria-pressed={short.ids.includes(r.artist.id)} className="text-b2b-muted hover:text-b2b-ink">
                    {short.ids.includes(r.artist.id) ? <BookmarkCheck className="size-5 text-emerald-600" /> : <Bookmark className="size-5" />}
                  </button>
                </div>
                <div className="mt-4">
                  <Meter value={r.audience_match} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-b2b-bg p-2">
                    <dt className="text-b2b-muted">Mulai</dt>
                    <dd className="font-extrabold text-b2b-ink">{r.from_fee != null ? fmt.idrShort(r.from_fee) : 'Request'}</dd>
                  </div>
                  <div className="rounded-lg bg-b2b-bg p-2">
                    <dt className="text-b2b-muted">Pendengar {applied.city || 'kota'}</dt>
                    <dd className="font-extrabold text-b2b-ink">{r.listeners_in_city != null ? fmt.compact(r.listeners_in_city) : '<50'}</dd>
                  </div>
                  <div className="rounded-lg bg-b2b-bg p-2">
                    <dt className="text-b2b-muted">Rating</dt>
                    <dd className="flex items-center justify-center gap-0.5 font-extrabold text-b2b-ink">
                      {r.avg_rating != null ? (
                        <>
                          <Star className="size-3 fill-amber-400 text-amber-400" />
                          {r.avg_rating.toFixed(1)}
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-b2b-muted">{r.shows_12m} show/12 bln</span>
                  {r.available === false ? <Badge tone="red">Tanggal terisi</Badge> : r.available ? <Badge tone="green">Tersedia</Badge> : null}
                  <Link to={`/promotor/artists/${r.artist.id}`} className="text-sm font-bold underline">
                    Lihat EPK
                  </Link>
                </div>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
