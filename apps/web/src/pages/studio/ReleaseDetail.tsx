import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { Release, Split, Track } from '@/lib/types';
import { Badge, Button, Card, Field, Input, PageHeader, Select, toast } from '@/components/ui';
import { GENRES, QueryState, useCurrentArtist } from '@/components/b2b/common';
import { ReleaseStatusBadge } from './Releases';
import { audioDuration, SharesEditor, uploadFile } from './NewRelease';

const EDITABLE: Release['status'][] = ['DRAFT', 'REJECTED'];

/** Tombol pilih file + upload (audio/artwork) → public_url. */
function UploadButton({ kind, label, onUploaded }: { kind: 'audio' | 'artwork'; label: string; onUploaded: (url: string, file: File) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-b2b-line bg-b2b-card px-4 py-1.5 text-sm font-bold text-b2b-ink hover:border-b2b-ink">
      <Upload className="size-4" /> {busy ? 'Mengunggah…' : label}
      <input
        type="file"
        className="sr-only"
        accept={kind === 'audio' ? 'audio/wav,audio/x-wav,audio/flac,audio/mpeg,audio/mp4' : 'image/png,image/jpeg'}
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            await onUploaded(await uploadFile(f, kind), f);
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

/** Ubah metadata rilis DRAFT/REJECTED (PATCH /v1/studio/releases/:id — status kembali DRAFT). */
function ReleaseMetaEditor({ r, onDone }: { r: Release; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: r.title, type: r.type, release_date: r.release_date, genre: r.genre ?? GENRES[0], label: r.label ?? '', explicit: r.explicit, cover_url: r.cover_url ?? '' });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/v1/studio/releases/${r.id}`, { method: 'PATCH', body: { ...f, label: f.label || null, cover_url: f.cover_url || null } });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success('Metadata rilis disimpan');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="mb-6">
      <Card title="Ubah metadata rilis">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Judul rilis">
              <Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
          </div>
          <Field label="Tipe">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Release['type'] })}>
              <option value="SINGLE">Single</option>
              <option value="EP">EP</option>
              <option value="ALBUM">Album</option>
            </Select>
          </Field>
          <Field label="Tanggal rilis">
            <Input type="date" required value={f.release_date} onChange={(e) => setF({ ...f, release_date: e.target.value })} />
          </Field>
          <Field label="Genre">
            <Select value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })}>
              {[...new Set([f.genre, ...GENRES])].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="Label (opsional)">
            <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={f.explicit} onChange={(e) => setF({ ...f, explicit: e.target.checked })} /> Konten eksplisit
          </label>
          <div className="flex items-center gap-3">
            {f.cover_url ? <img src={f.cover_url} alt="" className="size-14 rounded object-cover" /> : <div className="size-14 rounded bg-b2b-bg" />}
            <UploadButton kind="artwork" label="Ganti artwork" onUploaded={(url) => setF((x) => ({ ...x, cover_url: url }))} />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="ink" size="sm" type="submit" loading={busy}>
            Simpan metadata
          </Button>
          <Button variant="outline-ink" size="sm" type="button" onClick={onDone}>
            Batal
          </Button>
        </div>
      </Card>
    </form>
  );
}

/** Ubah judul/ISRC/eksplisit/audio satu lagu, atau hapus (PATCH/DELETE /v1/studio/tracks/:id). */
function TrackEditor({ track, onDone }: { track: Track; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: track.title, isrc: track.isrc ?? '', explicit: track.explicit });
  const [audio, setAudio] = useState<{ audio_url: string; duration_ms?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/v1/studio/tracks/${track.id}`, { method: 'PATCH', body: { title: f.title, isrc: f.isrc || null, explicit: f.explicit, ...(audio ?? {}) } });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success('Lagu disimpan');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 grid gap-3 rounded-lg bg-b2b-bg/60 p-3 sm:grid-cols-[1fr_180px]">
      <Field label="Judul lagu">
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label="ISRC" hint="Kosongkan bila tidak berubah">
        <Input value={f.isrc} placeholder="ID-GM1-26-00001" onChange={(e) => setF({ ...f, isrc: e.target.value })} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={f.explicit} onChange={(e) => setF({ ...f, explicit: e.target.checked })} /> Eksplisit
        </label>
        <UploadButton kind="audio" label={audio ? 'Audio baru siap' : 'Ganti audio master'} onUploaded={async (url, file) => setAudio({ audio_url: url, duration_ms: await audioDuration(file) })} />
        <span className="flex-1" />
        <Button variant="ink" size="sm" loading={busy} disabled={!f.title.trim()} onClick={save}>
          Simpan lagu
        </Button>
        <Button variant="outline-ink" size="sm" onClick={onDone}>
          Batal
        </Button>
      </div>
    </div>
  );
}

