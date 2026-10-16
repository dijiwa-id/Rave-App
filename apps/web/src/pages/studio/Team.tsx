import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api, fmt, forceRefresh } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Badge, Button, Card, Field, Input, PageHeader, Select, toast } from '@/components/ui';
import { QueryState, Table, useCurrentArtist } from '@/components/b2b/common';
import { KycForm } from '@/components/b2b/OrgOnboarding';
import { useModule } from '@/components/ModuleGate';
import { managementOrgs, useAuth } from '@/stores/auth';

interface OrgDetail {
  id: string;
  name: string;
  type: string;
  verified: boolean;
  members: { user_id?: string; id?: string; display_name?: string; email: string; role: string; joined_at?: string; created_at?: string }[];
  managed_by?: { id: string; name: string }[];
}

/**
 * Manajemen artis (REQ-IAM-03): daftar manajemen yang mengelola artis ini + tautkan ke roster.
 * Backend mensyaratkan requester OWNER manajemen sekaligus OWNER/ADMIN org artis — alurnya: artis mengundang
 * manajer sebagai Admin di panel Anggota, lalu manajer menautkan dari sini.
 */
function ManagementPanel({ orgId, myRole }: { orgId: string; myRole?: string }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrgDetail>(`/v1/orgs/${orgId}`) });
  const linked = new Set((q.data?.managed_by ?? []).map((m) => m.id));
  const candidates = managementOrgs(user).filter((m) => !linked.has(m.id));
  const [mgmt, setMgmt] = useState('');
  const [busy, setBusy] = useState(false);
  const canLink = ['OWNER', 'ADMIN'].includes(myRole ?? '');
  async function link() {
    setBusy(true);
    try {
      await api(`/v1/orgs/${mgmt || candidates[0].id}/manage-artist`, { body: { artist_org_id: orgId } });
      await forceRefresh();
      useAuth.getState().setUser(await api<Me>('/v1/me'));
      qc.invalidateQueries({ queryKey: ['org', orgId] });
      toast.success('Artis masuk roster manajemen');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Manajemen">
      <QueryState q={q}>
        {q.data?.managed_by?.length ? (
          <ul className="space-y-1 text-sm">
            {q.data.managed_by.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span className="font-semibold">{m.name}</span>
                <Badge tone="purple">Mengelola artis ini</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-b2b-muted">Artis ini belum dikelola manajemen.</p>
        )}
      </QueryState>
      {canLink && candidates.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label="Tautkan ke roster manajemen Anda">
              <Select value={mgmt || candidates[0].id} onChange={(e) => setMgmt(e.target.value)}>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button variant="ink" loading={busy} onClick={link}>
            Tautkan
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-b2b-muted">
          Ingin dikelola manajemen? Undang manajer Anda sebagai <strong>Admin</strong> di panel Anggota; manajer lalu menautkan artis ini ke rosternya dari halaman ini.
        </p>
      )}
    </Card>
  );
}

