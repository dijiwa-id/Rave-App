import { AboutHeroArt } from './heroArt';
import { CalendarCheck, Headphones, HeartHandshake, Mic2, Radio, ShieldCheck, Ticket, Users } from 'lucide-react';
import { useDict } from '@/lib/i18n';
import { Cards, Checklist, CompanyPage, Cta, CtaBand, Heading, PageHero, Section, Steps } from './shell';

// Ikon per kartu (urutan sama dengan kamus company.about.*).
const AUDIENCE_ICONS = [Mic2, Users, CalendarCheck, Headphones];
const PRODUCT_ICONS = [Headphones, Mic2, CalendarCheck, Radio];
const SCOPE_ICONS = [Ticket, HeartHandshake, ShieldCheck];

export default function About() {
  const d = useDict('company').about;
  const audiences = d.audiences.map((c, i) => ({ ...c, icon: AUDIENCE_ICONS[i] }));
  const products = d.products.map((c, i) => ({ ...c, icon: PRODUCT_ICONS[i] }));
  const scope = d.scopeCards.map((c, i) => ({ ...c, icon: SCOPE_ICONS[i] }));
  return (
    <CompanyPage title={d.title}>
      <PageHero
        kicker={d.kicker}
        title={
          <>
            {d.heroA}
            <span className="text-rave-primary-text">{d.heroB}</span>
          </>
        }
        lead={d.lead}
        actions={
          <>
            <Cta to="/app">{d.listen}</Cta>
            <Cta to="/karier" variant="ghost">
              {d.join}
            </Cta>
          </>
        }
        aside={<AboutHeroArt />}
      />

      <Section className="border-t border-white/10">
        <Heading kicker={d.why.kicker} title={d.why.title} body={d.why.body} />
        <Cards items={audiences} cols={4} />
      </Section>

      <Section>
        <Heading kicker={d.how.kicker} title={d.how.title} />
        <Steps items={d.steps} />
      </Section>

      <Section>
        <Heading kicker={d.eco.kicker} title={d.eco.title} body={d.eco.body} />
        <Cards items={products} cols={4} />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker={d.principlesHeading.kicker} title={d.principlesHeading.title} />
        <Checklist items={d.principles} />
      </Section>

      <Section>
        <Heading kicker={d.scope.kicker} title={d.scope.title} body={d.scope.body} />
        <Cards cols={3} items={scope} />
      </Section>

      <CtaBand title={d.band.title} body={d.band.body}>
        <Cta to="/untuk-artis" variant="light">
          {d.band.artists}
        </Cta>
        <Cta to="/untuk-promotor" variant="ghost">
          {d.band.promoters}
        </Cta>
        <Cta to="/media" variant="ghost">
          {d.band.media}
        </Cta>
      </CtaBand>
    </CompanyPage>
  );
}
