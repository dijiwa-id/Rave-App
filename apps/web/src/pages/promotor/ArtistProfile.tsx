import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Booking, Epk, RateCard } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { Button, Card, cx, Field, Input, Select, Textarea, toast } from '@/components/ui';
import { categoryLabel, categoryLabels, CITIES, formatLabel, formatLabels, QueryState, Table, zoneLabel, useCurrentPromotor } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';
import { EpkView } from '@/components/b2b/EpkView';
import { CAL_STATUS, CalendarLegend, iso, MonthGrid } from '../studio/Calendar';
import { KycBanner } from './Dashboard';

function Availability({ artistId, selected, onPick }: { artistId: string; selected: string; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const from = iso(new Date(month.getFullYear(), month.getMonth() - 1, 20));
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 10));
  const q = useQuery({ queryKey: ['availability', artistId, from, to], queryFn: () => api<{ data: { date: string; status: string }[] }>(`/v1/booking/artists/${artistId}/availability`, { query: { from, to } }) });
  const map = new Map((q.data?.data ?? []).map((d) => [d.date, d.status]));
  const t = useDict('b2b').promotor.artist;
  return (
    <div>
      <div className="mb-2">
        <CalendarLegend keys={['HOLD', 'BUSY']} />
      </div>
      <MonthGrid
        month={month}
        onMonth={setMonth}
        onDayClick={(d) => d >= iso(new Date()) && map.get(d) !== 'BUSY' && onPick(d)}
        cell={(d) => {
          const s = map.get(d);
          return (
            <>
              {s && s !== 'AVAILABLE' && <span className={cx('block rounded-none border px-1 text-[10px] font-bold', CAL_STATUS[s]?.cls)}>{CAL_STATUS[s]?.label ?? s}</span>}
              {d === selected && <span className="block rounded-none bg-b2b-ink px-1 text-[10px] font-bold text-b2b-on-ink">{t.selected}</span>}
            </>
          );
        }}
      />
      <p className="mt-2 text-xs text-b2b-muted">{t.availabilityNote}</p>
    </div>
  );
}

function InquiryForm({ artistId, artistName, date, setDate }: { artistId: string; artistName: string; date: string; setDate: (d: string) => void }) {
  const org = useCurrentPromotor()!;
  const kyc = useAuth((s) => s.user?.kyc_status);
  const nav = useNavigate();
  const [f, setF] = useState({ event_name: '', start_time: '19:00', duration_min: 60, city: 'Bandung', venue: '', capacity: 500, category: 'KAMPUS', format: 'FULL_BAND', budget: 15_000_000, notes: '', hold: true });
  const [busy, setBusy] = useState(false);
  const t = useDict('b2b').promotor.artist;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return toast.error(t.pickDate);
    setBusy(true);
    try {
      const b = await api<Booking>('/v1/booking/inquiries', {
        body: { artist_id: artistId, promotor_org_id: org.id, event_date: date, ...f, capacity: Number(f.capacity), budget: Number(f.budget), notes: f.notes || undefined },
        idempotencyKey: true,
      });
      toast.success(t.inquirySent(artistName));
      nav(`/promotor/bookings/${b.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={t.eventName}>
        <Input required value={f.event_name} onChange={(e) => setF({ ...f, event_name: e.target.value })} placeholder={t.eventNamePlaceholder} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.date}>
          <Input type="date" required min={iso(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t.startTime}>
          <Input type="time" required value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
        </Field>
        <Field label={t.duration}>
          <Input type="number" min={15} step={15} value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) })} />
        </Field>
        <Field label={t.capacity}>
          <Input type="number" min={10} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} />
        </Field>
        <Field label={t.city}>
          <Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
            {CITIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t.venue}>
          <Input required value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />
        </Field>
        <Field label={t.category}>
          <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(categoryLabels()).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.format}>
          <Select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
            {Object.entries(formatLabels()).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t.budget} hint={fmt.idrShort(f.budget)}>
        <Input type="number" min={0} step={500000} value={f.budget} onChange={(e) => setF({ ...f, budget: Number(e.target.value) })} />
      </Field>
      <Field label={t.notes} hint={t.notesHint}>
        <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.hold} onChange={(e) => setF({ ...f, hold: e.target.checked })} /> {t.hold}
      </label>
      <Button variant="ink" type="submit" className="w-full" loading={busy} disabled={kyc !== 'VERIFIED'}>
        {t.sendInquiry}
      </Button>
      {kyc !== 'VERIFIED' && <p className="text-xs text-red-600">{t.kycRequired}</p>}
    </form>
  );
}

export default function ArtistProfile() {
  const { artistId } = useParams();
  const [date, setDate] = useState('');
  const epk = useQuery({ queryKey: ['epk', artistId], queryFn: () => api<Epk>(`/v1/booking/artists/${artistId}/epk`) });
  const rc = useQuery({ queryKey: ['rate-card', artistId], queryFn: () => api<RateCard>(`/v1/booking/artists/${artistId}/rate-card`), retry: false });
  const t = useDict('b2b').promotor.artist;
  return (
    <div>
      <Link to="/promotor/discover" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <ArrowLeft className="size-4" /> {t.back}
      </Link>
      <KycBanner />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <QueryState q={epk}>{epk.data && <EpkView epk={epk.data} />}</QueryState>
          <Card title={t.rateCard}>
            {rc.data?.items.length ? (
              <Table head={[t.head.category, t.head.format, t.head.zone, t.head.duration, t.head.fee, t.head.rider, t.head.coverage]}>
                {rc.data.items.map((i, k) => (
                  <tr key={k}>
                    <td className="px-4 py-2">{categoryLabel(i.category)}</td>
                    <td className="px-4 py-2">{formatLabel(i.format)}</td>
                    <td className="px-4 py-2">{zoneLabel(i.zone)}</td>
                    <td className="px-4 py-2">{t.minutes(i.duration_min)}</td>
                    <td className="px-4 py-2 font-bold tabular-nums">{fmt.idr(i.fee)}</td>
                    <td className="px-4 py-2 tabular-nums">{fmt.idr(i.rider_estimate)}</td>
                    <td className="px-4 py-2 text-xs">
                      {i.accommodation_by_promotor ? t.accommodation : '—'} / {i.transport_by_promotor ? t.transport : '—'} {t.coveredByPromotor}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-sm text-b2b-muted">
                {rc.data?.visibility === 'BY_REQUEST' ? t.byRequest : rc.data?.visibility === 'VERIFIED_PROMOTOR' ? t.verifiedOnly : t.unavailable}
                {rc.data?.from_fee != null && t.fromFee(fmt.idr(rc.data.from_fee))}
              </p>
            )}
          </Card>
        </div>
        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          <Card title={t.availability}>
            <Availability artistId={artistId!} selected={date} onPick={setDate} />
          </Card>
          <Card title={t.sendInquiry}>
            <InquiryForm artistId={artistId!} artistName={epk.data?.artist.name ?? t.artistFallback} date={date} setDate={setDate} />
          </Card>
        </div>
      </div>
    </div>
  );
}
