import { afterAll, describe, expect, it } from 'vitest';
import { LOCKED_CLAUSE_TEXT, renderContractHtml, riderHtml } from './contract-template.js';
import { closePdfBrowser, findChromium, normalizePdfDates, pdfDate, renderPdf } from './contract-pdf.js';
import { attestationSigners, maskIp, maskUserId, renderFinalPdf, renderSpkPdf, type SignatureRow } from './contract-jobs.js';
import { createHash } from 'node:crypto';
import { putContractFile, readContractFile, signFileToken, verifyFileToken } from './contract-storage.js';
import type { ContractData } from './contract-data.js';

const party = (name: string) => ({ org_id: null, legal_name: name, rep_name: 'Rep', rep_title: 'Direktur', nik_mask: '************0001', npwp_mask: '***********000', address: 'Jl. Uji 1', email: 'a@b.id', whatsapp: '+62', bank: null });
const base = (): ContractData => ({
  contract_no: 'RAVE/SPK/202610/ABCD1234',
  version: 2,
  template: { id: 'spk', version: 'spk-v2' },
  generated_at: '2026-10-16T00:00:00.000Z',
  booking: { id: 'b1', event_name: 'Pensi Uji', category: 'PENSI', event_date: '2026-12-01', start_time: '19:30', duration_min: 60, venue: 'Aula', city: 'Bandung', capacity: 1000, format: 'FULL_BAND' },
  promotor: party('PT Promotor'),
  management: { ...party('PT Manajemen'), bank: { name: 'BCA', account_mask: '******4567', holder: 'PT Manajemen' } },
  artist: { id: 'a1', stage_name: 'Senja Kolektif', city: 'Bandung' },
  terms: {
    fee: 20_000_000, value_basis: 'GROSS', special_clauses: '', require_artist_ack: true,
    payment_terms: [{ label: 'DP', pct: 50, due: { type: 'ON_SIGN' } }, { label: 'Pelunasan', pct: 50, due: { type: 'DAYS_BEFORE_EVENT', days: 7 } }],
    fee_split: { management_pct: 20, artist_pct: 73, platform_pct: 7 },
  },
  schedule: [
    { label: 'DP', pct: 50, amount: 10_000_000, due_date: '2026-10-19', due_text: 'paling lambat 3×24 jam setelah kontrak ditandatangani' },
    { label: 'Pelunasan', pct: 50, amount: 10_000_000, due_date: '2026-11-24', due_text: 'paling lambat H-7 sebelum pertunjukan' },
  ],
  money: { fee: 20_000_000, service_fee: 800_000, total_promotor: 20_800_000, tax: { kind: 'PPH23', pct: 2, gross: 20_000_000, tax: 400_000, nett: 19_600_000, payee: 'company' }, emeterai: { required: true, threshold: 5_000_000, payer: 'promotor' } },
  rider: { hospitality: { personnel: { performers: 5 }, hospitality: { meals: 8, transport: 'minivan' } }, technical: { stage: { min_width_m: 8 }, input_list: [{ ch: 1, source: 'Kick' }] }, hospitality_version: 3, technical_version: 1, notes: null },
  commission: { promotor_service_fee_pct: 4, artist_commission_pct: 7 },
});
const opts = { verifyUrl: 'http://localhost:5173/verify/abc', statusLabel: 'Draf', isDraft: true };
const DRAFT_SHA = 'a'.repeat(64);
const sigs = (): SignatureRow[] => [
  { party: 'management', signer_name: 'Budi Manajer', signer_user_id: '0193aaaa-bbbb-7ccc-8ddd-eeeeffff1234', method: 'OTP_NATIVE', signed_at: '2026-10-16T08:00:00.000Z', ip_address: '203.0.113.45' },
  { party: 'promotor', signer_name: 'Sari Promotor', signer_user_id: '0193bbbb-cccc-7ddd-8eee-ffff00005678', method: 'OTP_NATIVE', signed_at: '2026-10-16T07:05:09.000Z', ip_address: '::ffff:198.51.100.7' },
  { party: 'artist', signer_name: 'Senja', signer_user_id: '0193cccc-dddd-7eee-8fff-000011119abc', method: 'OTP_NATIVE', signed_at: '2026-10-16T09:00:00.000Z', ip_address: null },
];

