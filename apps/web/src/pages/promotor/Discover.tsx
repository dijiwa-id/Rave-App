import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Bookmark, BookmarkCheck, MapPin, Star } from 'lucide-react';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import { api, fmt } from '@/lib/api';
import type { DiscoveryResult } from '@/lib/types';
import { Badge, Button, Field, Input, PageHeader, Select } from '@/components/ui';
import { categoryLabels, CITIES, Empty, formatLabels, genreName, GENRES, Meter, QueryState } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KycBanner } from './Dashboard';

export const useShortlist = create<{ ids: string[]; toggle: (id: string) => void }>()(
  persist((set, get) => ({ ids: [], toggle: (id) => set({ ids: get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id] }) }), { name: 'rave-shortlist' }),
);

export default function Discover() {
  const [f, setF] = useState({ city: 'Bandung', genre: '', budget_max: '', date: '', format: '', category: '' });
  const [applied, setApplied] = useState(f);
  const [onlyShortlist, setOnlyShortlist] = useState(false);
  const short = useShortlist();
  const t = useDict('b2b').promotor.discover;
  const q = useQuery({
    queryKey: ['discovery', applied],
    queryFn: () => api<{ data: DiscoveryResult[] }>('/v1/booking/discovery', { query: { ...applied, budget_max: applied.budget_max ? Number(applied.budget_max) : undefined } }),
  });
  const rows = (q.data?.data ?? []).filter((r) => !onlyShortlist || short.ids.includes(r.artist.id));
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <KycBanner />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
        className="mb-6 grid gap-3 rounded-none border border-b2b-line bg-b2b-card p-4 sm:grid-cols-3 lg:grid-cols-7 lg:items-end"
      >
        <Field label={t.eventCity}>
          <Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
            <option value="">{t.all}</option>
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t.genre}>
          <Select value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })}>
            <option value="">{t.all}</option>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {genreName(g)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.budgetMax}>
          <Input type="number" step={1000000} placeholder="Rp" value={f.budget_max} onChange={(e) => setF({ ...f, budget_max: e.target.value })} />
        </Field>
        <Field label={t.date}>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label={t.format}>
          <Select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
            <option value="">{t.all}</option>
            {Object.entries(formatLabels()).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.category}>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">{t.all}</option>
            {Object.entries(categoryLabels()).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="ink" type="submit">
          {t.search}
        </Button>
      </form>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-b2b-muted">{q.data ? t.count(rows.length) : ''}</span>
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={onlyShortlist} onChange={(e) => setOnlyShortlist(e.target.checked)} /> {t.shortlistOnly(short.ids.length)}
        </label>
      </div>
      <QueryState q={q} empty={q.data && !rows.length ? <Empty title={t.emptyTitle} body={t.emptyBody} /> : undefined}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <SpotlightCard key={r.artist.id} className="rounded-none! border-b2b-line! bg-b2b-card! p-0!" spotlightColor="rgba(244, 194, 31, 0.16)">
              <div className="p-5">
                <div className="flex items-start gap-4">
                  {r.artist.image_url ? <img src={r.artist.image_url} alt="" loading="lazy" decoding="async" width={64} height={64} className="size-16 rounded-none object-cover" /> : <div className="size-16 rounded-none bg-b2b-bg" />}
                  <div className="min-w-0 flex-1">
                    <Link to={`/promotor/artists/${r.artist.id}`} className="flex items-center gap-1 text-lg font-extrabold text-b2b-ink hover:underline">
                      <span className="truncate">{r.artist.name}</span>
                      {r.artist.verified && <BadgeCheck className="size-4 shrink-0 text-sky-500" aria-label={t.verified} />}
                    </Link>
                    <p className="flex items-center gap-1 text-xs text-b2b-muted">
                      <MapPin className="size-3" /> {r.artist.city} · {r.artist.genres.slice(0, 2).join(', ')}
                    </p>
                  </div>
                  <button onClick={() => short.toggle(r.artist.id)} aria-label={t.shortlist} aria-pressed={short.ids.includes(r.artist.id)} className="text-b2b-muted hover:text-b2b-ink">
                    {short.ids.includes(r.artist.id) ? <BookmarkCheck className="size-5 text-emerald-600" /> : <Bookmark className="size-5" />}
                  </button>
                </div>
                <div className="mt-4">
                  <Meter value={r.audience_match} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-none bg-b2b-bg p-2">
                    <dt className="text-b2b-muted">{t.from}</dt>
                    <dd className="font-extrabold text-b2b-ink">{r.from_fee != null ? fmt.idrShort(r.from_fee) : t.request}</dd>
                  </div>
                  <div className="rounded-none bg-b2b-bg p-2">
                    <dt className="text-b2b-muted">{t.listenersIn(applied.city || t.cityFallback)}</dt>
                    <dd className="font-extrabold text-b2b-ink">{r.listeners_in_city != null ? fmt.compact(r.listeners_in_city) : '<50'}</dd>
                  </div>
                  <div className="rounded-none bg-b2b-bg p-2">
                    <dt className="text-b2b-muted">{t.rating}</dt>
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
                  <span className="text-xs text-b2b-muted">{t.shows(r.shows_12m)}</span>
                  {r.available === false ? <Badge tone="red">{t.dateTaken}</Badge> : r.available ? <Badge tone="green">{t.available}</Badge> : null}
                  <Link to={`/promotor/artists/${r.artist.id}`} className="text-sm font-bold underline">
                    {t.viewEpk}
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
