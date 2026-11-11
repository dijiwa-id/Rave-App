import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Button, Card, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';

interface PendingSplit {
  id: string;
  type: 'MASTER' | 'PUBLISHING';
  party_name: string;
  email: string;
  pct: number;
  track_id: string;
  track_title: string;
  artist_name: string;
}

/**
 * Split hak yang menunggu persetujuan pengguna ini (diundang via email, REQ-STU-02).
 * Tidak dirender bila kosong — dipakai di Dasbor Studio dan onboarding (pengundang sering belum punya org artis).
 */
export function PendingSplits({ className }: { className?: string }) {
  const qc = useQueryClient();
  const d = useDict('b2b').splits;
  const q = useQuery({ queryKey: ['splits-pending'], queryFn: () => api<{ data: PendingSplit[] }>('/v1/studio/splits/pending') });
  const items = q.data?.data ?? [];
  if (!items.length) return null;
  async function approve(id: string) {
    try {
      await api(`/v1/studio/splits/${id}/approve`, { body: {} });
      toast.success(d.approved);
      qc.invalidateQueries({ queryKey: ['splits-pending'] });
      qc.invalidateQueries({ queryKey: ['splits'] });
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <Card className={className} title={<span>{d.title} <Badge tone="amber">{items.length}</Badge></span>}>
      <ul className="divide-y divide-b2b-line">
        {items.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <p className="font-bold">
                {s.track_title} <span className="font-normal text-b2b-muted">· {s.artist_name}</span>
              </p>
              <p className="text-xs text-b2b-muted">
                {d.line(s.type === 'MASTER' ? 'Master' : 'Publishing', s.pct, s.party_name)}
              </p>
            </div>
            <Button variant="ink" size="sm" onClick={() => approve(s.id)}>
              {d.approve}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
