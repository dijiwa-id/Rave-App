import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus, ScanLine, Trash2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { ArtistSummary, BookingSummary, EventDetail, EventSummary } from '@/lib/types';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { CITIES, Empty, QueryState, Table, useCurrentPromotor } from '@/components/b2b/common';
import { setting, usePlatformConfig } from '@/lib/platform';

type OrgEvent = EventSummary & { sold: number; revenue: number; checked_in: number };

/** ISO → nilai input datetime-local (waktu lokal browser). */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Ubah detail event (PATCH /v1/ticketing/events/:id). Kategori tiket tetap dari formulir pembuatan. */
function EditEvent({ id, onClose }: { id: string; onClose: () => void }) {
  const optOutDays = setting<number>(usePlatformConfig(), 'refund.reschedule_opt_out_days', 7);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api<EventDetail>(`/v1/ticketing/events/${id}`) });
  const [f, setF] = useState<null | { title: string; description: string; city: string; venue_name: string; venue_address: string; starts_at: string; ends_at: string; poster_url: string; rules: string }>(null);
  const [busy, setBusy] = useState(false);
  const e = q.data;
  if (e && !f)
    setF({
      title: e.title,
      description: e.description ?? '',
      city: e.city,
      venue_name: e.venue_name,
      venue_address: e.venue_address ?? '',
      starts_at: toLocalInput(e.starts_at),
      ends_at: toLocalInput(e.ends_at),
      poster_url: e.poster_url ?? '',
      rules: e.rules ?? '',
    });
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!f) return;
    if (new Date(f.ends_at) <= new Date(f.starts_at)) return toast.error('Waktu selesai harus setelah waktu mulai');
    setBusy(true);
    try {
      await api(`/v1/ticketing/events/${id}`, {
        method: 'PATCH',
        body: { ...f, starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(), poster_url: f.poster_url || null, rules: f.rules || null },
      });
      toast.success('Event diperbarui');
      qc.invalidateQueries({ queryKey: ['org-events'] });
      qc.invalidateQueries({ queryKey: ['event', id] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Ubah event" wide>
      <QueryState q={q}>
        {f && (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Judul">
                <Input required minLength={3} value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Deskripsi">
                <Textarea value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} />
              </Field>
            </div>
            <Field label="Kota">
              <Select value={f.city} onChange={(x) => setF({ ...f, city: x.target.value })}>
                {[...new Set([f.city, ...CITIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Venue">
              <Input required minLength={2} value={f.venue_name} onChange={(x) => setF({ ...f, venue_name: x.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Alamat venue">
                <Input value={f.venue_address} onChange={(x) => setF({ ...f, venue_address: x.target.value })} />
              </Field>
            </div>
            <Field label="Mulai">
              <Input type="datetime-local" required value={f.starts_at} onChange={(x) => setF({ ...f, starts_at: x.target.value })} />
            </Field>
            <Field label="Selesai">
              <Input type="datetime-local" required value={f.ends_at} onChange={(x) => setF({ ...f, ends_at: x.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="URL poster">
                <Input type="url" value={f.poster_url} onChange={(x) => setF({ ...f, poster_url: x.target.value })} placeholder="https://…" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Aturan masuk">
                <Textarea value={f.rules} onChange={(x) => setF({ ...f, rules: x.target.value })} />
              </Field>
            </div>
            {e && e.status !== 'DRAFT' && (
              <p className="text-xs text-b2b-muted sm:col-span-2">
                Event sudah dipublikasikan. Mengubah tanggal, kota, atau venue akan mengabari semua pemegang tiket dan memberi mereka hak refund penuh selama {optOutDays} hari.
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="ink" type="submit" loading={busy}>
                Simpan perubahan
              </Button>
              <Button variant="outline-ink" type="button" onClick={onClose}>
                Batal
              </Button>
            </div>
          </form>
        )}
      </QueryState>
    </Modal>
  );
}

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draf', PUBLISHED: 'Dipublikasikan', CANCELLED: 'Dibatalkan', COMPLETED: 'Selesai' };

/** Batalkan event: semua pembeli direfund penuh (termasuk biaya layanan) — tidak dapat diurungkan. */
function CancelEvent({ event, onClose }: { event: OrgEvent; onClose: () => void }) {
  const qc = useQueryClient();
  const sla = setting<number>(usePlatformConfig(), 'refund.event_cancel_sla_days', 14);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 10 && confirm.trim().toUpperCase() === 'BATALKAN';
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ refunds: { requested: number; queued: number } }>(`/v1/ticketing/events/${event.id}/cancel`, { body: { reason: reason.trim() } });
      const n = r.refunds.requested + r.refunds.queued;
      toast.success(n ? `Event dibatalkan — refund ${fmt.num(n)} order sedang diproses` : 'Event dibatalkan');
      qc.invalidateQueries({ queryKey: ['org-events'] });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Batalkan event">
      <div className="space-y-4 text-sm">
        <p>
          <strong>{event.title}</strong> · {fmt.dateTime(event.starts_at)}
        </p>
        <ul className="list-disc space-y-1 rounded-xl border border-red-500/30 bg-red-500/5 p-4 pl-8 text-b2b-ink">
          <li>{event.sold ? `${fmt.num(event.sold)} tiket terjual akan direfund penuh, termasuk biaya layanan.` : 'Belum ada tiket terjual.'}</li>
          <li>Dana kembali ke pembeli paling lambat {sla} hari, dan pembeli dikabari otomatis.</li>
          <li>Penjualan dan reservasi yang sedang berjalan dihentikan. Pembatalan tidak dapat diurungkan.</li>
        </ul>
        <Field label="Alasan pembatalan" hint="Ditampilkan ke tim GEMA dan dicatat di audit log">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. venue tidak dapat digunakan karena …" />
        </Field>
        <Field label='Ketik "BATALKAN" untuk konfirmasi'>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline-ink" onClick={onClose}>
            Kembali
          </Button>
          <Button variant="danger" loading={busy} disabled={!ok} onClick={submit}>
            Batalkan event
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function useOrgEvents() {
  const org = useCurrentPromotor()!;
  return useQuery({ queryKey: ['org-events', org.id], queryFn: () => api<{ data: OrgEvent[] }>(`/v1/ticketing/orgs/${org.id}/events`) });
}

export function PromotorEvents() {
  const q = useOrgEvents();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<OrgEvent | null>(null);
  async function publish(id: string) {
    setBusy(id);
    try {
      await api(`/v1/ticketing/events/${id}/publish`, { body: {} });
      toast.success('Event dipublikasikan — follower di kota terkait dinotifikasi');
      qc.invalidateQueries({ queryKey: ['org-events'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div>
      <PageHeader
        title="Event Saya"
        subtitle="Presale berjenjang: top listener → follower → publik. Kuota ditahan 10 menit saat checkout, tanpa oversell."
        actions={
          <Link to="/promotor/events/new">
            <Button variant="ink" icon={<Plus className="size-4" />}>
              Event baru
            </Button>
          </Link>
        }
      />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Belum ada event" body="Buat event dari booking yang sudah BOOKED atau event mandiri." /> : undefined}>
        <Table head={['Event', 'Tanggal', 'Status', 'Terjual', 'Pendapatan', 'Check-in', '']}>
          {q.data?.data.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {e.poster_url ? <img src={e.poster_url} alt="" className="size-11 rounded object-cover" /> : <div className="size-11 rounded bg-b2b-bg" />}
                  <div>
                    <p className="font-bold">{e.title}</p>
                    <p className="text-xs text-b2b-muted">
                      {e.venue_name}, {e.city}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{fmt.dateTime(e.starts_at)}</td>
              <td className="px-4 py-3">
                <Badge tone={e.status === 'PUBLISHED' ? 'green' : e.status === 'CANCELLED' ? 'red' : 'neutral'}>{STATUS_LABEL[e.status] ?? e.status}</Badge>
              </td>
              <td className="px-4 py-3 tabular-nums">{fmt.num(e.sold)}</td>
              <td className="px-4 py-3 tabular-nums">{fmt.idrShort(e.revenue)}</td>
              <td className="px-4 py-3 tabular-nums">{fmt.num(e.checked_in)}</td>
              <td className="space-x-3 px-4 py-3 text-right whitespace-nowrap">
                {(e.status === 'DRAFT' || e.status === 'PUBLISHED') && (
                  <button onClick={() => setEditing(e.id)} aria-label={`Ubah ${e.title}`} className="inline-flex items-center gap-1 align-middle text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                    <Pencil className="size-4" /> Ubah
                  </button>
                )}
                {(e.status === 'DRAFT' || e.status === 'PUBLISHED') && (
                  <button onClick={() => setCancelling(e)} aria-label={`Batalkan ${e.title}`} className="inline-flex items-center gap-1 align-middle text-sm font-bold text-red-600 hover:text-red-700">
                    <Ban className="size-4" /> Batalkan
                  </button>
                )}
                {e.status === 'DRAFT' && (
                  <Button size="sm" variant="ink" loading={busy === e.id} onClick={() => publish(e.id)}>
                    Publikasikan
                  </Button>
                )}
                {e.status === 'PUBLISHED' && (
                  <Link to={`/promotor/events/${e.id}/checkin`} className="inline-flex items-center gap-1 text-sm font-bold underline">
                    <ScanLine className="size-4" /> Check-in
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
      {editing && <EditEvent id={editing} onClose={() => setEditing(null)} />}
      {cancelling && <CancelEvent event={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

interface TT {
  name: string;
  price: number;
  quota: number;
  max_per_account: number;
  sale_starts_at: string;
  presale: boolean;
}

export function NewEvent() {
  const org = useCurrentPromotor()!;
  const nav = useNavigate();
  const qc = useQueryClient();
  const bookings = useQuery({
    queryKey: ['bookings', 'promotor', undefined, org.id, 'event'],
    queryFn: () => api<{ data: BookingSummary[] }>('/v1/booking/bookings', { query: { side: 'promotor', org_id: org.id } }),
  });
  const artists = useQuery({ queryKey: ['catalog-artists'], queryFn: () => api<{ data: ArtistSummary[] }>('/v1/catalog/artists') });
  const booked = bookings.data?.data.filter((b) => ['BOOKED', 'BOOKED_AND_SECURED', 'SHOW_DAY'].includes(b.status)) ?? [];
  const [f, setF] = useState({
    booking_id: '',
    title: '',
    description: '',
    city: 'Bandung',
    venue_name: '',
    venue_address: '',
    starts_at: '',
    ends_at: '',
    poster_url: '',
    rules: 'Dilarang membawa senjata tajam, obat terlarang, dan minuman keras. Tiket tidak dapat dipindahtangankan di luar fitur transfer resmi.',
    artist_ids: [] as string[],
  });
  const [types, setTypes] = useState<TT[]>([
    { name: 'Presale Fan', price: 75_000, quota: 200, max_per_account: 2, sale_starts_at: '', presale: true },
    { name: 'Reguler', price: 100_000, quota: 800, max_per_account: 4, sale_starts_at: '', presale: false },
  ]);
  const [busy, setBusy] = useState(false);

  function pickBooking(id: string) {
    const b = booked.find((x) => x.id === id);
    if (!b) return setF({ ...f, booking_id: '' });
    setF({ ...f, booking_id: id, title: f.title || b.event_name, city: b.city, venue_name: b.venue, starts_at: `${b.event_date}T19:00`, ends_at: `${b.event_date}T23:00`, artist_ids: [...new Set([...f.artist_ids, b.artist.id])] });
  }
  const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.artist_ids.length) return toast.error('Pilih minimal satu artis line-up');
    setBusy(true);
    try {
      const ev = await api<EventDetail>('/v1/ticketing/events', {
        body: {
          org_id: org.id,
          booking_id: f.booking_id || undefined,
          title: f.title,
          description: f.description,
          city: f.city,
          venue_name: f.venue_name,
          venue_address: f.venue_address,
          starts_at: toIso(f.starts_at),
          ends_at: toIso(f.ends_at),
          poster_url: f.poster_url || undefined,
          artist_ids: f.artist_ids,
          rules: f.rules || undefined,
          ticket_types: types.map((t) => ({ ...t, sale_starts_at: toIso(t.sale_starts_at) })),
        },
      });
      toast.success('Event dibuat (draf)');
      qc.invalidateQueries({ queryKey: ['org-events'] });
      nav('/promotor/events');
      return ev;
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <PageHeader title="Event baru" subtitle="Zona waktu event = zona waktu venue. Unggah izin keramaian sebelum publikasi (tanggung jawab promotor)." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Detail event">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Terhubung ke booking" hint="opsional">
                  <Select value={f.booking_id} onChange={(e) => pickBooking(e.target.value)}>
                    <option value="">Event mandiri</option>
                    {booked.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.artist.name} — {b.event_name} ({fmt.date(b.event_date)})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Judul">
                  <Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Deskripsi">
                  <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
                </Field>
              </div>
              <Field label="Kota">
                <Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
                  {CITIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Venue">
                <Input required value={f.venue_name} onChange={(e) => setF({ ...f, venue_name: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Alamat venue">
                  <Input required value={f.venue_address} onChange={(e) => setF({ ...f, venue_address: e.target.value })} />
                </Field>
              </div>
              <Field label="Mulai">
                <Input type="datetime-local" required value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
              </Field>
              <Field label="Selesai">
                <Input type="datetime-local" required value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="URL poster">
                  <Input value={f.poster_url} onChange={(e) => setF({ ...f, poster_url: e.target.value })} placeholder="https://…" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Aturan masuk">
                  <Textarea value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} />
                </Field>
              </div>
            </div>
          </Card>
          <Card title="Kategori tiket">
            <div className="space-y-3">
              {types.map((t, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-b2b-line p-3 sm:grid-cols-6 sm:items-end">
                  <div className="sm:col-span-2">
                    <Field label="Nama">
                      <Input value={t.name} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    </Field>
                  </div>
                  <Field label="Harga">
                    <Input type="number" min={0} step={5000} value={t.price} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />
                  </Field>
                  <Field label="Kuota">
                    <Input type="number" min={1} value={t.quota} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, quota: Number(e.target.value) } : x)))} />
                  </Field>
                  <Field label="Maks/akun">
                    <Input type="number" min={1} max={10} value={t.max_per_account} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, max_per_account: Number(e.target.value) } : x)))} />
                  </Field>
                  <button type="button" aria-label="Hapus kategori" onClick={() => setTypes(types.filter((_, j) => j !== i))} className="mb-3 justify-self-end text-b2b-muted hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                  <div className="sm:col-span-3">
                    <Field label="Mulai dijual" hint="kosong = saat publikasi">
                      <Input type="datetime-local" value={t.sale_starts_at} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, sale_starts_at: e.target.value } : x)))} />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 pb-3 text-sm sm:col-span-3">
                    <input type="checkbox" checked={t.presale} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, presale: e.target.checked } : x)))} /> Presale untuk top listener & follower
                  </label>
                </div>
              ))}
              <button type="button" onClick={() => setTypes([...types, { name: '', price: 0, quota: 100, max_per_account: 4, sale_starts_at: '', presale: false }])} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                <Plus className="size-4" /> Tambah kategori
              </button>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Line-up">
            <QueryState q={artists}>
              <ul className="max-h-96 space-y-1 overflow-y-auto">
                {artists.data?.data.map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg p-1.5 hover:bg-b2b-bg">
                      <input
                        type="checkbox"
                        checked={f.artist_ids.includes(a.id)}
                        onChange={(e) => setF({ ...f, artist_ids: e.target.checked ? [...f.artist_ids, a.id] : f.artist_ids.filter((x) => x !== a.id) })}
                      />
                      {a.image_url && <img src={a.image_url} alt="" className="size-8 rounded-full object-cover" />}
                      <span className="text-sm font-semibold">{a.name}</span>
                      <span className="ml-auto text-xs text-b2b-muted">{a.city}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </QueryState>
          </Card>
          <Button variant="ink" type="submit" loading={busy} className="w-full">
            Simpan sebagai draf
          </Button>
          <p className="text-xs text-b2b-muted">Pendapatan tiket ditahan dan dicairkan setelah acara selesai, dikurangi service fee & pajak hiburan (PBJT) sesuai Perda kota venue.</p>
        </div>
      </form>
    </div>
  );
}
