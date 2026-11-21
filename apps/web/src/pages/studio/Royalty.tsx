import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Download, Info, Printer, Wallet } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { RoyaltyOverview, RoyaltyStatementDetail } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, PageHeader, Stat, toast } from '@/components/ui';
import { downloadText, QueryState, Table, useCurrentArtist } from '@/components/b2b/common';
import { BarList, LineChart, SERIES } from '@/components/b2b/charts';
import { useDict } from '@/lib/i18n';

type Dict = ReturnType<typeof useDict<'b2b'>>['royalty'];
const monthLabel = (p: string, opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' }) => fmt.date(`${p}-15T00:00:00Z`, opts);

/** Artist Studio → Royalti: statement bulanan per org artis (atau akun pribadi untuk pihak split perorangan). */
export default function Royalty() {
  const t = useDict('b2b').royalty;
  const artist = useCurrentArtist();
  const user = useAuth((s) => s.user);
  const [mine, setMine] = useState(false);
  const partyId = mine ? user?.id : artist?.id;
  const q = useQuery({
    queryKey: ['royalty', partyId],
    queryFn: () => api<RoyaltyOverview>('/v1/royalty/statements', { query: { party_id: partyId } }),
    enabled: !!partyId,
  });
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(q.data?.data[0]?.period ?? null), [q.data]);
  const d = q.data;

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Link to="/studio/finance">
            <Button variant="outline-ink" size="sm" icon={<Wallet className="size-4" />}>
              {t.wallet}
            </Button>
          </Link>
        }
      />
      {artist && user && (
        <div className="-mt-3 mb-6 flex flex-wrap gap-2" role="radiogroup">
          {[
            [false, t.partyOrg(artist.name)],
            [true, t.partyMe],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              role="radio"
              aria-checked={mine === v}
              onClick={() => setMine(v as boolean)}
              className={cx('border px-3 py-1 text-xs font-bold transition', mine === v ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:text-b2b-ink')}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
      <QueryState q={q}>
        {d && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label={t.received} value={fmt.idrShort(d.summary.lifetime_payable)} hint={t.receivedHint} />
              <Stat label={t.reserve} value={fmt.idrShort(d.summary.reserve_pending)} hint={d.summary.next_reserve_release ? t.reserveHint(fmt.date(d.summary.next_reserve_release)) : t.reserveNone} />
              <Stat label={t.carry} value={fmt.idrShort(d.summary.carry_forward)} hint={t.carryHint(fmt.idr(d.params.min_payable))} />
              <Stat label={t.held} value={fmt.idrShort(d.summary.held)} hint={t.heldHint} />
            </div>

            {d.held_tracks.length > 0 && <HeldBanner d={d} t={t} />}

            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2" title={t.trend}>
                {d.data.length ? (
                  <LineChart data={[...d.data].reverse().map((r) => ({ x: monthLabel(r.period, { month: 'short', year: '2-digit' }), y: r.gross }))} label={t.gross} format={fmt.idrShort} color={SERIES[0]} />
                ) : (
                  <p className="text-sm text-b2b-muted">{t.emptyBody}</p>
                )}
              </Card>
              <Card title={t.nextTitle(monthLabel(d.next.period))}>
                {d.next.status && <Badge tone="amber">{t.nextStatus[d.next.status]}</Badge>}
                <p className="mt-2 text-sm text-b2b-muted">{t.nextBody(d.next.statement_day)}</p>
                <HowItWorks d={d} t={t} />
              </Card>
            </div>

            <Card title={t.statements}>
              {!d.data.length ? (
                <div className="py-6 text-center">
                  <p className="font-bold">{t.empty}</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-b2b-muted">{t.emptyBody}</p>
                </div>
              ) : (
                <Table head={[t.col.period, t.col.streams, t.col.gross, t.col.reserve, t.col.tax, t.col.payable, t.col.carry, '']}>
                  {d.data.map((r) => (
                    <tr key={r.period} className={cx(open === r.period && 'bg-b2b-bg')}>
                      <td className="font-semibold whitespace-nowrap">{monthLabel(r.period)}</td>
                      <td className="tabular-nums">{fmt.num(r.streams)}</td>
                      <td className="tabular-nums">{fmt.idr(r.gross)}</td>
                      <td className="tabular-nums text-b2b-muted">− {fmt.idr(r.reserve)}</td>
                      <td className="tabular-nums text-b2b-muted">− {fmt.idr(r.withholding)}</td>
                      <td className="font-bold tabular-nums">{fmt.idr(r.payable)}</td>
                      <td className="tabular-nums text-b2b-muted">{r.carry_out ? fmt.idr(r.carry_out) : '—'}</td>
                      <td className="text-right">
                        <button className="inline-flex items-center gap-1 text-xs font-bold underline" aria-expanded={open === r.period} onClick={() => setOpen(open === r.period ? null : r.period)}>
                          {t.view} <ChevronDown className={cx('size-3.5 transition', open === r.period && 'rotate-180')} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            {open && partyId && <StatementDetail period={open} partyId={partyId} t={t} />}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function HeldBanner({ d, t }: { d: RoyaltyOverview; t: Dict }) {
  return (
    <section className="border-2 border-amber-500/70 bg-amber-500/10 p-4 text-b2b-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-bold">{t.heldTitle(fmt.idr(d.summary.held), d.held_tracks.length)}</p>
            <p className="mt-1 text-sm">{t.heldBody}</p>
          </div>
        </div>
        <Link to="/studio/releases">
          <Button variant="ink" size="sm">
            {t.fixSplits}
          </Button>
        </Link>
      </div>
      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {d.held_tracks.slice(0, 8).map((h) => (
          <li key={`${h.period}-${h.track_id}`} className="flex justify-between gap-3 border-t border-amber-500/40 pt-1">
            <span className="truncate">
              <span className="font-semibold">{h.title}</span> · {t.heldReason[h.held_reason]}
            </span>
            <span className="tabular-nums">{fmt.idr(h.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HowItWorks({ d, t }: { d: RoyaltyOverview; t: Dict }) {
  const [open, setOpen] = useState(false);
  const items = t.howItems(d.params.rightsholder_share_pct, d.params.publishing_share_pct, d.params.reserve_pct, d.params.reserve_release_months, fmt.idr(d.params.min_payable), d.params.withholding_pct).split('\n');
  return (
    <div className="mt-4 border-t border-dashed border-b2b-line pt-3">
      <button className="flex w-full items-center justify-between text-left text-sm font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-2">
          <Info className="size-4" /> {t.how}
        </span>
        <ChevronDown className={cx('size-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs text-b2b-muted">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StatementDetail({ period, partyId, t }: { period: string; partyId: string; t: Dict }) {
  const q = useQuery({ queryKey: ['royalty-statement', partyId, period], queryFn: () => api<RoyaltyStatementDetail>(`/v1/royalty/statements/${period}`, { query: { party_id: partyId } }) });
  const s = q.data;
  async function csv() {
    try {
      const res = await api<Response>(`/v1/royalty/statements/${period}/export.csv`, { query: { party_id: partyId }, raw: true });
      if (!res.ok) throw new Error(String(res.status));
      downloadText(`royalti-${period}.csv`, await res.text());
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <Card
      title={t.detailTitle(monthLabel(period))}
      action={
        s && (
          <>
            <Button variant="outline-ink" size="sm" icon={<Download className="size-4" />} onClick={csv}>
              {t.csv}
            </Button>
            <Button variant="outline-ink" size="sm" icon={<Printer className="size-4" />} onClick={() => printStatement(s, t)}>
              {t.print}
            </Button>
          </>
        )
      }
    >
      <QueryState q={q}>
        {s && (
          <div className="space-y-6">
            <p className="text-xs text-b2b-muted">
              {t.issued(fmt.date(s.published_at))} · {t.model[s.model]} · {s.party.name}
            </p>
            <div className="grid gap-6 lg:grid-cols-3">
              <div>
                <h3 className="mb-3 text-sm font-bold">{t.waterfall}</h3>
                <dl className="space-y-2 text-sm">
                  <Row k={t.w.gross} v={fmt.idr(s.totals.gross)} />
                  <Row k={t.w.reserve(s.params.reserve_pct)} v={`− ${fmt.idr(s.totals.reserve)}`} muted />
                  <Row k={t.w.tax(s.params.withholding_pct)} v={`− ${fmt.idr(s.totals.withholding)}`} muted />
                  {s.totals.carry_in > 0 && <Row k={t.w.carryIn} v={`+ ${fmt.idr(s.totals.carry_in)}`} muted />}
                  <div className="border-t border-dashed border-b2b-line pt-2">
                    <Row k={t.w.payable} v={fmt.idr(s.totals.payable)} strong />
                    {s.totals.carry_out > 0 && <Row k={t.w.carryOut} v={fmt.idr(s.totals.carry_out)} muted />}
                  </div>
                </dl>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold">{t.bySource}</h3>
                <BarList
                  data={(['premium', 'ads', 'pool'] as const).filter((k) => s.by_source[k] > 0).map((k) => ({ label: t.source[k], value: s.by_source[k] }))}
                  format={fmt.idrShort}
                />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold">{t.byCity}</h3>
                <BarList data={s.by_city.map((c) => ({ label: c.city, value: c.amount }))} format={fmt.idrShort} max={6} />
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-bold">{t.tracks}</h3>
              <Table head={[t.track, t.right, t.col.streams, t.source.premium, t.source.ads, 'Pool', t.col.gross]}>
                {s.lines.map((l, i) => (
                  <tr key={`${l.track_id}-${l.type}-${i}`}>
                    <td>
                      <span className="font-semibold">{l.title}</span>
                      <span className="block text-xs text-b2b-muted">
                        {l.artist_name}
                        {l.isrc ? ` · ${l.isrc}` : ''}
                      </span>
                      {l.released_from_hold && <Badge tone="blue" className="mt-1">{t.fromHold(monthLabel(l.source_period, { month: 'short', year: 'numeric' }))}</Badge>}
                    </td>
                    <td className="whitespace-nowrap">
                      {t.rightType[l.type]} · {l.pct}%
                    </td>
                    <td className="tabular-nums">{fmt.num(l.streams)}</td>
                    <td className="tabular-nums">{fmt.idr(l.premium)}</td>
                    <td className="tabular-nums">{fmt.idr(l.ads)}</td>
                    <td className="tabular-nums">{fmt.idr(l.pool)}</td>
                    <td className="font-bold tabular-nums">{fmt.idr(l.total)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        )}
      </QueryState>
    </Card>
  );
}

function Row({ k, v, strong, muted }: { k: string; v: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cx(strong ? 'font-bold' : muted ? 'text-b2b-muted' : '')}>{k}</dt>
      <dd className={cx('tabular-nums', strong ? 'text-lg font-extrabold' : 'font-semibold', muted && 'text-b2b-muted')}>{v}</dd>
    </div>
  );
}

/** Statement cetak (A4) di jendela terpisah — tanpa navigasi dasbor. */
function printStatement(s: RoyaltyStatementDetail, t: Dict) {
  const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const rows = s.lines
    .map((l) => `<tr><td>${esc(l.title)}<br><small>${esc(l.artist_name)} ${l.isrc ? '· ' + esc(l.isrc) : ''}</small></td><td>${esc(t.rightType[l.type])} ${l.pct}%</td><td class="n">${fmt.num(l.streams)}</td><td class="n">${fmt.idr(l.total)}</td></tr>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.detailTitle(s.period))} — ${esc(s.party.name)}</title>
<style>body{font:12px/1.5 system-ui,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap}small{color:#666}.sum td{border:0;padding:2px 4px}.tot td{font-weight:700;border-top:2px solid #111}footer{margin-top:24px;color:#666;font-size:11px}</style></head><body>
<h1>RAVE — ${esc(t.detailTitle(monthLabel(s.period)))}</h1><p>${esc(s.party.name)} · ${esc(t.issued(fmt.date(s.published_at)))} · ${esc(t.model[s.model])}</p>
<table class="sum"><tr><td>${esc(t.w.gross)}</td><td class="n">${fmt.idr(s.totals.gross)}</td></tr><tr><td>${esc(t.w.reserve(s.params.reserve_pct))}</td><td class="n">− ${fmt.idr(s.totals.reserve)}</td></tr>
<tr><td>${esc(t.w.tax(s.params.withholding_pct))}</td><td class="n">− ${fmt.idr(s.totals.withholding)}</td></tr>${s.totals.carry_in ? `<tr><td>${esc(t.w.carryIn)}</td><td class="n">+ ${fmt.idr(s.totals.carry_in)}</td></tr>` : ''}
<tr class="tot"><td>${esc(t.w.payable)}</td><td class="n">${fmt.idr(s.totals.payable)}</td></tr>${s.totals.carry_out ? `<tr><td>${esc(t.w.carryOut)}</td><td class="n">${fmt.idr(s.totals.carry_out)}</td></tr>` : ''}</table>
<table><thead><tr><th>${esc(t.track)}</th><th>${esc(t.right)}</th><th class="n">${esc(t.col.streams)}</th><th class="n">${esc(t.col.gross)}</th></tr></thead><tbody>${rows}</tbody></table>
<footer>${esc(t.printFooter)}</footer><script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank', 'noopener=no,width=900,height=1000');
  if (!w) return toast.error('Popup diblokir browser');
  w.document.write(html);
  w.document.close();
}
