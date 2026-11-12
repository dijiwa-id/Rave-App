import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_STATUS_LABEL, type ContractStatus } from '@rave/domain';
import { BRANDING_PUBLIC_PREFIX } from '@rave/domain/settings';
import { settings, type Client, type Job } from '@rave/service-kit';
import type { ContractData } from './contract-data.js';
import {
  qrSvg,
  RAVE_MARK_DATA_URI,
  renderContractHtml,
  wibDateTime,
  type Attestation,
  type PlatformLegal,
  type SignerAttestation,
} from './contract-template.js';
import { renderPdf } from './contract-pdf.js';
import { CONTRACT_DIR, putContractFile } from './contract-storage.js';

/** Snapshot kontrak + identitas legal platform yang dibekukan saat draf dirender. */
export type SpkSnapshot = ContractData & { platform_legal?: PlatformLegal };

// ---- Identitas legal & logo (pengaturan Super Admin `legal.*`, `branding.logo_url`) ----
const BRANDING_DIR = () => process.env.BRANDING_DIR ?? join(CONTRACT_DIR, '..', 'branding');
const LEGAL_KEYS = ['entity_name', 'nib', 'npwp', 'address', 'pse_registration', 'psre_name', 'pse_logo', 'psre_logo', 'emeterai_logo'] as const;

