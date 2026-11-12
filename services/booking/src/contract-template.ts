import Handlebars from 'handlebars';
import QRCode from 'qrcode';
import { formatIdr } from '@rave/domain';
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
    'Pihak Pertama bertanggung jawab atas perizinan keramaian, keamanan, dan keselamatan acara, serta mengunggah bukti izin ke RAVE sebelum hari-H. Asuransi acara bersifat opsional.',
  dispute:
    'Musyawarah → mediasi RAVE (keputusan maksimal 14 hari kerja; sengketa diajukan paling lambat 24 jam setelah acara, dana dibekukan) → arbitrase atau pengadilan negeri domisili Pihak Pertama.',
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

// ---- Tata letak dokumen hukum: margin ±2,5 cm (diatur di renderPdf), pasal bernomor, tabel & blok tanda tangan tidak terpotong. ----
const STYLE = `
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font: 10.5pt/1.55 'Liberation Serif', 'Times New Roman', serif; color: #111; margin: 0; }
p { margin: 0 0 5px; text-align: justify; hyphens: auto; }
b { font-weight: 700; }
.draft-banner { border: 1.5px solid #a00; color: #a00; text-align: center; font: 700 9pt/1.4 'Liberation Sans', Arial, sans-serif; letter-spacing: .18em; padding: 5px; margin-bottom: 12px; }
.draft-banner small { display: block; letter-spacing: .02em; font-weight: 400; }
.cover { text-align: center; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
.cover .kind { font: 700 9pt 'Liberation Sans', Arial, sans-serif; letter-spacing: .28em; color: #444; }
.cover h1 { font-size: 16pt; letter-spacing: .06em; margin: 4px 0 8px; }
table.idbox { width: 100%; border-collapse: collapse; font: 8.5pt/1.35 'Liberation Sans', Arial, sans-serif; }
table.idbox td { border: 0; padding: 0 6px; text-align: center; color: #333; }
table.idbox td b { display: block; font-size: 9.5pt; color: #111; }
.preamble { margin: 10px 0 6px; }
h2 { font: 700 10.5pt/1.3 'Liberation Sans', Arial, sans-serif; text-transform: uppercase; letter-spacing: .05em; margin: 16px 0 6px; break-after: avoid; page-break-after: avoid; }
h2 .no { display: block; font-size: 9pt; color: #555; letter-spacing: .12em; }
h3 { font: 700 10pt 'Liberation Sans', Arial, sans-serif; margin: 12px 0 4px; break-after: avoid; }
ol.ayat { margin: 0 0 4px; padding-left: 20px; }
ol.ayat > li { margin-bottom: 4px; text-align: justify; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 8px; break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #9a9a9a; padding: 4px 7px; vertical-align: top; text-align: left; font-size: 9.8pt; }
th { background: #f1f1f1; font-weight: 700; }
table.parties th { width: 30%; }
table.detail th { width: 30%; font-weight: 600; background: #f7f7f7; }
table.grid thead th { background: #e9e9e9; font: 700 8.8pt 'Liberation Sans', Arial, sans-serif; text-transform: uppercase; letter-spacing: .03em; }
table.grid td.num, table.grid th.num { text-align: right; white-space: nowrap; }
table.grid tfoot td { font-weight: 700; background: #f7f7f7; }
table.kv th { width: 30%; font-weight: 600; background: #f7f7f7; }
table.kv table.kv { margin: 0; }
ul { margin: 2px 0; padding-left: 16px; }
.locked { border-left: 3px solid #333; padding-left: 9px; }
.missing { color: #a00; font-weight: 700; }
.keep { break-inside: avoid; page-break-inside: avoid; }
.signs { display: flex; gap: 10px; margin-top: 18px; break-inside: avoid; page-break-inside: avoid; }
.signs > .sig { flex: 1; border: 1px solid #9a9a9a; padding: 8px 9px; font-size: 9.3pt; display: flex; flex-direction: column; min-height: 150px; }
.sig .role { font: 700 8.5pt 'Liberation Sans', Arial, sans-serif; text-transform: uppercase; letter-spacing: .06em; color: #444; }
.sig .org { font-weight: 700; margin-bottom: 6px; }
.sig .space { flex: 1; min-height: 48px; display: flex; align-items: center; justify-content: center; text-align: center; font: 8pt/1.35 'Liberation Sans', Arial, sans-serif; color: #1a5d1a; }
.sig .line { border-top: 1px solid #111; padding-top: 3px; }
.sig .muted { color: #555; font-size: 8.6pt; }
.verify { display: flex; gap: 14px; align-items: center; margin-top: 16px; padding: 8px 10px; border: 1px solid #9a9a9a; break-inside: avoid; page-break-inside: avoid; font: 8.6pt/1.45 'Liberation Sans', Arial, sans-serif; color: #333; }
.verify svg { width: 80px; height: 80px; flex: none; }
.legal { margin-top: 8px; padding-top: 6px; border-top: 1px solid #ccc; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font: 8pt/1.4 'Liberation Sans', Arial, sans-serif; color: #444; break-inside: avoid; }
.legal img { height: 26px; width: auto; }
.break { break-before: page; page-break-before: always; }
.mono { font-family: 'Liberation Mono', 'Courier New', monospace; font-size: 8.3pt; word-break: break-all; }
.attest td, .attest th { font-size: 8.8pt; }
`;

