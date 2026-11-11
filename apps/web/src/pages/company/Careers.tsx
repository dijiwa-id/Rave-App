import { CareersHeroArt } from './heroArt';
import { BarChart3, Code2, Handshake, Palette, Scale } from 'lucide-react';
import { useDict } from '@/lib/i18n';
import { Checklist, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, Steps, useContact } from './shell';

// Ikon per bidang (urutan sama dengan kamus company.careers.teams).
const TEAM_ICONS = [Code2, Palette, Handshake, Scale];

export default function Careers() {
  const d = useDict('company').careers;
  const { email } = useContact('Karier');
  const TEAMS = d.teams.map((t, i) => ({ ...t, icon: TEAM_ICONS[i] }));
  return (
    <CompanyPage title={d.title}>
      <PageHero
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={
          <>
            <ContactCta subject="Karier">{d.apply}</ContactCta>
            <a href="#tim" className="inline-flex items-center rounded-none border border-white/25 px-7 py-3.5 text-sm font-bold hover:border-white">
              {d.seeTeams}
            </a>
          </>
        }
        aside={<CareersHeroArt teams={TEAMS.map((t) => t.name)} />}
      />

      <Section id="tim" className="border-t border-white/10">
        <Heading kicker={d.teamsHeading.kicker} title={d.teamsHeading.title} body={d.teamsHeading.body} />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {TEAMS.map(({ icon: Icon, name, body, roles }) => (
            <article key={name} className="rounded-none border border-white/10 bg-white/[0.03] p-7">
              <div className="flex items-center gap-4">
                <span className="grid size-11 place-items-center rounded-none bg-rave-primary/15 text-rave-primary-text">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="text-xl font-bold">{name}</h3>
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-white/60">{body}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {roles.map((r) => (
                  <li key={r} className="rounded-none border border-white/10 px-3 py-1 text-sm text-white/75">
                    {r}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <Heading kicker={d.valuesHeading.kicker} title={d.valuesHeading.title} />
        <Checklist items={d.values} />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker={d.processHeading.kicker} title={d.processHeading.title} />
        <Steps items={[{ title: d.applyStep.title, body: d.applyStep.body(email) }, ...d.steps]} />
      </Section>

      <Section>
        <div className="grid gap-8 rounded-none border border-white/10 p-8 md:grid-cols-[auto_1fr] md:items-center">
          <span className="grid size-14 place-items-center rounded-none bg-white/5">
            <BarChart3 className="size-6 text-rave-primary-text" aria-hidden />
          </span>
          <p className="text-[15px] leading-relaxed text-white/65">
            {d.equalOpportunity}
          </p>
        </div>
      </Section>

      <CtaBand title={d.band.title} body={d.band.body}>
        <ContactCta subject="Karier" variant="light">
          {d.band.button}
        </ContactCta>
      </CtaBand>
    </CompanyPage>
  );
}
