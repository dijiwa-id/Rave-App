import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { RateCard, RateItem } from '@/lib/types';
import { Button, Card, Field, Input, PageHeader, Select, toast } from '@/components/ui';
import { CATEGORY_LABEL, FORMAT_LABEL, QueryState, ZONE_LABEL, useCurrentArtist } from '@/components/b2b/common';

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
      toast.success('Rate card disimpan (tercatat di audit log)');
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
        title="Rate Card"
        subtitle="Tarif per kategori acara, format, durasi, dan zona. Label dapat menetapkan harga minimum roster."
        actions={
          <Button variant="ink" loading={saving} disabled={!rc} onClick={save}>
            Simpan
          </Button>
        }
      />
      <QueryState q={{ ...q, error: rc ? null : q.error, isLoading: q.isLoading && !rc }}>
        {rc && (
          <div className="space-y-6">
            <Card>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Visibilitas">
                  <Select value={rc.visibility} onChange={(e) => setRc({ ...rc, visibility: e.target.value as RateCard['visibility'] })}>
                    <option value="PUBLIC">Publik (“mulai dari”)</option>
                    <option value="VERIFIED_PROMOTOR">Hanya promotor terverifikasi</option>
                    <option value="BY_REQUEST">By request</option>
                  </Select>
                </Field>
                <Field label="Berlaku dari">
                  <Input type="date" value={rc.valid_from ?? ''} onChange={(e) => setRc({ ...rc, valid_from: e.target.value || null })} />
                </Field>
                <Field label="Berlaku sampai">
                  <Input type="date" value={rc.valid_to ?? ''} onChange={(e) => setRc({ ...rc, valid_to: e.target.value || null })} />
                </Field>
                <div className="rounded-xl bg-b2b-bg p-3">
                  <p className="text-xs font-semibold text-b2b-muted uppercase">Tampil sebagai</p>
                  <p className="text-lg font-extrabold">{rc.visibility === 'BY_REQUEST' ? 'By request' : `Mulai ${fmt.idrShort(minFee)}`}</p>
                </div>
              </div>
            </Card>
            <div className="overflow-x-auto rounded-xl border border-b2b-line bg-white">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="border-b border-b2b-line bg-b2b-bg/60 text-left text-xs font-bold text-b2b-muted uppercase">
                  <tr>
                    {['Kategori', 'Format', 'Zona', 'Durasi (mnt)', 'Fee artis', 'Estimasi rider', 'Akomodasi', 'Transport', ''].map((h) => (
                      <th key={h} className="px-3 py-3">
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
                          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Select value={it.format} onChange={(e) => upd(i, { format: e.target.value })}>
                          {Object.entries(FORMAT_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Select value={it.zone} onChange={(e) => upd(i, { zone: e.target.value })}>
                          {Object.entries(ZONE_LABEL).map(([k, v]) => (
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
                        <input type="checkbox" aria-label="Akomodasi ditanggung promotor" checked={it.accommodation_by_promotor} onChange={(e) => upd(i, { accommodation_by_promotor: e.target.checked })} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" aria-label="Transport ditanggung promotor" checked={it.transport_by_promotor} onChange={(e) => upd(i, { transport_by_promotor: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2">
                        <button aria-label="Hapus baris" onClick={() => setRc({ ...rc, items: rc.items.filter((_, j) => j !== i) })} className="text-b2b-muted hover:text-red-600">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-b2b-line p-3">
                <button onClick={() => setRc({ ...rc, items: [...rc.items, blank()] })} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                  <Plus className="size-4" /> Tambah tarif
                </button>
              </div>
            </div>
            <p className="text-xs text-b2b-muted">Centang = ditanggung promotor. Pajak (PPh) dipotong saat pencairan sesuai status pajak penerima.</p>
          </div>
        )}
      </QueryState>
    </div>
  );
}
