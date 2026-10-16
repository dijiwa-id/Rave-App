import { CONTRACT_STATUS_LABEL, type ContractStatus } from '@gema/domain';
import type { Client, Job } from '@gema/service-kit';
import type { ContractData } from './contract-data.js';
import { renderContractHtml } from './contract-template.js';
import { renderPdf } from './contract-pdf.js';
import { putContractFile } from './contract-storage.js';

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
  const data = k.data_snapshot as ContractData;
  const html = await renderContractHtml(data, { verifyUrl: verifyUrlOf(contractId), statusLabel: contractStatusLabel(k.status), isDraft: true });
  const { pdf, blocked } = await renderPdf(html, { contractNo: data.contract_no, version: data.version, note: 'DRAF' });
  if (blocked.length) throw new Error(`Render mencoba akses jaringan: ${blocked[0]}`);
  const key = `${contractId}/v${k.version}-draft.pdf`;
  const { sha256 } = putContractFile(key, pdf);
  await c.query(`UPDATE contracts SET draft_key=$2, draft_sha256=$3, draft_rendered_at=now() WHERE id=$1`, [contractId, key, sha256]);
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
        else throw new Error(`Job ${job.kind} belum diimplementasikan`);
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
