import { BarChart3, Code2, Handshake, Palette, Scale } from 'lucide-react';
import { Checklist, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, Steps, useContact } from './shell';

const TEAMS = [
  {
    icon: Code2,
    name: 'Engineering & Data',
    body: 'Membangun layanan streaming, pembayaran, dan booking yang andal pada skala nasional.',
    roles: ['Backend (TypeScript, PostgreSQL)', 'Frontend & mobile', 'Media & streaming (HLS, ffmpeg)', 'SRE & keamanan', 'Data & analitik', 'Quality assurance'],
  },
  {
    icon: Palette,
    name: 'Produk & Desain',
    body: 'Merancang pengalaman yang sederhana untuk fan, dan alat kerja yang tangguh untuk artis serta promotor.',
    roles: ['Product manager', 'UI/UX designer', 'UX researcher'],
  },
  {
    icon: Handshake,
    name: 'Artis & Komunitas',
    body: 'Merangkul musisi, label indie, promotor kampus, dan venue di setiap kota peluncuran.',
    roles: ['Artist relations & A&R', 'Partnership', 'Editorial & konten', 'Community & ambassador kampus'],
  },
  {
    icon: Scale,
    name: 'Legal & Keuangan',
    body: 'Menjaga kepatuhan, kontrak, perpajakan, dan rekonsiliasi dana yang dipercayakan kepada kami.',
    roles: ['Legal & compliance', 'Finance & tax', 'Risk & fraud operations'],
  },
];

const VALUES = [
  { title: 'Mulai dari musisi', body: 'Setiap keputusan produk diuji dengan satu pertanyaan: apakah ini membuat musisi lebih mudah hidup dari karyanya?' },
  { title: 'Uang adalah kode', body: 'Kami memperlakukan dana pengguna dengan ketelitian tertinggi — ledger double-entry, rekonsiliasi, dan audit trail.' },
  { title: 'Bergerak cepat, terukur', body: 'Sprint dua mingguan dan OKR per kuartal. Setiap fase punya kriteria keberhasilan yang jelas sebelum lanjut.' },
  { title: 'Terbuka & tertulis', body: 'Keputusan penting didokumentasikan agar semua orang bisa memahami alasan di baliknya dan ikut menantangnya.' },
  { title: 'Privasi bukan fitur tambahan', body: 'Kami membangun sesuai UU PDP sejak baris kode pertama, bukan sebagai tambalan belakangan.' },
  { title: 'Cinta pada skena', body: 'Kami datang ke gig, mendengar rilis baru, dan mengenal komunitas yang kami layani.' },
];

export default function Careers() {
  const { email } = useContact('Karier');
  return (
    <CompanyPage title="Karier">
      <PageHero
        kicker="Karier di GEMA"
        title="Bantu musisi Indonesia hidup dari panggungnya."
        lead="Kami tim kecil yang membangun infrastruktur untuk ekosistem musik live — dari streaming dan data pendengar hingga kontrak, rekening bersama, dan tiket. Jika kamu ingin pekerjaanmu terasa sampai ke panggung, mari bicara."
        actions={
          <>
            <ContactCta subject="Karier">Kirim lamaran</ContactCta>
            <a href="#tim" className="inline-flex items-center rounded-full border border-white/25 px-7 py-3.5 text-sm font-bold hover:border-white">
              Lihat bidang
            </a>
          </>
        }
      />

      <Section id="tim" className="border-t border-white/10">
        <Heading kicker="Bidang" title="Tempat kamu bisa berkontribusi." body="Kami merekrut bertahap mengikuti roadmap produk. Belum melihat peran yang pas? Lamaran terbuka selalu kami baca." />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {TEAMS.map(({ icon: Icon, name, body, roles }) => (
            <article key={name} className="rounded-2xl border border-white/10 bg-white/[0.03] p-7">
              <div className="flex items-center gap-4">
                <span className="grid size-11 place-items-center rounded-xl bg-gema-primary/15 text-gema-primary-text">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="text-xl font-bold">{name}</h3>
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-white/60">{body}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {roles.map((r) => (
                  <li key={r} className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/75">
                    {r}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <Heading kicker="Cara kami bekerja" title="Nilai yang kami pegang." />
        <Checklist items={VALUES} />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker="Proses rekrutmen" title="Jelas, cepat, dan saling menghormati waktu." />
        <Steps
          items={[
            { title: 'Kirim lamaran', body: `Email CV atau portofolio ke ${email} dengan subjek "[Karier] Bidang — Nama".` },
            { title: 'Ngobrol santai', body: 'Panggilan 30 menit untuk saling mengenal: pengalamanmu, minatmu, dan apa yang sedang kami bangun.' },
            { title: 'Studi kasus', body: 'Satu tugas atau sesi diskusi yang relevan dengan pekerjaan nyata — bukan teka-teki trik.' },
            { title: 'Keputusan', body: 'Kami memberi kabar dalam waktu wajar, apa pun hasilnya, beserta masukan yang jujur.' },
          ]}
        />
      </Section>

      <Section>
        <div className="grid gap-8 rounded-2xl border border-white/10 p-8 md:grid-cols-[auto_1fr] md:items-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-white/5">
            <BarChart3 className="size-6 text-gema-primary-text" aria-hidden />
          </span>
          <p className="text-[15px] leading-relaxed text-white/65">
            GEMA berkomitmen pada kesempatan kerja yang setara. Kami menilai kandidat berdasarkan kemampuan dan potensi, tanpa membedakan suku, agama, gender, disabilitas, maupun latar belakang pendidikan.
          </p>
        </div>
      </Section>

      <CtaBand title="Tidak ada peran yang pas?" body="Ceritakan apa yang ingin kamu bangun untuk musik Indonesia. Kami simpan lamaran terbuka untuk kebutuhan berikutnya.">
        <ContactCta subject="Karier" variant="light">
          Kirim lamaran terbuka
        </ContactCta>
      </CtaBand>
    </CompanyPage>
  );
}
