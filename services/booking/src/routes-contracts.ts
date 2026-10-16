import type { FastifyInstance, FastifyRequest } from 'fastify';
import { diffSnapshots } from '@gema/domain';
import { forbidden, notFound, requireAuth, settings, type Client, type Db, type ServiceContext } from '@gema/service-kit';
import { partyOf, type BookingRow } from './common.js';
import { contractStatusLabel } from './contract-jobs.js';
import { readContractFile, signFileToken, verifyFileToken } from './contract-storage.js';

type Q = Db | Client;

/** Catat aksi kontrak (append-only) lengkap dengan IP & user agent. */
export async function contractAudit(
  q: Q,
  e: { contractId: string; action: string; actorId?: string | null; party?: string | null; req?: FastifyRequest; data?: unknown },
) {
  await (q as { query: (sql: string, p: unknown[]) => Promise<unknown> }).query(
    `INSERT INTO contract_audit (contract_id, action, actor_id, actor_party, ip_address, user_agent, data) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.contractId, e.action, e.actorId ?? null, e.party ?? null, e.req?.ip ?? null, (e.req?.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null, e.data === undefined ? null : JSON.stringify(e.data)],
  );
}

/** RBAC: promotor hanya kontraknya, manajemen hanya artis yang dikelola; admin boleh membaca. */
async function loadForParty(req: FastifyRequest, db: Db, id: string) {
  const k = await db.one(`SELECT * FROM contracts WHERE id=$1`, [id]);
  if (!k) throw notFound('Kontrak');
  const b = (await db.one<BookingRow>(`SELECT * FROM bookings WHERE id=$1`, [k.booking_id]))!;
  const party = partyOf(req.user, b);
  if (!party) throw forbidden('Bukan pihak dalam kontrak ini');
  return { k, b, party };
}

export async function contractRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // ---- Pratinjau: signed URL berbatas waktu (PDF disimpan privat) ----
  app.get('/v1/booking/contracts/:id/preview-url', { preHandler: requireAuth }, async (req) => {
    const { k, party } = await loadForParty(req, db, (req.params as any).id);
    if (!k.draft_key && !k.final_key) throw notFound('Dokumen PDF belum siap (sedang dirender), coba lagi sebentar');
    const ttl = settings.num('contract.file_url_ttl_sec');
    const final = !!k.final_key;
    await contractAudit(db, { contractId: k.id, action: 'view', actorId: req.user!.sub, party, req, data: { kind: final ? 'final' : 'draft' } });
    return {
      url: `/v1/booking/contract-files/${signFileToken(final ? k.final_key : k.draft_key, ttl)}`,
      expires_in: ttl,
      kind: final ? 'FINAL' : 'DRAFT',
      sha256: final ? k.final_sha256 : k.draft_sha256,
    };
  });

  // ---- Riwayat versi + diff variabel antar versi (versi lama read-only) ----
  app.get('/v1/booking/contracts/:id/versions', { preHandler: requireAuth }, async (req) => {
    const { k } = await loadForParty(req, db, (req.params as any).id);
    const rows = await db.query(
      `SELECT id, version, status, template_version, contract_no, sha256, draft_sha256, final_sha256, reject_reason, created_at, signed_at, data_snapshot
         FROM contracts WHERE booking_id=$1 ORDER BY version`,
      [k.booking_id],
    );
    return {
      data: rows.map((r, i) => ({
        id: r.id,
        version: r.version,
        status: r.status,
        status_label: contractStatusLabel(r.status),
        template_version: r.template_version,
        contract_no: r.contract_no,
        sha256: r.final_sha256 ?? r.draft_sha256 ?? r.sha256,
        reject_reason: r.reject_reason,
        created_at: r.created_at,
        signed_at: r.signed_at,
        changes: i === 0 || !r.data_snapshot || !rows[i - 1].data_snapshot ? [] : diffSnapshots(strip(rows[i - 1].data_snapshot), strip(r.data_snapshot)),
      })),
    };
  });

  // ---- Unduh via signed URL: token = otorisasi (tanpa header Authorization agar bisa dimuat di <iframe>) ----
  // Wildcard: token (~150 karakter) melebihi maxParamLength default Fastify (100) bila dipakai sebagai :param.
  app.get('/v1/booking/contract-files/*', async (req, reply) => {
    const key = verifyFileToken((req.params as any)['*']);
    if (!key) throw forbidden('Tautan dokumen tidak valid atau sudah kedaluwarsa');
    const row = await db.one(`SELECT id FROM contracts WHERE draft_key=$1 OR final_key=$1`, [key]);
    if (!row) throw notFound('Dokumen');
    await contractAudit(db, { contractId: row.id, action: 'download', req });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', 'inline; filename="kontrak.pdf"')
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(readContractFile(key));
  });

  // ---- Verifikasi publik (hasil scan QR): status & hash, tanpa data sensitif ----
  app.get('/v1/booking/verify/:contractId', async (req) => {
    const id = (req.params as any).contractId as string;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Kontrak');
    const k = await db.one(`SELECT * FROM contracts WHERE id=$1`, [id]);
    if (!k) throw notFound('Kontrak');
    const snap = k.data_snapshot;
    const sigs = await db.query(`SELECT party, signed_at FROM signatures WHERE contract_id=$1 ORDER BY signed_at`, [id]);
    const final = !!k.final_sha256;
    return {
      contract_no: snap?.contract_no ?? null,
      version: k.version,
      status: k.status,
      status_label: contractStatusLabel(k.status),
      document: final ? 'FINAL' : 'DRAFT',
      sha256: k.final_sha256 ?? k.draft_sha256 ?? k.sha256,
      template_version: k.template_version,
      event: snap ? { name: snap.booking.event_name, date: snap.booking.event_date } : null,
      parties: snap ? { promotor: snap.promotor.legal_name, management: snap.management.legal_name, artist: snap.artist.stage_name } : null,
      signatures: sigs.map((s) => ({ party: s.party, signed_at: s.signed_at })),
      created_at: k.created_at,
      signed_at: k.signed_at,
    };
  });
}

/** Buang field yang berubah tiap render (nomor/versi/waktu generate) agar diff hanya memuat variabel bisnis. */
function strip(s: any) {
  const { generated_at: _g, contract_no: _n, version: _v, ...rest } = s ?? {};
  return rest;
}
