import { BadgeCheck, Lock, MapPin, Star } from 'lucide-react';
import { fmt } from '@/lib/api';
import type { Epk } from '@/lib/types';
import { Badge, Card } from '@/components/ui';
import { BarList } from './charts';
import { useDict } from '@/lib/i18n';

/** Kunci metrik EPK; label dibaca dari kamus `b2b.epk.metrics`. */
export const METRICS = ['monthly_listeners', 'growth_90d_pct', 'top_cities', 'age_groups', 'shows_12m', 'avg_rating'] as const;

function youtubeEmbed(url: string) {
  const m = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

/** Tampilan EPK dinamis (REQ-B2B-01, Lampiran B). Data streaming agregat, tanpa data pribadi pendengar. */
export function EpkView({ epk }: { epk: Epk }) {
  const s = epk.stats;
  const rider = (epk.rider ?? {}) as any;
  const d = useDict('b2b').epk;
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-none border border-b2b-line bg-b2b-card">
        <div className="flex flex-wrap items-center gap-5 bg-gradient-to-r from-[#1c1917] to-[#44403c] p-6 text-white">
          {epk.artist.image_url ? <img src={epk.artist.image_url} alt="" className="size-28 rounded-none object-cover ring-4 ring-white/20" /> : <div className="size-28 rounded-none bg-b2b-card/10" />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-[0.2em] text-white/60 uppercase">Electronic Press Kit</p>
            <h2 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
              {epk.artist.name}
              {epk.artist.verified && <BadgeCheck className="size-6 text-sky-300" aria-label={d.verified} />}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/75">
              <MapPin className="size-4" /> {epk.artist.city ?? '—'} · {epk.artist.genres.join(', ')}
            </p>
            {epk.bio_short && <p className="mt-2 max-w-2xl text-sm text-white/90">{epk.bio_short}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-white/60">{d.rateFrom}</p>
            <p className="text-2xl font-extrabold">{epk.rate_card.from_fee != null ? fmt.idrShort(epk.rate_card.from_fee) : d.byRequest}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-b2b-line border-t border-b2b-line sm:grid-cols-4 sm:divide-y-0">
          {[
            [d.monthlyListeners, fmt.compact(s.monthly_listeners)],
            [d.growth90, s.growth_90d_pct != null ? `${s.growth_90d_pct > 0 ? '+' : ''}${Math.round(s.growth_90d_pct)}%` : '—'],
            [d.shows12, fmt.num(s.shows_12m)],
            [d.promotorRating, s.avg_rating != null ? `${s.avg_rating.toFixed(1)} / 5` : d.none],
          ].map(([k, v]) => (
            <div key={k} className="p-4">
              <p className="text-xs font-semibold text-b2b-muted uppercase">{k}</p>
              <p className="mt-0.5 text-xl font-extrabold">{v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={d.topCities}>
          {s.top_cities?.length ? <BarList data={s.top_cities.map((c) => ({ label: c.city, value: c.listeners }))} unit={d.listenersUnit} /> : <Hidden />}
        </Card>
        <Card title={d.ageDemo}>
          {s.age_groups?.length ? <BarList data={s.age_groups.map((g) => ({ label: g.group, value: g.pct }))} format={(n) => `${Math.round(n <= 1 ? n * 100 : n)}%`} /> : <Hidden />}
        </Card>
      </div>

      {epk.bio_long && (
        <Card title={d.bio}>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{epk.bio_long}</p>
        </Card>
      )}

      {epk.press_photos?.length > 0 && (
        <Card title={d.pressPhotos}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {epk.press_photos.map((p) => (
              <a key={p} href={p} target="_blank" rel="noreferrer">
                <img src={p} alt={d.pressPhotoAlt} loading="lazy" decoding="async" className="aspect-square w-full rounded-none object-cover" />
              </a>
            ))}
          </div>
        </Card>
      )}

      {epk.videos?.length > 0 && (
        <Card title={d.liveVideos}>
          <div className="grid gap-3 sm:grid-cols-2">
            {epk.videos.map((v) => {
              const e = youtubeEmbed(v);
              return e ? (
                <iframe key={v} src={e} title={d.liveVideos} className="aspect-video w-full rounded-none" allowFullScreen loading="lazy" />
              ) : (
                <a key={v} href={v} target="_blank" rel="noreferrer" className="text-sm underline">
                  {v}
                </a>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {(epk.press_quotes?.length > 0 || epk.achievements?.length > 0) && (
          <Card title={d.pressAchievements}>
            <div className="space-y-3">
              {epk.press_quotes?.map((q, i) => (
                <blockquote key={i} className="border-l-4 border-b2b-ink pl-3 text-sm italic">
                  “{q.quote}” <span className="not-italic text-b2b-muted">— {q.source}</span>
                </blockquote>
              ))}
              {epk.achievements?.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {epk.achievements.map((a) => (
                    <li key={a} className="flex gap-2">
                      <Star className="mt-0.5 size-4 shrink-0 text-amber-500" /> {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
        {epk.members?.length > 0 && (
          <Card title={d.members}>
            <ul className="space-y-1 text-sm">
              {epk.members.map((m) => (
                <li key={m.name} className="flex justify-between">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-b2b-muted">{m.role}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {Object.keys(rider).length > 0 && (
        <Card title={d.riderTitle}>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {rider.personnel && (
              <RiderBlock title={d.crew}>
                {d.crewLine(rider.personnel.performers, rider.personnel.crew, rider.personnel.total_travel)}
              </RiderBlock>
            )}
            {rider.stage && (
              <RiderBlock title={d.stage}>
                {d.stageMin(rider.stage.min_width_m, rider.stage.min_depth_m)}{rider.stage.riser?.length ? ` · riser: ${rider.stage.riser.join(', ')}` : ''}
              </RiderBlock>
            )}
            {rider.pa_system && (
              <RiderBlock title={d.pa}>
                min {rider.pa_system.min_spl_db} dB SPL · FOH {rider.pa_system.foh_console?.join(' / ')}
              </RiderBlock>
            )}
            {rider.monitors && (
              <RiderBlock title={d.monitor}>
                {d.monitorLine(rider.monitors.wedges, rider.monitors.iem_channels)}
              </RiderBlock>
            )}
            {rider.soundcheck_minutes && <RiderBlock title={d.soundcheck}>{d.soundcheckMin(rider.soundcheck_minutes)}</RiderBlock>}
            {rider.hospitality && (
              <RiderBlock title={d.hospitality}>
                {rider.hospitality.green_room ? 'Green room · ' : ''}
                {d.hospitalityLine(rider.hospitality.meals, rider.hospitality.hotel_rooms)} · {rider.hospitality.transport}
              </RiderBlock>
            )}
          </div>
          {rider.backline?.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-bold text-b2b-muted uppercase">Backline</p>
              <ul className="text-sm">
                {rider.backline.map((b: any, i: number) => (
                  <li key={i}>
                    {b.item} — <span className="text-b2b-muted">{b.spec}</span> {b.substitutable && <Badge>{d.substitutable}</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rider.input_list?.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-bold text-b2b-muted uppercase">Input list</p>
              <div className="grid grid-cols-[40px_1fr_1fr] gap-x-3 text-sm">
                {rider.input_list.map((r: any) => (
                  <div key={r.ch} className="contents">
                    <span className="text-b2b-muted">{r.ch}</span>
                    <span>{r.source}</span>
                    <span className="text-b2b-muted">{r.mic}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title={d.mgmtContact}>
        <p className="text-sm font-semibold">{epk.contact.name}</p>
        <p className="text-sm text-b2b-muted">
          {epk.contact.email} · {epk.contact.phone}
        </p>
        {(epk.contact.email ?? '').includes('*') && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-b2b-muted">
            <Lock className="size-3.5" /> {d.contactLocked}
          </p>
        )}
      </Card>
      <p className="text-xs text-b2b-muted">{d.updated(fmt.dateTime(epk.updated_at))}</p>
    </div>
  );
}

function RiderBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-none bg-b2b-bg p-3">
      <p className="text-xs font-bold text-b2b-muted uppercase">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function Hidden() {
  const d = useDict('b2b').epk;
  return (
    <p className="flex items-center gap-2 text-sm text-b2b-muted">
      <Lock className="size-4" /> {d.verifiedOnly}
    </p>
  );
}
