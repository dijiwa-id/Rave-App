import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Link2 } from 'lucide-react';
import halftone from '@/assets/brand/paper-halftone.webp';
import { CompanyPage } from './shell';
import { useNews } from './news-data';
import { useDict } from '@/lib/i18n';
import { CategoryTag, Meta, NewsCard, NewsImage } from './newsUi';

/** Halaman artikel berita: breadcrumb, judul, meta, foto utama, isi prose, kutipan, salin tautan, baca juga. */
export default function NewsArticlePage() {
  const d = useDict('company').news;
  const NEWS = useNews();
  const { slug } = useParams();
  const a = NEWS.find((n) => n.slug === slug);
  const [copied, setCopied] = useState(false);
  if (!a) return <Navigate to="/berita" replace />;
  const related = NEWS.filter((n) => n.slug !== a.slug && n.category === a.category).concat(NEWS.filter((n) => n.slug !== a.slug && n.category !== a.category)).slice(0, 3);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard tidak tersedia */
    }
  }
  return (
    <CompanyPage title={a.title}>
      <article>
        <header className="relative isolate overflow-hidden bg-[radial-gradient(60rem_34rem_at_85%_-10%,rgba(122,62,145,0.55),transparent_70%),radial-gradient(48rem_30rem_at_5%_20%,rgba(91,42,110,0.35),transparent_70%),linear-gradient(180deg,#2a1233_0%,#22112a_40%,#181818_100%)] px-4 pt-[8rem] pb-12 md:pt-[9rem]">
          {/* Titik raw abstrak tipis (halftone kertas, warna paper) yang memudar mulus dari kanan atas. */}
          <span
            className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center opacity-[0.16] mix-blend-screen invert"
            style={{
              backgroundImage: `url(${halftone})`,
              maskImage: 'radial-gradient(75% 90% at 88% 0%, #000 0%, rgba(0,0,0,0.55) 40%, transparent 78%)',
              WebkitMaskImage: 'radial-gradient(75% 90% at 88% 0%, #000 0%, rgba(0,0,0,0.55) 40%, transparent 78%)',
            }}
            aria-hidden
          />
          <div className="mx-auto max-w-3xl">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-label text-[11px] font-bold tracking-[0.1em] text-white/55 uppercase">
              <Link to="/berita" className="inline-flex items-center gap-1.5 hover:text-rave-primary-text">
                <ArrowLeft className="size-3.5" /> {d.back}
              </Link>
              <span aria-hidden>/</span>
              <Link to={`/berita?kategori=${a.category}`} className="hover:text-rave-primary-text">
                {d.categories[a.category]}
              </Link>
            </nav>
            <CategoryTag c={d.categories[a.category]} className="mt-6" />
            <h1 className="mt-4 text-5xl leading-[0.92] md:text-7xl">{a.title}</h1>
            <p className="mt-5 text-lg leading-relaxed text-[#cfc4d8]">{a.excerpt}</p>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t-2 border-dashed border-white/15 pt-5">
              <div>
                <p className="text-sm font-bold">{a.author}</p>
                <Meta a={a} />
              </div>
              <button type="button" onClick={copy} className="inline-flex items-center gap-2 border-2 border-white/25 px-4 py-2 font-label text-[11px] font-bold tracking-[0.1em] uppercase transition hover:border-rave-paper">
                {copied ? <Check className="size-4 text-rave-primary-text" /> : <Link2 className="size-4" />} {copied ? d.copied : d.copyLink}
              </button>
            </div>
          </div>
        </header>

        <div className="px-4">
          <div className="mx-auto -mt-2 max-w-5xl">
            <NewsImage a={a} eager clean className="aspect-[16/8] border-2 border-rave-ink shadow-[10px_10px_0_#F4C21F]" />
          </div>
          <div className="mx-auto max-w-3xl py-14">
            {a.body.map((b, i) =>
              'h' in b ? (
                <h2 key={i} className="mt-12 text-3xl leading-none md:text-4xl">
                  {b.h}
                </h2>
              ) : 'quote' in b ? (
                <blockquote key={i} className="my-10 border-l-4 border-rave-primary bg-[#1e1c1f] p-6 shadow-[5px_5px_0_#0b0a0c]">
                  <p className="font-display text-3xl leading-[1.05] uppercase md:text-4xl">“{b.quote}”</p>
                  <footer className="mt-3 font-label text-[11px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">— {b.by}</footer>
                </blockquote>
              ) : (
                <p key={i} className="mt-6 text-[17px] leading-[1.8] text-white/80 first:mt-0">
                  {b.p}
                </p>
              ),
            )}
          </div>
        </div>
      </article>

      <section className="border-t-2 border-dashed border-white/10 px-4 py-16">
        <div className="mx-auto max-w-[82.5rem]">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="text-4xl leading-none">{d.related}</h2>
            <Link to="/berita" className="rave-label text-white/70 hover:text-rave-primary-text">
              {d.allNews}
            </Link>
          </div>
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((n) => (
              <NewsCard key={n.slug} a={n} />
            ))}
          </div>
        </div>
      </section>
    </CompanyPage>
  );
}
