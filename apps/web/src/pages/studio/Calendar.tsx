import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { CalendarSlot } from '@/lib/types';
import { Button, Card, cx, Field, Input, Modal, PageHeader, Select, toast } from '@/components/ui';
import { useCurrentArtist } from '@/components/b2b/common';
import { localeTag, useDict } from '@/lib/i18n';

// Warna status kalender (status = identitas kategorikal → label teks selalu menyertai).
export const CAL_STATUS: Record<string, { label: string; cls: string }> = {
  AVAILABLE: { label: 'Available', cls: 'bg-b2b-card text-b2b-muted border-b2b-line' },
  HOLD_1: { label: 'Hold 1st', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  HOLD_2: { label: 'Hold 2nd', cls: 'bg-amber-50 text-amber-800 border-amber-200 border-dashed' },
  HOLD: { label: 'Hold', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  PENDING_CONTRACT: { label: 'Pending Contract', cls: 'bg-violet-100 text-violet-900 border-violet-300' },
  BOOKED: { label: 'Booked', cls: 'bg-sky-100 text-sky-900 border-sky-300' },
  BOOKED_AND_SECURED: { label: 'Booked & Secured', cls: 'bg-emerald-100 text-emerald-900 border-emerald-400' },
  BLOCKED: { label: 'Blocked', cls: 'bg-stone-200 text-stone-700 border-stone-300' },
  TRAVEL: { label: 'Travel', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  BUSY: { label: 'Busy', cls: 'bg-stone-200 text-stone-700 border-stone-300' },
};

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Grid bulan (Senin-awal). `cell(dateIso)` mengembalikan konten tambahan untuk tanggal tsb. */
export function MonthGrid({ month, onMonth, cell, onDayClick }: { month: Date; onMonth: (d: Date) => void; cell: (date: string) => React.ReactNode; onDayClick?: (date: string) => void }) {
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);
  const today = iso(new Date());
  const t = useDict('b2b').studio.calendar;
  return (
    <div className="rounded-none border border-b2b-line bg-b2b-card">
      <div className="flex items-center justify-between border-b border-b2b-line px-4 py-3">
        <button aria-label={t.prevMonth} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-none p-1.5 hover:bg-b2b-bg">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-extrabold">{month.toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' })}</p>
        <button aria-label={t.nextMonth} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-none p-1.5 hover:bg-b2b-bg">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-b border-b2b-line text-center text-xs font-bold text-b2b-muted">
        {t.weekdays.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = iso(d);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={k}
              role={onDayClick ? 'button' : undefined}
              tabIndex={onDayClick ? 0 : undefined}
              onClick={() => onDayClick?.(k)}
              onKeyDown={(e) => e.key === 'Enter' && onDayClick?.(k)}
              className={cx('min-h-24 border-r border-b border-b2b-line p-1.5 text-left last:border-r-0 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-b2b-bg/50 opacity-50', onDayClick && 'cursor-pointer hover:bg-b2b-bg/70')}
            >
              <span className={cx('inline-grid size-6 place-items-center rounded-full text-xs font-bold', k === today && 'bg-b2b-ink text-b2b-on-ink')}>{d.getDate()}</span>
              <div className="mt-1 space-y-1">{cell(k)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarLegend({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((k) => (
        <span key={k} className={cx('rounded-none border px-2 py-0.5 text-[11px] font-bold', CAL_STATUS[k].cls)}>
          {CAL_STATUS[k].label}
        </span>
      ))}
    </div>
  );
}

export default function CalendarPage() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const from = iso(new Date(month.getFullYear(), month.getMonth() - 1, 20));
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 10));
  const q = useQuery({ queryKey: ['calendar', aid, from, to], queryFn: () => api<{ data: CalendarSlot[] }>(`/v1/booking/artists/${aid}/calendar`, { query: { from, to } }) });
  const [block, setBlock] = useState<null | { start_date: string; end_date: string; status: 'BLOCKED' | 'TRAVEL'; note: string }>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CalendarSlot | null>(null);
  const t = useDict('b2b').studio.calendar;

  const slotsOn = (d: string) => (q.data?.data ?? []).filter((s) => s.start_date <= d && s.end_date >= d);

  async function save() {
    setBusy(true);
    try {
      await api(`/v1/booking/artists/${aid}/calendar/blocks`, { body: { ...block, note: block!.note || undefined } });
      toast.success(t.blocked);
      setBlock(null);
      qc.invalidateQueries({ queryKey: ['calendar', aid] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast.error(t.conflict);
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/v1/booking/calendar/${id}`, { method: 'DELETE' });
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['calendar', aid] });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button variant="ink" onClick={() => setBlock({ start_date: iso(new Date()), end_date: iso(new Date()), status: 'BLOCKED', note: '' })}>
            {t.blockDate}
          </Button>
        }
      />
      <div className="mb-4">
        <CalendarLegend keys={['HOLD_1', 'HOLD_2', 'PENDING_CONTRACT', 'BOOKED', 'BOOKED_AND_SECURED', 'BLOCKED', 'TRAVEL']} />
      </div>
      {q.error ? <Card><p className="text-sm text-red-600">{t.loadFailed((q.error as Error).message)}</p></Card> : null}
      <MonthGrid
        month={month}
        onMonth={setMonth}
        onDayClick={(d) => !slotsOn(d).length && setBlock({ start_date: d, end_date: d, status: 'BLOCKED', note: '' })}
        cell={(d) =>
          slotsOn(d).map((s) => (
            <button
              key={s.id}
              onClick={(e) => {
                e.stopPropagation();
                if (s.booking_id) nav(`/studio/bookings/${s.booking_id}`);
                else setSelected(s);
              }}
              className={cx('block w-full truncate rounded-none border px-1.5 py-0.5 text-left text-[10px] font-bold', (CAL_STATUS[s.status] ?? CAL_STATUS.BLOCKED).cls)}
              title={`${CAL_STATUS[s.status]?.label ?? s.status}${s.note ? ' — ' + s.note : ''}`}
            >
              {CAL_STATUS[s.status]?.label ?? s.status}
              {s.note ? ` · ${s.note}` : ''}
            </button>
          ))
        }
      />
      <p className="mt-3 text-xs text-b2b-muted">{t.syncNote}</p>

      <Modal open={!!block} onClose={() => setBlock(null)} title={t.blockDate}>
        {block && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.from}>
                <Input type="date" value={block.start_date} onChange={(e) => setBlock({ ...block, start_date: e.target.value, end_date: e.target.value > block.end_date ? e.target.value : block.end_date })} />
              </Field>
              <Field label={t.to}>
                <Input type="date" min={block.start_date} value={block.end_date} onChange={(e) => setBlock({ ...block, end_date: e.target.value })} />
              </Field>
            </div>
            <Field label={t.kind}>
              <Select value={block.status} onChange={(e) => setBlock({ ...block, status: e.target.value as 'BLOCKED' | 'TRAVEL' })}>
                <option value="BLOCKED">{t.blockedOption}</option>
                <option value="TRAVEL">{t.travelOption}</option>
              </Select>
            </Field>
            <Field label={t.note} hint={t.private}>
              <Input value={block.note} onChange={(e) => setBlock({ ...block, note: e.target.value })} />
            </Field>
            <Button variant="ink" loading={busy} onClick={save}>
              {t.save}
            </Button>
          </div>
        )}
      </Modal>
      <Modal open={!!selected} onClose={() => setSelected(null)} title={CAL_STATUS[selected?.status ?? '']?.label ?? t.slot}>
        {selected && (
          <div className="space-y-3 text-sm">
            <p>
              {fmt.date(selected.start_date)} – {fmt.date(selected.end_date)}
            </p>
            {selected.note && <p className="text-b2b-muted">{selected.note}</p>}
            {['BLOCKED', 'TRAVEL'].includes(selected.status) && (
              <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={() => remove(selected.id)}>
                {t.removeBlock}
              </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
