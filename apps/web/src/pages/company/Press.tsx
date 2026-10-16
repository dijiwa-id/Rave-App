import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { toast } from '@/components/ui';
import { DEFAULT_BRAND } from '@/lib/platform';
import { CompanyPage, ContactCta, Heading, PageHero, Section, useContact } from './shell';

const BOILERPLATE =
  'GEMA adalah platform ekosistem musik indie dan off-air asal Indonesia. GEMA menghubungkan streaming musik gratis dengan panggung nyata: data pendengar per kota membantu promotor menemukan artis yang tepat, lalu booking diproses dengan kontrak elektronik, rekening bersama, dan pembagian fee otomatis. Selain aplikasi dengar, GEMA menyediakan Artist Studio untuk musisi dan manajemen, Promotor Hub untuk promotor dan EO, serta tiket dan siaran langsung untuk fan.';

const FACTS: [string, string][] = [
  ['Kategori', 'Platform musik indie & off-air (streaming, booking, tiket, live)'],
  ['Tagline', 'Dengar gratis. Datang ke panggungnya. Dukung langsung.'],
  ['Produk', 'Aplikasi GEMA · Artist Studio · Promotor Hub · GEMA Live'],
  ['Kota peluncuran', 'Jakarta, Bandung, Yogyakarta, Surabaya, Malang & Bali'],
  ['Penulisan nama', 'GEMA (huruf kapital) dalam teks; logo resmi untuk visual'],
];

const COLORS: [string, string][] = [
  ['Ungu GEMA', '#662D91'],
  ['Magenta GEMA', '#DA1C5C'],
  ['Oranye GEMA', '#F6851F'],
  ['Hitam', '#000000'],
];

const ASSETS = [
  { name: 'Logo — latar terang', file: 'gema-logo.svg', src: DEFAULT_BRAND.logo, bg: 'bg-white' },
  { name: 'Logo — latar gelap', file: 'gema-logo-dark.svg', src: DEFAULT_BRAND.logoDark, bg: 'bg-[#121212]' },
  { name: 'Ikon', file: 'gema-icon.svg', src: DEFAULT_BRAND.icon, bg: 'bg-[#1e1e1e]' },
];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: (id: string, text: string) =>
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(id);
          setTimeout(() => setCopied(null), 1600);
        })
        .catch(() => toast.error('Gagal menyalin — salin manual dari halaman ini.')),
  };
}

export default function Press() {
  const { email } = useContact('Media');
  const { copied, copy } = useCopy();
  return (
    <CompanyPage title="Untuk Media">
      <PageHero
        kicker="Ruang media"
        title="Semua yang kamu perlukan untuk menulis tentang GEMA."
        lead="Profil singkat, fakta, dan aset merek resmi. Untuk wawancara, data, atau konfirmasi, hubungi tim komunikasi kami."
        actions={<ContactCta subject="Media">Hubungi tim media</ContactCta>}
      />

      <Section className="border-t border-white/10">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <Heading kicker="Profil singkat" title="Tentang GEMA" />
            <blockquote className="mt-8 border-l-2 border-gema-primary pl-6 text-lg leading-relaxed text-white/80">{BOILERPLATE}</blockquote>
            <button
              onClick={() => copy('boiler', BOILERPLATE)}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-bold hover:border-white"
            >
              {copied === 'boiler' ? <Check className="size-4 text-gema-primary-text" /> : <Copy className="size-4" />}
              {copied === 'boiler' ? 'Tersalin' : 'Salin profil'}
            </button>
          </div>
          <div>
            <Heading kicker="Fakta" title="Sekilas" />
            <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">
              {FACTS.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-4 py-4 text-[15px]">
                  <dt className="text-white/45">{k}</dt>
                  <dd className="text-white/85">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section>
        <Heading kicker="Aset merek" title="Logo resmi" body="Format SVG, siap untuk cetak dan layar. Gunakan versi yang sesuai dengan warna latar." />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {ASSETS.map((a) => (
            <figure key={a.file} className="overflow-hidden rounded-2xl border border-white/10">
              <div className={`grid h-44 place-items-center p-8 ${a.bg}`}>
                <img src={a.src} alt={a.name} className="max-h-16 max-w-[80%]" />
              </div>
              <figcaption className="flex items-center justify-between gap-3 px-5 py-4">
                <span className="text-sm font-bold">{a.name}</span>
                <a href={a.src} download={a.file} className="inline-flex items-center gap-1.5 text-sm font-bold text-gema-primary-text hover:underline">
                  <Download className="size-4" aria-hidden /> SVG
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Heading kicker="Warna" title="Palet merek" />
            <ul className="mt-8 grid grid-cols-2 gap-3">
              {COLORS.map(([name, hex]) => (
                <li key={hex}>
                  <button onClick={() => copy(hex, hex)} className="w-full overflow-hidden rounded-xl border border-white/10 text-left hover:border-white/30" aria-label={`Salin ${name} ${hex}`}>
                    <span className="block h-16 border-b border-white/10" style={{ background: hex }} />
                    <span className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-bold">{name}</span>
                      <span className="font-mono text-xs text-white/55">{copied === hex ? 'Tersalin' : hex}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 h-3 rounded-full bg-gradient-to-r from-[#662D91] via-[#DA1C5C] to-[#F6851F]" aria-label="Gradien logo GEMA" />
          </div>
          <div>
            <Heading kicker="Panduan" title="Pemakaian logo" />
            <ul className="mt-8 space-y-4 text-[15px] leading-relaxed text-white/70">
              {[
                'Beri ruang kosong di sekeliling logo minimal setinggi huruf “G” pada ikon.',
                'Gunakan logo latar gelap di atas warna gelap, dan logo latar terang di atas warna terang.',
                'Jangan mengubah gradien, memutar, meregangkan, menambah efek, atau mengganti huruf pada logo.',
                'Ikon bulat boleh dipakai sendiri untuk avatar dan ruang sempit; untuk konteks lain, gunakan logo lengkap.',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gema-primary" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section className="border-t border-white/10">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-black tracking-tight">Kontak media</h2>
            <p className="mt-2 text-white/60">
              Email <span className="font-bold text-white">{email}</span> dengan subjek “[Media]”. Kami berusaha membalas dalam satu hari kerja.
            </p>
          </div>
          <ContactCta subject="Media" variant="light">
            Kirim email
          </ContactCta>
        </div>
      </Section>
    </CompanyPage>
  );
}
