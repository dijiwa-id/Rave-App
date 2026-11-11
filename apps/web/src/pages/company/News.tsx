import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cx } from '@/components/ui';
import { BTN_PRIMARY } from '@/pages/public/marketing';
import { CompanyPage } from './shell';
import { NEWS_CATEGORIES, useNews } from './news-data';
import { useDict } from '@/lib/i18n';
import { CategoryTag, Meta, NewsCard, NewsImage } from './newsUi';

/** Ruang berita RAVE: header ringkas, filter kategori (di URL), cerita utama, grid kartu, langganan kabar. */
export default function News() {
  const d = useDict('company').news;
  const NEWS = useNews();
  const [params, setParams] = useSearchParams();
  const cat = params.get('kategori');
  const list = cat ? NEWS.filter((a) => a.category === cat) : NEWS;
  const featured = !cat ? (NEWS.find((a) => a.featured) ?? NEWS[0]) : null;
  const rest = featured ? list.filter((a) => a.slug !== featured.slug) : list;
  const setCat = (c: string | null) => setParams(c ? { kategori: c } : {}, { replace: true });

  return (
    <CompanyPage title={d.title}>
      <section className="rave-crumple relative isolate overflow-hidden bg-[radial-gradient(110%_90%_at_80%_0%,#4a1f5c_0,#2a1233_45%,#181818_100%)] px-4 pt-[8.5rem] pb-10 md:pt-[9.5rem]">
        <div className="mx-auto flex max-w-[82.5rem] flex-wrap items-end justify-between gap-6">
          <div>
            <p className="rave-label rave-eyebrow !text-[12px]">{d.kicker}</p>
            <h1 className="mt-5 text-6xl leading-[0.9] md:text-8xl">
              {d.titleA}
              <span className="text-rave-primary-text">{d.titleB}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-[#cfc4d8]">{d.lead}</p>
          </div>
          <p className="rave-stamp text-white/60">{d.count(NEWS.length)}</p>
        </div>
        <nav aria-label={d.navLabel} className="mx-auto mt-10 flex max-w-[82.5rem] flex-wrap gap-2">
          {[null, ...NEWS_CATEGORIES].map((c) => {
            const on = (c ?? null) === (cat ?? null);
            return (
              <button
                key={c ?? 'semua'}
                type="button"
                onClick={() => setCat(c)}
                aria-pressed={on}
                className={cx(
                  'border-2 px-4 py-2 font-label text-[11px] font-bold tracking-[0.1em] uppercase transition',
                  on ? 'border-rave-ink bg-rave-primary text-rave-ink shadow-[3px_3px_0_#0b0a0c]' : 'border-white/20 text-white/75 hover:border-rave-paper hover:text-rave-paper',
                )}
              >
                {c ? d.categories[c] : d.all}
              </button>
            );
          })}
        </nav>
      </section>

      <section className="px-4 py-14">
        <div className="mx-auto max-w-[82.5rem]">
          {featured && (
            <Link
              to={`/berita/${featured.slug}`}
              className="group mb-12 grid border-2 border-rave-ink bg-[#1e1c1f] shadow-[8px_8px_0_#F4C21F] transition hover:-translate-y-0.5 lg:grid-cols-[1.35fr_1fr]"
            >
              <NewsImage a={featured} eager className="aspect-[16/10] border-b-2 border-rave-ink lg:aspect-auto lg:min-h-[420px] lg:border-r-2 lg:border-b-0" />
              <div className="flex flex-col justify-center p-7 md:p-10">
                <div className="flex items-center gap-3">
                  <CategoryTag c={d.categories[featured.category]} />
                  <span className="rave-label text-rave-primary-text">{d.featured}</span>
                </div>
                <h2 className="mt-5 text-4xl leading-[0.95] transition group-hover:text-rave-primary-text md:text-5xl">{featured.title}</h2>
                <p className="mt-4 text-[15.5px] leading-relaxed text-white/70">{featured.excerpt}</p>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                  <Meta a={featured} />
                  <span className="rave-label inline-flex items-center gap-2 text-rave-paper">
                    {d.readStory} <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                  </span>
                </div>
              </div>
            </Link>
          )}

          {rest.length ? (
            <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((a) => (
                <NewsCard key={a.slug} a={a} />
              ))}
            </div>
          ) : (
            <p className="border-2 border-rave-ink bg-[#1e1c1f] p-8 text-center text-white/70">{d.empty}</p>
          )}
        </div>
      </section>

      <section className="px-4 pb-24">
        <div className="rave-crumple relative mx-auto flex max-w-[82.5rem] flex-wrap items-center justify-between gap-6 border-2 border-rave-ink bg-[#1e1c1f] p-8 shadow-[10px_10px_0_#F4C21F] before:!opacity-35 md:p-10">
          <div>
            <p className="font-display text-4xl leading-none uppercase md:text-5xl">{d.ctaTitle}</p>
            <p className="mt-3 max-w-lg text-white/70">{d.ctaBody}</p>
          </div>
          <a href="/#waitlist" className={BTN_PRIMARY}>
            {d.ctaButton} <ArrowRight className="size-4 transition group-hover:translate-x-1" />
          </a>
        </div>
      </section>
    </CompanyPage>
  );
}