/** Anggota organisasi + undangan (REQ-IAM-03). */
export function TeamPanel({ orgId, myRole }: { orgId: string; myRole?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrgDetail>(`/v1/orgs/${orgId}`) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [busy, setBusy] = useState(false);
  const canInvite = !myRole || ['OWNER', 'ADMIN'].includes(myRole);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/v1/orgs/${orgId}/members`, { body: { email, role } });
      setEmail('');
      toast.success('Anggota ditambahkan');
      qc.invalidateQueries({ queryKey: ['org', orgId] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={<span>Anggota {q.data?.name ? `· ${q.data.name}` : ''} {q.data?.verified && <Badge tone="green">Terverifikasi</Badge>}</span>}>
      <QueryState q={q}>
        <Table head={['Nama', 'Email', 'Peran', 'Bergabung']}>
          {q.data?.members.map((m) => (
            <tr key={m.user_id ?? m.id ?? m.email}>
              <td className="px-4 py-2.5 font-semibold">{m.display_name ?? '—'}</td>
              <td className="px-4 py-2.5">{m.email}</td>
              <td className="px-4 py-2.5">
                <Badge>{m.role}</Badge>
              </td>
              <td className="px-4 py-2.5">{fmt.date(m.joined_at ?? m.created_at)}</td>
            </tr>
          ))}
        </Table>
      </QueryState>
      {canInvite && (
        <form onSubmit={invite} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label="Undang via email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@email.com" />
            </Field>
          </div>
          <Field label="Peran">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="ADMIN">Admin</option>
              <option value="FINANCE">Finance</option>
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer</option>
            </Select>
          </Field>
          <Button variant="ink" type="submit" loading={busy}>
            Undang
          </Button>
        </form>
      )}
      <p className="mt-3 text-xs text-b2b-muted">Aksi sensitif (ubah rate card, terima offer, tanda tangan, ubah rekening) tercatat di audit log. Owner/Finance wajib MFA.</p>
    </Card>
  );
}

type SplitItem = { label: string; party_id?: string; pct: number };

function FeeSplits({ artistId }: { artistId: string }) {
  const q = useQuery({
    queryKey: ['fee-splits', artistId],
    queryFn: () => api<{ items: SplitItem[] }>(`/v1/booking/artists/${artistId}/fee-splits`).catch(() => ({ items: [] as SplitItem[] })),
  });
  const [items, setItems] = useState<SplitItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data && !items) setItems(q.data.items.length ? q.data.items : [{ label: 'Artis/Band', pct: 80 }, { label: 'Manajemen fee', pct: 20 }]);
  }, [q.data, items]);
  const total = Math.round((items ?? []).reduce((a, x) => a + (Number(x.pct) || 0), 0) * 100) / 100;
  async function save() {
    setBusy(true);
    try {
      await api(`/v1/booking/artists/${artistId}/fee-splits`, { method: 'PUT', body: { items } });
      toast.success('Split fee disimpan — berlaku otomatis saat pencairan');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      title="Split fee show (band, additional, kru, manajemen)"
      action={<span className={`text-sm font-extrabold ${total === 100 ? 'text-emerald-600' : 'text-red-600'}`}>Total {total}%</span>}
    >
      <div className="space-y-2">
        {(items ?? []).map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_24px] gap-2">
            <Input value={it.label} placeholder="mis. Gitaris, Kru, Manajemen" onChange={(e) => setItems(items!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input type="number" min={0} max={100} step={0.5} value={it.pct} onChange={(e) => setItems(items!.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} aria-label="Persen" />
            <button aria-label="Hapus" onClick={() => setItems(items!.filter((_, j) => j !== i))} className="text-b2b-muted hover:text-red-600">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => setItems([...(items ?? []), { label: '', pct: 0 }])} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
          <Plus className="size-4" /> Tambah pihak
        </button>
        <Button variant="ink" size="sm" loading={busy} disabled={total !== 100} onClick={save}>
          Simpan split
        </Button>
      </div>
      <p className="mt-3 text-xs text-b2b-muted">Ditetapkan sekali dan dieksekusi otomatis oleh escrow saat pencairan (setelah komisi platform & PPh).</p>
    </Card>
  );
}

export default function StudioTeam() {
  const artist = useCurrentArtist()!;
  const booking = useModule('booking');
  return (
    <div>
      <PageHeader title="Tim, Split Fee & KYC" subtitle="Satu manajemen dapat mengelola banyak artis; satu artis dapat punya manajemen dan label." />
      <div className="grid gap-6 lg:grid-cols-2">
        <TeamPanel orgId={artist.id} myRole={artist.role} />
        {booking && <FeeSplits artistId={artist.artist_id!} />}
        <ManagementPanel orgId={artist.id} myRole={artist.role} />
        <KycForm compact orgId={artist.id} nextLink={null} />
      </div>
    </div>
  );
}