describe('templat spk-v2', () => {
  it('memuat klausul terkunci, termin, pajak, e-Meterai, rider & QR', async () => {
    const html = await renderContractHtml(base(), opts);
    for (const t of Object.values(LOCKED_CLAUSE_TEXT)) expect(html).toContain(t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
    expect(html).toContain('RAVE/SPK/202610/ABCD1234');
    expect(html).toContain('Rp 10.000.000');
    expect(html).toContain('PPh 23');
    expect(html).toContain('e-Meterai');
    expect(html).toContain('Lampiran A — Hospitality Rider (v3)');
    expect(html).toContain('Lampiran B — Technical Rider (v1)');
    expect(html).toContain('<svg'); // QR
    expect(html).toContain('http://localhost:5173/verify/abc');
    expect(html).toContain('Mengetahui'); // acknowledgement artis
  });
  it('tanpa acknowledgement artis & di bawah ambang e-Meterai bagian terkait hilang', async () => {
    const d = base();
    d.terms.require_artist_ack = false;
    d.money.emeterai.required = false;
    const html = await renderContractHtml(d, opts);
    expect(html).not.toContain('Mengetahui');
    expect(html).not.toContain('dibubuhi e-Meterai');
  });
  it('meng-escape input pengguna (HTML/JS injection)', async () => {
    const d = base();
    d.promotor.legal_name = '<img src=x onerror=alert(1)>';
    d.booking.event_name = '"><script>fetch("http://evil")</script>';
    d.terms.special_clauses = 'baris1\n<b onclick=x>{{{raw}}}</b>';
    d.rider.technical = { stage: '<script>x</script>', evil: { '<i>': '<svg onload=1>' } };
    const html = await renderContractHtml(d, opts);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toContain('<script>fetch');
    expect(html).not.toContain('<b onclick');
    expect(html).not.toContain('<svg onload');
    expect(html).not.toContain('<i>');
    expect(html).toContain('baris1<br>');
    expect(html).toContain('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;');
  });
  it('klausul terkunci tidak bisa ditimpa lewat data', async () => {
    const html = await renderContractHtml({ ...base(), lockedText: { force_majeure: 'DIHAPUS' }, matrix: [] } as any, opts);
    expect(html).not.toContain('DIHAPUS');
    expect(html).toContain('Force majeure meliputi');
  });
  it('menolak versi templat tak dikenal', async () => {
    const d = base();
    d.template.version = 'spk-v0';
    await expect(renderContractHtml(d, opts)).rejects.toThrow(/tidak dikenal/);
  });
  it('riderHtml aman untuk nilai aneh dan kedalaman berlebih', () => {
    expect(riderHtml(null)).toBe('-');
    expect(riderHtml({})).toBe('-');
    expect(riderHtml([])).toBe('-');
    let deep: any = 'x';
    for (let i = 0; i < 20; i++) deep = { a: deep };
    expect(riderHtml(deep)).toContain('…');
  });
});

describe('dokumen final (lembar pengesahan)', () => {
  it('menyamarkan ID pengguna & IP, urut Promotor → Manajemen → Artis, waktu WIB', () => {
    expect(maskUserId('0193aaaa-bbbb-7ccc-8ddd-eeeeffff1234')).toBe('0193…1234');
    expect(maskIp('203.0.113.45')).toBe('203.0.113.x');
    expect(maskIp('::ffff:198.51.100.7')).toBe('198.51.100.x');
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3:x:x');
    expect(maskIp(null)).toBeNull();
    const s = attestationSigners(sigs());
    expect(s.map((x) => x.party)).toEqual(['Pihak Pertama (Promotor)', 'Pihak Kedua (Manajemen)', 'Artis (Mengetahui)']);
    expect(s[0].at).toBe('16 Oktober 2026 14:05:09 WIB');
    expect(s[0].method).toBe('OTP_NATIVE');
  });
  it('HTML final: tanpa watermark draf, memuat lembar pengesahan & hash yang ditandatangani', async () => {
    const html = await renderContractHtml(base(), {
      verifyUrl: 'http://localhost:5173/verify/abc',
      statusLabel: 'Kontrak Aktif',
      isDraft: false,
      attestation: { signed_sha256: DRAFT_SHA, activated_at: '16 Oktober 2026 16:00:00 WIB', signers: attestationSigners(sigs()) },
    });
    expect(html).not.toContain('DRAF — BELUM BERLAKU');
    expect(html).toContain('Lembar Pengesahan Tanda Tangan Elektronik');
    expect(html).toContain(DRAFT_SHA);
    expect(html).toContain('Sari Promotor');
    expect(html).toContain('0193…1234');
    expect(html).toContain('203.0.113.x');
    expect(html).not.toContain('203.0.113.45');
    expect(html).not.toContain('0193aaaa-bbbb');
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(2); // QR di badan + lembar pengesahan
    // Draf tetap memuat watermark & tanpa lembar pengesahan.
    const draft = await renderContractHtml(base(), opts);
    expect(draft).toContain('DRAF — BELUM BERLAKU');
    expect(draft).not.toContain('Lembar Pengesahan');
  });
  it('legalitas: hanya kolom terisi yang tampil; nama badan hukum kosong diberi penanda', async () => {
    const empty = await renderContractHtml(base(), { ...opts, legal: null });
    expect(empty).toContain('[Nama badan hukum belum diatur]');
    expect(empty).not.toContain('class="legal"');
    expect(empty).not.toMatch(/NIB|PSE|PSrE/);
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const filled = await renderContractHtml(base(), {
      ...opts,
      legal: { entity_name: 'PT Uji Legal', nib: '1234567890123', npwp: '', pse_registration: '', psre_name: '' },
      legalAssets: { pse_logo: png, psre_logo: 'javascript:alert(1)', emeterai_logo: null },
    });
    expect(filled).toContain('PT Uji Legal');
    expect(filled).not.toContain('[Nama badan hukum belum diatur]');
    expect(filled).toContain('NIB 1234567890123');
    expect(filled).not.toContain('NPWP </span>');
    expect(filled).not.toContain('Terdaftar sebagai PSE');
    expect(filled).toContain(`src="${png.replace(/=/g, "&#x3D;")}"`); // entitas didekode parser HTML
    expect(filled).not.toContain('javascript:');
  });
  it('tata letak: pasal bernomor, tabel termin bertotal, blok tanda tangan', async () => {
    const html = await renderContractHtml(base(), opts);
    for (let i = 1; i <= 12; i++) expect(html).toContain(`Pasal ${i}<`);
    expect(html).toContain('Total nilai kontrak');
    expect(html).toContain('Tanggal: ______________________');
    const fin = await renderContractHtml(base(), { ...opts, isDraft: false, attestation: { signed_sha256: DRAFT_SHA, activated_at: 'x', signers: attestationSigners(sigs()) } });
    expect(fin).toContain('Ditandatangani secara elektronik<br>OTP_NATIVE · 16 Oktober 2026 14:05:09 WIB');
  });
  it('normalisasi tanggal PDF menjaga panjang berkas', () => {
    const raw = Buffer.from("x /CreationDate (D:20261112092652+00'00') /ModDate (D:20261112092652+00'00') y", 'latin1');
    const out = normalizePdfDates(raw, '2026-10-16T09:00:00Z');
    expect(out.length).toBe(raw.length);
    expect(out.toString('latin1')).toContain(`/CreationDate (${pdfDate('2026-10-16T09:00:00Z')})`);
    expect(pdfDate('2026-10-16T09:00:00Z')).toBe("D:20261016090000+00'00'");
  });
});

describe('storage privat & signed URL', () => {
  it('token valid, kedaluwarsa, dan dimanipulasi', () => {
    const t = signFileToken('c1/v1-draft.pdf', 600);
    expect(verifyFileToken(t)).toBe('c1/v1-draft.pdf');
    expect(verifyFileToken(t, Date.now() + 601_000)).toBeNull();
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'c2/v1-draft.pdf', e: 9999999999 })).toString('base64url');
    expect(verifyFileToken(`${forged}.${s}`)).toBeNull();
    expect(verifyFileToken(`${p}.x${s.slice(1)}`)).toBeNull();
    expect(verifyFileToken('sampah')).toBeNull();
  });
  it('menolak path traversal', () => {
    expect(() => putContractFile('../../etc/x', Buffer.from('x'))).toThrow();
    expect(() => readContractFile('../../etc/passwd')).toThrow();
  });
});

