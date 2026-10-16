import { BarChart3, CalendarRange, FileSignature, FileText, Layers, Radio, Upload, Wallet } from 'lucide-react';
import { Cards, Checklist, CompanyPage, Cta, CtaBand, Heading, PageHero, pct, Section, Stats, Steps, useParam } from './shell';

const FEATURES = [
  { icon: Upload, title: 'Rilis & split hak', body: 'Unggah master, atur metadata, dan bagi hak cipta ke kolaborator. Setiap kolaborator menyetujui bagiannya sendiri.' },
  { icon: BarChart3, title: 'Analitik per kota', body: 'Lihat di kota mana pendengarmu tumbuh — data yang langsung bisa kamu bawa ke meja negosiasi.' },
  { icon: FileText, title: 'EPK dinamis', body: 'Electronic press kit yang selalu mutakhir dari data streaming, siap dibagikan ke promotor lewat satu tautan.' },
  { icon: Layers, title: 'Rate card', body: 'Tentukan kisaran fee per jenis acara dan kota, agar inquiry yang masuk sudah sesuai harapanmu.' },
  { icon: CalendarRange, title: 'Kalender anti-bentrok', body: 'Satu kalender untuk artis dan manajemen. Tanggal yang sudah ter-booking otomatis terkunci.' },
  { icon: FileSignature, title: 'Kontrak elektronik', body: 'Negosiasi terstruktur hingga kontrak digital — klausul pembatalan dan pembayaran tertulis jelas sejak awal.' },
  { icon: Wallet, title: 'Dana aman & split otomatis', body: 'Fee ditahan di rekening bersama sebelum show, lalu cair dan terbagi otomatis ke seluruh tim setelah acara.' },
  { icon: Radio, title: 'Live streaming', body: 'Siarkan konser atau sesi akustik dari OBS atau langsung dari browser, gratis maupun bertiket.' },
];

export default function ForArtists() {
  const commission = useParam('commission.artist_commission_pct');
  const dp = useParam('booking.default_dp_pct');
  const disputeHours = useParam('booking.dispute_window_hours');
  return (
    <CompanyPage title="Untuk Artis">
      <PageHero
        kicker="Untuk artis & manajemen"
        title="Dari playlist ke panggung, dalam satu dasbor."
        lead="Artist Studio membantu musisi indie dan manajemen mengubah pendengar menjadi tawaran manggung — lengkap dengan EPK, kalender, kontrak, dan pencairan dana yang aman."
        actions={
          <>
            <Cta to="/studio">Buka Artist Studio</Cta>
            <Cta to="/login?signup=1" variant="ghost">
              Daftar gratis
            </Cta>
          </>
        }
      />

      <Section className="border-t border-white/10">
        <Heading kicker="Fitur" title="Semua yang dibutuhkan kariermu." body="Tidak perlu lagi spreadsheet jadwal, DM negosiasi, dan transfer manual yang ditunggu berminggu-minggu." />
        <Cards items={FEATURES} cols={4} />
      </Section>

      <Section>
        <Heading kicker="Alur booking" title="Dari inquiry sampai dana cair." />
        <Steps
          items={[
            { title: 'Inquiry masuk', body: 'Promotor menemukanmu lewat Audience Match dan mengirim tawaran berisi tanggal, kota, dan budget.' },
            { title: 'Negosiasi', body: 'Terima, ajukan counter-offer, atau tolak — semua tercatat dalam satu utas yang rapi.' },
            { title: 'Kontrak & DP', body: `Kontrak elektronik ditandatangani kedua pihak, lalu promotor membayar DP ${pct(dp)} ke rekening bersama.` },
            { title: 'Tampil', body: 'Pelunasan diterima sebelum hari H. Kamu fokus ke panggung, bukan ke tagihan.' },
            { title: 'Dana cair', body: `Setelah jendela sengketa ${disputeHours} jam, fee cair dan terbagi otomatis ke tim sesuai split.` },
          ]}
        />
      </Section>

      <Section>
        <Heading kicker="Biaya" title="Gratis sampai kamu manggung." body="Mengunggah musik, membuat EPK, dan menerima inquiry tidak dipungut biaya. GEMA hanya mengambil komisi dari booking yang benar-benar terjadi." />
        <Stats
          items={[
            { value: 'Rp 0', label: 'Unggah rilis, EPK, rate card, dan kalender' },
            { value: pct(commission), label: 'Komisi dari fee artis, dipotong saat pencairan escrow' },
            { value: pct(dp), label: 'DP default yang dibayar promotor saat kontrak diteken' },
            { value: `${disputeHours} jam`, label: 'Jendela sengketa setelah acara sebelum dana cair' },
          ]}
          note="Besaran dapat berubah dan selalu ditampilkan sebelum kontrak ditandatangani. Pajak (PPh) dipotong sesuai ketentuan yang berlaku."
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker="Perlindungan" title="Kamu dilindungi di setiap tahap." />
        <Checklist
          items={[
            { title: 'Promotor terverifikasi', body: 'Promotor wajib verifikasi identitas atau badan usaha sebelum dapat membayar dan mengikat kontrak.' },
            { title: 'Klausul pembatalan yang adil', body: 'Kompensasi pembatalan dihitung otomatis berdasarkan jarak ke hari acara, sesuai yang tertulis di kontrak.' },
            { title: 'Rating dua arah', body: 'Setelah acara, artis dan promotor saling menilai. Reputasi baik membuka lebih banyak tawaran.' },
            { title: 'Mediasi sengketa', body: 'Jika terjadi masalah, dana dibekukan dan tim GEMA memediasi berdasarkan bukti dan isi kontrak.' },
          ]}
        />
      </Section>

      <CtaBand title="Siap membawa musikmu ke lebih banyak panggung?" body="Buat profil artis dalam beberapa menit. Manajemen dapat mengelola beberapa artis dari satu akun.">
        <Cta to="/studio" variant="light">
          Mulai di Artist Studio
        </Cta>
        <Cta to="/untuk-promotor" variant="ghost">
          Lihat sisi promotor
        </Cta>
      </CtaBand>
    </CompanyPage>
  );
}
