import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLmknWorkbook, mmss, readZip, writeZip, type LmknIdentity } from './lmkn.js';

const template = readFileSync(new URL('../assets/lmkn-template.xlsx', import.meta.url));
const id: LmknIdentity = {
  entityName: 'PT Contoh <RAVE> & Co', venueName: 'RAVE', category: 'Lainnya', address: 'Jl. X', cityProvince: 'Jakarta, DKI Jakarta', npwp: '01.234',
  licenseNo: '-', periodLabel: 'November 2026', picName: 'A', picTitle: 'Finance', picContact: 'a@x.id', placeDate: 'Jakarta, 10 Desember 2026',
};
const row = (i: number) => ({ date: '2026-11-0' + ((i % 9) + 1), time: '19:15', title: `Lagu ${i}`, composers: 'Pencipta', artist: 'Artis', producer: 'Label', zone: 'Aplikasi RAVE', plays: i + 1, duration: '03:30', usage: 'Rekaman' as const, note: 'ISRC' });

describe('laporan LMKN (template resmi)', () => {
  it('ZIP round-trip identik', () => {
    const z = readZip(template);
    const again = readZip(writeZip(z));
    expect([...again.keys()].sort()).toEqual([...z.keys()].sort());
    for (const [k, v] of z) expect(again.get(k)!.equals(v)).toBe(true);
  });
  it('mengisi identitas, log, total & ringkasan; calcChain dibuang; tetap 3 sheet', () => {
    const out = readZip(buildLmknWorkbook(template, id, [row(0), row(1), row(2)]));
    const s1 = out.get('xl/worksheets/sheet1.xml')!.toString();
    const s2 = out.get('xl/worksheets/sheet2.xml')!.toString();
    expect(s1).toContain('PT Contoh &lt;RAVE&gt; &amp; Co');
    expect(s1).toContain("COUNTA('Log Pemakaian Musik'!D6:D8)</f><v>3</v>");
    expect(s1).toContain("SUM('Log Pemakaian Musik'!I6:I8)</f><v>6</v>");
    expect(s2).toContain('<row r="8"');
    expect(s2).toContain('<f>SUM(I6:I8)</f><v>6</v>');
    expect(s2).toContain('sqref="K6:K8"');
    expect(s2).not.toContain('Contoh: Hati-Hati di Jalan');
    expect(out.has('xl/calcChain.xml')).toBe(false);
    expect(out.get('[Content_Types].xml')!.toString()).not.toContain('calcChain');
    expect(out.get('xl/workbook.xml')!.toString()).toContain('fullCalcOnLoad="1"');
    expect(out.has('xl/worksheets/sheet3.xml')).toBe(true);
  });
  it('periode tanpa pemakaian tetap berkas valid', () => {
    const s2 = readZip(buildLmknWorkbook(template, id, [])).get('xl/worksheets/sheet2.xml')!.toString();
    expect(s2).toContain('<f>SUM(I6:I6)</f><v>0</v>');
  });
  it('durasi MM:SS', () => {
    expect(mmss(242_000)).toBe('04:02');
    expect(mmss(null)).toBe('');
  });
});
