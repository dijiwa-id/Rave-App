import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock3 } from 'lucide-react';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import halftone from '@/assets/brand/paper-halftone.webp';
import { fmtNewsDate, type NewsArticle } from './news-data';

/** Foto berita: hitam-putih kontras + tinta ungu; daftar memakai halftone tipis, `clean` = gradasi halus tanpa titik. */
export function NewsImage({ a, className, eager, clean }: { a: NewsArticle; className?: string; eager?: boolean; clean?: boolean }) {
  return (
    <div className={cx('relative overflow-hidden bg-rave-plum', className)}>
      <img src={a.image} alt={a.imageAlt} loading={eager ? 'eager' : 'lazy'} className="size-full object-cover grayscale contrast-[1.2] transition duration-700 group-hover:scale-[1.04]" />
      <span className="absolute inset-0 bg-rave-purple opacity-30 mix-blend-color" aria-hidden />
      {clean ? (
        <span className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(24,24,24,0.35))]" aria-hidden />
      ) : (
        <span className="absolute inset-0 bg-cover bg-center opacity-25 mix-blend-multiply" style={{ backgroundImage: `url(${halftone})` }} aria-hidden />
      )}
    </div>
  );
}

/** Label kategori (mono, mustard). */
export function CategoryTag({ c, className }: { c: string; className?: string }) {
  return <span className={cx('inline-block border-2 border-rave-ink bg-rave-primary px-2 py-0.5 font-label text-[10px] font-bold tracking-[0.1em] text-rave-ink uppercase', className)}>{c}</span>;
}

export function Meta({ a, light }: { a: NewsArticle; light?: boolean }) {
  const d = useDict('company').news;
  return (
    <p className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 font-label text-[10.5px] font-bold tracking-[0.08em] uppercase', light ? 'text-white/55' : 'text-white/50')}>
      <span>{fmtNewsDate(a.date)}</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <Clock3 className="size-3" /> {d.readMin(a.readMin)}
      </span>
    </p>
  );
}

/** Kartu berita: tajam (garis tinta + bayangan sablon), rapi untuk grid editorial — tanpa kemiringan. */
export function NewsCard({ a }: { a: NewsArticle }) {
  const d = useDict('company').news;
  return (
    <Link
      to={`/berita/${a.slug}`}
      className="group flex h-full flex-col border-2 border-rave-ink bg-[#1e1c1f] shadow-[5px_5px_0_#0b0a0c] transition duration-300 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-rave-primary/60 hover:shadow-[8px_8px_0_#F4C21F] focus-visible:shadow-[8px_8px_0_#F4C21F]"
    >
      <div className="relative">
        <NewsImage a={a} className="aspect-[16/10] border-b-2 border-rave-ink" />
        <CategoryTag c={d.categories[a.category]} className="absolute top-3 left-3" />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <Meta a={a} />
        <h3 className="mt-3 text-lg leading-snug font-bold text-rave-paper transition group-hover:text-rave-primary-text">{a.title}</h3>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/60">{a.excerpt}</p>
        <span className="mt-auto flex items-center justify-between pt-5 font-label text-[11px] font-bold tracking-[0.1em] text-white/70 uppercase">
          {d.read}
          <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-rave-primary-text" />
        </span>
      </div>
    </Link>
  );
}