const LEGAL_STRIP = `{{#if legal.show}}<div class="legal">
{{#if legal.entity_name}}<span><b>{{legal.entity_name}}</b></span>{{/if}}
{{#if legal.nib}}<span>NIB {{legal.nib}}</span>{{/if}}
{{#if legal.npwp}}<span>NPWP {{legal.npwp}}</span>{{/if}}
{{#if legal.pse_registration}}<span>Terdaftar sebagai PSE · No. {{legal.pse_registration}}</span>{{/if}}
{{#if legal.psre_name}}<span>Mitra PSrE: {{legal.psre_name}}</span>{{/if}}
{{#if legal.address}}<span>{{legal.address}}</span>{{/if}}
{{#each legal.logos}}<img src="{{this.src}}" alt="{{this.alt}}">{{/each}}
</div>{{/if}}`;

const SIGN_BLOCK = (party: string, role: string, org: string, rep: string, title: string) => `
 <div class="sig"><div class="role">${role}</div><div class="org">${org}</div>
  <div class="space">{{#if signed.${party}}}Ditandatangani secara elektronik<br>{{signed.${party}.method}} · {{signed.${party}.at}}{{/if}}</div>
  <div class="line">Nama: <b>${rep}</b></div>
  <div class="muted">Jabatan: ${title}</div>
  <div class="muted">Tanggal: {{#if signed.${party}}}{{signed.${party}.date}}{{else}}______________________{{/if}}</div></div>`;

