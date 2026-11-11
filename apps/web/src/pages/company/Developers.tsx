import { Braces, KeyRound, Link2, Radio, Repeat, ShieldCheck, Webhook } from 'lucide-react';
import { DeveloperHeroArt } from './heroArt';
import { useDict } from '@/lib/i18n';
import { Cards, Checklist, CompanyPage, ContactCta, CtaBand, Heading, PageHero, Section, useParam } from './shell';

// Ikon per permukaan integrasi (urutan sama dengan kamus company.developers.surfaces).
const SURFACE_ICONS = [Braces, Radio, Link2, Webhook];
const WEBHOOK_ICONS = [ShieldCheck, Repeat, KeyRound];

const CURL = `curl -s "$RAVE_API/v1/catalog/home" \\
  -H "Authorization: Bearer $RAVE_TOKEN"`;

const problem = (detail: string) => `HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json

{
  "type": "about:blank",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "${detail}"
}`;

const signature = (comment: string) => `X-PG-Signature: t=1760000000,v1=<hex>

v1 = HMAC_SHA256(secret, "<t>.<raw body>")
${comment}`;

function Code({ label, children }: { label: string; children: string }) {
  return (
    <figure className="overflow-hidden rounded-none border border-white/10 bg-[#0b0b0d]">
      <figcaption className="border-b border-white/10 px-5 py-3 rave-label text-white/45">{label}</figcaption>
      <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-white/85">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export default function Developers() {
  const d = useDict('company').developers;
  const rate = useParam('security.rate_limit_per_minute');
  const surfaces = d.surfaces.map((c, i) => ({ ...c, icon: SURFACE_ICONS[i] }));
  return (
    <CompanyPage title={d.title}>
      <PageHero
        kicker={d.kicker}
        title={d.heroTitle}
        lead={d.lead}
        actions={<ContactCta subject="Developer">{d.requestAccess}</ContactCta>}
        aside={<DeveloperHeroArt />}
      />

      <Section className="border-t border-white/10">
        <Heading kicker={d.surfacesHeading.kicker} title={d.surfacesHeading.title} body={d.surfacesHeading.body} />
        <Cards items={surfaces} cols={4} />
      </Section>

      <Section>
        <Heading kicker={d.conventions.kicker} title={d.conventions.title} />
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <Code label={d.codeRequest}>{CURL}</Code>
          <Code label={d.codeError}>{problem(d.problemDetail)}</Code>
        </div>
        <Checklist items={[...d.checklist, { title: d.rateLimit.title, body: d.rateLimit.body(rate) }]} />
      </Section>

      <Section className="border-t border-white/10">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <Heading kicker={d.webhook.kicker} title={d.webhook.title} body={d.webhook.body} />
            <ul className="mt-8 space-y-4 text-[15px] text-white/70">
              {WEBHOOK_ICONS.map((I, i) => (
                <li key={d.webhookPoints[i]} className="flex items-center gap-3">
                  <I className="size-5 shrink-0 text-rave-primary-text" aria-hidden /> {d.webhookPoints[i]}
                </li>
              ))}
            </ul>
          </div>
          <Code label={d.verifyLabel}>{signature(d.signatureComment)}</Code>
        </div>
      </Section>

      <CtaBand title={d.band.title} body={d.band.body}>
        <ContactCta subject="Developer" variant="light">
          {d.band.button}
        </ContactCta>
      </CtaBand>
    </CompanyPage>
  );
}
