import { Mic, MonitorPlay, Music4, Sparkles, Ticket } from 'lucide-react';
import { AD_CATEGORIES, AD_FIXED_RULES } from '@gema/domain/ads';
import { Cards, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, Stats, Steps, useParam } from './shell';

const byTier = (tier: string) =>
  Object.values(AD_CATEGORIES)
    .filter((c) => c.tier === tier)
    .map((c) => c.label);

export default function Advertise() {
  const audioMax = useParam('ads.max_audio_seconds');
  const displayMax = useParam('ads.max_display_seconds');
  const skipAfter = useParam('ads.skip_after_seconds');
  const interval = useParam('ads.break_interval_minutes');
  const perHour = useParam('ads.max_ads_per_hour');
  const cap = useParam('ads.frequency_cap_per_day');
  const perBreak = useParam('ads.max_ads_per_break');

  return (
    <CompanyPage title="Iklan">
      <PageHero
        kicker="Beriklan di GEMA"
        title="Sampai ke telinga yang tepat, tanpa merusak musiknya."
        lead="Jangkau pendengar musik indie di kota-kota peluncuran GEMA lewat iklan audio, display, pre-roll podcast, dan kemitraan brand di panggung nyata — dengan kebijakan yang menjaga pengalaman dengar dan keamanan merekmu."
        actions={<ContactCta subject="Iklan">Hubungi tim iklan</ContactCta>}
      />

      <Section className="border-t border-white/10">
        <Heading kicker="Format" title="Pilih cara bercerita." />
        <Cards
          cols={4}
          items={[
            { icon: Mic, title: 'Audio', body: `Spot audio hingga ${audioMax} detik yang diputar di antara lagu, tidak pernah memotong lagu yang sedang didengar.` },
            { icon: MonitorPlay, title: 'Display', body: `Kartu visual di pemutar selama hingga ${displayMax} detik${skipAfter ? `, dapat dilewati setelah ${skipAfter} detik` : ''}, dengan tautan ke halamanmu.` },
            { icon: Music4, title: 'Pre-roll podcast', body: 'Pesan singkat sebelum episode podcast gratis. Episode Premium selalu bebas iklan.' },
            { icon: Ticket, title: 'Kemitraan panggung', body: 'Paket brand untuk event, tur kampus, dan siaran langsung — dari aktivasi venue sampai konten artis.' },
          ]}
        />
      </Section>

      <Section>
        <Heading kicker="Pengalaman dengar" title="Iklan yang dihargai, bukan dihindari." body="Batas tayang kami jaga ketat agar pendengar tetap betah — dan pesanmu benar-benar didengar." />
        <Stats
          items={[
            { value: `${interval} mnt`, label: 'Jeda minimum antar-jeda iklan untuk satu pendengar' },
            { value: `${perBreak}`, label: 'Iklan maksimum dalam satu jeda' },
            { value: `${perHour}/jam`, label: 'Batas total iklan per pendengar dalam satu jam' },
            { value: `${cap}×/hari`, label: 'Frequency cap satu kampanye ke pendengar yang sama' },
          ]}
          note="Parameter dapat disesuaikan oleh GEMA untuk menjaga kualitas pengalaman dengar."
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker="Kebijakan" title="Aturan yang tidak dapat ditawar." />
        <ul className="mt-12 grid gap-x-12 gap-y-5 md:grid-cols-2">
          {AD_FIXED_RULES.map((r) => (
            <li key={r} className="flex gap-4 text-[15px] leading-relaxed text-white/75">
              <span className="mt-2 size-2 shrink-0 rounded-full bg-gema-primary" aria-hidden /> {r}
            </li>
          ))}
        </ul>
        <div className="mt-14 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold">Kategori terbatas</h3>
            <p className="mt-1.5 text-sm text-white/55">Diterima dengan nomor izin yang sah dan peninjauan tambahan; sebagian dapat dinonaktifkan sesuai kebijakan platform.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {byTier('restricted').map((l) => (
                <li key={l} className="rounded-full border border-white/15 px-3 py-1 text-sm text-white/75">
                  {l}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 p-6">
            <h3 className="font-bold">Kategori terlarang</h3>
            <p className="mt-1.5 text-sm text-white/55">Selalu ditolak, tanpa pengecualian.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {byTier('prohibited').map((l) => (
                <li key={l} className="rounded-full border border-red-400/30 px-3 py-1 text-sm text-red-200/90">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section>
        <Heading kicker="Proses" title="Dari brief sampai tayang." />
        <Steps
          items={[
            { title: 'Brief', body: 'Ceritakan tujuan, kota, genre, periode, dan anggaran kampanyemu.' },
            { title: 'Kreatif', body: 'Kirim materi audio atau display sesuai spesifikasi; kami bantu menyesuaikan format.' },
            { title: 'Peninjauan', body: 'Setiap kampanye ditinjau tim GEMA — termasuk izin untuk kategori terbatas — sebelum tayang.' },
            { title: 'Tayang & laporan', body: 'Pantau impresi dan interaksi; kampanye berhenti otomatis di akhir periode.' },
          ]}
        />
      </Section>

      <CtaBand title="Mari rancang kampanye pertamamu." body="Tim kami menyiapkan rekomendasi format dan penempatan berdasarkan audiens yang ingin kamu jangkau.">
        <ContactCta subject="Iklan" variant="light">
          Minta penawaran
        </ContactCta>
        <a href="/premium" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-7 py-3.5 text-sm font-bold hover:border-white">
          <Sparkles className="size-4" aria-hidden /> Premium bebas iklan
        </a>
      </CtaBand>
    </CompanyPage>
  );
}
