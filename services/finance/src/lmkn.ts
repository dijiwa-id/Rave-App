// Laporan Penggunaan Lagu dan/atau Musik untuk LMKN (PP 56/2021, SILM) — REQ-ROY-04.
// Mengisi TEMPLATE RESMI yang diberikan tim (assets/lmkn-template.xlsx: sheet "Identitas & Ringkasan", "Log Pemakaian Musik",
// "Petunjuk Pengisian") sehingga gaya, dropdown & rumus ringkasannya tetap utuh. Tanpa dependensi: ZIP dibaca/ditulis dengan zlib.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------------------------------------------------
// ZIP minimal (cukup untuk OOXML: entri tersimpan/deflate, tanpa enkripsi/zip64)
// ---------------------------------------------------------------------------------------------------------------------

export function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Bukan berkas ZIP/XLSX yang valid');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Direktori ZIP rusak');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    out.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function writeZip(entries: Map<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // Tanggal DOS tetap (1 Jan 2024) — isi deterministik untuk pengujian & audit.
  const dosTime = 0;
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, raw] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Data laporan
// ---------------------------------------------------------------------------------------------------------------------

/** Kategori layanan sesuai dropdown template LMKN (layanan streaming digital tidak terdaftar → "Lainnya"). */
export const LMKN_CATEGORIES = ['Restoran / Kafe', 'Pub / Bar / Klub Malam', 'Hotel & Fasilitas Hotel', 'Konser Musik / Event', 'Pusat Perbelanjaan / Pertokoan', 'Transportasi Umum', 'Lembaga Penyiaran (Radio/TV)', 'Karaoke', 'Lainnya'] as const;
export const LMKN_USAGE_TYPES = ['Rekaman', 'Live Music', 'Karaoke', 'Radio / TV Siaran'] as const;

export interface LmknIdentity {
  entityName: string;
  venueName: string;
  category: (typeof LMKN_CATEGORIES)[number];
  address: string;
  cityProvince: string;
  npwp: string;
  licenseNo: string;
  periodLabel: string;
  picName: string;
  picTitle: string;
  picContact: string;
  placeDate: string;
}
export interface LmknLogRow {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  title: string;
  composers: string;
  artist: string;
  producer: string;
  zone: string;
  plays: number;
  duration: string; // MM:SS
  usage: (typeof LMKN_USAGE_TYPES)[number];
  note: string;
}

export const mmss = (ms: number | null | undefined) => {
  if (!ms || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Baris log sebagai tabel CSV untuk unggah massal portal SILM (kolom identik dengan sheet "Log Pemakaian Musik"). */
export const LMKN_LOG_COLUMNS = ['No', 'Tanggal (YYYY-MM-DD)', 'Waktu Mulai (HH:MM)', 'Judul Lagu', 'Pencipta / Komposer', 'Penyanyi / Artis', 'Produser Fonogram / Label', 'Lokasi / Zona Pemutaran', 'Frekuensi (Kali)', 'Durasi (MM:SS)', 'Jenis Penggunaan', 'Keterangan / Sumber'];
export function lmknLogValues(r: LmknLogRow, i: number): (string | number)[] {
  return [i + 1, r.date, r.time, r.title, r.composers, r.artist, r.producer, r.zone, r.plays, r.duration, r.usage, r.note];
}

// ---------------------------------------------------------------------------------------------------------------------
// Pengisian template
// ---------------------------------------------------------------------------------------------------------------------

const xmlEsc = (s: string) =>
  s
    // Karakter kontrol tidak sah di XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const strCell = (ref: string, s: number, v: string) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
const numCell = (ref: string, s: number, v: number) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;

/** Ganti sel `ref` (mempertahankan gaya `s` aslinya) di XML sheet. */
function setCell(xml: string, ref: string, value: string | number | { formula: string; cached: number }): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) throw new Error(`Sel ${ref} tidak ada di template LMKN`);
  const s = Number(/s="(\d+)"/.exec(m[1])?.[1] ?? 0);
  const cell = typeof value === 'object' ? `<c r="${ref}" s="${s}"><f>${xmlEsc(value.formula)}</f><v>${value.cached}</v></c>` : typeof value === 'number' ? numCell(ref, s, value) : strCell(ref, s, value);
  return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
}

const LOG_SHEET = "'Log Pemakaian Musik'";
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
// Gaya baris data kosong template (baris 8+): tengah = 13, teks rata kiri = 14, angka = 15; baris total = 16/17/18.
const COL_STYLE = [13, 13, 13, 14, 14, 14, 14, 14, 15, 13, 13, 14];

