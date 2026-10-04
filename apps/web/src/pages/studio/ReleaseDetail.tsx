import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { Release, Split, Track } from '@/lib/types';
import { Badge, Button, Card, PageHeader, toast } from '@/components/ui';
import { QueryState, useCurrentArtist } from '@/components/b2b/common';
import { ReleaseStatusBadge } from './Releases';
import { SharesEditor } from './NewRelease';

type SplitsRes = { master: Split[]; publishing: Split[]; fully_approved: boolean };

function TrackSplits({ track, editable }: { track: Track; editable: boolean }) {
  const qc = useQueryClient();
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
        {q.data && <Badge tone={q.data.fully_approved ? 'green' : 'amber'}>{q.data.fully_approved ? 'Split 100% disetujui' : 'Menunggu persetujuan split'}</Badge>}
      </div>
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
              {(r.status === 'DRAFT' || r.status === 'REJECTED') && (
                <Button variant="ink" loading={busy} onClick={submit}>
                  Submit untuk review
                </Button>
              )}
            </div>
            {r.qc_reason && (
              <Card className="mb-6 border-red-200 bg-red-50">
                <p className="text-sm font-bold text-red-700">Catatan QC: {r.qc_reason}</p>
              </Card>
            )}
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
                  <TrackSplits key={t.id} track={t} editable={r.status === 'DRAFT' || r.status === 'REJECTED'} />
                ))}
              </div>
            </Card>
          </>
        )}
      </QueryState>
    </div>
  );
}
