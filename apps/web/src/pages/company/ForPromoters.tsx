import { BadgeCheck, FileSignature, Gauge, MessagesSquare, QrCode, Radio, Search, ShieldCheck } from 'lucide-react';
import { Cards, Checklist, CompanyPage, Cta, CtaBand, Heading, PageHero, pct, Section, Stats, Steps, useParam } from './shell';
import { PromoterHeroArt } from './heroArt';
import { useDict } from '@/lib/i18n';

// Ikon per fitur (urutan sama dengan kamus company.forPromoters.features).
const FEATURE_ICONS = [Gauge, Search, MessagesSquare, FileSignature, ShieldCheck, BadgeCheck, QrCode, Radio];

export default function ForPromoters() {
  const d = useDict('company').forPromoters;
  const features = d.features.map((c, i) => ({ ...c, icon: FEATURE_ICONS[i] }));
  const fee = useParam('commission.promotor_service_fee_pct');
  const dp = useParam('booking.default_dp_pct');
  const settleDays = useParam('booking.settlement_days_before');
  const disputeHours = useParam('booking.dispute_window_hours');
  return (
    <CompanyPage title={d.title}>
      <PageHero
        aside={<PromoterHeroArt />}
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={
          <>
            <Cta to="/promotor">{d.openHub}</Cta>
            <Cta to="/login?signup=1" variant="ghost">
              {d.signup}
            </Cta>
          </>
        }
      />

      <Section className="border-t border-white/10">
        <Heading kicker={d.featuresHeading.kicker} title={d.featuresHeading.title} />
        <Cards items={features} cols={4} />
      </Section>

      <Section>
        <Heading kicker={d.flowHeading.kicker} title={d.flowHeading.title} body={d.flowHeading.body} />
        <Steps
          items={[
            d.flow.signed,
            { title: d.flow.dp.title(pct(dp)), body: d.flow.dp.body },
            { title: d.flow.settle.title(settleDays), body: d.flow.settle.body },
            { title: d.flow.show.title, body: d.flow.show.body(disputeHours) },
            d.flow.forwarded,
          ]}
        />
      </Section>

      <Section>
        <Heading kicker={d.pricingHeading.kicker} title={d.pricingHeading.title} body={d.pricingHeading.body} />
        <Stats
          items={[
            { value: 'Rp 0', label: d.stats.freeLabel },
            { value: pct(fee), label: d.stats.feeLabel },
            { value: pct(dp), label: d.stats.dpLabel },
            { value: d.stats.settle(settleDays), label: d.stats.settleLabel },
          ]}
          note={d.stats.note}
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker={d.fitHeading.kicker} title={d.fitHeading.title} />
        <Checklist items={d.fit} />
      </Section>

      <CtaBand title={d.band.title} body={d.band.body}>
        <Cta to="/promotor" variant="light">
          {d.band.start}
        </Cta>
        <Cta to="/untuk-artis" variant="ghost">
          {d.band.otherSide}
        </Cta>
      </CtaBand>
    </CompanyPage>
  );
}