function settingStr(key: string): string {
  try {
    const v = settings.get<unknown>(key);
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

/** Nilai `legal.*` terkini (kosong = tidak ditampilkan). */
export function currentPlatformLegal(): PlatformLegal {
  const out = Object.fromEntries(LEGAL_KEYS.map((k) => [k, settingStr(`legal.${k}`)])) as Omit<PlatformLegal, 'brand_logo'>;
  return { ...out, brand_logo: settingStr('branding.logo_url') };
}

/** File bucket branding → data URI (Chromium render tanpa jaringan). Path tidak valid/berkas hilang = null. */
export function brandingDataUri(path: string | null | undefined): string | null {
  if (!path || !path.startsWith(BRANDING_PUBLIC_PREFIX)) return null;
  const file = path.slice(BRANDING_PUBLIC_PREFIX.length);
  if (!/^[\w-]+\.(svg|png)$/.test(file)) return null;
  try {
    const buf = readFileSync(join(BRANDING_DIR(), file));
    return `data:image/${file.endsWith('.png') ? 'png' : 'svg+xml'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Render PDF SPK (draf atau final) dari snapshot — murni, tanpa DB. Deterministik: snapshot + templat + identitas legal
 * beku + `fixedDate` menghasilkan byte yang sama.
 */
export async function renderSpkPdf(
  data: SpkSnapshot,
  o: { verifyUrl: string; statusLabel: string; isDraft: boolean; attestation?: Attestation | null; fixedDate: Date | string },
): Promise<Buffer> {
  const legal = data.platform_legal ?? null;
  const html = await renderContractHtml(data, {
    verifyUrl: o.verifyUrl,
    statusLabel: o.statusLabel,
    isDraft: o.isDraft,
    attestation: o.attestation ?? null,
    legal,
    legalAssets: legal ? { pse_logo: brandingDataUri(legal.pse_logo), psre_logo: brandingDataUri(legal.psre_logo), emeterai_logo: brandingDataUri(legal.emeterai_logo) } : null,
  });
  const brandLogo = brandingDataUri(legal?.brand_logo);
  const { pdf, blocked } = await renderPdf(html, {
    contractNo: data.contract_no,
    version: data.version,
    note: o.isDraft ? 'DRAF' : 'FINAL',
    qrSvg: await qrSvg(o.verifyUrl),
    fixedDate: o.fixedDate,
    sha256: o.attestation?.signed_sha256 ?? null,
    logoDataUri: brandLogo ?? RAVE_MARK_DATA_URI,
    logoText: brandLogo ? null : 'RAVE',
  });
  if (blocked.length) throw new Error(`Render mencoba akses jaringan: ${blocked[0]}`);
  return pdf;
}

export const PUBLIC_WEB_URL = () => (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
export const verifyUrlOf = (contractId: string) => `${PUBLIC_WEB_URL()}/verify/${contractId}`;

/** Status lama (SENT/SIGNED/VOID) dipetakan ke label baru sampai kode booking dimigrasikan penuh. */
export function contractStatusLabel(status: string): string {
  const legacy: Record<string, string> = { SENT: 'Menunggu Tanda Tangan', SIGNED: 'Kontrak Aktif', VOID: 'Dibatalkan' };
  return legacy[status] ?? CONTRACT_STATUS_LABEL[status as ContractStatus] ?? status;
}

export async function enqueueContractJob(c: Client, contractId: string, kind: 'RENDER_DRAFT' | 'RENDER_FINAL' | 'DISTRIBUTE') {
  await c.query(`INSERT INTO contract_jobs (contract_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [contractId, kind]);
}

/** Render draf PDF dari snapshot tersimpan (deterministik: snapshot + templat berversi). */
export async function renderDraft(c: Client, contractId: string): Promise<{ key: string; sha256: string }> {
  const k = (await c.query(`SELECT id, version, status, data_snapshot FROM contracts WHERE id=$1`, [contractId])).rows[0];
  if (!k?.data_snapshot) throw new Error('Kontrak tidak punya data_snapshot');
  let data = k.data_snapshot as SpkSnapshot;
  if (!data.platform_legal) {
    // Bekukan identitas legal platform ke snapshot SEBELUM ditandatangani → draf & final memuat identitas yang sama.
    data = { ...data, platform_legal: currentPlatformLegal() };
    if (!['SIGNED', 'ACTIVE'].includes(k.status)) await c.query(`UPDATE contracts SET data_snapshot=$2 WHERE id=$1`, [contractId, JSON.stringify(data)]);
  }
  const pdf = await renderSpkPdf(data, { verifyUrl: verifyUrlOf(contractId), statusLabel: contractStatusLabel(k.status), isDraft: true, fixedDate: data.generated_at });
  const key = `${contractId}/v${k.version}-draft.pdf`;
  const { sha256 } = putContractFile(key, pdf);
  await c.query(`UPDATE contracts SET draft_key=$2, draft_sha256=$3, draft_rendered_at=now() WHERE id=$1`, [contractId, key, sha256]);
  return { key, sha256 };
}

// ---- Dokumen FINAL: isi draf yang ditandatangani (snapshot sama) tanpa watermark + lembar pengesahan ----

const PARTY_ATTEST_LABEL: Record<string, string> = {
  promotor: 'Pihak Pertama (Promotor)',
  management: 'Pihak Kedua (Manajemen)',
  artist: 'Artis (Mengetahui)',
};
const PARTY_ORDER = ['promotor', 'management', 'artist'];

/** ID pengguna disamarkan: 4 karakter awal & akhir. */
export const maskUserId = (id: string) => (id.length <= 8 ? '****' : `${id.slice(0, 4)}…${id.slice(-4)}`);
/** IP disamarkan: oktet terakhir IPv4 / separuh akhir IPv6 diganti "x". */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v.replace(/\.\d{1,3}$/, '.x');
  if (v.includes(':')) return `${v.split(':').slice(0, 3).join(':')}:x:x`;
  return 'x';
}

export interface SignatureRow {
  party: string;
  signer_name: string;
  signer_user_id: string;
  method: string | null;
  signed_at: Date | string;
  ip_address: string | null;
}

/** Baris tanda tangan → data lembar pengesahan (urutan Promotor → Manajemen → Artis). */
export function attestationSigners(rows: SignatureRow[]): SignerAttestation[] {
  return [...rows]
    .sort((a, b) => PARTY_ORDER.indexOf(a.party) - PARTY_ORDER.indexOf(b.party))
    .map((r) => ({
      key: r.party,
      party: PARTY_ATTEST_LABEL[r.party] ?? r.party,
      name: r.signer_name,
      user: maskUserId(r.signer_user_id),
      method: r.method ?? 'OTP_NATIVE',
      at: wibDateTime(r.signed_at),
      ip: maskIp(r.ip_address),
    }));
}

/**
 * Render PDF final secara murni (tanpa DB) — deterministik: snapshot + templat berversi + tanda tangan + waktu aktif
 * (dipakai sebagai tanggal metadata PDF) menghasilkan byte yang sama.
 */
export async function renderFinalPdf(
  data: SpkSnapshot,
  f: { verifyUrl: string; signedSha256: string; activatedAt: Date | string; signatures: SignatureRow[] },
): Promise<Buffer> {
  return renderSpkPdf(data, {
    verifyUrl: f.verifyUrl,
    statusLabel: contractStatusLabel('ACTIVE'),
    isDraft: false,
    attestation: { signed_sha256: f.signedSha256, activated_at: wibDateTime(f.activatedAt), signers: attestationSigners(f.signatures) },
    fixedDate: f.activatedAt,
  });
}

/**
 * Job RENDER_FINAL: dijalankan setelah kontrak ACTIVE. Idempoten — bila final sudah ada, tidak dirender ulang
 * (kolom final_* juga dikunci trigger setelah terisi). Kontrak lama tanpa snapshot dilewati.
 */
export async function renderFinal(c: Client, contractId: string): Promise<{ key: string; sha256: string } | { skipped: string }> {
  const k = (
    await c.query(`SELECT id, version, status, data_snapshot, draft_sha256, final_key, final_sha256, signed_at FROM contracts WHERE id=$1 FOR UPDATE`, [contractId])
  ).rows[0];
  if (!k) return { skipped: 'kontrak tidak ditemukan' };
  if (k.final_key && k.final_sha256) return { key: k.final_key, sha256: k.final_sha256 };
  if (!k.data_snapshot) return { skipped: 'kontrak versi lama tanpa data_snapshot' };
  if (k.status !== 'ACTIVE') return { skipped: `status ${k.status} bukan ACTIVE` };
  if (!k.draft_sha256 || !k.signed_at) throw new Error('Kontrak ACTIVE tanpa draft_sha256/signed_at');
  const sigs = (
    await c.query(
      `SELECT s.party, s.signer_name, s.signer_user_id, s.method, s.signed_at, s.doc_sha256,
              COALESCE(s.ip_address, (SELECT a.ip_address FROM contract_audit a
                                       WHERE a.contract_id=s.contract_id AND a.action IN ('sign','ack') AND a.actor_party=s.party AND a.actor_id=s.signer_user_id
                                       ORDER BY a.id DESC LIMIT 1)) AS ip_address
         FROM signatures s WHERE s.contract_id=$1 AND s.status='SIGNED' ORDER BY s.signed_at`,
      [contractId],
    )
  ).rows as (SignatureRow & { doc_sha256: string | null })[];
  if (sigs.length < 2) throw new Error('Tanda tangan para pihak belum lengkap');
  const bad = sigs.find((s) => s.doc_sha256 !== k.draft_sha256);
  if (bad) throw new Error(`Hash dokumen tanda tangan ${bad.party} tidak cocok dengan draf`);
  const pdf = await renderFinalPdf(k.data_snapshot as SpkSnapshot, {
    verifyUrl: verifyUrlOf(contractId),
    signedSha256: k.draft_sha256,
    activatedAt: k.signed_at,
    signatures: sigs,
  });
  const key = `${contractId}/v${k.version}-final.pdf`;
  // Tulis berkas dulu (aman diulang: byte identik), lalu kunci path+hash di DB dalam transaksi yang sama.
  const { sha256 } = putContractFile(key, pdf);
  await c.query(`UPDATE contracts SET final_key=$2, final_sha256=$3, final_rendered_at=now() WHERE id=$1`, [contractId, key, sha256]);
  await c.query(`INSERT INTO contract_audit (contract_id, action, actor_party, data) VALUES ($1,'finalize','system',$2)`, [
    contractId,
    JSON.stringify({ final_sha256: sha256, signed_sha256: k.draft_sha256, signers: sigs.map((s) => s.party) }),
  ]);
  return { key, sha256 };
}

const MAX_ATTEMPTS = 5;

/** Antrean job kontrak berbasis Postgres (FOR UPDATE SKIP LOCKED) — aman untuk banyak replika. */
export const contractJobs: Job = {
  name: 'contract-jobs',
  everyMs: 3_000,
  async run({ db, log }) {
    for (let i = 0; i < 5; i++) {
      const job = await db.one<{ id: string; contract_id: string; kind: string; attempts: number }>(
        `UPDATE contract_jobs SET status='RUNNING', attempts=attempts+1, updated_at=now()
          WHERE id = (SELECT id FROM contract_jobs WHERE status='PENDING' AND run_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
          RETURNING id, contract_id, kind, attempts`,
      );
      if (!job) return;
      try {
        if (job.kind === 'RENDER_DRAFT') await db.tx((c) => renderDraft(c, job.contract_id));
        else if (job.kind === 'RENDER_FINAL') {
          const r = await db.tx((c) => renderFinal(c, job.contract_id));
          if ('skipped' in r) log.warn({ job: job.id, contract: job.contract_id, reason: r.skipped }, 'RENDER_FINAL dilewati');
        } else throw new Error(`Job ${job.kind} belum diimplementasikan`);
        await db.query(`UPDATE contract_jobs SET status='DONE', last_error=NULL, updated_at=now() WHERE id=$1`, [job.id]);
      } catch (e: any) {
        const dead = job.attempts >= MAX_ATTEMPTS;
        log.warn({ err: e?.message, job: job.id, kind: job.kind }, 'job kontrak gagal');
        await db.query(
          `UPDATE contract_jobs SET status=$2, last_error=$3, run_after = now() + make_interval(secs => $4), updated_at=now() WHERE id=$1`,
          [job.id, dead ? 'FAILED' : 'PENDING', String(e?.message ?? e).slice(0, 500), 10 * job.attempts],
        );
      }
    }
  },
};