/** Tambah lagu ke rilis DRAFT/REJECTED (POST /v1/studio/releases/:id/tracks) — audio wajib diunggah dulu. */
function AddTrack({ releaseId }: { releaseId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [audio, setAudio] = useState<{ audio_url: string; duration_ms?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try {
      await api(`/v1/studio/releases/${releaseId}/tracks`, { body: { title, ...audio } });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success('Lagu ditambahkan — atur split haknya');
      setOpen(false);
      setTitle('');
      setAudio(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <Plus className="size-4" /> Tambah lagu
      </button>
    );
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-b2b-line p-4">
      <div className="min-w-56 flex-1">
        <Field label="Judul lagu baru">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <UploadButton
        kind="audio"
        label={audio ? 'Audio terunggah' : 'Unggah audio master'}
        onUploaded={async (url, file) => {
          setAudio({ audio_url: url, duration_ms: await audioDuration(file) });
          if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
        }}
      />
      <Button variant="ink" size="sm" loading={busy} disabled={!title.trim() || !audio} onClick={add}>
        Tambahkan
      </Button>
      <Button variant="outline-ink" size="sm" onClick={() => setOpen(false)}>
        Batal
      </Button>
    </div>
  );
}

type SplitsRes = { master: Split[]; publishing: Split[]; fully_approved: boolean };

function TrackSplits({ track, editable }: { track: Track; editable: boolean }) {
  const qc = useQueryClient();
  const [editTrack, setEditTrack] = useState(false);
  async function removeTrack() {
    if (!confirm(`Hapus lagu "${track.title}" dari rilis ini?`)) return;
    try {
      await api(`/v1/studio/tracks/${track.id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success('Lagu dihapus');
    } catch (e) {
      toast.error(e);
    }
  }
  const q = useQuery({ queryKey: ['splits', track.id], queryFn: () => api<SplitsRes>(`/v1/studio/tracks/${track.id}/splits`) });
  const [edit, setEdit] = useState<null | { master: any[]; publishing: any[] }>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const strip = (s: any[]) => s.map((x) => ({ party_name: x.party_name, email: x.email || undefined, pct: Number(x.pct) }));
      await api(`/v1/studio/tracks/${track.id}/splits`, { method: 'PUT', body: { master: strip(edit!.master), publishing: strip(edit!.publishing) } });
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['splits', track.id] });
      toast.success('Split disimpan');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  async function approve(id: string) {
    try {
      await api(`/v1/studio/splits/${id}/approve`, { body: {} });
      qc.invalidateQueries({ queryKey: ['splits', track.id] });
    } catch (e) {
      toast.error(e);
    }
  }
  const list = (title: string, s: Split[]) => (
    <div>
      <p className="mb-1 text-xs font-bold tracking-wide text-b2b-muted uppercase">{title}</p>
      <ul className="space-y-1 text-sm">
        {s.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2">
            <span>
              {x.party_name} <span className="text-b2b-muted">{x.pct}%</span>
            </span>
            {x.approved_at ? (
              <Badge tone="green">Disetujui</Badge>
            ) : (
              <button onClick={() => approve(x.id)} className="text-xs font-bold underline">
                Setujui
              </button>
            )}
          </li>
        ))}
        {!s.length && <li className="text-b2b-muted">Belum diatur</li>}
      </ul>
    </div>
  );
  return (
    <div className="rounded-xl border border-b2b-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          {track.track_number}. {track.title} <span className="ml-2 text-xs font-normal text-b2b-muted">{fmt.duration(track.duration_ms)}</span>
        </p>
        <div className="flex items-center gap-2">
          {q.data && <Badge tone={q.data.fully_approved ? 'green' : 'amber'}>{q.data.fully_approved ? 'Split 100% disetujui' : 'Menunggu persetujuan split'}</Badge>}
          {editable && !editTrack && (
            <>
              <button aria-label={`Ubah lagu ${track.title}`} onClick={() => setEditTrack(true)} className="text-b2b-muted hover:text-b2b-ink">
                <Pencil className="size-4" />
              </button>
              <button aria-label={`Hapus lagu ${track.title}`} onClick={removeTrack} className="text-b2b-muted hover:text-red-600">
                <Trash2 className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>
      {editTrack && <TrackEditor track={track} onDone={() => setEditTrack(false)} />}
      {edit ? (
        <div className="mt-4 space-y-4">
          <SharesEditor title="Master" shares={edit.master} onChange={(m) => setEdit({ ...edit, master: m })} />
          <SharesEditor title="Publishing" shares={edit.publishing} onChange={(p) => setEdit({ ...edit, publishing: p })} />
          <div className="flex gap-2">
            <Button variant="ink" size="sm" loading={busy} onClick={save}>
              Simpan split
            </Button>
            <Button variant="outline-ink" size="sm" onClick={() => setEdit(null)}>
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <QueryState q={q}>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {list('Master', q.data?.master ?? [])}
            {list('Publishing', q.data?.publishing ?? [])}
          </div>
          {editable && (
            <button
              onClick={() =>
                setEdit({
                  master: (q.data?.master ?? []).map((x) => ({ party_name: x.party_name, email: x.email ?? '', pct: x.pct })),
                  publishing: (q.data?.publishing ?? []).map((x) => ({ party_name: x.party_name, email: x.email ?? '', pct: x.pct })),
                })
              }
              className="mt-3 text-sm font-bold underline"
            >
              Ubah split
            </button>
          )}
        </QueryState>
      )}
    </div>
  );
}

export default function ReleaseDetail() {
  const { id } = useParams();
  const artist = useCurrentArtist()!;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['studio-releases', artist.artist_id],
    queryFn: () => api<{ data: Release[] }>(`/v1/studio/artists/${artist.artist_id}/releases`),
  });
  const r = q.data?.data.find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  async function submit() {
    setBusy(true);
    setErrors([]);
    try {
      await api(`/v1/studio/releases/${id}/submit`, { body: {} });
      toast.success('Dikirim untuk review');
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) setErrors(e.problem.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Link to="/studio/releases" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <ArrowLeft className="size-4" /> Karya
      </Link>
      <QueryState q={q}>
        {!r ? (
          <p>Rilis tidak ditemukan.</p>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end gap-5">
              {r.cover_url ? <img src={r.cover_url} alt="" className="size-36 rounded-lg object-cover shadow" /> : <div className="size-36 rounded-lg bg-b2b-bg" />}
              <div className="flex-1">
                <PageHeader title={r.title} subtitle={`${r.type} · ${r.genre ?? ''} · rilis ${fmt.date(r.release_date)}${r.label ? ' · ' + r.label : ''}`} />
                <div className="-mt-4 flex flex-wrap items-center gap-2">
                  <ReleaseStatusBadge status={r.status} />
                  {r.upc && <Badge>UPC {r.upc}</Badge>}
                  {r.explicit && <Badge>Eksplisit</Badge>}
                </div>
              </div>
              {EDITABLE.includes(r.status) && (
                <div className="flex gap-2">
                  {!editMeta && (
                    <Button variant="outline-ink" icon={<Pencil className="size-4" />} onClick={() => setEditMeta(true)}>
                      Ubah metadata
                    </Button>
                  )}
                  <Button variant="ink" loading={busy} onClick={submit}>
                    {r.status === 'REJECTED' ? 'Ajukan ulang' : 'Submit untuk review'}
                  </Button>
                </div>
              )}
            </div>
            {r.qc_reason && (
              <Card className="mb-6 border-red-200 bg-red-50">
                <p className="text-xs font-bold tracking-wide text-red-700 uppercase">{r.status === 'REJECTED' ? 'Ditolak tim QC' : r.status === 'TAKEN_DOWN' ? 'Diturunkan' : 'Catatan QC'}</p>
                <p className="mt-1 text-sm font-bold text-red-700">{r.qc_reason}</p>
                {r.status === 'REJECTED' && <p className="mt-2 text-xs text-red-700">Perbaiki metadata, lagu, atau split di halaman ini, lalu ajukan ulang.</p>}
              </Card>
            )}
            {editMeta && <ReleaseMetaEditor r={r} onDone={() => setEditMeta(false)} />}
            {errors.length > 0 && (
              <ul className="mb-6 space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {errors.map((e, i) => (
                  <li key={i}>
                    {e.path && <strong>{e.path}: </strong>}
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
            <Card title="Lagu & split hak">
              <div className="space-y-3">
                {r.tracks.map((t) => (
                  <TrackSplits key={t.id} track={t} editable={EDITABLE.includes(r.status)} />
                ))}
                {!r.tracks.length && <p className="text-sm text-b2b-muted">Belum ada lagu.</p>}
                {EDITABLE.includes(r.status) && <AddTrack releaseId={r.id} />}
              </div>
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
