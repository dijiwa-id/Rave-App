// Royalti streaming bulanan (BRD v3.0 §4.3, §6.9 REQ-ROY-02..04, §7.5; TDD §11.4). Pemilik: finance (periode, statement, ledger).
// Siklus: tutup periode → hitung draf (otomatis tgl `royalty.compute_day` atau manual) → Finance meninjau & mengisi pendapatan
// iklan → setujui (orang berbeda dari penghitung) → terbit (otomatis tgl `royalty.statement_day` atau manual): jurnal ledger,
// statement per pihak, saldo wallet sumber `royalty`, notifikasi. Cadangan koreksi dilepas otomatis setelah masa cadangan.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LedgerAccounts,
  computeRoyalty,
  currentPeriod,
  PERIOD_RE,
  periodRange,
  premiumRevenue,
  previousPeriod,
  adRevenue,
  scaleTo,
  splitTrack,
  statementMath,
  sumSource,
  perStream,
  type BySource,
  type ListenerInput,
  type PremiumMember,
  type RightsShare,
  type RoyaltyModel,
} from '@rave/domain';
import { L, type ServiceReport } from '@rave/domain/reports';
import {
  callService,
  config,
  conflict,
  forbidden,
  hasPermission,
  isSuperAdmin,
  notFound,
  orgMembership,
  publish,
  requireAuth,
  requirePermission,
  requireSuperAdmin,
  settings,
  unprocessable,
  uuidv7,
  type AuthUser,
  type Client,
  type Db,
  type Job,
  type ServiceContext,
} from '@rave/service-kit';
import { C, D, payableAccount, post, serial } from './ledger.js';
import { FAST_CLOCK } from './jobs.js';
import { readFile } from 'node:fs/promises';
import { buildLmknWorkbook, LMKN_LOG_COLUMNS, lmknLogValues, mmss, type LmknIdentity, type LmknLogRow } from './lmkn.js';

const ACC = {
  expense: 'expense:royalty:streaming',
  held: 'liability:royalty:held',
  unclaimed: 'liability:royalty:unclaimed',
  reserve: (p: string) => `liability:royalty:reserve:${p}`,
  carry: (p: string) => `liability:royalty:carry:${p}`,
};
/** Dev/demo: izinkan menghitung bulan berjalan (data stream lokal hanya bulan ini). Produksi: hanya periode yang sudah ditutup. */
export const ALLOW_OPEN_PERIOD = (process.env.ROYALTY_ALLOW_OPEN_PERIOD ?? (config.isDev ? '1' : '0')) === '1';
const num = (k: string) => settings.num(k);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
/** Nama pihak split per jenis hak (tanpa awalan "Pencipta — ") untuk kolom pencipta/produser laporan LMKN. */
const names = (t: TrackInfo | undefined, type: 'MASTER' | 'PUBLISHING') =>
  [...new Set((t?.shares ?? []).filter((s) => s.type === type).map((s) => s.party_name.replace(/^(Pencipta|Komposer)\s*[—–-]\s*/i, '').trim()).filter(Boolean))].join(', ') || null;
const wibDay = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).getUTCDate();
const nextPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

