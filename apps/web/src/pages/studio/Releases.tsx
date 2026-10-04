import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt } from '@/lib/api';
import type { Release } from '@/lib/types';
import { Badge, Button, PageHeader } from '@/components/ui';
import { Empty, QueryState, Table, useCurrentArtist } from '@/components/b2b/common';

const RS: Record<Release['status'], ['neutral' | 'green' | 'blue' | 'amber' | 'red' | 'purple', string]> = {
  DRAFT: ['neutral', 'Draf'],
  IN_REVIEW: ['amber', 'Dalam review'],
  SCHEDULED: ['blue', 'Terjadwal'],
  LIVE: ['green', 'Tayang'],
  REJECTED: ['red', 'Ditolak'],
  TAKEN_DOWN: ['red', 'Diturunkan'],
};
export function ReleaseStatusBadge({ status }: { status: Release['status'] }) {
  const [tone, label] = RS[status] ?? ['neutral', status];
  return <Badge tone={tone}>{label}</Badge>;
}

export default function Releases() {
  const artist = useCurrentArtist()!;
  const q = useQuery({ queryKey: ['studio-releases', artist.artist_id], queryFn: () => api<{ data: Release[] }>(`/v1/studio/artists/${artist.artist_id}/releases`) });
  return (
    <div>
      <PageHeader
        title="Karya & Rilis"
        subtitle="Draft → In Review → Scheduled → Live. Rilis yang lolos validasi tayang ≤ 48 jam."
        actions={
          <Link to="/studio/releases/new">
            <Button variant="ink">Rilis baru</Button>
          </Link>
        }
      />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Belum ada rilis" body="Unggah single, EP, atau album pertamamu." action={<Link to="/studio/releases/new"><Button variant="ink">Mulai rilis</Button></Link>} /> : undefined}>
        <Table head={['Rilis', 'Tipe', 'Tanggal rilis', 'Lagu', 'Status', '']}>
          {q.data?.data.map((r) => (
            <tr key={r.id} className="align-middle">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {r.cover_url ? <img src={r.cover_url} alt="" className="size-11 rounded object-cover" /> : <div className="size-11 rounded bg-b2b-bg" />}
                  <div>
                    <p className="font-bold">{r.title}</p>
                    <p className="text-xs text-b2b-muted">
                      {r.genre} {r.upc && `· UPC ${r.upc}`}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">{r.type}</td>
              <td className="px-4 py-3">{fmt.date(r.release_date)}</td>
              <td className="px-4 py-3">{r.tracks?.length ?? '—'}</td>
              <td className="px-4 py-3">
                <ReleaseStatusBadge status={r.status} />
                {r.qc_reason && <p className="mt-1 max-w-56 text-xs text-red-600">{r.qc_reason}</p>}
              </td>
              <td className="px-4 py-3 text-right">
                <Link to={`/studio/releases/${r.id}`} className="text-sm font-bold underline">
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