let chromium: string | null = null;
try {
  chromium = findChromium();
} catch {
  /* tanpa Chromium: tes PDF dilewati */
}
describe.skipIf(!chromium)('render PDF (Chromium nyata)', () => {
  afterAll(() => closePdfBrowser());
  it('menghasilkan PDF multi-halaman dengan hash stabil di storage', async () => {
    const html = await renderContractHtml(base(), opts);
    const { pdf, blocked } = await renderPdf(html, { contractNo: 'RAVE/SPK/202610/ABCD1234', version: 2, note: 'DRAF' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(2); // kontrak + lampiran rider
    expect(blocked).toEqual([]);
    const a = putContractFile('test-suite/x-draft.pdf', pdf);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readContractFile('test-suite/x-draft.pdf').equals(pdf)).toBe(true);
  }, 60_000);
  it('PDF final: deterministik, tanpa watermark, ada lembar pengesahan (+1 halaman)', async () => {
    const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    const f = { verifyUrl: 'http://localhost:5173/verify/abc', signedSha256: DRAFT_SHA, activatedAt: '2026-10-16T09:00:00.000Z', signatures: sigs() };
    const a = await renderFinalPdf(base(), f);
    const b = await renderFinalPdf(base(), f);
    const sha = (x: Buffer) => createHash('sha256').update(x).digest('hex');
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha(a)).toBe(sha(b)); // input sama → hash sama (aman di-retry)
    expect(a.toString('latin1')).toContain(`/CreationDate (${pdfDate(f.activatedAt)})`);
    const other = await renderFinalPdf(base(), { ...f, signatures: sigs().slice(0, 2) });
    expect(sha(other)).not.toBe(sha(a));
    // Draf dengan snapshot sama: final = draf + 1 halaman pengesahan.
    const draft = await renderSpkPdf(base(), { verifyUrl: f.verifyUrl, statusLabel: 'Draf', isDraft: true, fixedDate: base().generated_at });
    const draft2 = await renderSpkPdf(base(), { verifyUrl: f.verifyUrl, statusLabel: 'Draf', isDraft: true, fixedDate: base().generated_at });
    expect(sha(draft)).toBe(sha(draft2)); // draf juga deterministik
    // Contoh untuk ditinjau visual: CONTRACT_PDF_SAMPLE_DIR=/path npx vitest run services/booking
    const dir = process.env.CONTRACT_PDF_SAMPLE_DIR;
    if (dir) for (const [n, buf] of [['final', a], ['draft', draft]] as const) (await import('node:fs')).writeFileSync(`${dir}/rave-spk-sample-${n}.pdf`, buf);
    expect(pages(a)).toBe(pages(draft) + 1);
    expect(sha(a)).not.toBe(sha(draft));
  }, 90_000);
  it('memblokir akses jaringan dari dokumen', async () => {
    const { blocked } = await renderPdf('<html><body><img src="http://127.0.0.1:9/leak.png"><link rel="stylesheet" href="http://127.0.0.1:9/x.css">x</body></html>', { contractNo: 'X', version: 1 });
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((u) => u.includes('127.0.0.1:9'))).toBe(true);
  }, 60_000);
});
