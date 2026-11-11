import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Epk, EpkContent } from '@/lib/types';
import { Button, Card, cx, Field, Input, Modal, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { QueryState, useCurrentArtist } from '@/components/b2b/common';
import { EpkView, METRICS } from '@/components/b2b/EpkView';
import { useDict } from '@/lib/i18n';

const DEFAULT_RIDER = {
  personnel: { performers: 4, crew: 2, total_travel: 6 },
  stage: { min_width_m: 6, min_depth_m: 4, riser: [] as string[] },
  pa_system: { min_spl_db: 100, foh_console: ['Yamaha CL5', 'setara'] },
  monitors: { wedges: 4, iem_channels: 0 },
  backline: [] as { item: string; spec: string; substitutable: boolean }[],
  input_list: [] as { ch: number; source: string; mic: string }[],
  soundcheck_minutes: 45,
  hospitality: { green_room: true, meals: 6, hotel_rooms: 0, transport: '' },
};

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const t = useDict('b2b').studio.epkEditor;
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input value={v} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button aria-label={t.remove} onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-b2b-muted hover:text-red-600">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <Plus className="size-4" /> {t.add}
      </button>
    </div>
  );
}

const num = (v: string) => (v === '' ? 0 : Number(v));

export default function EpkEditor() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['epk', aid], queryFn: () => api<Epk>(`/v1/booking/artists/${aid}/epk`) });
  const [f, setF] = useState<EpkContent | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [share, setShare] = useState<{ open: boolean; days: number; url?: string; expires_at?: string }>({ open: false, days: 14 });
  const d = useDict('b2b');
  const t = d.studio.epkEditor;

  useEffect(() => {
    if (q.data && !f)
      setF({
        bio_short: q.data.bio_short ?? '',
        bio_long: q.data.bio_long ?? '',
        press_photos: q.data.press_photos ?? [],
        videos: q.data.videos ?? [],
        press_quotes: q.data.press_quotes ?? [],
        achievements: q.data.achievements ?? [],
        members: q.data.members ?? [],
        public_metrics: q.data.public_metrics ?? ['monthly_listeners', 'top_cities'],
        rider: { ...DEFAULT_RIDER, ...(q.data.rider ?? {}) },
      });
  }, [q.data, f]);

  async function save() {
    setSaving(true);
    try {
      const saved = await api<Epk>(`/v1/booking/artists/${aid}/epk`, { method: 'PUT', body: f });
      qc.setQueryData(['epk', aid], saved);
      toast.success(t.saved);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }
  async function makeLink() {
    try {
      const r = await api<{ url: string; token: string; expires_at: string }>(`/v1/booking/artists/${aid}/epk/share`, { body: { expires_in_days: share.days } });
      const url = r.url.startsWith('http') ? r.url : `${location.origin}${r.url}`;
      setShare({ ...share, url, expires_at: r.expires_at });
    } catch (e) {
      toast.error(e);
    }
  }

  const rider = (f?.rider ?? DEFAULT_RIDER) as typeof DEFAULT_RIDER;
  const setRider = (r: Partial<typeof DEFAULT_RIDER>) => setF({ ...f!, rider: { ...rider, ...r } });

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <div className="flex rounded-none border border-b2b-line bg-b2b-card p-0.5">
              {(['edit', 'preview'] as const).map((m) => (
                <button key={m} onClick={() => setTab(m)} className={cx('flex items-center gap-1 rounded-none px-3 py-1.5 text-xs font-bold', tab === m ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted')}>
                  {m === 'edit' ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />} {m === 'edit' ? t.edit : t.preview}
                </button>
              ))}
            </div>
            <Button variant="outline-ink" size="sm" icon={<Link2 className="size-4" />} onClick={() => setShare({ ...share, open: true, url: undefined })}>
              {t.privateLink}
            </Button>
            <Button variant="ink" size="sm" loading={saving} onClick={save} disabled={!f}>
              {t.save}
            </Button>
          </>
        }
      />
      <QueryState q={q}>
        {tab === 'preview' && q.data && f ? (
          <EpkView epk={{ ...q.data, ...f }} />
        ) : (
          f && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title={t.bio}>
                <div className="space-y-3">
                  <Field label={t.bioShort} hint={t.bioShortHint}>
                    <Textarea maxLength={280} value={f.bio_short} onChange={(e) => setF({ ...f, bio_short: e.target.value })} />
                  </Field>
                  <Field label={t.bioLong}>
                    <Textarea className="min-h-40" value={f.bio_long} onChange={(e) => setF({ ...f, bio_long: e.target.value })} />
                  </Field>
                </div>
              </Card>
              <Card title={t.publicMetrics}>
                <p className="mb-3 text-sm text-b2b-muted">{t.publicMetricsNote}</p>
                <div className="space-y-2">
                  {METRICS.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={f.public_metrics.includes(k)}
                        onChange={(e) => setF({ ...f, public_metrics: e.target.checked ? [...f.public_metrics, k] : f.public_metrics.filter((x) => x !== k) })}
                      />
                      {d.epk.metrics[k]}
                    </label>
                  ))}
                </div>
              </Card>
              <Card title={t.pressPhotos}>
                <ListEditor items={f.press_photos} onChange={(v) => setF({ ...f, press_photos: v })} placeholder="https://…/foto.jpg" />
              </Card>
              <Card title={t.liveVideos}>
                <ListEditor items={f.videos} onChange={(v) => setF({ ...f, videos: v })} placeholder="https://youtu.be/…" />
              </Card>
              <Card title={t.pressQuote}>
                <div className="space-y-2">
                  {f.press_quotes.map((q, i) => (
                    <div key={i} className="grid grid-cols-[1fr_140px_24px] gap-2">
                      <Input value={q.quote} placeholder={t.quote} onChange={(e) => setF({ ...f, press_quotes: f.press_quotes.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)) })} />
                      <Input value={q.source} placeholder={t.media} onChange={(e) => setF({ ...f, press_quotes: f.press_quotes.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)) })} />
                      <button aria-label={t.remove} onClick={() => setF({ ...f, press_quotes: f.press_quotes.filter((_, j) => j !== i) })} className="text-b2b-muted hover:text-red-600">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setF({ ...f, press_quotes: [...f.press_quotes, { quote: '', source: '' }] })} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                    <Plus className="size-4" /> {t.add}
                  </button>
                </div>
              </Card>
              <Card title={t.achievements}>
                <ListEditor items={f.achievements} onChange={(v) => setF({ ...f, achievements: v })} placeholder={t.achievementPlaceholder} />
              </Card>
              <Card title={t.members}>
                <div className="space-y-2">
                  {f.members.map((m, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_24px] gap-2">
                      <Input value={m.name} placeholder={t.name} onChange={(e) => setF({ ...f, members: f.members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                      <Input value={m.role} placeholder={t.rolePlaceholder} onChange={(e) => setF({ ...f, members: f.members.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} />
                      <button aria-label={t.remove} onClick={() => setF({ ...f, members: f.members.filter((_, j) => j !== i) })} className="text-b2b-muted hover:text-red-600">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setF({ ...f, members: [...f.members, { name: '', role: '' }] })} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                    <Plus className="size-4" /> {t.add}
                  </button>
                </div>
              </Card>
              <Card title={t.rider} className="lg:col-span-2">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Field label={t.performers}>
                    <Input type="number" value={rider.personnel.performers} onChange={(e) => setRider({ personnel: { ...rider.personnel, performers: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.crew}>
                    <Input type="number" value={rider.personnel.crew} onChange={(e) => setRider({ personnel: { ...rider.personnel, crew: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.totalTravel}>
                    <Input type="number" value={rider.personnel.total_travel} onChange={(e) => setRider({ personnel: { ...rider.personnel, total_travel: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.stageWidth}>
                    <Input type="number" value={rider.stage.min_width_m} onChange={(e) => setRider({ stage: { ...rider.stage, min_width_m: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.stageDepth}>
                    <Input type="number" value={rider.stage.min_depth_m} onChange={(e) => setRider({ stage: { ...rider.stage, min_depth_m: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.minSpl}>
                    <Input type="number" value={rider.pa_system.min_spl_db} onChange={(e) => setRider({ pa_system: { ...rider.pa_system, min_spl_db: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.wedges}>
                    <Input type="number" value={rider.monitors.wedges} onChange={(e) => setRider({ monitors: { ...rider.monitors, wedges: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.iem}>
                    <Input type="number" value={rider.monitors.iem_channels} onChange={(e) => setRider({ monitors: { ...rider.monitors, iem_channels: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.soundcheck}>
                    <Input type="number" value={rider.soundcheck_minutes} onChange={(e) => setRider({ soundcheck_minutes: num(e.target.value) })} />
                  </Field>
                  <Field label={t.meals}>
                    <Input type="number" value={rider.hospitality.meals} onChange={(e) => setRider({ hospitality: { ...rider.hospitality, meals: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.hotelRooms}>
                    <Input type="number" value={rider.hospitality.hotel_rooms} onChange={(e) => setRider({ hospitality: { ...rider.hospitality, hotel_rooms: num(e.target.value) } })} />
                  </Field>
                  <Field label={t.transport}>
                    <Input value={rider.hospitality.transport} onChange={(e) => setRider({ hospitality: { ...rider.hospitality, transport: e.target.value } })} />
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label={t.foh}>
                    <Input value={rider.pa_system.foh_console.join(', ')} onChange={(e) => setRider({ pa_system: { ...rider.pa_system, foh_console: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-3 text-sm">
                    <input type="checkbox" checked={rider.hospitality.green_room} onChange={(e) => setRider({ hospitality: { ...rider.hospitality, green_room: e.target.checked } })} /> {t.greenRoom}
                  </label>
                </div>
                <div className="mt-4 grid gap-6 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-bold">{t.backline}</p>
                    {rider.backline.map((b, i) => (
                      <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto_24px] items-center gap-2">
                        <Input value={b.item} placeholder={t.item} onChange={(e) => setRider({ backline: rider.backline.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })} />
                        <Input value={b.spec} placeholder={t.spec} onChange={(e) => setRider({ backline: rider.backline.map((x, j) => (j === i ? { ...x, spec: e.target.value } : x)) })} />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={b.substitutable} onChange={(e) => setRider({ backline: rider.backline.map((x, j) => (j === i ? { ...x, substitutable: e.target.checked } : x)) })} /> {t.subst}
                        </label>
                        <button aria-label={t.remove} onClick={() => setRider({ backline: rider.backline.filter((_, j) => j !== i) })} className="text-b2b-muted hover:text-red-600">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setRider({ backline: [...rider.backline, { item: '', spec: '', substitutable: true }] })} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                      <Plus className="size-4" /> {t.addBackline}
                    </button>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-bold">{t.inputList}</p>
                    {rider.input_list.map((r, i) => (
                      <div key={i} className="mb-2 grid grid-cols-[48px_1fr_1fr_24px] gap-2">
                        <Input value={r.ch} type="number" aria-label={t.channel} onChange={(e) => setRider({ input_list: rider.input_list.map((x, j) => (j === i ? { ...x, ch: num(e.target.value) } : x)) })} />
                        <Input value={r.source} placeholder={t.source} onChange={(e) => setRider({ input_list: rider.input_list.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)) })} />
                        <Input value={r.mic} placeholder={t.mic} onChange={(e) => setRider({ input_list: rider.input_list.map((x, j) => (j === i ? { ...x, mic: e.target.value } : x)) })} />
                        <button aria-label={t.remove} onClick={() => setRider({ input_list: rider.input_list.filter((_, j) => j !== i) })} className="text-b2b-muted hover:text-red-600">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setRider({ input_list: [...rider.input_list, { ch: rider.input_list.length + 1, source: '', mic: '' }] })} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                      <Plus className="size-4" /> {t.addChannel}
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          )
        )}
      </QueryState>

      <Modal open={share.open} onClose={() => setShare({ ...share, open: false })} title={t.shareTitle}>
        <p className="text-sm text-b2b-muted">{t.shareNote}</p>
        <div className="mt-4 flex items-end gap-2">
          <Field label={t.validFor}>
            <Select value={share.days} onChange={(e) => setShare({ ...share, days: Number(e.target.value) })}>
              {[3, 7, 14, 30].map((n) => (
                <option key={n} value={n}>
                  {t.days(n)}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="ink" onClick={makeLink}>
            {t.createLink}
          </Button>
        </div>
        {share.url && (
          <div className="mt-4 rounded-none bg-b2b-bg p-3">
            <p className="font-mono text-xs break-all">{share.url}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-b2b-muted">{t.expires(fmt.dateTime(share.expires_at))}</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(share.url!);
                  toast.success(t.copied);
                }}
                className="flex items-center gap-1 text-xs font-bold"
              >
                <Copy className="size-3.5" /> {t.copy}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
