import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmt } from '@/lib/api';
import type { OrgClaim, Wallet } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { setting, usePlatformConfig } from '@/lib/platform';
import { Button, Card, Field, Input, Modal, PageHeader, Select, Stat, toast } from '@/components/ui';
import { Empty, QueryState, Table, useCurrentArtist } from '@/components/b2b/common';

const SOURCE: Record<string, string> = { royalty: 'Royalti', offair: 'Off-air', ticket: 'Tiket', merch: 'Merch', tip: 'Tip' };

/** Wallet penerima (REQ-PAY-02): saldo per sumber + penarikan ke rekening terverifikasi. */
export function WalletPanel({ parties, title = 'Keuangan' }: { parties: { id: string; name: string; role?: string }[]; title?: string }) {
  const [partyId, setPartyId] = useState(parties[0]?.id);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['wallet', partyId], queryFn: () => api<Wallet>(`/v1/finance/wallets/${partyId}`), enabled: !!partyId });
  // Minimum penarikan dari Super Admin (`payout.min_amount_idr`, juga ditegakkan finance).
  const minPayout = setting<number>(usePlatformConfig(), 'payout.min_amount_idr', 50_000);
  const [payout, setPayout] = useState<null | { amount: number; bank: string; number: string; holder: string }>(null);
  const [busy, setBusy] = useState(false);
  const party = parties.find((p) => p.id === partyId);
  const canPayout = !party?.role || ['OWNER', 'FINANCE'].includes(party.role);
  async function submit() {
    setBusy(true);
    try {
      await api('/v1/finance/payouts', {
        body: { party_id: partyId, amount: payout!.amount, bank_account: { bank: payout!.bank, number: payout!.number, holder: payout!.holder } },
        idempotencyKey: true,
      });
      toast.success('Penarikan diajukan');
      setPayout(null);
      qc.invalidateQueries({ queryKey: ['wallet', partyId] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const b = q.data?.balances;
  return (
    <div>
      <PageHeader
        title={title}
        subtitle="Saldo terpisah per sumber. Royalti bulan N terbit paling lambat tanggal 15 bulan N+1; fee off-air cair H+1 setelah acara selesai."
        actions={
          <>
            {parties.length > 1 && (
              <Select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="w-56">
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            <Button variant="ink" disabled={!b?.total || !canPayout} onClick={() => setPayout({ amount: b?.total ?? 0, bank: 'BCA', number: '', holder: party?.name ?? '' })}>
              Tarik saldo
            </Button>
          </>
        }
      />
      <QueryState q={q}>
        {b && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
              <Stat label="Total" value={fmt.idrShort(b.total)} />
              {Object.entries(SOURCE).map(([k, l]) => (
                <Stat key={k} label={l} value={fmt.idrShort((b as any)[k])} />
              ))}
            </div>
            <Card title="Riwayat transaksi">
              {!q.data!.transactions.length ? (
                <Empty title="Belum ada transaksi" />
              ) : (
                <Table head={['Tanggal', 'Sumber', 'Keterangan', 'Jumlah']}>
                  {q.data!.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(t.created_at)}</td>
                      <td className="px-4 py-2.5">{SOURCE[t.source] ?? t.source}</td>
                      <td className="px-4 py-2.5">{t.description}</td>
                      <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${t.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {t.amount < 0 ? '− ' : '+ '}
                        {fmt.idr(Math.abs(t.amount))}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        )}
      </QueryState>
      <Modal open={!!payout} onClose={() => setPayout(null)} title="Tarik saldo">
        {payout && (
          <div className="space-y-3">
            <Field label="Jumlah (Rp)" hint={`Minimal ${fmt.idr(minPayout)}`}>
              <Input type="number" min={minPayout} max={b?.total} value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: Number(e.target.value) })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank">
                <Select value={payout.bank} onChange={(e) => setPayout({ ...payout, bank: e.target.value })}>
                  {['BCA', 'Mandiri', 'BNI', 'BRI', 'CIMB Niaga', 'Permata', 'BSI', 'Jago'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Nomor rekening">
                <Input required inputMode="numeric" value={payout.number} onChange={(e) => setPayout({ ...payout, number: e.target.value })} />
              </Field>
            </div>
            <Field label="Nama pemilik rekening">
              <Input value={payout.holder} onChange={(e) => setPayout({ ...payout, holder: e.target.value })} />
            </Field>
            <p className="text-xs text-b2b-muted">Nama pemilik divalidasi (account name inquiry). Perubahan rekening baru aktif setelah masa tunggu 24 jam.</p>
            <Button variant="ink" loading={busy} disabled={!payout.number || payout.amount < minPayout} onClick={submit}>
              Ajukan penarikan
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function StudioFinance() {
  const artist = useCurrentArtist()!;
  const user = useAuth((s) => s.user);
  const mgmt = (user?.orgs ?? []).filter((o: OrgClaim) => o.type === 'MANAGEMENT');
  return <WalletPanel parties={[{ id: artist.id, name: artist.name, role: artist.role }, ...mgmt.map((m) => ({ id: m.id, name: m.name, role: m.role }))]} />;
}