interface TrackInfo {
  track_id: string;
  title: string;
  isrc: string | null;
  artist_id: string;
  artist_name: string;
  artist_org_id: string | null;
  release_title: string;
  upc: string | null;
  duration_ms: number | null;
  label: string | null;
  shares: { type: 'MASTER' | 'PUBLISHING'; party_name: string; email: string | null; pct: number; approved: boolean }[];
}
interface Party {
  key: string;
  type: 'org' | 'user' | 'unclaimed';
  id: string | null;
  email: string | null;
  name: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Perhitungan draf
// ---------------------------------------------------------------------------------------------------------------------

export async function computePeriod(db: Db, period: string, input: { adRevenue: number; premiumRevenue: number | null; note?: string | null; by: AuthUser | null }) {
  const { from, to } = periodRange(period);
  if (to.getTime() > Date.now() && !(ALLOW_OPEN_PERIOD && period === currentPeriod())) throw conflict('Periode belum berakhir — royalti dihitung setelah bulan ditutup');
  const existing = await db.one(`SELECT status FROM royalty_periods WHERE period=$1`, [period]);
  if (existing && existing.status !== 'DRAFT') throw conflict(`Periode ${period} sudah ${existing.status === 'APPROVED' ? 'disetujui' : 'diterbitkan'}`);

  // 1. Data mentah dari service pemilik.
  const q = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const [streamRes, premRes, impRes] = await Promise.all([
    callService<{ rows: { user_id: string; track_id: string; artist_id: string; n: number }[]; cities: { track_id: string; city: string; n: number }[]; usage: { day: string; track_id: string; first_time: string; plays: number; listeners: number }[]; excluded: { streams: number; listeners: number } }>('finance', 'playback', `/internal/royalty/streams?${q}`),
    callService<{ data: { user_id: string; member_type: PremiumMember['memberType']; member_updated_at: string | null; member_until: string | null }[] }>('finance', 'iam', '/internal/royalty/premium'),
    callService<{ data: { user_id: string; n: number }[] }>('finance', 'ads', `/internal/royalty/impressions?${q}`),
  ]);

  // 2. Atribusi pendapatan per pendengar (DPP Premium prorata; iklan menurut impresi) → angka final Finance.
  const premAuto = premiumRevenue(
    premRes.data.map((m) => ({ userId: m.user_id, memberType: m.member_type, since: m.member_updated_at ? new Date(m.member_updated_at) : null, until: m.member_until ? new Date(m.member_until) : null })),
    { INDIVIDUAL: num('subscription.price_individual_idr'), STUDENT: num('subscription.price_student_idr'), DUO: num('subscription.price_duo_idr'), ppnPct: 11 },
    period,
  );
  const premAutoTotal = Math.round([...premAuto.values()].reduce((a, b) => a + b, 0));
  const prem = scaleTo(premAuto, input.premiumRevenue);
  const ads = adRevenue(input.adRevenue, new Map(impRes.data.map((r) => [r.user_id, r.n])));
  const byUser = new Map<string, ListenerInput>();
  for (const r of streamRes.rows) {
    const l = byUser.get(r.user_id) ?? { userId: r.user_id, premium: prem.get(r.user_id) ?? 0, ads: ads.get(r.user_id) ?? 0, streams: {} };
    l.streams[r.track_id] = (l.streams[r.track_id] ?? 0) + r.n;
    byUser.set(r.user_id, l);
  }
  const cfg = {
    model: settings.get<RoyaltyModel>('royalty.model'),
    rightsholderSharePct: num('royalty.rightsholder_share_pct'),
    hybridFloor: num('royalty.hybrid_floor_idr'),
  };
  const result = computeRoyalty([...byUser.values()], cfg);

  // 3. Registri hak: lagu periode ini + lagu tertahan periode lalu (dicek ulang apakah splitnya kini disetujui).
  const heldBefore = await db.query(
    `SELECT rt.* FROM royalty_tracks rt JOIN royalty_periods p ON p.period = rt.period
      WHERE p.status = 'PUBLISHED' AND rt.held_reason IS NOT NULL AND rt.released_in IS NULL AND rt.period <> $1`,
    [period],
  );
  const ids = [...new Set([...result.tracks.map((t) => t.trackId), ...heldBefore.map((h) => h.track_id)])];
  const rights = new Map<string, TrackInfo>();
  for (let i = 0; i < ids.length; i += 1000) {
    const r = await callService<{ data: TrackInfo[] }>('finance', 'catalog', '/internal/royalty/rights', { method: 'POST', body: { track_ids: ids.slice(i, i + 1000) } });
    for (const t of r.data) rights.set(t.track_id, t);
  }
  // Email pihak → akun RAVE. Pihak tak terdaftar → royalti "tak bertuan" ditahan sampai pemilik email mendaftar.
  const unclaimedBefore = await db.query(
    `SELECT l.* FROM royalty_lines l JOIN royalty_periods p ON p.period = l.period
      WHERE p.status = 'PUBLISHED' AND l.party_type = 'unclaimed' AND l.claimed_in IS NULL`,
  );
  const emails = [...new Set([...[...rights.values()].flatMap((t) => t.shares.map((s) => s.email).filter((e): e is string => !!e)), ...unclaimedBefore.map((u) => u.party_email)])];
  const resolved = new Map<string, { user_id: string; name: string }>();
  if (emails.length) {
    const r = await callService<{ data: { email: string; user_id: string; name: string }[] }>('finance', 'iam', '/internal/users/resolve-emails', { method: 'POST', body: { emails } });
    for (const u of r.data) resolved.set(u.email, u);
  }
  const partyOf = (t: TrackInfo, s: TrackInfo['shares'][number]): Party | null => {
    if (!s.email) return t.artist_org_id ? { key: `org:${t.artist_org_id}`, type: 'org', id: t.artist_org_id, email: null, name: t.artist_name } : null;
    const u = resolved.get(s.email);
    if (u) return { key: `user:${u.user_id}`, type: 'user', id: u.user_id, email: s.email, name: s.party_name || u.name };
    return { key: `email:${s.email}`, type: 'unclaimed', id: null, email: s.email, name: s.party_name };
  };
  const pubPct = num('royalty.publishing_share_pct');

  type Line = { source_period: string; track_id: string; party: Party; type: 'MASTER' | 'PUBLISHING'; pct: number; amount: BySource };
  const lines: Line[] = [];
  const trackRows: any[] = [];
  const splitInto = (t: TrackInfo | undefined, amount: BySource, sourcePeriod: string): string | null => {
    if (!t || !t.shares.length) return 'NO_RIGHTS';
    const parties = t.shares.map((s) => partyOf(t, s));
    if (parties.some((p) => !p)) return 'NO_PAYEE';
    const shares: RightsShare[] = t.shares.map((s, i) => ({ type: s.type, party: String(i), pct: s.pct, approved: s.approved }));
    const sp = splitTrack(amount, shares, pubPct);
    if (sp.held) return 'SPLIT_PENDING';
    for (const l of sp.lines) {
      const s = t.shares[Number(l.party)];
      lines.push({ source_period: sourcePeriod, track_id: t.track_id, party: parties[Number(l.party)]!, type: l.type, pct: s.pct, amount: l.amount });
    }
    return null;
  };

  const citiesBy = new Map<string, { city: string; n: number }[]>();
  for (const c of streamRes.cities) citiesBy.set(c.track_id, [...(citiesBy.get(c.track_id) ?? []), { city: c.city, n: c.n }]);
  let held = 0;
  for (const tr of result.tracks) {
    const info = rights.get(tr.trackId);
    const reason = splitInto(info, tr.amount, period);
    if (reason) held += sumSource(tr.amount);
    trackRows.push({
      track_id: tr.trackId,
      title: info?.title ?? 'Lagu tidak dikenal',
      isrc: info?.isrc ?? null,
      release_title: info?.release_title ?? null,
      upc: info?.upc ?? null,
      artist_id: info?.artist_id ?? null,
      artist_name: info?.artist_name ?? null,
      artist_org_id: info?.artist_org_id ?? null,
      streams: tr.streams,
      listeners: tr.listeners,
      amount: tr.amount,
      cities: (citiesBy.get(tr.trackId) ?? []).sort((a, b) => b.n - a.n),
      held_reason: reason,
      duration_ms: info?.duration_ms ?? null,
      label: info?.label ?? null,
      composers: names(info, 'PUBLISHING'),
      producers: info?.label || names(info, 'MASTER'),
    });
  }
  // Royalti tertahan periode lalu yang kini splitnya lengkap → dibagi di periode ini.
  const releasedHeld: { period: string; track_id: string; total: number }[] = [];
  for (const h of heldBefore) {
    const amt = { premium: Number(h.premium), ads: Number(h.ads), pool: Number(h.pool) };
    if (!splitInto(rights.get(h.track_id), amt, h.period)) releasedHeld.push({ period: h.period, track_id: h.track_id, total: Number(h.total) });
  }
  // Royalti tak bertuan periode lalu yang emailnya kini terdaftar → diklaim ke akun tsb.
  const claimed: string[] = [];
  for (const u of unclaimedBefore) {
    const r = resolved.get(u.party_email);
    if (!r) continue;
    claimed.push(u.id);
    lines.push({
      source_period: u.source_period,
      track_id: u.track_id,
      party: { key: `user:${r.user_id}`, type: 'user', id: r.user_id, email: u.party_email, name: u.party_name },
      type: u.type,
      pct: Number(u.pct),
      amount: { premium: Number(u.premium), ads: Number(u.ads), pool: Number(u.pool) },
    });
  }

  // 4. Statement per pihak (cadangan, PPh, ambang terutang, saldo bawaan).
  const stCfg = { reservePct: num('royalty.reserve_pct'), withholdingPct: num('royalty.withholding_pct'), minPayable: num('royalty.min_payable_idr') };
  const byParty = new Map<string, { party: Party; gross: number; tracks: Set<string>; streams: number }>();
  const trackStreams = new Map(result.tracks.map((t) => [t.trackId, t.streams]));
  for (const l of lines) {
    if (l.party.type === 'unclaimed') continue;
    const p = byParty.get(l.party.key) ?? { party: l.party, gross: 0, tracks: new Set<string>(), streams: 0 };
    p.gross += sumSource(l.amount);
    if (!p.tracks.has(l.track_id)) {
      p.tracks.add(l.track_id);
      if (l.source_period === period) p.streams += trackStreams.get(l.track_id) ?? 0;
    }
    byParty.set(l.party.key, p);
  }
  const prevCarry = await db.query(
    `SELECT DISTINCT ON (s.party_key) s.party_key, s.party_type, s.party_id, s.party_name, s.carry_out FROM royalty_statements s JOIN royalty_periods p ON p.period = s.period
      WHERE p.status = 'PUBLISHED' AND s.period < $1 ORDER BY s.party_key, s.period DESC`,
    [period],
  );
  for (const c of prevCarry) {
    if (Number(c.carry_out) > 0 && !byParty.has(c.party_key))
      byParty.set(c.party_key, { party: { key: c.party_key, type: c.party_type, id: c.party_id, email: null, name: c.party_name }, gross: 0, tracks: new Set(), streams: 0 });
  }
  const carryIn = new Map(prevCarry.map((c) => [c.party_key, Number(c.carry_out)]));
  const statements = [...byParty.values()].map((p) => ({ ...p, math: statementMath(p.gross, carryIn.get(p.party.key) ?? 0, stCfg) }));
  const unclaimed = lines.filter((l) => l.party.type === 'unclaimed').reduce((a, l) => a + sumSource(l.amount), 0);

  // 5. Anomali untuk ditinjau Finance (BRD §7.5 "review Finance atas anomali").
  const anomalies: { kind: string; severity: 'info' | 'warn'; message: string; ref?: string }[] = [];
  const rates = result.tracks.map((t) => perStream(sumSource(t.amount), t.streams) ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
  for (const t of result.tracks) {
    const r = perStream(sumSource(t.amount), t.streams) ?? 0;
    if (median > 0 && r > median * 5 && t.streams >= 5)
      anomalies.push({ kind: 'RATE_OUTLIER', severity: 'warn', message: `Tarif per stream ${r.toFixed(2)} (> 5× median ${median.toFixed(2)}) — konsentrasi pendengar Premium kecil`, ref: t.trackId });
    if (t.listeners === 1 && t.streams >= 50) anomalies.push({ kind: 'SINGLE_LISTENER', severity: 'warn', message: `${t.streams} stream dari satu pendengar`, ref: t.trackId });
  }
  if (streamRes.excluded.streams) anomalies.push({ kind: 'FRAUD_EXCLUDED', severity: 'info', message: `${streamRes.excluded.streams} stream dari ${streamRes.excluded.listeners} pendengar dikecualikan (fraud)` });
  const heldCount = trackRows.filter((t) => t.held_reason).length;
  if (heldCount) anomalies.push({ kind: 'HELD', severity: 'warn', message: `${heldCount} lagu ditahan (split belum disetujui / registri hak tidak lengkap)` });
  const unclaimedEmails = new Set(lines.filter((l) => l.party.type === 'unclaimed').map((l) => l.party.email));
  if (unclaimedEmails.size) anomalies.push({ kind: 'UNCLAIMED', severity: 'info', message: `${unclaimedEmails.size} pihak split belum punya akun RAVE — royalti ditahan sampai mendaftar` });
  if (input.adRevenue <= 0 && impRes.data.length) anomalies.push({ kind: 'AD_REVENUE_ZERO', severity: 'warn', message: 'Pendapatan iklan belum diisi padahal ada impresi iklan berbayar' });
  if (input.adRevenue > 0 && !impRes.data.length) anomalies.push({ kind: 'AD_UNATTRIBUTED', severity: 'warn', message: 'Pendapatan iklan diisi tetapi tidak ada impresi iklan berbayar yang selesai — tidak dapat diatribusikan ke pendengar (tetap milik platform)' });
  const adAttributed = [...byUser.values()].reduce((a, l) => a + l.ads, 0);
  if (input.adRevenue > 0 && impRes.data.length && adAttributed < input.adRevenue * 0.99)
    anomalies.push({ kind: 'AD_PARTIAL', severity: 'info', message: `${Math.round(((input.adRevenue - adAttributed) * 100) / input.adRevenue)}% pendapatan iklan berasal dari pendengar tanpa stream qualified (tidak dibagikan)` });
  if (!streamRes.rows.length) anomalies.push({ kind: 'NO_STREAMS', severity: 'warn', message: 'Tidak ada stream qualified di periode ini' });

  // 6. Simpan draf (menimpa draf sebelumnya).
  const distributed = statements.reduce((a, s) => a + s.gross, 0);
  const releasedHeldTotal = releasedHeld.reduce((a, r) => a + r.total, 0);
  await serial(db, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('royalty'), hashtext($1))`, [period]);
    const cur = (await c.query(`SELECT status FROM royalty_periods WHERE period=$1 FOR UPDATE`, [period])).rows[0];
    if (cur && cur.status !== 'DRAFT') throw conflict(`Periode ${period} sudah tidak berstatus draf`);
    await c.query(`DELETE FROM royalty_periods WHERE period=$1`, [period]);
    await c.query(
      `INSERT INTO royalty_periods (period, status, model, rightsholder_share_pct, publishing_share_pct, reserve_pct, withholding_pct, min_payable, hybrid_floor,
         premium_revenue_auto, premium_revenue, premium_override, ad_revenue, attributed_revenue, rightsholder_pool, distributed, held, unclaimed, released_held,
         streams, listeners, listeners_direct, listeners_pooled, premium_listeners, excluded_streams, excluded_listeners, tracks, parties, anomalies, note,
         computed_at, computed_by, computed_by_name)
       VALUES ($1,'DRAFT',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, now(), $30, $31)`,
      [
        period, cfg.model, cfg.rightsholderSharePct, pubPct, stCfg.reservePct, stCfg.withholdingPct, stCfg.minPayable, cfg.hybridFloor,
        premAutoTotal, input.premiumRevenue ?? premAutoTotal, input.premiumRevenue != null, input.adRevenue, result.revenue.total, result.rightsholderPool,
        distributed, held, unclaimed, releasedHeldTotal,
        result.tracks.reduce((a, t) => a + t.streams, 0), result.listeners.total, result.listeners.direct, result.listeners.pooled,
        [...byUser.values()].filter((l) => l.premium > 0).length, streamRes.excluded.streams, streamRes.excluded.listeners, result.tracks.length, statements.length,
        JSON.stringify(anomalies), input.note ?? null, input.by?.sub && isUuid(input.by.sub) ? input.by.sub : null, input.by?.name ?? (input.by ? input.by.email : 'Sistem'),
      ],
    );
    for (const t of trackRows)
      await c.query(
        `INSERT INTO royalty_tracks (period, track_id, title, isrc, release_title, upc, artist_id, artist_name, artist_org_id, streams, listeners, premium, ads, pool, total, cities, held_reason, duration_ms, label, composers, producers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [period, t.track_id, t.title, t.isrc, t.release_title, t.upc, t.artist_id, t.artist_name, t.artist_org_id, t.streams, t.listeners, t.amount.premium, t.amount.ads, t.amount.pool, sumSource(t.amount), JSON.stringify(t.cities), t.held_reason, t.duration_ms, t.label, t.composers, t.producers],
      );
    // Log harian (laporan penggunaan LMKN) — disisipkan per 500 baris.
    for (let i = 0; i < streamRes.usage.length; i += 500) {
      const chunk = streamRes.usage.slice(i, i + 500);
      await c.query(
        `INSERT INTO royalty_usage (period, day, track_id, first_time, plays, listeners)
         SELECT $1, d::date, t::uuid, f, p, l FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[]) AS x(d, t, f, p, l)`,
        [period, chunk.map((u) => u.day), chunk.map((u) => u.track_id), chunk.map((u) => u.first_time), chunk.map((u) => u.plays), chunk.map((u) => u.listeners)],
      );
    }
    for (const l of lines)
      await c.query(
        `INSERT INTO royalty_lines (id, period, source_period, track_id, party_key, party_type, party_id, party_email, party_name, type, pct, premium, ads, pool, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [uuidv7(), period, l.source_period, l.track_id, l.party.key, l.party.type, l.party.id, l.party.email, l.party.name, l.type, l.pct, l.amount.premium, l.amount.ads, l.amount.pool, sumSource(l.amount)],
      );
    for (const s of statements)
      await c.query(
        `INSERT INTO royalty_statements (period, party_key, party_type, party_id, party_name, gross, reserve, withholding, carry_in, payable, carry_out, tracks, streams)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [period, s.party.key, s.party.type, s.party.id, s.party.name, s.math.gross, s.math.reserve, s.math.withholding, s.math.carryIn, s.math.payable, s.math.carryOut, s.tracks.size, s.streams],
      );
    // Metadata pelepasan untuk diterapkan saat terbit.
    await c.query(`UPDATE royalty_periods SET anomalies = anomalies || $2::jsonb WHERE period=$1`, [
      period, JSON.stringify(releasedHeld.length || claimed.length ? [{ kind: 'RELEASES', severity: 'info', message: `${releasedHeld.length} lagu tertahan dilepas, ${claimed.length} baris tak bertuan diklaim`, ref: JSON.stringify({ held: releasedHeld.map((r) => [r.period, r.track_id]), claimed }) }] : []),
    ]);
  });
  return periodDetail(db, period);
}