export function buildLmknWorkbook(template: Buffer, id: LmknIdentity, rows: LmknLogRow[]): Buffer {
  const files = readZip(template);
  const get = (n: string) => {
    const b = files.get(n);
    if (!b) throw new Error(`Template LMKN tidak lengkap: ${n}`);
    return b.toString('utf8');
  };
  const first = 6;
  const last = first + Math.max(rows.length, 1) - 1;
  const totalRow = last + 1;
  const plays = rows.reduce((a, r) => a + r.plays, 0);
  const countUsage = (u: string) => rows.filter((r) => r.usage === u).length;

  // ---- Sheet 2: Log Pemakaian Musik ----
  let s2 = get('xl/worksheets/sheet2.xml');
  const head = s2.slice(0, s2.indexOf('<row r="6"'));
  const tail = s2.slice(s2.indexOf('</sheetData>'));
  const rowXml = rows.map((r, i) => {
    const n = first + i;
    const vals = lmknLogValues(r, i);
    const cells = vals.map((v, c) => (typeof v === 'number' ? numCell(`${COLS[c]}${n}`, COL_STYLE[c], v) : strCell(`${COLS[c]}${n}`, COL_STYLE[c], v))).join('');
    return `<row r="${n}" spans="1:12" ht="20.100000000000001" customHeight="1" x14ac:dyDescent="0.25">${cells}</row>`;
  });
  if (!rows.length) rowXml.push(`<row r="6" spans="1:12" ht="20.100000000000001" customHeight="1" x14ac:dyDescent="0.25">${COLS.map((c, i) => `<c r="${c}6" s="${COL_STYLE[i]}"/>`).join('')}</row>`);
  const total =
    `<row r="${totalRow}" spans="1:12" ht="24" customHeight="1" x14ac:dyDescent="0.25">` +
    COLS.map((c) => (c === 'D' ? strCell(`D${totalRow}`, 17, 'TOTAL FREKUENSI') : c === 'I' ? `<c r="I${totalRow}" s="18"><f>SUM(I${first}:I${last})</f><v>${plays}</v></c>` : `<c r="${c}${totalRow}" s="16"/>`)).join('') +
    '</row>';
  s2 = head.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A2:L${totalRow}"/>`) + rowXml.join('') + total + tail.replace(/sqref="K6:K\d+"/, `sqref="K6:K${last}"`);
  files.set('xl/worksheets/sheet2.xml', Buffer.from(s2, 'utf8'));

  // ---- Sheet 1: Identitas & Ringkasan ----
  let s1 = get('xl/worksheets/sheet1.xml');
  const ident: [string, string][] = [
    ['C6', id.entityName], ['C7', id.venueName], ['C8', id.category], ['C9', id.address], ['C10', id.cityProvince], ['C11', id.npwp],
    ['C12', id.licenseNo], ['C13', id.periodLabel], ['C14', id.picName], ['C15', id.picTitle], ['C16', id.picContact], ['C27', id.placeDate],
  ];
  for (const [ref, v] of ident) s1 = setCell(s1, ref, v);
  s1 = setCell(s1, 'C20', { formula: `COUNTA(${LOG_SHEET}!D${first}:D${last})`, cached: rows.length });
  s1 = setCell(s1, 'C21', { formula: `SUM(${LOG_SHEET}!I${first}:I${last})`, cached: plays });
  s1 = setCell(s1, 'C22', { formula: `COUNTIF(${LOG_SHEET}!K${first}:K${last}, "Rekaman")`, cached: countUsage('Rekaman') });
  s1 = setCell(s1, 'C23', { formula: `COUNTIF(${LOG_SHEET}!K${first}:K${last}, "Live Music")`, cached: countUsage('Live Music') });
  files.set('xl/worksheets/sheet1.xml', Buffer.from(s1, 'utf8'));

  // ---- Rumus dihitung ulang saat dibuka; calcChain lama dibuang agar Excel tidak "memperbaiki" berkas ----
  files.delete('xl/calcChain.xml');
  files.set('[Content_Types].xml', Buffer.from(get('[Content_Types].xml').replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''), 'utf8'));
  files.set('xl/_rels/workbook.xml.rels', Buffer.from(get('xl/_rels/workbook.xml.rels').replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, ''), 'utf8'));
  files.set('xl/workbook.xml', Buffer.from(get('xl/workbook.xml').replace(/<calcPr ([^/]*?)\/>/, (_m, a) => `<calcPr ${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`), 'utf8'));
  return writeZip(files);
}