const TEMPLATE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>{{contract_no}} v{{version}}</title><style>{{{style}}}</style></head>
<body>
{{#if isDraft}}<div class="draft-banner">DRAF — BELUM BERLAKU<small>Dokumen ini belum ditandatangani seluruh pihak dan belum mengikat.</small></div>{{/if}}
<div class="cover">
 <div class="kind">SURAT PERJANJIAN KERJASAMA (SPK)</div>
 <h1>PERTUNJUKAN ARTIS</h1>
 <table class="idbox"><tr>
  <td>Nomor<b>{{contract_no}}</b></td><td>Versi<b>{{version}}</b></td><td>Templat<b>{{template.version}}</b></td>
  <td>Dibuat<b>{{tglwib generated_at}}</b></td><td>Status<b>{{statusLabel}}</b></td></tr></table>
</div>

<p class="preamble">Perjanjian ini dibuat dan ditandatangani secara elektronik oleh para pihak di bawah ini, yang selanjutnya secara bersama-sama disebut "Para Pihak", dengan ketentuan sebagai berikut.</p>

<h2><span class="no">Pasal 1</span>Para Pihak</h2>
<table class="parties">
<tr><th>Pihak Pertama (Promotor)</th><td><b>{{promotor.legal_name}}</b><br>
 Diwakili oleh {{promotor.rep_name}}{{#if promotor.rep_title}}, {{promotor.rep_title}}{{/if}}<br>
 NIK {{dash promotor.nik_mask}} · NPWP {{dash promotor.npwp_mask}}<br>
 Alamat: {{dash promotor.address}}<br>Kontak: {{dash promotor.email}} / {{dash promotor.whatsapp}}</td></tr>
<tr><th>Pihak Kedua (Manajemen)</th><td><b>{{management.legal_name}}</b><br>
 Diwakili oleh {{management.rep_name}}{{#if management.rep_title}}, {{management.rep_title}}{{/if}}<br>
 NPWP {{dash management.npwp_mask}}<br>Alamat: {{dash management.address}}
 {{#if management.bank}}<br>Rekening: {{management.bank.name}} {{management.bank.account_mask}} a.n. {{management.bank.holder}}{{/if}}</td></tr>
<tr><th>Pengisi Acara (Artis)</th><td><b>{{artist.stage_name}}</b>{{#if artist.city}}, {{artist.city}}{{/if}}, dikelola oleh Pihak Kedua.</td></tr>
<tr><th>Platform Fasilitator</th><td>{{#if legal.entity_name}}<b>{{legal.entity_name}}</b>{{else}}<span class="missing">[Nama badan hukum belum diatur]</span>{{/if}} ("RAVE") menyediakan sistem kontrak elektronik, rekening bersama (escrow) melalui mitra berizin, dan mediasi. RAVE bukan pihak dalam pertunjukan.</td></tr></table>

<h2><span class="no">Pasal 2</span>Detail Pertunjukan</h2>
<table class="detail">
<tr><th>Nama acara</th><td>{{booking.event_name}}</td></tr>
<tr><th>Kategori</th><td>{{kategori booking.category}}</td></tr>
<tr><th>Tanggal</th><td>{{tgl booking.event_date}} (zona waktu venue)</td></tr>
<tr><th>Jam tampil</th><td>{{booking.start_time}} · durasi {{booking.duration_min}} menit</td></tr>
<tr><th>Venue & kota</th><td>{{booking.venue}}, {{booking.city}}</td></tr>
<tr><th>Kapasitas</th><td>{{num booking.capacity}} orang</td></tr>
<tr><th>Format</th><td>{{format booking.format}}</td></tr></table>

<h2><span class="no">Pasal 3</span>Nilai Kontrak & Pajak</h2>
<ol class="ayat">
<li>Nilai kontrak (bruto): <b>{{idr money.fee}}</b>. Biaya layanan platform {{idr money.service_fee}} ({{commission.promotor_service_fee_pct}}%) ditanggung Pihak Pertama di atas nilai kontrak; total dibayar Pihak Pertama <b>{{idr money.total_promotor}}</b>.</li>
<li>Pajak: {{#if (eq money.tax.kind "PPH23")}}PPh 23{{else}}PPh 21{{/if}} {{money.tax.pct}}% = {{idr money.tax.tax}}, dipotong dari nilai kontrak; nilai bersih diterima Pihak Kedua {{idr money.tax.nett}}. Bukti potong tersedia di aplikasi.</li>
<li>Pembagian hasil: Manajemen {{terms.fee_split.management_pct}}%, Artis {{terms.fee_split.artist_pct}}%, komisi platform {{terms.fee_split.platform_pct}}%.</li>
{{#if money.emeterai.required}}<li>Dokumen ini bernilai di atas {{idr money.emeterai.threshold}} sehingga dibubuhi e-Meterai; bea meterai ditanggung {{payer money.emeterai.payer}}.</li>{{/if}}
</ol>

<h2><span class="no">Pasal 4</span>Jadwal Pembayaran</h2>
<table class="grid"><thead><tr><th>No.</th><th>Termin</th><th class="num">%</th><th class="num">Nominal</th><th>Jatuh tempo</th></tr></thead>
<tbody>{{#each schedule}}<tr><td>{{inc @index}}</td><td>{{label}}</td><td class="num">{{pct}}%</td><td class="num">{{idr amount}}</td><td>{{due_text}}</td></tr>{{/each}}</tbody>
<tfoot><tr><td></td><td>Total nilai kontrak</td><td class="num">100%</td><td class="num">{{idr money.fee}}</td><td></td></tr></tfoot></table>
<p>Seluruh pembayaran dilakukan ke rekening bersama (escrow) mitra berizin yang ditunjuk RAVE atas nama booking ini. Dana dicairkan H+1 setelah pertunjukan selesai bila tidak ada sengketa.</p>

<h2><span class="no">Pasal 5</span>Hak Cipta & Dokumentasi</h2><p class="locked">{{lockedText.copyright_documentation}}</p>
<h2><span class="no">Pasal 6</span>Keterlambatan Pembayaran</h2><p class="locked">{{lockedText.late_payment_penalty}}</p>
<h2><span class="no">Pasal 7</span>Pembatalan, Penjadwalan Ulang & Force Majeure</h2>
<table class="grid"><thead><tr><th>Pihak & waktu pembatalan</th><th>Dana DP</th><th>Dana pelunasan</th></tr></thead>
<tbody>{{#each matrix}}<tr><td>{{this.[0]}}</td><td>{{this.[1]}}</td><td>{{this.[2]}}</td></tr>{{/each}}</tbody></table>
<p>Komisi platform dan biaya pembayaran yang telah terjadi tidak direfund kecuali pembatalan disebabkan kesalahan sistem RAVE.</p>
<p class="locked">{{lockedText.force_majeure}}</p>
<h2><span class="no">Pasal 8</span>Radius & Eksklusivitas</h2><p class="locked">{{lockedText.radius}}</p>
<h2><span class="no">Pasal 9</span>Keamanan, Keselamatan & Perizinan</h2><p class="locked">{{lockedText.safety}}</p>
<h2><span class="no">Pasal 10</span>Penyelesaian Sengketa</h2><p class="locked">{{lockedText.dispute}}</p>
<h2><span class="no">Pasal 11</span>Klausul Khusus</h2>
{{#if terms.special_clauses}}<p>{{multiline terms.special_clauses}}</p>{{else}}<p>Tidak ada klausul khusus tambahan.</p>{{/if}}
<h2><span class="no">Pasal 12</span>Penutup</h2>
<p>Perjanjian ini ditandatangani secara elektronik dan tidak dapat diubah setelah berlaku; perubahan dilakukan melalui adendum yang juga ditandatangani Para Pihak. Lampiran A (Hospitality Rider) dan Lampiran B (Technical Rider) merupakan bagian tak terpisahkan dari perjanjian ini.</p>

<div class="signs">
${SIGN_BLOCK('promotor', 'Pihak Pertama', '{{promotor.legal_name}}', '{{promotor.rep_name}}', '{{dash promotor.rep_title}}')}
${SIGN_BLOCK('management', 'Pihak Kedua', '{{management.legal_name}}', '{{management.rep_name}}', '{{dash management.rep_title}}')}
 {{#if terms.require_artist_ack}}${SIGN_BLOCK('artist', 'Mengetahui', '{{artist.stage_name}}', '{{artist.stage_name}}', 'Artis')}{{/if}}
</div>

<div class="verify">{{{qr}}}<div>Verifikasi keaslian dokumen: pindai QR atau buka<br><b>{{verifyUrl}}</b><br>Status: {{statusLabel}}{{#if docHash}}<br>SHA-256: {{docHash}}{{/if}}{{#if attestation}}<br>SHA-256 dokumen yang ditandatangani: <span class="mono">{{attestation.signed_sha256}}</span>{{/if}}</div></div>
${LEGAL_STRIP}

<div class="break"></div>
<h2>Lampiran A — Hospitality Rider{{#if rider.hospitality_version}} (v{{rider.hospitality_version}}){{/if}}</h2>
{{riderBlock rider.hospitality}}
<h2>Lampiran B — Technical Rider{{#if rider.technical_version}} (v{{rider.technical_version}}){{/if}}</h2>
{{riderBlock rider.technical}}
{{#if rider.notes}}<h3>Catatan rider hasil negosiasi</h3><p>{{multiline rider.notes}}</p>{{/if}}
{{#if attestation}}
<div class="break"></div>
<h2>Lembar Pengesahan Tanda Tangan Elektronik</h2>
<p>Dokumen final ini memuat isi yang sama persis dengan dokumen draf (nomor {{contract_no}}, versi {{version}}) yang ditandatangani secara elektronik oleh Para Pihak di bawah ini melalui sistem RAVE. Setiap tanda tangan mengikat pada sidik dokumen (SHA-256) draf berikut:</p>
<table class="detail attest"><tr><th>Nomor kontrak</th><td>{{contract_no}}</td></tr>
<tr><th>Versi kontrak / templat</th><td>Versi {{version}} · {{template.version}}</td></tr>
<tr><th>SHA-256 dokumen yang ditandatangani</th><td class="mono">{{attestation.signed_sha256}}</td></tr>
<tr><th>Kontrak berlaku sejak</th><td>{{attestation.activated_at}}</td></tr></table>
<table class="grid attest"><thead><tr><th>Pihak</th><th>Nama penanda tangan</th><th>ID pengguna</th><th>Metode</th><th>Waktu (WIB)</th><th>Alamat IP</th></tr></thead>
<tbody>{{#each attestation.signers}}<tr><td>{{party}}</td><td>{{name}}</td><td class="mono">{{user}}</td><td>{{method}}</td><td>{{at}}</td><td class="mono">{{dash ip}}</td></tr>{{/each}}</tbody></table>
<p>Metode OTP_NATIVE: penanda tangan diautentikasi dengan kode sekali pakai (OTP) yang dikirim ke kontak terverifikasi akunnya, lalu tanda tangan dicatat bersama sidik dokumen, alamat IP, dan perangkat pada jejak audit yang tidak dapat diubah (append-only). ID pengguna dan alamat IP ditampilkan tersamar untuk melindungi data pribadi; data lengkap tersimpan di jejak audit RAVE.</p>
<div class="verify">{{{qr}}}<div>Verifikasi keaslian dokumen final: pindai QR atau buka<br><b>{{verifyUrl}}</b><br>Bandingkan SHA-256 berkas PDF ini dengan nilai "dokumen final" pada halaman verifikasi.</div></div>
${LEGAL_STRIP}
{{/if}}
</body></html>`;

hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hb.registerHelper('tglwib', (d: string) => wibDate(d));
const compiled = hb.compile(TEMPLATE, { strict: false });

export interface SignerAttestation {
  key: string; // promotor | management | artist
  party: string; // label pihak, mis. "Pihak Pertama (Promotor)"
  name: string;
  user: string; // ID pengguna tersamar
  method: string;
  at: string; // waktu WIB terformat
  ip: string | null; // tersamar
}
export interface Attestation {
  signed_sha256: string;
  activated_at: string;
  signers: SignerAttestation[];
}

/**
 * Identitas legal platform yang dibekukan ke snapshot kontrak saat draf dirender (pengaturan `legal.*`).
 * Logo = path file di bucket branding (nama file = hash isi → isi tidak berubah).
 */
export interface PlatformLegal {
  entity_name: string;
  nib: string;
  npwp: string;
  address: string;
  pse_registration: string;
  psre_name: string;
  pse_logo: string;
  psre_logo: string;
  emeterai_logo: string;
  brand_logo: string;
}
/** Logo legalitas yang sudah di-resolve ke data URI (render tanpa jaringan). */
export interface LegalAssets {
  pse_logo?: string | null;
  psre_logo?: string | null;
  emeterai_logo?: string | null;
}

export interface RenderOpts {
  verifyUrl: string;
  statusLabel: string;
  isDraft: boolean;
  docHash?: string | null;
  /** Hanya dokumen FINAL: lembar pengesahan tanda tangan. */
  attestation?: Attestation | null;
  /** Identitas legal platform (dari snapshot). Kolom kosong tidak ditampilkan. */
  legal?: Partial<PlatformLegal> | null;
  legalAssets?: LegalAssets | null;
}

/** QR verifikasi (SVG) — dipakai di badan dokumen & footer tiap halaman. */
export const qrSvg = (url: string) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

/** Waktu WIB (UTC+7) deterministik tanpa bergantung ICU/zona waktu host: "16 Oktober 2026 14:05:09 WIB". */
export function wibDateTime(d: Date | string): string {
  const t = new Date(new Date(d).getTime() + 7 * 3600_000).toISOString();
  return `${tanggal(t)} ${t.slice(11, 19)} WIB`;
}
const wibDate = (d: Date | string) => tanggal(new Date(new Date(d).getTime() + 7 * 3600_000).toISOString());

const DATA_IMG = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Tanda RAVE bawaan (ikon resmi, sama dengan apps/web/src/assets/brand/rave-icon.svg) untuk header PDF. */
export const RAVE_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#5B2A6E"/><circle cx="32" cy="33" r="22" fill="#181818" stroke="#EDEDED" stroke-width="1.5"/><g fill="none" stroke="#EDEDED" stroke-opacity=".55" stroke-width=".8"><circle cx="32" cy="33" r="18"/><circle cx="32" cy="33" r="15.5"/><circle cx="32" cy="33" r="13"/><circle cx="32" cy="33" r="10.5"/></g><path d="M13 10h12.5L32 41.5 38.5 10H51L37.5 57h-11z" fill="#EDEDED" stroke="#5B2A6E" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
export const RAVE_MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(RAVE_MARK_SVG).toString('base64')}`;

export async function renderContractHtml(data: ContractData, o: RenderOpts): Promise<string> {
  if (data.template.version !== SPK_TEMPLATE_VERSION) throw new Error(`Templat ${data.template.version} tidak dikenal`);
  const qr = await qrSvg(o.verifyUrl);
  const lg = o.legal ?? {};
  const a = o.legalAssets ?? {};
  const logos = [
    a.pse_logo && { src: a.pse_logo, alt: 'Tanda terdaftar PSE' },
    a.psre_logo && { src: a.psre_logo, alt: lg.psre_name || 'PSrE' },
    data.money?.emeterai?.required && a.emeterai_logo && { src: a.emeterai_logo, alt: 'Mitra e-Meterai' },
  ].filter((x): x is { src: string; alt: string } => !!x && DATA_IMG.test(x.src));
  const legal = {
    entity_name: lg.entity_name?.trim() || '',
    nib: lg.nib?.trim() || '',
    npwp: lg.npwp?.trim() || '',
    address: lg.address?.trim() || '',
    pse_registration: lg.pse_registration?.trim() || '',
    psre_name: lg.psre_name?.trim() || '',
    logos,
  };
  const show = !!(legal.entity_name || legal.nib || legal.npwp || legal.address || legal.pse_registration || legal.psre_name || logos.length);
  // Blok tanda tangan versi final: stempel "ditandatangani elektronik" per pihak.
  const signed: Record<string, { method: string; at: string; date: string }> = {};
  for (const s of o.attestation?.signers ?? []) signed[s.key] = { method: s.method, at: s.at, date: s.at.replace(/ \d{2}:\d{2}:\d{2} WIB$/, '') };
  return compiled({
    ...data,
    ...o,
    qr,
    style: STYLE,
    lockedText: LOCKED_CLAUSE_TEXT,
    matrix: CANCELLATION_MATRIX,
    legal: { ...legal, show },
    signed,
  });
}