// ---------------------------------------------------------------------------------------------------------------------
// Persetujuan & penerbitan
// ---------------------------------------------------------------------------------------------------------------------

export async function approvePeriod(db: Db, period: string, u: AuthUser) {
  await serial(db, async (c) => {
    const p = (await c.query(`SELECT * FROM royalty_periods WHERE period=$1 FOR UPDATE`, [period])).rows[0];
    if (!p) throw notFound('Periode royalti');
    if (p.status !== 'DRAFT') throw conflict(`Periode berstatus ${p.status}`);
    // Kontrol ganda: penyetuju ≠ penghitung (Super Admin boleh, tercatat atas namanya).
    if (p.computed_by && p.computed_by === u.sub && !isSuperAdmin(u)) throw forbidden('Persetujuan harus oleh anggota Finance lain (kontrol ganda)');
    await c.query(`UPDATE royalty_periods SET status='APPROVED', approved_at=now(), approved_by=$2, approved_by_name=$3 WHERE period=$1`, [period, u.sub, u.name ?? u.email]);
  });
  return periodDetail(db, period);
}

export async function reopenPeriod(db: Db, period: string) {
  const r = await db.query(`UPDATE royalty_periods SET status='DRAFT', approved_at=NULL, approved_by=NULL, approved_by_name=NULL WHERE period=$1 AND status='APPROVED' RETURNING period`, [period]);
  if (!r.length) throw conflict('Hanya periode berstatus disetujui yang dapat dibuka kembali');
  return periodDetail(db, period);
}

