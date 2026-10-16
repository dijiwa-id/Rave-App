import { BadgeCheck, FileSignature, Gauge, MessagesSquare, QrCode, Radio, Search, ShieldCheck } from 'lucide-react';
import { Cards, Checklist, CompanyPage, Cta, CtaBand, Heading, PageHero, pct, Section, Stats, Steps, useParam } from './shell';

const FEATURES = [
  { icon: Gauge, title: 'Audience Match', body: 'Skor kecocokan artis dengan kota dan acaramu, dihitung dari pendengar nyata — bukan sekadar jumlah followers.' },
  { icon: Search, title: 'Pencarian terarah', body: 'Saring artis berdasarkan genre, kota, kisaran fee, dan ketersediaan tanggal dalam satu layar.' },
  { icon: MessagesSquare, title: 'Negosiasi terstruktur', body: 'Tawaran, counter-offer, dan rider tersimpan dalam satu utas — tidak ada lagi detail yang tercecer di chat.' },
  { icon: FileSignature, title: 'Kontrak elektronik', body: 'Kontrak baku yang adil untuk kedua pihak, ditandatangani digital dan tersimpan permanen.' },
  { icon: ShieldCheck, title: 'Rekening bersama', body: 'DP dan pelunasan ditahan aman sampai show selesai. Jika artis batal, dana kembali sesuai kontrak.' },
  { icon: BadgeCheck, title: 'Rating dua arah', body: 'Lihat rekam jejak artis dari promotor lain, dan bangun reputasimu sendiri untuk booking berikutnya.' },
  { icon: QrCode, title: 'Tiket & check-in', body: 'Jual tiket dengan QR yang berputar agar tidak bisa disalin, lalu check-in cepat di pintu masuk.' },
  { icon: Radio, title: 'Siaran bertiket', body: 'Perluas penonton dengan live streaming yang hanya bisa ditonton pemegang tiket.' },
];

export default function ForPromoters() {
  const fee = useParam('commission.promotor_service_fee_pct');
  const dp = useParam('booking.default_dp_pct');
  const settleDays = useParam('booking.settlement_days_before');
  const disputeHours = useParam('booking.dispute_window_hours');
  return (
    <CompanyPage title="Untuk Promotor">
      <PageHero
        kicker="Untuk promotor, EO & venue"
        title="Booking artis yang tepat, dengan aman."
        lead="Promotor Hub membantu promotor kampus, EO, venue, dan penyelenggara acara privat menemukan artis yang benar-benar didengar di kotanya — lalu mengurus kontrak, pembayaran, dan tiket dalam satu tempat."
        actions={
          <>
            <Cta to="/promotor">Buka Promotor Hub</Cta>
            <Cta to="/login?signup=1" variant="ghost">
              Daftar gratis
            </Cta>
          </>
        }
      />

      <Section className="border-t border-white/10">
        <Heading kicker="Fitur" title="Dari mencari artis sampai pintu masuk venue." />
        <Cards items={FEATURES} cols={4} />
      </Section>

      <Section>
        <Heading kicker="Alur dana" title="Uangmu tidak pernah hilang begitu saja." body="Pembayaran tidak masuk ke rekening operasional GEMA maupun langsung ke artis, melainkan ditahan di rekening bersama hingga kewajiban kedua pihak terpenuhi." />
        <Steps
          items={[
            { title: 'Kontrak diteken', body: 'Invoice DP terbit otomatis setelah kedua pihak menandatangani.' },
            { title: `Bayar DP ${pct(dp)}`, body: 'Dana ditahan di rekening bersama; tanggal artis terkunci untukmu.' },
            { title: `Pelunasan H-${settleDays}`, body: 'Status booking menjadi aman. Artis dan tim bersiap tampil.' },
            { title: 'Show selesai', body: `Ada jendela ${disputeHours} jam untuk melaporkan masalah sebelum dana diteruskan.` },
            { title: 'Dana diteruskan', body: 'Fee cair ke artis dan tim. Jika ada sengketa, dana dibekukan sampai mediasi selesai.' },
          ]}
        />
      </Section>

      <Section>
        <Heading kicker="Biaya" title="Transparan, tanpa biaya langganan." body="Membuat akun, mencari artis, dan mengirim inquiry gratis. Service fee hanya ditagihkan saat booking benar-benar terjadi." />
        <Stats
          items={[
            { value: 'Rp 0', label: 'Akun, pencarian artis, dan inquiry' },
            { value: pct(fee), label: 'Service fee di atas fee artis, tertera di invoice' },
            { value: pct(dp), label: 'DP default saat kontrak ditandatangani' },
            { value: `H-${settleDays}`, label: 'Batas pelunasan sebelum hari acara' },
          ]}
          note="Besaran dapat berubah dan selalu ditampilkan sebelum kamu membayar. Untuk penjualan tiket, biaya layanan ditampilkan di halaman checkout."
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker="Cocok untuk" title="Dibangun untuk sirkuit musik Indonesia." />
        <Checklist
          items={[
            { title: 'Promotor kampus & BEM', body: 'Pensi dan festival kampus dengan anggaran jelas, proses persetujuan rapi, dan bukti pembayaran resmi.' },
            { title: 'EO & festival', body: 'Kelola banyak artis, tanggal, dan tim dalam satu organisasi dengan peran anggota yang terpisah.' },
            { title: 'Venue & kafe musik', body: 'Isi jadwal mingguan dengan artis yang punya pendengar di kotamu.' },
            { title: 'Corporate & wedding', body: 'Acara privat dengan kontrak, invoice berbadan usaha, dan jaminan dana yang dapat dipertanggungjawabkan.' },
          ]}
        />
      </Section>

      <CtaBand title="Booking berikutnya, tanpa drama." body="Verifikasi organisasimu sekali, lalu mulai kirim inquiry ke artis pilihan.">
        <Cta to="/promotor" variant="light">
          Mulai di Promotor Hub
        </Cta>
        <Cta to="/untuk-artis" variant="ghost">
          Lihat sisi artis
        </Cta>
      </CtaBand>
    </CompanyPage>
  );
}
