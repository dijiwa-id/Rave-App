import Handlebars from 'handlebars';
import QRCode from 'qrcode';
import { formatIdr } from '@gema/domain';
import { SPK_TEMPLATE_VERSION, type ContractData } from './contract-data.js';

const hb = Handlebars.create();
const esc = (v: unknown) => Handlebars.escapeExpression(String(v ?? ''));

// ---- Helper templat. Semua keluaran berasal dari escapeExpression; templat tidak memakai {{{ }}} untuk input pengguna. ----
const CATEGORY: Record<string, string> = {
  KAMPUS: 'Acara Kampus', PENSI: 'Pentas Seni Sekolah', FESTIVAL: 'Festival', KORPORAT: 'Acara Korporat',
  WEDDING: 'Wedding / Acara Privat', CAFE_CLUB: 'Café / Club', SHOWCASE: 'Showcase',
};
const FORMAT: Record<string, string> = { FULL_BAND: 'Full Band', AKUSTIK: 'Akustik', DJ_SOLO: 'DJ / Solo' };
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const tanggal = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return `${day} ${BULAN[m - 1]} ${y}`;
};
const EMETERAI_PAYER: Record<string, string> = { promotor: 'Pihak Pertama (Promotor)', management: 'Pihak Kedua (Manajemen)', split: 'Pihak Pertama dan Pihak Kedua masing-masing 50%' };

hb.registerHelper('idr', (n: number) => formatIdr(n));
hb.registerHelper('tgl', (d: string) => tanggal(d));
hb.registerHelper('kategori', (k: string) => CATEGORY[k] ?? k);
hb.registerHelper('format', (k: string) => FORMAT[k] ?? k);
hb.registerHelper('dash', (v: unknown) => (v === null || v === undefined || v === '' ? '-' : v));
hb.registerHelper('payer', (k: string) => EMETERAI_PAYER[k] ?? k);
hb.registerHelper('num', (n: number) => Number(n).toLocaleString('id-ID'));
hb.registerHelper('inc', (n: number) => n + 1);
/** Teks bebas pengguna: di-escape lalu baris baru jadi <br>. */
hb.registerHelper('multiline', (t: string) => new hb.SafeString(esc(t).replace(/\r?\n/g, '<br>')));
hb.registerHelper('riderBlock', (o: unknown) => new hb.SafeString(riderHtml(o)));

const RIDER_LABEL: Record<string, string> = {
  personnel: 'Personel', performers: 'Performer', crew: 'Kru', total_travel: 'Total perjalanan',
  stage: 'Panggung', min_width_m: 'Lebar min. (m)', min_depth_m: 'Kedalaman min. (m)', riser: 'Riser',
  pa_system: 'Sound system', min_spl_db: 'SPL min. (dB)', foh_console: 'Konsol FOH',
  monitors: 'Monitor', wedges: 'Wedge', iem_channels: 'Kanal IEM',
  backline: 'Backline', item: 'Perangkat', spec: 'Spesifikasi', substitutable: 'Boleh pengganti',
  input_list: 'Input list', ch: 'Ch', source: 'Sumber', mic: 'Mikrofon',
  soundcheck_minutes: 'Soundcheck (menit)', hospitality: 'Hospitality', green_room: 'Green room',
  meals: 'Konsumsi (porsi)', hotel_rooms: 'Kamar hotel', transport: 'Transportasi',
};
const label = (k: string) => RIDER_LABEL[k] ?? k.replace(/_/g, ' ');

