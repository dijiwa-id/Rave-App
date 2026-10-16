import { Database, Lock, Workflow } from 'lucide-react';
import { Cards, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, Stats } from './shell';

// Hanya informasi yang aman untuk publik. Detail pendanaan, proyeksi, dan penggunaan dana
// dibagikan lewat materi investor setelah NDA — bukan di halaman ini.

const STREAMS: [string, string][] = [
  ['Komisi booking off-air', 'Service fee promotor dan komisi dari fee artis atas setiap show yang settled.'],
  ['Ticketing', 'Biaya layanan per tiket untuk event yang dijual lewat GEMA.'],
  ['GEMA Pro', 'Langganan B2B untuk manajemen, label, dan promotor dengan komisi lebih rendah dan alat kerja lanjutan.'],
  ['Brand partnership', 'Paket kampanye, aktivasi event, dan tur kampus bersama artis.'],
  ['Premium', 'Langganan pendengar untuk podcast & audio fiksi eksklusif, bebas iklan, dan akses tiket lebih awal.'],
  ['Iklan', 'Iklan audio dan display untuk tier Gratis, dengan penargetan berbasis persetujuan.'],
];

const PHASES = [
  { phase: 'Fase 0', title: 'Fondasi & landing', body: 'Validasi, merek, waitlist, legal, dan pemilihan vendor.' },
  { phase: 'Fase 1', title: 'Streaming & Booking Lite', body: 'Aplikasi dengar, Artist Studio, EPK, kalender, dan inquiry.' },
  { phase: 'Fase 2', title: 'Trust layer & ticketing', body: 'Rekening bersama, kontrak elektronik, KYC, sengketa, tiket, dan GEMA Pro.' },
  { phase: 'Fase 3', title: 'Premium & commerce', body: 'Podcast, audio fiksi, merchandise, iklan, dan rekomendasi.' },
  { phase: 'Fase 4', title: 'Skala & ekosistem', body: 'Portal label, distribusi katalog, data insight, dan ekspansi regional.' },
];

export default function Investors() {
  return (
    <CompanyPage title="Investor">
      <PageHero
        kicker="Hubungan investor"
        title="Infrastruktur untuk ekonomi musik live Indonesia."
        lead="Musik gratis menarik pendengar; panggung dan commerce membayar. GEMA menyatukan streaming, data audiens per kota, booking, rekening bersama, dan tiket dalam satu lingkaran yang memperkuat dirinya sendiri."
        actions={<ContactCta subject="Investor">Minta materi investor</ContactCta>}
      />

      <Section className="border-t border-white/10">
        <Heading kicker="Mengapa sekarang" title="Indonesia sudah online, sudah mendengar, dan rela antre demi panggung." />
        <Stats
          items={[
            { value: '215,6 jt', label: 'Pengguna internet Indonesia, penetrasi 78,19% (APJII, 2023)' },
            { value: '38%', label: 'Mendengar musik on-demand tiap minggu, vs rata-rata Asia Tenggara 28% (PwC, 2023)' },
            { value: '1,7 jt', label: 'Orang berebut tiket satu konser stadion di Jakarta (November 2023)' },
            { value: '5 kota', label: 'Pasar peluncuran: Jakarta, Bandung, Yogyakarta, Surabaya, Malang & Bali' },
          ]}
          note="Sumber: APJII Survei Penetrasi Internet 2023; PwC Indonesia TMT Update 2023; pemberitaan media atas penjualan tiket konser November 2023."
        />
      </Section>

      <Section>
        <Heading kicker="Keunggulan" title="Pemain lain memegang satu potong. GEMA memegang lingkarannya." body="Platform streaming global tidak mengurus booking; agensi dan platform tiket tidak punya data pendengar. Kami menggabungkan keduanya." />
        <Cards
          cols={3}
          items={[
            { icon: Database, title: 'Data loop', body: 'Setiap stream memperkaya EPK dan Audience Match; setiap event mendorong pendengar kembali ke streaming.' },
            { icon: Lock, title: 'Trust layer', body: 'Rekening bersama, kontrak elektronik, rating dua arah, dan KYC — sulit ditiru platform streaming maupun agensi.' },
            { icon: Workflow, title: 'Workflow lock-in', body: 'Manajemen menjalankan operasional harian di GEMA: kalender, kontrak, invoice, dan pembagian fee.' },
          ]}
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker="Model bisnis" title="Musik gratis. Panggung yang membayar." body="Pendapatan off-air dan commerce menyubsidi biaya streaming gratis, dengan royalti user-centric bagi pemegang hak." />
        <dl className="mt-12 divide-y divide-white/10 border-y border-white/10">
          {STREAMS.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-5 md:grid-cols-[16rem_1fr] md:gap-8">
              <dt className="font-bold">{k}</dt>
              <dd className="text-[15px] text-white/60">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-white/45">
          North star metric: jumlah show off-air yang settled melalui GEMA.
        </p>
      </Section>

      <Section>
        <Heading kicker="Roadmap" title="Lima fase, masing-masing dengan kriteria keberhasilan." body="Fase berikutnya dibuka penuh hanya setelah kriteria fase sebelumnya terpenuhi." />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-5">
          {PHASES.map((p) => (
            <li key={p.phase} className="bg-black p-6">
              <span className="text-xs font-black tracking-[0.14em] text-gema-primary-text uppercase">{p.phase}</span>
              <h3 className="mt-3 font-bold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{p.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CtaBand title="Tertarik berdiskusi?" body="Materi lengkap — deck, model keuangan, dan data validasi — kami bagikan kepada investor dan mitra strategis setelah perjanjian kerahasiaan.">
        <ContactCta subject="Investor" variant="light">
          Hubungi kami
        </ContactCta>
      </CtaBand>

      <p className="mx-auto max-w-6xl px-4 pb-16 text-xs leading-relaxed text-white/35">
        Halaman ini hanya bersifat informasi dan bukan merupakan penawaran atau ajakan untuk membeli efek. Pernyataan mengenai rencana dan target bersifat indikatif dan dapat berubah.
      </p>
    </CompanyPage>
  );
}
