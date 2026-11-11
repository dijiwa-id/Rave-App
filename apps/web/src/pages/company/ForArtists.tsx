import { BarChart3, CalendarRange, FileSignature, FileText, Layers, Radio, Upload, Wallet } from 'lucide-react';
import { Cards, Checklist, CompanyPage, Cta, CtaBand, Heading, PageHero, pct, Section, Stats, Steps, useParam } from './shell';
import { ArtistHeroArt } from './heroArt';
import { useDict } from '@/lib/i18n';

// Ikon per fitur (urutan sama dengan kamus company.forArtists.features).
const FEATURE_ICONS = [Upload, BarChart3, FileText, Layers, CalendarRange, FileSignature, Wallet, Radio];

export default function ForArtists() {
  const d = useDict('company').forArtists;
  const features = d.features.map((c, i) => ({ ...c, icon: FEATURE_ICONS[i] }));
  const commission = useParam('commission.artist_commission_pct');
  const dp = useParam('booking.default_dp_pct');
  const disputeHours = useParam('booking.dispute_window_hours');
  return (
    <CompanyPage title={d.title}>
      <PageHero
        aside={<ArtistHeroArt />}
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={
          <>
            <Cta to="/studio">{d.openStudio}</Cta>
            <Cta to="/login?signup=1" variant="ghost">
              {d.signup}
            </Cta>
          </>
        }
      />

      <Section className="border-t border-white/10">
        <Heading kicker={d.featuresHeading.kicker} title={d.featuresHeading.title} body={d.featuresHeading.body} />
        <Cards items={features} cols={4} />
      </Section>

      <Section>
        <Heading kicker={d.flowHeading.kicker} title={d.flowHeading.title} />
        <Steps
          items={[
            d.flow.inquiry,
            d.flow.negotiation,
            { title: d.flow.contract.title, body: d.flow.contract.body(pct(dp)) },
            d.flow.perform,
            { title: d.flow.payout.title, body: d.flow.payout.body(disputeHours) },
          ]}
        />
      </Section>

      <Section>
        <Heading kicker={d.pricingHeading.kicker} title={d.pricingHeading.title} body={d.pricingHeading.body} />
        <Stats
          items={[
            { value: 'Rp 0', label: d.stats.freeLabel },
            { value: pct(commission), label: d.stats.commissionLabel },
            { value: pct(dp), label: d.stats.dpLabel },
            { value: d.stats.dispute(disputeHours), label: d.stats.disputeLabel },
          ]}
          note={d.stats.note}
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker={d.protectionHeading.kicker} title={d.protectionHeading.title} />
        <Checklist items={d.protections} />
      </Section>

      <CtaBand title={d.band.title} body={d.band.body}>
        <Cta to="/studio" variant="light">
          {d.band.start}
        </Cta>
        <Cta to="/untuk-promotor" variant="ghost">
          {d.band.otherSide}
        </Cta>
      </CtaBand>
    </CompanyPage>
  );
}