/** Render rider terstruktur (objek/array/skalar) ke HTML ter-escape, kedalaman dibatasi. */
export function riderHtml(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (typeof v !== 'object') return esc(v);
  if (depth > 5) return '…';
  if (Array.isArray(v)) {
    if (v.length === 0) return '-';
    if (v.every((x) => x === null || typeof x !== 'object')) return v.map((x) => esc(x)).join(', ');
    return `<ul>${v.map((x) => `<li>${riderHtml(x, depth + 1)}</li>`).join('')}</ul>`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return '-';
  return `<table class="kv">${entries.map(([k, x]) => `<tr><th>${esc(label(k))}</th><td>${riderHtml(x, depth + 1)}</td></tr>`).join('')}</table>`;
}

// ---- Klausul standar TERKUNCI: bagian dari templat, tidak berasal dari variabel mana pun. ----
export const LOCKED_CLAUSE_TEXT = {
  copyright_documentation:
    'Pihak Pertama boleh mendokumentasikan pertunjukan untuk keperluan non-komersial dan promosi acara. Siaran langsung, rekaman audio/video untuk dijual, atau penggunaan di luar promosi acara memerlukan persetujuan tertulis Pihak Kedua. Nama dan foto Artis hanya boleh dipakai untuk promosi acara ini. Hak cipta atas karya dan pertunjukan tetap pada pemiliknya.',
  late_payment_penalty:
    'Keterlambatan pembayaran termin melewati jatuh tempo dikenakan denda 0,1% (nol koma satu persen) per hari dari nilai termin yang tertunggak, maksimal 5% dari nilai kontrak. Keterlambatan pelunasan melewati H-7 memberi hak kepada Pihak Kedua untuk membatalkan pertunjukan tanpa pengembalian DP.',
  force_majeure:
    'Force majeure meliputi bencana alam, kebijakan pemerintah yang melarang acara, kerusuhan, wabah, dan kejadian lain di luar kendali wajar para pihak yang dibuktikan dengan dokumen resmi. Dana yang ditahan di rekening bersama digunakan untuk penjadwalan ulang paling lambat 90 hari, atau dikembalikan setelah dikurangi biaya riil yang sudah terjadi dan dapat dibuktikan.',
  safety:
    'Pihak Pertama bertanggung jawab atas perizinan keramaian, keamanan, dan keselamatan acara, serta mengunggah bukti izin ke GEMA sebelum hari-H. Asuransi acara bersifat opsional.',
  dispute:
    'Musyawarah → mediasi GEMA (keputusan maksimal 14 hari kerja; sengketa diajukan paling lambat 24 jam setelah acara, dana dibekukan) → arbitrase atau pengadilan negeri domisili Pihak Pertama.',
  radius:
    'Pihak Kedua tidak tampil di acara publik berbayar lain dalam radius 30 km dari venue selama 14 hari sebelum tanggal acara, kecuali disetujui Pihak Pertama.',
} as const;

export const CANCELLATION_MATRIX = [
  ['Promotor, > 30 hari sebelum acara', 'Hangus 50% ke Artis; sisanya refund', 'Refund 100%'],
  ['Promotor, 14–30 hari', 'Hangus 100% ke Artis', 'Refund 50%'],
  ['Promotor, < 14 hari', 'Hangus 100% ke Artis', 'Hangus 100% ke Artis'],
  ['Artis/Manajemen, kapan pun', 'Refund 100% ke Promotor', 'Refund 100% + kompensasi 25% fee + penalti reputasi'],
  ['Force majeure (terbukti dokumen)', 'Ditahan untuk reschedule ≤ 90 hari atau refund dikurangi biaya riil', 'Idem'],
  ['Izin acara tidak keluar', 'Diperlakukan sebagai pembatalan Promotor', 'Idem'],
];

const STYLE = `
@page { size: A4; margin: 22mm 18mm 24mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 'Liberation Serif', 'Times New Roman', serif; color: #111; margin: 0; }
h1 { font-size: 15pt; text-align: center; margin: 0 0 2px; letter-spacing: .04em; }
.sub { text-align: center; color: #444; font-size: 9.5pt; margin-bottom: 14px; }
h2 { font-size: 11.5pt; margin: 16px 0 5px; break-after: avoid; }
p { margin: 4px 0; text-align: justify; }
table { border-collapse: collapse; width: 100%; margin: 6px 0; break-inside: avoid; }
th, td { border: 1px solid #999; padding: 4px 7px; vertical-align: top; text-align: left; font-size: 10pt; }
th { background: #f0f0f0; width: 34%; }
table.cols th { width: auto; }
table.kv th { width: 30%; font-weight: 600; background: #f7f7f7; }
table.kv table.kv { margin: 0; }
ul { margin: 2px 0; padding-left: 16px; }
.locked { border-left: 3px solid #222; padding-left: 8px; }
.sign { display: flex; gap: 12px; margin-top: 18px; break-inside: avoid; }
.sign > div { flex: 1; border: 1px solid #999; padding: 8px; min-height: 96px; font-size: 9.5pt; }
.sign .who { font-weight: 700; margin-bottom: 52px; }
.meta { display: flex; gap: 16px; align-items: center; margin-top: 16px; padding-top: 8px; border-top: 1px solid #999; break-inside: avoid; font-size: 9pt; color: #333; }
.meta svg { width: 84px; height: 84px; flex: none; }
.break { break-before: page; }
.draft { text-align: center; font-weight: 700; color: #a00; letter-spacing: .2em; font-size: 9pt; }
`;

const TEMPLATE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>{{contract_no}} v{{version}}</title><style>{{{style}}}</style></head>
<body>
{{#if isDraft}}<div class="draft">DRAF — BELUM BERLAKU</div>{{/if}}
<h1>SURAT PERJANJIAN KERJASAMA (SPK) PERTUNJUKAN</h1>
<div class="sub">Nomor {{contract_no}} · Versi {{version}} · Templat {{template.version}}</div>

<h2>1. Para Pihak</h2>
<table><tr><th>Pihak Pertama (Promotor)</th><td><b>{{promotor.legal_name}}</b><br>
 Diwakili oleh {{promotor.rep_name}}{{#if promotor.rep_title}}, {{promotor.rep_title}}{{/if}}<br>
 NIK {{dash promotor.nik_mask}} · NPWP {{dash promotor.npwp_mask}}<br>
 Alamat: {{dash promotor.address}}<br>Kontak: {{dash promotor.email}} / {{dash promotor.whatsapp}}</td></tr>
<tr><th>Pihak Kedua (Manajemen)</th><td><b>{{management.legal_name}}</b><br>
 Diwakili oleh {{management.rep_name}}{{#if management.rep_title}}, {{management.rep_title}}{{/if}}<br>
 NPWP {{dash management.npwp_mask}}<br>Alamat: {{dash management.address}}
 {{#if management.bank}}<br>Rekening: {{management.bank.name}} {{management.bank.account_mask}} a.n. {{management.bank.holder}}{{/if}}</td></tr>
<tr><th>Pengisi Acara (Artis)</th><td><b>{{artist.stage_name}}</b>{{#if artist.city}}, {{artist.city}}{{/if}}, dikelola oleh Pihak Kedua.</td></tr>
<tr><th>Platform Fasilitator</th><td>PT GEMA menyediakan sistem kontrak elektronik, rekening bersama (escrow) melalui mitra berizin, dan mediasi. GEMA bukan pihak dalam pertunjukan.</td></tr></table>

<h2>2. Detail Pertunjukan</h2>
<table>
<tr><th>Nama acara</th><td>{{booking.event_name}}</td></tr>
<tr><th>Kategori</th><td>{{kategori booking.category}}</td></tr>
<tr><th>Tanggal</th><td>{{tgl booking.event_date}} (zona waktu venue)</td></tr>
<tr><th>Jam tampil</th><td>{{booking.start_time}} · durasi {{booking.duration_min}} menit</td></tr>
<tr><th>Venue & kota</th><td>{{booking.venue}}, {{booking.city}}</td></tr>
<tr><th>Kapasitas</th><td>{{num booking.capacity}} orang</td></tr>
<tr><th>Format</th><td>{{format booking.format}}</td></tr></table>

<h2>3. Nilai Kontrak, Pajak & Termin</h2>
<p>1. Nilai kontrak (bruto): <b>{{idr money.fee}}</b>. Biaya layanan platform {{idr money.service_fee}} ({{commission.promotor_service_fee_pct}}%) ditanggung Pihak Pertama di atas nilai kontrak; total dibayar Pihak Pertama {{idr money.total_promotor}}.</p>
<p>2. Pajak: {{#if (eq money.tax.kind "PPH23")}}PPh 23{{else}}PPh 21{{/if}} {{money.tax.pct}}% = {{idr money.tax.tax}}, dipotong dari nilai kontrak; nilai bersih diterima Pihak Kedua {{idr money.tax.nett}}. Bukti potong tersedia di aplikasi.</p>
<table class="cols"><tr><th>Termin</th><th>%</th><th>Nominal</th><th>Jatuh tempo</th></tr>
{{#each schedule}}<tr><td>{{label}}</td><td>{{pct}}%</td><td>{{idr amount}}</td><td>{{due_text}}</td></tr>{{/each}}</table>
<p>3. Seluruh pembayaran dilakukan ke rekening bersama (escrow) mitra berizin yang ditunjuk GEMA atas nama booking ini. Dana dicairkan H+1 setelah pertunjukan selesai bila tidak ada sengketa.</p>
{{#if money.emeterai.required}}<p>4. Dokumen ini bernilai di atas {{idr money.emeterai.threshold}} sehingga dibubuhi e-Meterai; bea meterai ditanggung {{payer money.emeterai.payer}}.</p>{{/if}}
<p>Pembagian hasil: Manajemen {{terms.fee_split.management_pct}}%, Artis {{terms.fee_split.artist_pct}}%, komisi platform {{terms.fee_split.platform_pct}}%.</p>

<h2>4. Hak Cipta & Dokumentasi</h2><p class="locked">{{lockedText.copyright_documentation}}</p>
<h2>5. Keterlambatan Pembayaran</h2><p class="locked">{{lockedText.late_payment_penalty}}</p>
<h2>6. Pembatalan, Reschedule & Force Majeure</h2>
<table class="cols"><tr><th>Pihak & waktu pembatalan</th><th>Dana DP</th><th>Dana pelunasan</th></tr>
{{#each matrix}}<tr><td>{{this.[0]}}</td><td>{{this.[1]}}</td><td>{{this.[2]}}</td></tr>{{/each}}</table>
<p>Komisi platform dan biaya pembayaran yang telah terjadi tidak direfund kecuali pembatalan disebabkan kesalahan sistem GEMA.</p>
<p class="locked">{{lockedText.force_majeure}}</p>
<h2>7. Radius & Eksklusivitas</h2><p class="locked">{{lockedText.radius}}</p>
<h2>8. Keamanan, Keselamatan & Perizinan</h2><p class="locked">{{lockedText.safety}}</p>
<h2>9. Penyelesaian Sengketa</h2><p class="locked">{{lockedText.dispute}}</p>
<h2>10. Klausul Khusus</h2>
{{#if terms.special_clauses}}<p>{{multiline terms.special_clauses}}</p>{{else}}<p>Tidak ada klausul khusus tambahan.</p>{{/if}}
<h2>11. Penutup</h2>
<p>Perjanjian ini ditandatangani secara elektronik dan tidak dapat diubah setelah berlaku; perubahan dilakukan melalui adendum yang juga ditandatangani para pihak. Lampiran A (Hospitality Rider) dan Lampiran B (Technical Rider) merupakan bagian tak terpisahkan dari perjanjian ini.</p>

<div class="sign">
 <div><div class="who">Pihak Pertama<br>{{promotor.legal_name}}</div>{{promotor.rep_name}}</div>
 <div><div class="who">Pihak Kedua<br>{{management.legal_name}}</div>{{management.rep_name}}</div>
 {{#if terms.require_artist_ack}}<div><div class="who">Mengetahui<br>{{artist.stage_name}}</div>Artis</div>{{/if}}
</div>
<div class="meta">{{{qr}}}<div>Verifikasi keaslian dokumen: pindai QR atau buka<br><b>{{verifyUrl}}</b><br>Status: {{statusLabel}}{{#if docHash}}<br>SHA-256: {{docHash}}{{/if}}</div></div>

<div class="break"></div>
<h2>Lampiran A — Hospitality Rider{{#if rider.hospitality_version}} (v{{rider.hospitality_version}}){{/if}}</h2>
{{riderBlock rider.hospitality}}
<h2>Lampiran B — Technical Rider{{#if rider.technical_version}} (v{{rider.technical_version}}){{/if}}</h2>
{{riderBlock rider.technical}}
{{#if rider.notes}}<h2>Catatan rider hasil negosiasi</h2><p>{{multiline rider.notes}}</p>{{/if}}
</body></html>`;

hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
const compiled = hb.compile(TEMPLATE, { strict: false });

export interface RenderOpts {
  verifyUrl: string;
  statusLabel: string;
  isDraft: boolean;
  docHash?: string | null;
}

export async function renderContractHtml(data: ContractData, o: RenderOpts): Promise<string> {
  if (data.template.version !== SPK_TEMPLATE_VERSION) throw new Error(`Templat ${data.template.version} tidak dikenal`);
  const qr = await QRCode.toString(o.verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  return compiled({
    ...data,
    ...o,
    qr,
    style: STYLE,
    lockedText: LOCKED_CLAUSE_TEXT,
    matrix: CANCELLATION_MATRIX,
  });
}
