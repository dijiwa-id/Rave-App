import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { RateCard, RateItem } from '@/lib/types';
import { Button, Card, Field, Input, PageHeader, Select, toast } from '@/components/ui';
import { categoryLabels, formatLabels, QueryState, zoneLabels, useCurrentArtist } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';

const blank = (): RateItem => ({
  category: 'KAMPUS',
  format: 'FULL_BAND',
  zone: 'DALAM_KOTA',
  duration_min: 60,
  fee: 15_000_000,
  rider_estimate: 3_000_000,
  accommodation_by_promotor: true,
  transport_by_promotor: true,
});

export default function RateCardPage() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rate-card', aid], queryFn: () => api<RateCard>(`/v1/booking/artists/${aid}/rate-card`) });
  const [rc, setRc] = useState<Omit<RateCard, 'artist_id' | 'from_fee'> | null>(null);
  const [saving, setSaving] = useState(false);
  const t = useDict('b2b').studio.rateCard;
  useEffect(() => {
    if (q.data && !rc) setRc({ visibility: q.data.visibility, valid_from: q.data.valid_from, valid_to: q.data.valid_to, items: q.data.items.length ? q.data.items : [blank()] });
  }, [q.data, rc]);
  useEffect(() => {
    if (q.error && !rc) setRc({ visibility: 'PUBLIC', valid_from: null, valid_to: null, items: [blank()] });
  }, [q.error, rc]);

  const upd = (i: number, p: Partial<RateItem>) => setRc({ ...rc!, items: rc!.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  async function save() {
    setSaving(true);
    try {
      const r = await api<RateCard>(`/v1/booking/artists/${aid}/rate-card`, {
        method: 'PUT',
        body: { ...rc, valid_from: rc!.valid_from || undefined, valid_to: rc!.valid_to || undefined },
      });
      qc.setQueryData(['rate-card', aid], r);
      toast.success(t.saved);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }
  const minFee = rc?.items.length ? Math.min(...rc.items.map((i) => i.fee)) : null;

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button variant="ink" loading={saving} disabled={!rc} onClick={save}>
            {t.save}
          </Button>
        }
      />
      <QueryState q={{ ...q, error: rc ? null : q.error, isLoading: q.isLoading && !rc }}>
        {rc && (
          <div className="space-y-6">
            <Card>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={t.visibility}>
                  <Select value={rc.visibility} onChange={(e) => setRc({ ...rc, visibility: e.target.value as RateCard['visibility'] })}>
                    <option value="PUBLIC">{t.public}</option>
                    <option value="VERIFIED_PROMOTOR">{t.verifiedOnly}</option>
                    <option value="BY_REQUEST">{t.byRequest}</option>
                  </Select>
                </Field>
                <Field label={t.validFrom}>
                  <Input type="date" value={rc.valid_from ?? ''} onChange={(e) => setRc({ ...rc, valid_from: e.target.value || null })} />
                </Field>
                <Field label={t.validTo}>
                  <Input type="date" value={rc.valid_to ?? ''} onChange={(e) => setRc({ ...rc, valid_to: e.target.value || null })} />
                </Field>
                <div className="rounded-none bg-b2b-bg p-3">
                  <p className="text-xs font-semibold text-b2b-muted uppercase">{t.shownAs}</p>
                  <p className="text-lg font-extrabold">{rc.visibility === 'BY_REQUEST' ? t.byRequest : t.from(fmt.idrShort(minFee))}</p>
                </div>
              </div>
            </Card>
            <div className="overflow-x-auto rounded-none border border-b2b-line bg-b2b-card">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="border-b border-b2b-line bg-b2b-bg/60 text-left text-xs font-bold text-b2b-muted uppercase">
                  <tr>
                    {[t.head.category, t.head.format, t.head.zone, t.head.duration, t.head.fee, t.head.rider, t.head.accommodation, t.head.transport, ''].map((h, hi) => (
                      <th key={hi} className="px-3 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-b2b-line">
                  {rc.items.map((it, i) => (
                    <tr key={i}>
                      <td className="px-2 py-2">
                        <Select value={it.category} onChange={(e) => upd(i, { category: e.target.value })}>
                          {Object.entries(categoryLabels()).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Select value={it.format} onChange={(e) => upd(i, { format: e.target.value })}>
                          {Object.entries(formatLabels()).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Select value={it.zone} onChange={(e) => upd(i, { zone: e.target.value })}>
                          {Object.entries(zoneLabels()).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="w-24 px-2 py-2">
                        <Input type="number" min={15} step={15} value={it.duration_min} onChange={(e) => upd(i, { duration_min: Number(e.target.value) })} />
                      </td>
                      <td className="w-40 px-2 py-2">
                        <Input type="number" min={0} step={500000} value={it.fee} onChange={(e) => upd(i, { fee: Number(e.target.value) })} />
                      </td>
                      <td className="w-36 px-2 py-2">
                        <Input type="number" min={0} step={500000} value={it.rider_estimate} onChange={(e) => upd(i, { rider_estimate: Number(e.target.value) })} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" aria-label={t.accommodationAria} checked={it.accommodation_by_promotor} onChange={(e) => upd(i, { accommodation_by_promotor: e.target.checked })} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" aria-label={t.transportAria} checked={it.transport_by_promotor} onChange={(e) => upd(i, { transport_by_promotor: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2">
                        <button aria-label={t.removeRow} onClick={() => setRc({ ...rc, items: rc.items.filter((_, j) => j !== i) })} className="text-b2b-muted hover:text-red-600">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-b2b-line p-3">
                <button onClick={() => setRc({ ...rc, items: [...rc.items, blank()] })} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                  <Plus className="size-4" /> {t.addRate}
                </button>
              </div>
            </div>
            <p className="text-xs text-b2b-muted">{t.note}</p>
          </div>
        )}
      </QueryState>
    </div>
  );
}
