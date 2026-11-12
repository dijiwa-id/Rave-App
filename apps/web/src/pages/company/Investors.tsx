import { InvestorHeroArt } from './heroArt';
import { useDict } from '@/lib/i18n';
import { CompanyPage, ContactCta, CtaBand, PageHero } from './shell';

// Hanya informasi yang aman & benar untuk publik: tanpa angka pasar, metrik, atau proyeksi.
// Detail pendanaan dan materi investor dibagikan lewat email setelah NDA — bukan di halaman ini.

export default function Investors() {
  const d = useDict('company').investors;
  return (
    <CompanyPage title={d.title}>
      <PageHero
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={<ContactCta subject="Investor">{d.requestDeck}</ContactCta>}
        aside={<InvestorHeroArt />}
      />

      <CtaBand title={d.band.title} body={d.band.body}>
        <ContactCta subject="Investor" variant="light">
          {d.band.button}
        </ContactCta>
      </CtaBand>

      <p className="mx-auto max-w-[82.5rem] px-4 pb-16 text-xs leading-relaxed text-white/35">
        {d.disclaimer}
      </p>
    </CompanyPage>
  );
}
