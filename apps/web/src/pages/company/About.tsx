import { CalendarCheck, Headphones, HeartHandshake, Mic2, Radio, ShieldCheck, Ticket, Users } from 'lucide-react';
import { Cards, Checklist, CompanyPage, Cta, CtaBand, Heading, PageHero, Section, Steps } from './shell';

const AUDIENCES = [
  { icon: Mic2, title: 'Musisi indie', body: 'Royalti streaming kecil dan data pendengar sulit diubah menjadi tawaran manggung. Pembayaran sering telat — atau tidak datang sama sekali.' },
  { icon: Users, title: 'Manajemen', body: 'Jadwal tersebar di chat dan spreadsheet, rawan bentrok. Kontrak dan pembagian fee masih dihitung manual.' },
  { icon: CalendarCheck, title: 'Promotor & EO', body: 'Sulit menemukan artis yang sesuai budget dan audiens kota. Saat artis batal, DP ikut hilang tanpa jaminan.' },
  { icon: Headphones, title: 'Fan', body: 'Info manggung tercecer, tiket presale direbut calo dan bot, dan cara mendukung artis favorit terbatas.' },
];

const PRODUCTS = [
  { icon: Headphones, title: 'Aplikasi GEMA', body: 'Streaming musik gratis dengan kualitas lossless, lirik sinkron, playlist, podcast, dan audio fiksi — di web dan ponsel.', meta: 'Untuk pendengar' },
  { icon: Mic2, title: 'Artist Studio', body: 'Rilis karya, atur split hak, pantau pendengar per kota, kelola EPK, rate card, kalender, kontrak, dan pencairan dana.', meta: 'Untuk artis & manajemen' },
  { icon: CalendarCheck, title: 'Promotor Hub', body: 'Temukan artis lewat Audience Match, negosiasi terstruktur, kontrak elektronik, rekening bersama, tiket QR, dan check-in.', meta: 'Untuk promotor & EO' },
  { icon: Radio, title: 'GEMA Live', body: 'Siarkan konser dan sesi langsung dari OBS atau browser, dengan chat dan akses berbasis tiket.', meta: 'Untuk artis & promotor' },
];

const PRINCIPLES = [
  { title: 'Musik selalu gratis', body: 'Mendengar tidak pernah dibatasi paywall. GEMA dibayar ketika panggung terjadi, bukan dari menutup akses ke karya.' },
  { title: 'Adil untuk kreator', body: 'Royalti dibagi dengan model user-centric: dukunganmu mengalir ke artis yang benar-benar kamu dengarkan.' },
  { title: 'Uang aman sebelum panggung', body: 'Dana booking ditahan di rekening bersama dan baru cair setelah show selesai, terbagi otomatis ke seluruh tim.' },
  { title: 'Privat sejak dirancang', body: 'Data pribadi diproses sesuai UU PDP: berbasis persetujuan, dienkripsi, dan bisa kamu minta untuk dihapus.' },
  { title: 'Kepercayaan dua arah', body: 'Verifikasi identitas, kontrak elektronik, rating dua arah, dan mediasi sengketa melindungi artis maupun promotor.' },
  { title: 'Bangga buatan Indonesia', body: 'Dibangun untuk ekosistem musik Indonesia — dari gig kampus dan pensi hingga festival di kota-kota besar.' },
];

export default function About() {
  return (
    <CompanyPage title="Tentang">
      <PageHero
        kicker="Tentang GEMA"
        title={
          <>
            Dengar gratis. Datang ke panggungnya. <span className="text-gema-primary-text">Dukung langsung.</span>
          </>
        }
        lead="GEMA adalah platform ekosistem musik indie dan off-air. Kami menghubungkan pemutaran lagu dengan panggung nyata — agar setiap pendengar baru bisa menjadi penonton, dan setiap penonton menjadi penghasilan yang adil bagi musisi."
        actions={
          <>
            <Cta to="/app">Dengarkan sekarang</Cta>
            <Cta to="/karier" variant="ghost">
              Bergabung dengan tim
            </Cta>
          </>
        }
      />

      <Section className="border-t border-white/10">
        <Heading kicker="Mengapa GEMA ada" title="Uang musisi indie ada di panggung. Prosesnya masih lewat DM." body="Setiap pihak di ekosistem musik live memegang satu potong masalah yang sama: kurangnya data, kepercayaan, dan alat kerja." />
        <Cards items={AUDIENCES} cols={4} />
      </Section>

      <Section>
        <Heading kicker="Cara kerja" title="Dari pemutaran pertama ke panggung." />
        <Steps
          items={[
            { title: 'Dengar', body: 'Fan streaming gratis. Setiap putaran yang memenuhi syarat menjadi sinyal permintaan pasar per kota.' },
            { title: 'Booking', body: 'Promotor menemukan artis yang tepat lewat Audience Match, bernegosiasi, lalu menandatangani kontrak elektronik.' },
            { title: 'Panggung', body: 'Fan mendapat tiket, artis tampil, dan dana cair setelah show — langsung terbagi ke seluruh tim.' },
          ]}
        />
      </Section>

      <Section>
        <Heading kicker="Satu ekosistem" title="Empat produk, satu lingkaran." body="Setiap stream memperkaya profil artis; setiap event mendorong pendengar kembali ke musiknya." />
        <Cards items={PRODUCTS} cols={4} />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker="Prinsip kami" title="Yang tidak akan kami tawar." />
        <Checklist items={PRINCIPLES} />
      </Section>

      <Section>
        <Heading kicker="Ruang lingkup" title="Dimulai dari lima kota." body="Peluncuran bertahap di Jakarta, Bandung, Yogyakarta, Surabaya, serta Malang dan Bali — kota dengan komunitas musik indie dan sirkuit gig kampus yang paling hidup." />
        <Cards
          cols={3}
          items={[
            { icon: Ticket, title: 'Gig kampus & pensi', body: 'Promotor kampus dan BEM mendapat alat booking yang aman tanpa harus menjadi agensi.' },
            { icon: HeartHandshake, title: 'Komunitas & venue', body: 'Venue dan kolektif lokal menemukan artis yang punya pendengar nyata di kotanya.' },
            { icon: ShieldCheck, title: 'Corporate & wedding', body: 'Acara privat mendapat kontrak, invoice, dan jaminan dana yang jelas.' },
          ]}
        />
      </Section>

      <CtaBand title="Mari bangun panggung musik Indonesia bersama." body="Artis, promotor, mitra, dan pendengar — ada tempat untuk semua orang di GEMA.">
        <Cta to="/untuk-artis" variant="light">
          Untuk artis
        </Cta>
        <Cta to="/untuk-promotor" variant="ghost">
          Untuk promotor
        </Cta>
        <Cta to="/media" variant="ghost">
          Untuk media
        </Cta>
      </CtaBand>
    </CompanyPage>
  );
}
