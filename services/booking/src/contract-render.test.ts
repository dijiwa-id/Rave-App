import { afterAll, describe, expect, it } from 'vitest';
import { LOCKED_CLAUSE_TEXT, renderContractHtml, riderHtml } from './contract-template.js';
import { closePdfBrowser, findChromium, renderPdf } from './contract-pdf.js';
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
  it('memblokir akses jaringan dari dokumen', async () => {
    const { blocked } = await renderPdf('<html><body><img src="http://127.0.0.1:9/leak.png"><link rel="stylesheet" href="http://127.0.0.1:9/x.css">x</body></html>', { contractNo: 'X', version: 1 });
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((u) => u.includes('127.0.0.1:9'))).toBe(true);
  }, 60_000);
});
