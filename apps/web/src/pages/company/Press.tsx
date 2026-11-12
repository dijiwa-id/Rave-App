import { PressHeroArt } from './heroArt';
import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { toast } from '@/components/ui';
import { DEFAULT_BRAND } from '@/lib/platform';
import { useDict } from '@/lib/i18n';
import { CompanyPage, ContactCta, Heading, PageHero, Section, useContact } from './shell';

// Hex warna merek (nama per bahasa di kamus company.press.colors, urutan sama).
const COLORS = ['#5B2A6E', '#F4C21F', '#2A1233', '#181818', '#EDEDED', '#1F5C52', '#8A2F3F'];

// Nama aset per bahasa di kamus company.press.assets (urutan sama).
const ASSETS = [
  { file: 'rave-logo-latar-terang.webp', src: DEFAULT_BRAND.logo, bg: 'bg-white' },
  { file: 'rave-logo-latar-gelap.webp', src: DEFAULT_BRAND.logoDark, bg: 'bg-[#181818]' },
  { file: 'rave-icon.svg', src: DEFAULT_BRAND.icon, bg: 'bg-[#1e1e1e]' },
];

function useCopy(failed: string) {
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
        .catch(() => toast.error(failed)),
  };
}

export default function Press() {
  const d = useDict('company').press;
  const { email } = useContact('Media');
  const { copied, copy } = useCopy(d.copyFailed);
  const BOILERPLATE = d.boilerplate;
  return (
    <CompanyPage title={d.title}>
      <PageHero
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={<ContactCta subject="Media">{d.contact}</ContactCta>}
        aside={<PressHeroArt />}
      />

      <Section className="border-t border-white/10">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <Heading kicker={d.profileHeading.kicker} title={d.profileHeading.title} />
            <blockquote className="mt-8 border-l-2 border-rave-primary pl-6 text-lg leading-relaxed text-white/80">{BOILERPLATE}</blockquote>
            <button
              onClick={() => copy('boiler', BOILERPLATE)}
              className="mt-6 inline-flex items-center gap-2 rounded-none border border-white/20 px-5 py-2.5 text-sm font-bold hover:border-white"
            >
              {copied === 'boiler' ? <Check className="size-4 text-rave-primary-text" /> : <Copy className="size-4" />}
              {copied === 'boiler' ? d.copied : d.copyProfile}
            </button>
          </div>
          <div>
            <Heading kicker={d.factsHeading.kicker} title={d.factsHeading.title} />
            <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">
              {d.facts.map(({ k, v }) => (
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
        <Heading kicker={d.releasesHeading.kicker} title={d.releasesHeading.title} body={d.releasesEmpty} />
      </Section>

      <Section>
        <Heading kicker={d.assetsHeading.kicker} title={d.assetsHeading.title} body={d.assetsHeading.body} />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {ASSETS.map((a, i) => ({ ...a, name: d.assets[i] })).map((a) => (
            <figure key={a.file} className="overflow-hidden rounded-none border border-white/10">
              <div className={`grid h-44 place-items-center p-8 ${a.bg}`}>
                <img src={a.src} alt={a.name} className="max-h-16 max-w-[80%]" />
              </div>
              <figcaption className="flex items-center justify-between gap-3 px-5 py-4">
                <span className="text-sm font-bold">{a.name}</span>
                <a href={a.src} download={a.file} className="inline-flex items-center gap-1.5 text-sm font-bold text-rave-primary-text hover:underline">
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
            <Heading kicker={d.colorsHeading.kicker} title={d.colorsHeading.title} />
            <ul className="mt-8 grid grid-cols-2 gap-3">
              {COLORS.map((hex, i) => [d.colors[i], hex] as const).map(([name, hex]) => (
                <li key={hex}>
                  <button onClick={() => copy(hex, hex)} className="w-full overflow-hidden rounded-none border border-white/10 text-left hover:border-white/30" aria-label={d.copyColor(name, hex)}>
                    <span className="block h-16 border-b border-white/10" style={{ background: hex }} />
                    <span className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-bold">{name}</span>
                      <span className="font-mono text-xs text-white/55">{copied === hex ? d.copied : hex}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full" aria-label={d.composition}>
              <span className="w-[40%] bg-[#5B2A6E]" />
              <span className="w-[25%] bg-[#F4C21F]" />
              <span className="w-[20%] bg-[#2A1233]" />
              <span className="flex-1 bg-[#181818]" />
            </div>
          </div>
          <div>
            <Heading kicker={d.guideHeading.kicker} title={d.guideHeading.title} />
            <ul className="mt-8 space-y-4 text-[15px] leading-relaxed text-white/70">
              {d.guidelines.map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-rave-primary" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section className="border-t border-white/10">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-5xl leading-[0.95]">{d.mediaContact.title}</h2>
            <p className="mt-2 text-white/60">
              {d.mediaContact.before}
              <span className="font-bold text-white">{email}</span>
              {d.mediaContact.after}
            </p>
          </div>
          <ContactCta subject="Media" variant="light">
            {d.sendEmail}
          </ContactCta>
        </div>
      </Section>
    </CompanyPage>
  );
}
