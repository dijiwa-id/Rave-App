import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt } from '@/lib/api';
import type { Release } from '@/lib/types';
import { Badge, Button, PageHeader } from '@/components/ui';
import { Empty, QueryState, Table, useCurrentArtist } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';

const RS: Record<Release['status'], 'neutral' | 'green' | 'blue' | 'amber' | 'red' | 'purple'> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'amber',
  SCHEDULED: 'blue',
  LIVE: 'green',
  REJECTED: 'red',
  TAKEN_DOWN: 'red',
};
export function ReleaseStatusBadge({ status }: { status: Release['status'] }) {
  const labels = useDict('b2b').studio.releaseStatus as Record<string, string>;
  return <Badge tone={RS[status] ?? 'neutral'}>{labels[status] ?? status}</Badge>;
}

export default function Releases() {
  const artist = useCurrentArtist()!;
  const t = useDict('b2b').studio.releases;
  const q = useQuery({ queryKey: ['studio-releases', artist.artist_id], queryFn: () => api<{ data: Release[] }>(`/v1/studio/artists/${artist.artist_id}/releases`) });
  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Link to="/studio/releases/new">
            <Button variant="ink">{t.newRelease}</Button>
          </Link>
        }
      />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.emptyTitle} body={t.emptyBody} action={<Link to="/studio/releases/new"><Button variant="ink">{t.start}</Button></Link>} /> : undefined}>
        <Table head={[t.head.release, t.head.type, t.head.date, t.head.tracks, t.head.status, '']}>
          {q.data?.data.map((r) => (
            <tr key={r.id} className="align-middle">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {r.cover_url ? <img src={r.cover_url} alt="" className="size-11 rounded-none object-cover" /> : <div className="size-11 rounded-none bg-b2b-bg" />}
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
                  {t.detail}
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
