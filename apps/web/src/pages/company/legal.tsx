import { LegalHeroArt } from './heroArt';
import { useEffect, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { CompanyPage, ContactCta, PageHero } from './shell';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** Paragraf & daftar dokumen dengan gaya seragam. */
export const P = ({ children }: { children: ReactNode }) => <p className="mt-4 text-[15.5px] leading-relaxed text-white/75">{children}</p>;
export const UL = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-4 space-y-2.5">
    {items.map((it, i) => (
      <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-white/75">
        <span className="mt-2 size-2 shrink-0 rotate-45 bg-rave-primary" aria-hidden />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

/** Sorot bagian yang sedang dibaca di daftar isi (IntersectionObserver). */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return active;
}

/**
 * Templat dokumen RAVE (ketentuan, privasi, hak cipta, cookie): hero seragam, catatan status dokumen,
 * daftar isi sticky bernomor (mono) + bagian bernomor (display) — konsisten dengan halaman perusahaan.
 */
export function LegalPage({
  title,
  kicker,
  lead,
  updated,
  sections,
  contactSubject,
}: {
  title: string;
  kicker: string;
  lead: string;
  updated: string;
  sections: LegalSection[];
  contactSubject: string;
}) {
  const d = useDict('company').legal;
  const active = useActiveSection(sections.map((s) => s.id));
  return (
    <CompanyPage title={title}>
      <PageHero kicker={kicker} title={title} lead={lead} aside={<LegalHeroArt kicker={kicker} updated={updated} />} />
      <section className="px-4 pb-24">
        <div className="mx-auto grid max-w-[82.5rem] gap-12 lg:grid-cols-[17rem_1fr]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="border-2 border-rave-ink bg-[#1e1c1f] p-5 shadow-[5px_5px_0_#0b0a0c]">
              <p className="rave-label mb-4 border-b-2 border-rave-primary pb-2 text-rave-primary-text">{d.toc}</p>
              <ol className="space-y-1">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={cx(
                        'flex gap-3 py-1 font-label text-[11.5px] font-bold tracking-[0.04em] uppercase transition',
                        active === s.id ? 'text-rave-primary-text' : 'text-white/60 hover:text-rave-paper',
                      )}
                    >
                      <span className="w-5 shrink-0 text-white/30">{String(i + 1).padStart(2, '0')}</span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
              <p className="rave-stamp mt-5 text-white/60 [--stamp-r:-2deg]">{d.updated(updated)}</p>
            </div>
          </aside>

          <article className="min-w-0">
            <div className="mb-10 flex gap-4 border-2 border-rave-ink bg-rave-primary p-4 text-rave-ink shadow-[4px_4px_0_#0b0a0c]">
              <span className="font-display text-3xl leading-none">!</span>
              <p className="text-sm leading-relaxed">
                <strong className="font-label text-[11px] tracking-[0.1em] uppercase">{d.betaTitle}</strong> {d.betaBody}
              </p>
            </div>
            <div className="space-y-14">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} className="scroll-mt-28 border-t-2 border-dashed border-white/15 pt-8">
                  <div className="flex items-baseline gap-4">
                    <span className="font-display text-5xl leading-none text-rave-primary-text">{String(i + 1).padStart(2, '0')}</span>
                    <h2 className="text-3xl leading-none md:text-4xl">{s.title}</h2>
                  </div>
                  {s.body}
                </section>
              ))}
            </div>
            <div className="mt-16 flex flex-wrap items-center justify-between gap-6 border-2 border-rave-ink bg-[#1e1c1f] p-6 shadow-[6px_6px_0_#F4C21F]">
              <div>
                <p className="font-display text-3xl leading-none uppercase">{d.questions}</p>
                <p className="mt-2 text-sm text-white/65">{d.replyTime}</p>
              </div>
              <ContactCta subject={contactSubject}>{d.contact}</ContactCta>
            </div>
          </article>
        </div>
      </section>
    </CompanyPage>
  );
}
