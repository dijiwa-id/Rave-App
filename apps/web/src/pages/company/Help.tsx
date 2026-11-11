import { HelpHeroArt } from './heroArt';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Headphones, Mic2, Radio, Search, Sparkles, Ticket, UserRound, CalendarCheck } from 'lucide-react';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { CompanyPage, ContactCta, PageHero } from './shell';

type TopicId = 'akun' | 'dengar' | 'premium' | 'tiket' | 'artis' | 'promotor' | 'live';
type Topic = { id: TopicId; icon: typeof Headphones; title: string; blurb: string; faqs: readonly { q: string; a: string }[] };

// Urutan & ikon topik; judul, ringkasan, dan FAQ per bahasa di kamus company.help.topics.
const TOPIC_ICONS: [TopicId, typeof Headphones][] = [
  ['akun', UserRound],
  ['dengar', Headphones],
  ['premium', Sparkles],
  ['tiket', Ticket],
  ['artis', Mic2],
  ['promotor', CalendarCheck],
  ['live', Radio],
];

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-2 border-rave-ink bg-[#1e1c1f] shadow-[3px_3px_0_#0b0a0c]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-bold transition hover:text-rave-primary-text">
        {q}
        <ChevronDown className={cx('size-5 shrink-0 transition', open && 'rotate-180 text-rave-primary-text')} />
      </button>
      {open && <p className="border-t-2 border-dashed border-white/10 px-5 py-4 text-[15px] leading-relaxed text-white/75">{a}</p>}
    </li>
  );
}

/** Pusat Bantuan: pencarian instan, kartu topik, FAQ per topik (akordion), dan kontak. */
export default function Help() {
  const d = useDict('company').help;
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const TOPICS = useMemo<Topic[]>(() => TOPIC_ICONS.map(([id, icon]) => ({ id, icon, ...d.topics[id] })), [d]);
  const topics = useMemo(
    () => (term ? TOPICS.map((t) => ({ ...t, faqs: t.faqs.filter(({ q: a, a: b }) => (a + ' ' + b).toLowerCase().includes(term)) })).filter((t) => t.faqs.length) : TOPICS),
    [term, TOPICS],
  );
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
          <label className="relative block w-full max-w-xl">
            <span className="sr-only">{d.searchLabel}</span>
            <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-rave-ink/60" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={d.placeholder}
              className="h-14 w-full border-2 border-rave-ink bg-rave-paper pr-4 pl-12 text-rave-ink shadow-[4px_4px_0_#0b0a0c] placeholder:text-rave-ink/45 focus:border-rave-primary focus:outline-none"
            />
          </label>
        }
        aside={<HelpHeroArt topics={TOPICS.slice(0, 4).map((t) => t.title)} />}
      />

      {!term && (
        <section className="px-4">
          <div className="rave-tilt mx-auto grid max-w-[82.5rem] gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TOPICS.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="rave-card group block p-5">
                <span className="grid size-11 -rotate-3 place-items-center border-2 border-rave-ink bg-rave-purple text-rave-primary-text shadow-[3px_3px_0_#0b0a0c]">
                  <t.icon className="size-5" />
                </span>
                <p className="mt-4 font-display text-2xl leading-none uppercase">{t.title}</p>
                <p className="mt-1.5 text-sm text-white/60">{t.blurb}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="px-4 py-20">
        <div className="mx-auto max-w-4xl space-y-14">
          {topics.length === 0 && (
            <div className="border-2 border-rave-ink bg-rave-primary p-6 text-rave-ink shadow-[5px_5px_0_#0b0a0c]">
              <p className="font-display text-3xl leading-none uppercase">{d.notFoundTitle}</p>
              <p className="mt-2 text-sm">{d.notFound(q)}</p>
            </div>
          )}
          {topics.map((t) => (
            <div key={t.id} id={t.id} className="scroll-mt-28">
              <p className="rave-label rave-eyebrow">{t.blurb}</p>
              <h2 className="mt-3 text-4xl leading-none md:text-5xl">{t.title}</h2>
              <ul className="mt-6 space-y-3">
                {t.faqs.map((f) => (
                  <Faq key={f.q} q={f.q} a={f.a} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-24">
        <div className="rave-crumple relative mx-auto flex max-w-[82.5rem] flex-wrap items-center justify-between gap-6 border-2 border-rave-ink bg-[#1e1c1f] p-8 shadow-[10px_10px_0_#F4C21F] before:!opacity-35 md:p-10">
          <div>
            <p className="font-display text-4xl leading-none uppercase md:text-5xl">{d.stillTitle}</p>
            <p className="mt-3 max-w-lg text-white/70">
              {d.still.before}
              <Link to="/ketentuan" className="text-rave-primary-text underline decoration-2 underline-offset-4">
                {d.still.terms}
              </Link>
              {d.still.and}
              <Link to="/privasi" className="text-rave-primary-text underline decoration-2 underline-offset-4">
                {d.still.privacy}
              </Link>
              {d.still.after}
            </p>
          </div>
          <ContactCta subject="Bantuan pengguna RAVE">{d.contact}</ContactCta>
        </div>
      </section>
    </CompanyPage>
  );
}
