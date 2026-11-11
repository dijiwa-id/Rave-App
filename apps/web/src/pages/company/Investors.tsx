import { InvestorHeroArt } from './heroArt';
import { Database, Lock, Workflow } from 'lucide-react';
import { useDict } from '@/lib/i18n';
import { Cards, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, Stats } from './shell';

// Hanya informasi yang aman untuk publik. Detail pendanaan, proyeksi, dan penggunaan dana
// dibagikan lewat materi investor setelah NDA — bukan di halaman ini.

// Ikon kartu keunggulan (urutan sama dengan kamus company.investors.edge).
const EDGE_ICONS = [Database, Lock, Workflow];

export default function Investors() {
  const d = useDict('company').investors;
  const edge = d.edge.map((c, i) => ({ ...c, icon: EDGE_ICONS[i] }));
  return (
    <CompanyPage title={d.title}>
      <PageHero
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={<ContactCta subject="Investor">{d.requestDeck}</ContactCta>}
        aside={<InvestorHeroArt />}
      />

      <Section className="border-t border-white/10">
        <Heading kicker={d.whyHeading.kicker} title={d.whyHeading.title} />
        <Stats items={d.stats} note={d.statsNote} />
      </Section>

      <Section>
        <Heading kicker={d.edgeHeading.kicker} title={d.edgeHeading.title} body={d.edgeHeading.body} />
        <Cards cols={3} items={edge} />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker={d.modelHeading.kicker} title={d.modelHeading.title} body={d.modelHeading.body} />
        <dl className="mt-12 divide-y divide-white/10 border-y border-white/10">
          {d.streams.map(({ name: k, body: v }) => (
            <div key={k} className="grid gap-2 py-5 md:grid-cols-[16rem_1fr] md:gap-8">
              <dt className="font-bold">{k}</dt>
              <dd className="text-[15px] text-white/60">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-white/45">
          {d.northStar}
        </p>
      </Section>

      <Section>
        <Heading kicker={d.roadmapHeading.kicker} title={d.roadmapHeading.title} body={d.roadmapHeading.body} />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-none border border-white/10 bg-white/10 md:grid-cols-5">
          {d.phases.map((p) => (
            <li key={p.phase} className="bg-black p-6">
              <span className="rave-label text-rave-primary-text">{p.phase}</span>
              <h3 className="mt-3 font-bold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{p.body}</p>
            </li>
          ))}
        </ol>
      </Section>

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
