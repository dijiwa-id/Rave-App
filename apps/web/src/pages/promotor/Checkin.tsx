import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import StatusMark from '@/components/reactbits/StatusMark';
import { api, ApiError, fmt } from '@/lib/api';
import { safeGet, safeSet } from '@/lib/storage';
import { Button, Card, Field, Input, PageHeader, Select, Stat } from '@/components/ui';
import { BarList } from '@/components/b2b/charts';
import { Empty, QueryState } from '@/components/b2b/common';
import { useOrgEvents } from './Events';

type Result = { ok: boolean; reason?: 'INVALID' | 'DUPLICATE' | 'WRONG_EVENT' | 'EXPIRED_CODE' | 'NETWORK' | 'ERROR'; message?: string; ticket?: { id: string; type_name: string; holder_name: string; checked_in_at?: string | null } };
const REASON: Record<string, string> = {
  INVALID: 'Tiket tidak valid',
  DUPLICATE: 'Sudah check-in sebelumnya',
  WRONG_EVENT: 'Tiket untuk event lain',
  EXPIRED_CODE: 'Kode QR kedaluwarsa — minta pemilik membuka ulang tiket',
  NETWORK: 'Gagal terhubung — scan ulang',
  ERROR: 'Scan tidak dapat diproses',
};

/** Check-in gate (REQ-TIX-04): validasi QR berputar, anti duplikasi, multi-gate, statistik real-time. */
export default function Checkin() {
  const { id } = useParams();
  const nav = useNavigate();
  const events = useOrgEvents();
  const [gate, setGate] = useState(() => safeGet('gema-gate') ?? 'Gate A');
  const [payload, setPayload] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<{ at: string; ok: boolean; text: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const stats = useQuery({
    queryKey: ['checkin-stats', id],
    queryFn: () => api<{ sold: number; checked_in: number; by_gate: { gate: string; count: number }[] }>(`/v1/ticketing/events/${id}/checkin-stats`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  useEffect(() => safeSet('gema-gate', gate), [gate]);

  // Antrean scan: scanner gate mengirim Enter beruntun — scan yang masuk saat pemeriksaan berjalan diproses berurutan, tidak hilang.
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const gateRef = useRef(gate);
  gateRef.current = gate;

  function check(e: React.FormEvent) {
    e.preventDefault();
    const p = payload.trim();
    if (!p) return;
    setPayload('');
    queue.current.push(p);
    void drain();
    input.current?.focus();
  }

  async function drain() {
    if (draining.current) return;
    draining.current = true;
    setBusy(true);
    try {
      while (queue.current.length) await checkOne(queue.current.shift()!);
    } finally {
      draining.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }

  async function checkOne(p: string) {
    try {
      const r = await api<Result>('/v1/ticketing/checkin', { body: { event_id: id, payload: p, gate: gateRef.current } });
      setResult(r);
      setLog((l) => [{ at: new Date().toISOString(), ok: r.ok, text: r.ok ? `${r.ticket?.holder_name ?? 'Tiket'} · ${r.ticket?.type_name ?? ''}` : REASON[r.reason ?? 'INVALID'] }, ...l].slice(0, 20));
      void stats.refetch();
    } catch (err: any) {
      // Gangguan jaringan/server ≠ tiket tidak valid: jangan menolak pemegang tiket sah karena koneksi putus.
      const offline = !(err instanceof ApiError) || err.status >= 500;
      setResult({ ok: false, reason: offline ? 'NETWORK' : 'ERROR', message: offline ? undefined : err.message });
      setLog((l) => [{ at: new Date().toISOString(), ok: false, text: offline ? REASON.NETWORK : (err?.message ?? 'Gagal') }, ...l].slice(0, 20));
    }
  }

  if (!id)
    return (
      <div>
        <PageHeader title="Check-in" subtitle="Pilih event untuk membuka mode scanner gate." />
        <QueryState q={events} empty={events.data && !events.data.data.filter((e) => e.status === 'PUBLISHED').length ? <Empty title="Belum ada event terpublikasi" /> : undefined}>
          <div className="grid gap-3 sm:grid-cols-2">
            {events.data?.data
              .filter((e) => e.status === 'PUBLISHED')
              .map((e) => (
                <button key={e.id} onClick={() => nav(`/promotor/events/${e.id}/checkin`)} className="rounded-xl border border-b2b-line bg-b2b-card p-4 text-left hover:border-b2b-ink">
                  <p className="font-bold">{e.title}</p>
                  <p className="text-sm text-b2b-muted">
                    {fmt.dateTime(e.starts_at)} · {e.venue_name}
                  </p>
                </button>
              ))}
          </div>
        </QueryState>
      </div>
    );

  const ev = events.data?.data.find((e) => e.id === id);
  return (
    <div>
      <PageHeader title={`Check-in · ${ev?.title ?? ''}`} subtitle="Arahkan scanner ke QR tiket (atau tempel payload). QR berputar tiap 15 detik sehingga screenshot tidak berlaku." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <form onSubmit={check} className="flex flex-wrap items-end gap-3">
              <Field label="Gate">
                <Select value={gate} onChange={(e) => setGate(e.target.value)}>
                  {['Gate A', 'Gate B', 'Gate C', 'VIP'].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              </Field>
              <div className="min-w-64 flex-1">
                <Field label="Payload QR">
                  <Input ref={input} autoFocus value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="GEMA1.<ticket_id>.<kode>" className="font-mono" />
                </Field>
              </div>
              <Button variant="ink" type="submit">
                Validasi
              </Button>
            </form>
          </Card>
          <Card>
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center" aria-live="assertive">
              {busy ? (
                <StatusMark status="running" size={72} label="Memeriksa…" />
              ) : result ? (
                <>
                  <StatusMark key={log[0]?.at} status={result.ok ? 'done' : 'failed'} size={88} label={result.ok ? 'Masuk' : result.reason === 'NETWORK' ? 'Gagal terhubung' : 'Ditolak'} doneColor="#16a34a" errorColor="#dc2626" />
                  <p className={`text-2xl font-extrabold ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.ok ? 'BOLEH MASUK' : (result.message ?? REASON[result.reason ?? 'INVALID'])}</p>
                  {result.ticket && (
                    <p className="text-sm text-b2b-muted">
                      {result.ticket.holder_name} · {result.ticket.type_name}
                      {result.reason === 'DUPLICATE' && result.ticket.checked_in_at && ` · check-in ${fmt.dateTime(result.ticket.checked_in_at)}`}
                    </p>
                  )}
                </>
              ) : (
                <StatusMark status="pending" size={72} label="Siap memindai" />
              )}
            </div>
          </Card>
          <Card title="Riwayat gate ini">
            {!log.length ? (
              <p className="text-sm text-b2b-muted">Belum ada pemindaian.</p>
            ) : (
              <ul className="divide-y divide-b2b-line text-sm">
                {log.map((l, i) => (
                  <li key={i} className="flex justify-between py-2">
                    <span className={l.ok ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
                      {l.ok ? '✓' : '✕'} {l.text}
                    </span>
                    <span className="text-xs text-b2b-muted">{new Date(l.at).toLocaleTimeString('id-ID')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Terjual" value={fmt.num(stats.data?.sold)} />
            <Stat label="Sudah masuk" value={fmt.num(stats.data?.checked_in)} hint={stats.data?.sold ? `${Math.round((stats.data.checked_in / stats.data.sold) * 100)}%` : undefined} />
          </div>
          <Card title="Kedatangan per gate">
            <BarList data={(stats.data?.by_gate ?? []).map((g) => ({ label: g.gate, value: g.count }))} unit="orang" />
          </Card>
          <p className="text-xs text-b2b-muted">Statistik diperbarui tiap 5 detik. Aplikasi scanner mobile mendukung mode offline (sinkron saat online).</p>
        </div>
      </div>
    </div>
  );
}
