import { createHash } from 'node:crypto';
import { bookingInvoice, formatIdr } from '@rave/domain';
import { commissionPolicy, type BookingRow } from './common.js';

export const TEMPLATE_VERSION = 'booking-v1';

interface Ctx {
  b: BookingRow;
  fee: number;
  artistName: string;
  artistCity: string | null;
  promotorName: string;
  rider: Record<string, any>;
  riderNotes: string | null;
}

const CATEGORY: Record<string, string> = {
  KAMPUS: 'Acara Kampus',
  PENSI: 'Pentas Seni Sekolah',
  FESTIVAL: 'Festival',
  KORPORAT: 'Acara Korporat',
  WEDDING: 'Wedding / Acara Privat',
  CAFE_CLUB: 'Café / Club',
  SHOWCASE: 'Showcase',
};

/** Templat kontrak booking berversi — memuat klausul wajib BRD §8.7 & matriks pembatalan §7.3. */
export function renderContract({ b, fee, artistName, artistCity, promotorName, rider, riderNotes }: Ctx): { body: string; sha256: string } {
  const inv = bookingInvoice(fee, b.dp_pct, commissionPolicy());
  const r = rider ?? {};
  const body = `# PERJANJIAN PERTUNJUKAN (BOOKING) — RAVE
Templat: \`${TEMPLATE_VERSION}\` · Nomor booking: \`${b.id}\`

## 1. Para Pihak
1. **Penyelenggara (Promotor):** ${promotorName} (selanjutnya "Pihak Pertama").
2. **Pengisi Acara (Artis):** ${artistName}${artistCity ? `, berdomisili di ${artistCity}` : ''}, diwakili manajemen resminya (selanjutnya "Pihak Kedua").
3. **PT RAVE (Platform Fasilitator):** menyediakan sistem kontrak elektronik, rekening bersama (escrow) melalui mitra berizin, dan mediasi. RAVE bukan pihak dalam pertunjukan.

## 2. Detail Pertunjukan
| Butir | Ketentuan |
|---|---|
| Nama acara | ${b.event_name} |
| Kategori | ${CATEGORY[b.category] ?? b.category} |
| Tanggal | ${b.event_date} (zona waktu venue) |
| Jam tampil | ${b.start_time} · durasi ${b.duration_min} menit |
| Venue & kota | ${b.venue}, ${b.city} |
| Kapasitas | ${b.capacity.toLocaleString('id-ID')} orang |
| Format | ${b.format.replace('_', ' ')} |
| Personel & soundcheck | ${r.personnel?.performers ?? '-'} performer, ${r.personnel?.crew ?? '-'} kru; soundcheck ${r.soundcheck_minutes ?? 60} menit |

## 3. Fee, Termin & Rekening Bersama
1. Fee pertunjukan: **${formatIdr(fee)}** (belum termasuk biaya layanan platform ${formatIdr(inv.serviceFee)} yang ditanggung Pihak Pertama).
2. Termin: DP **${b.dp_pct}% = ${formatIdr(inv.dp)}** paling lambat 3×24 jam setelah kontrak ditandatangani; pelunasan **${formatIdr(inv.settlement)}** paling lambat H-${b.settlement_days_before}.
3. Seluruh pembayaran dilakukan ke rekening bersama (escrow) mitra berizin yang ditunjuk RAVE atas nama booking ini. Dana dicairkan H+1 setelah status SELESAI bila tidak ada sengketa.
4. Pajak: pemotongan PPh atas fee mengikuti status perpajakan penerima; bukti potong tersedia di aplikasi. Bea meterai elektronik dibebankan sesuai ketentuan.
5. Transport & akomodasi: ${r.hospitality?.transport ? `ditanggung Pihak Pertama (${r.hospitality.transport})` : 'sesuai rate card yang disepakati'}; konsumsi ${r.hospitality?.meals ?? '-'} porsi; kamar hotel ${r.hospitality?.hotel_rooms ?? '-'}.

## 4. Technical & Hospitality Rider (lampiran tak terpisahkan)
\`\`\`json
${JSON.stringify(r, null, 2)}
\`\`\`
${riderNotes ? `Catatan rider hasil negosiasi: ${riderNotes}\n` : ''}
## 5. Dokumentasi, Siaran & Promosi
Pihak Pertama boleh mendokumentasikan pertunjukan untuk keperluan non-komersial dan promosi acara. Siaran langsung, rekaman audio/video untuk dijual, atau penggunaan di luar promosi acara memerlukan persetujuan tertulis Pihak Kedua. Nama & foto Artis boleh dipakai untuk promosi acara ini saja.

## 6. Radius & Eksklusivitas
Pihak Kedua tidak tampil di acara publik berbayar lain dalam radius 30 km dari venue selama 14 hari sebelum tanggal acara, kecuali disetujui Pihak Pertama.

## 7. Pembatalan, Reschedule & Force Majeure
| Pihak & waktu pembatalan | Dana DP | Dana pelunasan |
|---|---|---|
| Promotor, > 30 hari sebelum acara | Hangus 50% ke Artis; sisanya refund | Refund 100% |
| Promotor, 14–30 hari | Hangus 100% ke Artis | Refund 50% |
| Promotor, < 14 hari | Hangus 100% ke Artis | Hangus 100% ke Artis |
| Artis/Manajemen, kapan pun | Refund 100% ke Promotor | Refund 100% + kompensasi 25% fee + penalti reputasi |
| Force majeure (terbukti dokumen) | Ditahan untuk reschedule ≤ 90 hari atau refund dikurangi biaya riil | Idem |
| Izin acara tidak keluar | Diperlakukan sebagai pembatalan Promotor | |

Komisi platform dan biaya pembayaran yang telah terjadi tidak direfund kecuali pembatalan disebabkan kesalahan sistem RAVE.

## 8. Keamanan, Keselamatan & Perizinan
Pihak Pertama bertanggung jawab atas perizinan keramaian, keamanan, dan keselamatan acara, serta mengunggah bukti izin ke RAVE sebelum hari-H. Asuransi acara bersifat opsional.

## 9. Penyelesaian Sengketa
Musyawarah → mediasi RAVE (keputusan maks. 14 hari kerja; sengketa diajukan ≤ 24 jam setelah acara, dana dibekukan) → arbitrase/pengadilan negeri domisili Pihak Pertama.

## 10. Penutup
Perjanjian ini ditandatangani secara elektronik melalui PSrE tersertifikasi dan tidak dapat diubah setelah ditandatangani; perubahan dilakukan melalui adendum yang juga ditandatangani para pihak.
`;
  return { body, sha256: createHash('sha256').update(body).digest('hex') };
}
