import { Mic, MonitorPlay, Music4, Sparkles, Ticket } from 'lucide-react';
import { AD_CATEGORIES, AD_FIXED_RULES } from '@rave/domain/ads';
import { Cards, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, Stats, Steps, useParam } from './shell';
import { AdvertiseHeroArt } from './heroArt';
import { useDict } from '@/lib/i18n';

/** Label kategori per tier, diterjemahkan lewat kamus (fallback ke label domain). */
const byTier = (tier: string, labels: Record<string, string>) =>
  Object.entries(AD_CATEGORIES)
    .filter(([, c]) => c.tier === tier)
    .map(([k, c]) => labels[k] ?? c.label);

export default function Advertise() {
  const d = useDict('company').advertise;
  const labels = d.categories as Record<string, string>;
  const audioMax = useParam('ads.max_audio_seconds');
  const displayMax = useParam('ads.max_display_seconds');
  const skipAfter = useParam('ads.skip_after_seconds');
  const interval = useParam('ads.break_interval_minutes');
  const perHour = useParam('ads.max_ads_per_hour');
  const cap = useParam('ads.frequency_cap_per_day');
  const perBreak = useParam('ads.max_ads_per_break');

  return (
    <CompanyPage title={d.title}>
      <PageHero
        aside={<AdvertiseHeroArt />}
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={<ContactCta subject="Iklan">{d.contact}</ContactCta>}
      />

      <Section className="border-t border-white/10">
        <Heading kicker={d.formats.kicker} title={d.formats.title} />
        <Cards
          cols={4}
          items={[
            { icon: Mic, title: d.audio.title, body: d.audio.body(audioMax) },
            { icon: MonitorPlay, title: d.display.title, body: d.display.body(displayMax, skipAfter) },
            { icon: Music4, ...d.podcast },
            { icon: Ticket, ...d.stage },
          ]}
        />
      </Section>

      <Section>
        <Heading kicker={d.experience.kicker} title={d.experience.title} body={d.experience.body} />
        <Stats
          items={[
            { value: d.stats.interval(interval), label: d.stats.intervalLabel },
            { value: `${perBreak}`, label: d.stats.perBreakLabel },
            { value: d.stats.perHour(perHour), label: d.stats.perHourLabel },
            { value: d.stats.cap(cap), label: d.stats.capLabel },
          ]}
          note={d.stats.note}
        />
      </Section>

      <Section className="border-t border-white/10">
        <Heading kicker={d.policy.kicker} title={d.policy.title} />
        <ul className="mt-12 grid gap-x-12 gap-y-5 md:grid-cols-2">
          {AD_FIXED_RULES.map((rule, i) => d.fixedRules[i] ?? rule).map((r) => (
            <li key={r} className="flex gap-4 text-[15px] leading-relaxed text-white/75">
              <span className="mt-2 size-2 shrink-0 rounded-full bg-rave-primary" aria-hidden /> {r}
            </li>
          ))}
        </ul>
        <div className="mt-14 grid gap-4 md:grid-cols-2">
          <div className="rounded-none border border-white/10 p-6">
            <h3 className="font-bold">{d.restricted.title}</h3>
            <p className="mt-1.5 text-sm text-white/55">{d.restricted.body}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {byTier('restricted', labels).map((l) => (
                <li key={l} className="rounded-none border border-white/15 px-3 py-1 text-sm text-white/75">
                  {l}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-none border border-white/10 p-6">
            <h3 className="font-bold">{d.prohibited.title}</h3>
            <p className="mt-1.5 text-sm text-white/55">{d.prohibited.body}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {byTier('prohibited', labels).map((l) => (
                <li key={l} className="rounded-none border border-red-400/30 px-3 py-1 text-sm text-red-200/90">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section>
        <Heading kicker={d.process.kicker} title={d.process.title} />
        <Steps items={d.steps} />
      </Section>

      <CtaBand title={d.band.title} body={d.band.body}>
        <ContactCta subject="Iklan" variant="light">
          {d.band.quote}
        </ContactCta>
        <a href="/premium" className="inline-flex items-center gap-2 rounded-none border border-white/25 px-7 py-3.5 text-sm font-bold hover:border-white">
          <Sparkles className="size-4" aria-hidden /> {d.band.premium}
        </a>
      </CtaBand>
    </CompanyPage>
  );
}