export async function publishPeriod(db: Db, period: string, by: string | null) {
  await serial(db, async (c) => {
    const p = (await c.query(`SELECT * FROM royalty_periods WHERE period=$1 FOR UPDATE`, [period])).rows[0];
    if (!p) throw notFound('Periode royalti');
    if (p.status === 'PUBLISHED') return;
    if (p.status !== 'APPROVED') throw conflict('Periode harus disetujui sebelum diterbitkan');
    const sts = (await c.query(`SELECT * FROM royalty_statements WHERE period=$1`, [period])).rows;
    const releases = (p.anomalies as any[]).find((a) => a.kind === 'RELEASES');
    const rel = releases?.ref ? (JSON.parse(releases.ref) as { held: [string, string][]; claimed: string[] }) : { held: [], claimed: [] };
    const claimedTotal = rel.claimed.length ? Number((await c.query(`SELECT coalesce(sum(total),0) AS s FROM royalty_lines WHERE id = ANY($1::uuid[])`, [rel.claimed])).rows[0].s) : 0;

    // Jurnal: beban royalti periode (+ pelepasan tertahan/tak bertuan lama, + saldo bawaan) = tertahan + tak bertuan + Σ pihak.
    const lines = [D(ACC.expense, Number(p.rightsholder_pool))];
    if (Number(p.released_held)) lines.push(D(ACC.held, Number(p.released_held)));
    if (claimedTotal) lines.push(D(ACC.unclaimed, claimedTotal));
    if (Number(p.held)) lines.push(C(ACC.held, Number(p.held)));
    if (Number(p.unclaimed)) lines.push(C(ACC.unclaimed, Number(p.unclaimed)));
    for (const s of sts) {
      if (Number(s.carry_in)) lines.push(D(ACC.carry(s.party_id), Number(s.carry_in)));
      if (Number(s.payable)) lines.push(C(payableAccount(s.party_id, 'royalty'), Number(s.payable)));
      if (Number(s.reserve)) lines.push(C(ACC.reserve(s.party_id), Number(s.reserve)));
      if (Number(s.withholding)) lines.push(C(LedgerAccounts.taxWithholding(), Number(s.withholding)));
      if (Number(s.carry_out)) lines.push(C(ACC.carry(s.party_id), Number(s.carry_out)));
    }
    // Sisa pembulatan pool yang tidak terbagi (lagu tanpa stream tidak ada; selisih = 0 bila konsisten) → tetap di beban/pendapatan platform.
    const debit = lines.filter((l) => l.side === 'DEBIT').reduce((a, l) => a + l.amount, 0);
    const credit = lines.filter((l) => l.side === 'CREDIT').reduce((a, l) => a + l.amount, 0);
    if (debit !== credit) {
      const diff = debit - credit;
      if (Math.abs(diff) > Math.max(10, sts.length)) throw unprocessable(`Jurnal royalti tidak seimbang (selisih ${diff}) — hitung ulang periode`);
      lines.push(diff > 0 ? C(ACC.expense, diff) : D(ACC.expense, -diff));
    }
    const nonzero = lines.filter((l) => l.amount > 0);
    if (nonzero.length >= 2) await post(c, { key: `royalty:${period}`, kind: 'royalty.statement', referenceId: `royalty:${period}`, description: `Royalti streaming periode ${period}`, lines: nonzero });

    const months = num('royalty.reserve_release_months');
    const releaseAt = periodRange(period).to;
    releaseAt.setUTCMonth(releaseAt.getUTCMonth() + months);
    for (const s of sts) {
      if (Number(s.reserve) > 0)
        await c.query(`INSERT INTO royalty_reserves (period, party_key, party_type, party_id, amount, release_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [
          period, s.party_key, s.party_type, s.party_id, s.reserve, releaseAt,
        ]);
      await publish(c, 'finance.royalty.statement_issued', s.party_id, {
        period, partyId: s.party_id, partyType: s.party_type, gross: Number(s.gross), payable: Number(s.payable), carryOut: Number(s.carry_out), held: 0,
      });
    }
    for (const [hp, ht] of rel.held) await c.query(`UPDATE royalty_tracks SET released_in=$3 WHERE period=$1 AND track_id=$2`, [hp, ht, period]);
    if (rel.claimed.length) await c.query(`UPDATE royalty_lines SET claimed_in=$2 WHERE id = ANY($1::uuid[])`, [rel.claimed, period]);
    await c.query(`UPDATE royalty_statements SET issued_at=now() WHERE period=$1`, [period]);
    await c.query(`UPDATE royalty_periods SET status='PUBLISHED', published_at=now(), published_by=$2 WHERE period=$1`, [period, by]);
  });
  return periodDetail(db, period);
}

// ---------------------------------------------------------------------------------------------------------------------
// Tampilan
// ---------------------------------------------------------------------------------------------------------------------

function periodOut(p: any) {
  const n = (k: string) => Number(p[k] ?? 0);
  return {
    period: p.period,
    status: p.status,
    model: p.model,
    params: { rightsholder_share_pct: n('rightsholder_share_pct'), publishing_share_pct: n('publishing_share_pct'), reserve_pct: n('reserve_pct'), withholding_pct: n('withholding_pct'), min_payable: n('min_payable'), hybrid_floor: n('hybrid_floor') },
    revenue: { premium_auto: n('premium_revenue_auto'), premium: n('premium_revenue'), premium_override: p.premium_override, ads: n('ad_revenue'), attributed: n('attributed_revenue') },
    rightsholder_pool: n('rightsholder_pool'),
    distributed: n('distributed'),
    held: n('held'),
    unclaimed: n('unclaimed'),
    released_held: n('released_held'),
    streams: n('streams'),
    listeners: { total: n('listeners'), direct: n('listeners_direct'), pooled: n('listeners_pooled'), premium: n('premium_listeners') },
    excluded: { streams: n('excluded_streams'), listeners: n('excluded_listeners') },
    tracks: n('tracks'),
    parties: n('parties'),
    anomalies: ((p.anomalies ?? []) as any[]).filter((a) => a.kind !== 'RELEASES').concat(((p.anomalies ?? []) as any[]).filter((a) => a.kind === 'RELEASES').map((a) => ({ ...a, ref: undefined }))),
    note: p.note,
    computed: p.computed_at ? { at: p.computed_at, by: p.computed_by_name ?? 'Sistem', by_id: p.computed_by ?? null } : null,
    approved: p.approved_at ? { at: p.approved_at, by: p.approved_by_name } : null,
    published_at: p.published_at,
  };
}

async function periodDetail(db: Db, period: string) {
  const p = await db.one(`SELECT * FROM royalty_periods WHERE period=$1`, [period]);
  if (!p) throw notFound('Periode royalti');
  const tracks = await db.query(`SELECT track_id, title, isrc, artist_name, streams, listeners, premium, ads, pool, total, held_reason FROM royalty_tracks WHERE period=$1 ORDER BY total DESC LIMIT 200`, [period]);
  const statements = await db.query(`SELECT party_key, party_type, party_id, party_name, gross, reserve, withholding, carry_in, payable, carry_out, tracks, streams FROM royalty_statements WHERE period=$1 ORDER BY gross DESC LIMIT 500`, [period]);
  const unclaimed = await db.query(
    `SELECT party_email, party_name, sum(total)::bigint AS total, count(DISTINCT track_id)::int AS tracks FROM royalty_lines WHERE period=$1 AND party_type='unclaimed' GROUP BY 1, 2 ORDER BY 3 DESC`,
    [period],
  );
  return {
    ...periodOut(p),
    top_tracks: tracks.map((t) => ({ ...t, premium: Number(t.premium), ads: Number(t.ads), pool: Number(t.pool), total: Number(t.total), per_stream: perStream(Number(t.total), t.streams) })),
    statements: statements.map((s) => ({ ...s, gross: Number(s.gross), reserve: Number(s.reserve), withholding: Number(s.withholding), carry_in: Number(s.carry_in), payable: Number(s.payable), carry_out: Number(s.carry_out) })),
    unclaimed_parties: unclaimed.map((u) => ({ ...u, total: Number(u.total) })),
    lmkn_missing: lmknMissing(),
  };
}

/** Pihak yang boleh dilihat pengguna: org tempat ia anggota, atau akunnya sendiri. */
function assertParty(u: AuthUser, partyId: string) {
  if (partyId === u.sub || orgMembership(u, partyId)) return;
  // Tim keuangan Back Office (dukungan & rekonsiliasi) boleh melihat statement pihak mana pun.
  if (hasPermission(u, 'royalty.manage') || hasPermission(u, 'finance.view')) return;
  throw forbidden('Bukan statement milik Anda atau organisasi Anda');
}

const csvCell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (cols: string[], rows: Record<string, unknown>[]) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';

// ---------------------------------------------------------------------------------------------------------------------
// Rute
// ---------------------------------------------------------------------------------------------------------------------

const periodParam = z.object({ period: z.string().regex(PERIOD_RE, 'Periode harus YYYY-MM') });

export async function royaltyRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // ---------- Pemegang hak (Artist Studio / akun pribadi) ----------
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.get('/v1/royalty/statements', async (req) => {
      const q = z.object({ party_id: z.string().uuid() }).parse(req.query);
      assertParty(req.user!, q.party_id);
      const rows = await db.query(
        `SELECT s.period, s.gross, s.reserve, s.withholding, s.carry_in, s.payable, s.carry_out, s.tracks, s.streams, s.issued_at
           FROM royalty_statements s JOIN royalty_periods p ON p.period = s.period WHERE p.status = 'PUBLISHED' AND s.party_id = $1 ORDER BY s.period DESC LIMIT 60`,
        [q.party_id],
      );
      const reserve = await db.one(`SELECT coalesce(sum(amount),0)::bigint AS pending, min(release_at) AS next_release FROM royalty_reserves WHERE party_id=$1 AND released_at IS NULL`, [q.party_id]);
      const released = await db.one(`SELECT coalesce(sum(payable),0)::bigint AS total FROM royalty_reserves WHERE party_id=$1 AND released_at IS NOT NULL`, [q.party_id]);
      // Royalti tertahan milik lagu-lagu org artis ini (split belum disetujui) — dapat ditindaklanjuti di Studio.
      const heldTracks = await db.query(
        `SELECT rt.period, rt.track_id, rt.title, rt.total, rt.held_reason FROM royalty_tracks rt JOIN royalty_periods p ON p.period = rt.period
          WHERE p.status='PUBLISHED' AND rt.artist_org_id = $1 AND rt.held_reason IS NOT NULL AND rt.released_in IS NULL ORDER BY rt.period DESC, rt.total DESC LIMIT 50`,
        [q.party_id],
      );
      const pending = await db.one(`SELECT period, status FROM royalty_periods WHERE status <> 'PUBLISHED' ORDER BY period DESC LIMIT 1`);
      const lastPub = await db.one(`SELECT period FROM royalty_periods WHERE status = 'PUBLISHED' ORDER BY period DESC LIMIT 1`);
      const after = lastPub ? nextPeriod(lastPub.period) : previousPeriod();
      const nextP = pending?.period ?? (after > previousPeriod() ? after : previousPeriod());
      const data = rows.map((r) => ({ ...r, gross: Number(r.gross), reserve: Number(r.reserve), withholding: Number(r.withholding), carry_in: Number(r.carry_in), payable: Number(r.payable), carry_out: Number(r.carry_out) }));
      return {
        data,
        summary: {
          lifetime_payable: data.reduce((a, r) => a + r.payable, 0) + Number(released?.total ?? 0),
          lifetime_gross: data.reduce((a, r) => a + r.gross, 0),
          reserve_pending: Number(reserve?.pending ?? 0),
          next_reserve_release: reserve?.next_release ?? null,
          carry_forward: data[0]?.carry_out ?? 0,
          held: heldTracks.reduce((a, h) => a + Number(h.total), 0),
        },
        held_tracks: heldTracks.map((h) => ({ ...h, total: Number(h.total) })),
        next: { period: nextP, status: pending?.status ?? null, statement_day: num('royalty.statement_day') },
        params: { rightsholder_share_pct: num('royalty.rightsholder_share_pct'), publishing_share_pct: num('royalty.publishing_share_pct'), reserve_pct: num('royalty.reserve_pct'), reserve_release_months: num('royalty.reserve_release_months'), min_payable: num('royalty.min_payable_idr'), withholding_pct: num('royalty.withholding_pct') },
      };
    });

    s.get('/v1/royalty/statements/:period', async (req) => {
      const { period } = periodParam.parse(req.params);
      const q = z.object({ party_id: z.string().uuid() }).parse(req.query);
      assertParty(req.user!, q.party_id);
      const st = await db.one(
        `SELECT s.*, p.model, p.rightsholder_share_pct, p.publishing_share_pct, p.reserve_pct, p.withholding_pct, p.published_at FROM royalty_statements s JOIN royalty_periods p ON p.period = s.period
          WHERE s.period=$1 AND s.party_id=$2 AND p.status='PUBLISHED'`,
        [period, q.party_id],
      );
      if (!st) throw notFound('Statement');
      const lines = await db.query(
        `SELECT l.track_id, l.source_period, l.type, l.pct, l.premium, l.ads, l.pool, l.total, coalesce(rt.title, t2.title) AS title, coalesce(rt.isrc, t2.isrc) AS isrc,
                coalesce(rt.artist_name, t2.artist_name) AS artist_name, coalesce(rt.streams, 0) AS streams, rt.cities
           FROM royalty_lines l
           LEFT JOIN royalty_tracks rt ON rt.period = l.period AND rt.track_id = l.track_id
           LEFT JOIN royalty_tracks t2 ON t2.period = l.source_period AND t2.track_id = l.track_id
          WHERE l.period=$1 AND l.party_id=$2 ORDER BY sum(l.total) OVER (PARTITION BY l.track_id, l.source_period) DESC, l.track_id, l.type`,
        [period, q.party_id],
      );
      // Per kota: porsi pihak per lagu dibagi menurut stream kota lagu tsb (REQ-ROY-03 "per kota").
      const city = new Map<string, number>();
      for (const l of lines) {
        const cs = (l.cities ?? []) as { city: string; n: number }[];
        const tot = cs.reduce((a, c) => a + c.n, 0);
        for (const c of cs) city.set(c.city, (city.get(c.city) ?? 0) + (Number(l.total) * c.n) / (tot || 1));
      }
      const src = lines.reduce((a, l) => ({ premium: a.premium + Number(l.premium), ads: a.ads + Number(l.ads), pool: a.pool + Number(l.pool) }), { premium: 0, ads: 0, pool: 0 });
      return {
        period,
        party: { id: st.party_id, name: st.party_name, type: st.party_type },
        published_at: st.published_at,
        model: st.model,
        params: { rightsholder_share_pct: Number(st.rightsholder_share_pct), publishing_share_pct: Number(st.publishing_share_pct), reserve_pct: Number(st.reserve_pct), withholding_pct: Number(st.withholding_pct) },
        totals: { gross: Number(st.gross), reserve: Number(st.reserve), withholding: Number(st.withholding), carry_in: Number(st.carry_in), payable: Number(st.payable), carry_out: Number(st.carry_out), streams: st.streams, tracks: st.tracks },
        by_source: src,
        by_city: [...city].map(([c, v]) => ({ city: c, amount: Math.round(v) })).sort((a, b) => b.amount - a.amount).slice(0, 12),
        lines: lines.map((l) => ({
          track_id: l.track_id, title: l.title, isrc: l.isrc, artist_name: l.artist_name, type: l.type, pct: Number(l.pct), streams: l.streams,
          premium: Number(l.premium), ads: Number(l.ads), pool: Number(l.pool), total: Number(l.total), source_period: l.source_period, released_from_hold: l.source_period !== period,
        })),
      };
    });

    s.get('/v1/royalty/statements/:period/export.csv', async (req, reply) => {
      const { period } = periodParam.parse(req.params);
      const q = z.object({ party_id: z.string().uuid() }).parse(req.query);
      assertParty(req.user!, q.party_id);
      const rows = await db.query(
        `SELECT l.period, l.source_period, rt.isrc, rt.title, rt.artist_name, l.type, l.pct, rt.streams, l.premium, l.ads, l.pool, l.total
           FROM royalty_lines l JOIN royalty_periods p ON p.period = l.period LEFT JOIN royalty_tracks rt ON rt.period = l.source_period AND rt.track_id = l.track_id
          WHERE p.status='PUBLISHED' AND l.period=$1 AND l.party_id=$2 ORDER BY l.total DESC`,
        [period, q.party_id],
      );
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="rave-royalti-${period}.csv"`);
      return csv(['period', 'source_period', 'isrc', 'title', 'artist_name', 'type', 'pct', 'streams', 'premium', 'ads', 'pool', 'total'], rows);
    });
  });

  // ---------- Back Office (Finance) ----------
  const view = [requireAuth, requirePermission(['royalty.manage', 'finance.view'])];
  const manage = [requireAuth, requirePermission('royalty.manage')];

  app.get('/v1/admin/royalty/periods', { preHandler: view }, async () => {
    const rows = await db.query(`SELECT * FROM royalty_periods ORDER BY period DESC LIMIT 36`);
    const prev = previousPeriod();
    return {
      data: rows.map(periodOut),
      next: { period: prev, exists: rows.some((r) => r.period === prev), compute_day: num('royalty.compute_day'), statement_day: num('royalty.statement_day') },
      allow_open_period: ALLOW_OPEN_PERIOD ? currentPeriod() : null,
    };
  });
  app.get('/v1/admin/royalty/periods/:period', { preHandler: view }, async (req) => periodDetail(db, periodParam.parse(req.params).period));

  app.post('/v1/admin/royalty/periods/:period/compute', { preHandler: manage }, async (req) => {
    const { period } = periodParam.parse(req.params);
    const b = z
      .object({
        ad_revenue_idr: z.number().int().min(0).max(1e13).default(0),
        premium_revenue_idr: z.number().int().min(0).max(1e13).nullable().optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(req.body ?? {});
    return computePeriod(db, period, { adRevenue: b.ad_revenue_idr, premiumRevenue: b.premium_revenue_idr ?? null, note: b.note, by: req.user! });
  });
  app.post('/v1/admin/royalty/periods/:period/approve', { preHandler: manage }, async (req) => approvePeriod(db, periodParam.parse(req.params).period, req.user!));
  app.post('/v1/admin/royalty/periods/:period/reopen', { preHandler: manage }, async (req) => reopenPeriod(db, periodParam.parse(req.params).period));
  app.post('/v1/admin/royalty/periods/:period/publish', { preHandler: manage }, async (req) => publishPeriod(db, periodParam.parse(req.params).period, req.user!.sub));

  // Ekspor: rincian per pihak × lagu, dan laporan penggunaan untuk LMK/penerbit (REQ-ROY-04).
  app.get('/v1/admin/royalty/periods/:period/lines.csv', { preHandler: view }, async (req, reply) => {
    const { period } = periodParam.parse(req.params);
    const rows = await db.query(
      `SELECT l.period, l.source_period, l.party_type, l.party_name, l.party_email, l.party_id, rt.isrc, rt.title, rt.artist_name, l.type, l.pct, l.premium, l.ads, l.pool, l.total
         FROM royalty_lines l LEFT JOIN royalty_tracks rt ON rt.period = l.source_period AND rt.track_id = l.track_id WHERE l.period=$1 ORDER BY l.party_name, l.total DESC`,
      [period],
    );
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="rave-royalti-rincian-${period}.csv"`);
    return csv(['period', 'source_period', 'party_type', 'party_name', 'party_email', 'party_id', 'isrc', 'title', 'artist_name', 'type', 'pct', 'premium', 'ads', 'pool', 'total'], rows);
  });
  // Laporan penggunaan LMKN (REQ-ROY-04): template resmi terisi (.xlsx) + tabel log untuk unggah massal SILM (.csv).
  app.get('/v1/admin/royalty/periods/:period/lmkn.xlsx', { preHandler: view }, async (req, reply) => {
    const { period } = periodParam.parse(req.params);
    const { identity, rows } = await lmknData(db, period);
    const buf = buildLmknWorkbook(await lmknTemplate(), identity, rows);
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="Laporan_Penggunaan_Musik_LMKN_RAVE_${period}.xlsx"`);
    return buf;
  });
  app.get('/v1/admin/royalty/periods/:period/usage.csv', { preHandler: view }, async (req, reply) => {
    const { period } = periodParam.parse(req.params);
    const { rows } = await lmknData(db, period);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="SILM_Log_Pemakaian_Musik_RAVE_${period}.csv"`);
    // BOM agar Excel membaca UTF-8 (judul lagu beraksara non-Latin).
    return '\uFEFF' + [LMKN_LOG_COLUMNS.map(csvCell).join(','), ...rows.map((r, i) => lmknLogValues(r, i).map(csvCell).join(','))].join('\n') + '\n';
  });

  // Laporan layanan (Super Admin → Pengaturan Layanan → Royalti → Laporan).
  app.get('/v1/admin/reports/royalty', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const last = await db.one(`SELECT * FROM royalty_periods WHERE status='PUBLISHED' ORDER BY period DESC LIMIT 1`);
    const pend = await db.one(`SELECT period, status FROM royalty_periods WHERE status <> 'PUBLISHED' ORDER BY period DESC LIMIT 1`);
    const reserve = await db.one(`SELECT coalesce(sum(amount),0)::bigint AS s FROM royalty_reserves WHERE released_at IS NULL`);
    const rows = await db.query(`SELECT period, status, rightsholder_pool, distributed, held, streams, parties, published_at FROM royalty_periods ORDER BY period DESC LIMIT 24`);
    return {
      kpis: [
        { label: L('Royalti periode terakhir', 'Last period royalty'), value: last ? Number(last.rightsholder_pool) : 0, format: 'idr', hint: last ? L(`Periode ${last.period}`, `Period ${last.period}`) : undefined },
        { label: L('Pihak menerima', 'Payees'), value: last?.parties ?? 0, format: 'num' },
        { label: L('Ditahan (split/registri)', 'Held (splits/registry)'), value: last ? Number(last.held) : 0, format: 'idr', tone: last && Number(last.held) > 0 ? 'warn' : 'neutral' },
        { label: L('Cadangan koreksi berjalan', 'Correction reserve'), value: Number(reserve?.s ?? 0), format: 'idr' },
        { label: L('Menunggu', 'Pending'), value: pend ? 1 : 0, format: 'num', hint: pend ? L(`${pend.period} · ${pend.status}`, `${pend.period} · ${pend.status}`) : undefined, tone: pend ? 'warn' : 'neutral' },
      ],
      table: {
        title: L('Periode royalti', 'Royalty periods'),
        columns: [
          { key: 'period', label: L('Periode', 'Period') },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'rightsholder_pool', label: L('Porsi pemegang hak', 'Rightsholder pool'), format: 'idr' },
          { key: 'distributed', label: L('Dibagikan', 'Distributed'), format: 'idr' },
          { key: 'held', label: L('Ditahan', 'Held'), format: 'idr' },
          { key: 'streams', label: L('Stream', 'Streams'), format: 'num' },
          { key: 'published_at', label: L('Terbit', 'Published'), format: 'date' },
        ],
        rows: rows.map((r) => ({ ...r, rightsholder_pool: Number(r.rightsholder_pool), distributed: Number(r.distributed), held: Number(r.held) })),
        empty: L('Belum ada periode royalti', 'No royalty periods yet'),
        link: { label: L('Buka meja kerja royalti', 'Open royalty workspace'), href: '/admin/royalty' },
      },
      generated_at: new Date().toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Job: hitung draf otomatis, terbit otomatis (bila sudah disetujui), pelepasan cadangan
// ---------------------------------------------------------------------------------------------------------------------

export const royaltyJob: Job = {
  name: 'royalty-cycle',
  everyMs: FAST_CLOCK ? 20_000 : 15 * 60_000,
  async run({ db, log }) {
    const prev = previousPeriod();
    const day = wibDay();
    const p = await db.one(`SELECT status FROM royalty_periods WHERE period=$1`, [prev]);
    if (!p && day >= num('royalty.compute_day')) {
      await computePeriod(db, prev, { adRevenue: 0, premiumRevenue: null, note: 'Draf otomatis — isi pendapatan iklan lalu hitung ulang sebelum disetujui', by: null }).catch((e) =>
        log.error({ err: e?.message, period: prev }, 'hitung royalti otomatis gagal'),
      );
    }
    if (p?.status === 'APPROVED' && day >= num('royalty.statement_day')) {
      await publishPeriod(db, prev, null).catch((e) => log.error({ err: e?.message, period: prev }, 'terbit royalti otomatis gagal'));
    }
    await releaseReserves(db).catch((e) => log.error({ err: e?.message }, 'pelepasan cadangan royalti gagal'));
  },
};

export async function releaseReserves(db: Db, now = new Date()) {
  const due = await db.query(`SELECT period, party_key FROM royalty_reserves WHERE released_at IS NULL AND release_at <= $1 LIMIT 200`, [now]);
  for (const d of due) {
    await serial(db, async (c: Client) => {
      const r = (await c.query(`SELECT * FROM royalty_reserves WHERE period=$1 AND party_key=$2 AND released_at IS NULL FOR UPDATE`, [d.period, d.party_key])).rows[0];
      if (!r) return;
      const amount = Number(r.amount);
      const tax = Math.floor((amount * Math.min(50, Math.max(0, num('royalty.withholding_pct')))) / 100);
      const payable = amount - tax;
      const lines = [D(ACC.reserve(r.party_id), amount), C(payableAccount(r.party_id, 'royalty'), payable)];
      if (tax) lines.push(C(LedgerAccounts.taxWithholding(), tax));
      await post(c, { key: `royalty-reserve:${r.period}:${r.party_key}`, kind: 'royalty.reserve_release', referenceId: `royalty:${r.period}`, description: `Pelepasan cadangan koreksi royalti ${r.period}`, lines });
      await c.query(`UPDATE royalty_reserves SET released_at=now(), withholding=$3, payable=$4 WHERE period=$1 AND party_key=$2`, [r.period, r.party_key, tax, payable]);
      await publish(c, 'finance.royalty.reserve_released', r.party_id, { period: r.period, partyId: r.party_id, partyType: r.party_type, amount, payable });
    });
  }
  return due.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Laporan LMKN
// ---------------------------------------------------------------------------------------------------------------------

let templateCache: Buffer | null = null;
async function lmknTemplate(): Promise<Buffer> {
  templateCache ??= await readFile(new URL('../assets/lmkn-template.xlsx', import.meta.url));
  return templateCache;
}

const sv = (k: string, fallback: string) => {
  const v = settings.get<string>(k);
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
};

/** Identitas pelapor (Super Admin → Legalitas & Royalti) + log harian per lagu dari snapshot periode. */
export async function lmknData(db: Db, period: string): Promise<{ identity: LmknIdentity; rows: LmknLogRow[] }> {
  const p = await db.one(`SELECT period, status, published_at, computed_at FROM royalty_periods WHERE period=$1`, [period]);
  if (!p) throw notFound('Periode royalti');
  await backfillUsage(db, period);
  const usage = await db.query(
    `SELECT to_char(u.day, 'YYYY-MM-DD') AS day, u.first_time, u.plays, u.listeners, t.title, t.isrc, t.artist_name, t.composers, t.producers, t.label, t.duration_ms
       FROM royalty_usage u JOIN royalty_tracks t ON t.period = u.period AND t.track_id = u.track_id
      WHERE u.period=$1 ORDER BY u.day, u.first_time, t.title`,
    [period],
  );
  const city = sv('royalty.lmkn_city_province', '[Isi Kota, Provinsi]');
  const issued = new Date(p.published_at ?? p.computed_at ?? Date.now());
  const identity: LmknIdentity = {
    entityName: sv('legal.entity_name', '[Isi Nama Badan Usaha]'),
    venueName: `${sv('general.platform_name', 'RAVE')} — layanan streaming musik digital (web, desktop & seluler)`,
    category: 'Lainnya',
    address: sv('legal.address', '[Isi Alamat Lengkap]'),
    cityProvince: city,
    npwp: sv('legal.npwp', '[Isi Nomor NPWP]'),
    licenseNo: sv('royalty.lmkn_license_no', '-'),
    periodLabel: new Date(`${period}-15T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    picName: sv('royalty.lmkn_pic_name', '[Isi Nama Lengkap PIC]'),
    picTitle: sv('royalty.lmkn_pic_title', '[Isi Jabatan]'),
    picContact: sv('royalty.lmkn_pic_contact', sv('general.support_email', '[Isi Kontak PIC]')),
    placeDate: `${settings.get<string>('royalty.lmkn_city_province')?.trim() ? city.split(',')[0].trim() : '[Kota]'}, ${issued.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}`,
  };
  const rows: LmknLogRow[] = usage.map((u) => ({
    date: u.day,
    time: u.first_time,
    title: u.title,
    composers: u.composers ?? '',
    artist: u.artist_name ?? '',
    producer: u.producers ?? u.label ?? '',
    zone: 'Aplikasi RAVE (streaming on-demand)',
    plays: u.plays,
    duration: mmss(u.duration_ms),
    usage: 'Rekaman',
    note: [u.isrc ? `ISRC ${u.isrc}` : 'ISRC belum ada', `${u.listeners} pendengar`, 'stream qualified ≥ 30 dtk'].join(' · '),
  }));
  return { identity, rows };
}

/** Periode yang dihitung sebelum snapshot laporan LMKN ada (migrasi 011): ambil log harian & metadata sekali, lalu simpan. */
async function backfillUsage(db: Db, period: string) {
  const need = await db.one(
    `SELECT (SELECT count(*) FROM royalty_tracks WHERE period=$1)::int AS tracks, (SELECT count(*) FROM royalty_usage WHERE period=$1)::int AS usage`,
    [period],
  );
  if (!need?.tracks || need.usage) return;
  const { from, to } = periodRange(period);
  const r = await callService<{ usage: { day: string; track_id: string; first_time: string; plays: number; listeners: number }[] }>(
    'finance', 'playback', `/internal/royalty/streams?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
  );
  const tracks = (await db.query(`SELECT track_id FROM royalty_tracks WHERE period=$1`, [period])).map((t) => t.track_id);
  const meta = await callService<{ data: TrackInfo[] }>('finance', 'catalog', '/internal/royalty/rights', { method: 'POST', body: { track_ids: tracks } });
  const known = new Set(tracks);
  const usage = (r.usage ?? []).filter((u) => known.has(u.track_id));
  await serial(db, async (c) => {
    for (const t of meta.data)
      await c.query(`UPDATE royalty_tracks SET duration_ms=$3, label=$4, composers=$5, producers=$6 WHERE period=$1 AND track_id=$2`, [
        period, t.track_id, t.duration_ms, t.label, names(t, 'PUBLISHING'), t.label || names(t, 'MASTER'),
      ]);
    for (let i = 0; i < usage.length; i += 500) {
      const ch = usage.slice(i, i + 500);
      await c.query(
        `INSERT INTO royalty_usage (period, day, track_id, first_time, plays, listeners)
         SELECT $1, d::date, t::uuid, f, p, l FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::int[]) AS x(d, t, f, p, l) ON CONFLICT DO NOTHING`,
        [period, ch.map((u) => u.day), ch.map((u) => u.track_id), ch.map((u) => u.first_time), ch.map((u) => u.plays), ch.map((u) => u.listeners)],
      );
    }
  });
}

/** Identitas pelapor LMKN yang belum diisi di Super Admin (ditampilkan di meja kerja sebelum mengunduh laporan). */
function lmknMissing(): string[] {
  const req: [string, string][] = [
    ['legal.entity_name', 'Nama badan hukum'], ['legal.npwp', 'NPWP badan'], ['legal.address', 'Alamat'],
    ['royalty.lmkn_city_province', 'Kota / provinsi'], ['royalty.lmkn_pic_name', 'Nama PIC'], ['royalty.lmkn_pic_title', 'Jabatan PIC'],
  ];
  return req.filter(([k]) => !String(settings.get<string>(k) ?? '').trim()).map(([, l]) => l);
}
