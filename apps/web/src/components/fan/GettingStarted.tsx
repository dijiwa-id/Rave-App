import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Heart, ListMusic, Mic2, Radio, Search, Ticket } from 'lucide-react';
import { useDict } from '@/lib/i18n';
import { cx } from '@/components/ui';
import { PlayFab } from '@/components/fan';
import { useMediaPlaying } from '@/components/fan/usePlayMedia';


type StepId = 'play' | 'like' | 'playlist' | 'follow' | 'live' | 'events';
const STEP_META: Record<StepId, { href: string; icon: any; tone: string }> = {
  play: { href: '/app/search', icon: Search, tone: 'gs-card--mustard' },
  like: { href: '/app/liked', icon: Heart, tone: 'gs-card--purple' },
  playlist: { href: '/app/library', icon: ListMusic, tone: 'gs-card--teal' },
  follow: { href: '/app?tab=artists', icon: Mic2, tone: 'gs-card--berry' },
  live: { href: '/app/live', icon: Radio, tone: 'gs-card--plum' },
  events: { href: '/app/events', icon: Ticket, tone: 'gs-card--ink' },
};

/** Slider generik satu-kartu-per-tampilan: indeks dari posisi scroll, panah & titik menggulir ke kartu. */
function useSnapSlider(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth + 24)));
  }, []);
  const go = useCallback(
    (i: number) => {
      const el = ref.current;
      if (!el) return;
      const t = Math.max(0, Math.min(count - 1, i));
      el.scrollTo({ left: t * (el.clientWidth + 24), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
    [count],
  );
  return { ref, index, onScroll, go };
}

function NavArrows({ index, count, go, label }: { index: number; count: number; go: (i: number) => void; label: { prev: string; next: string } }) {
  return (
    <div className="flex gap-1.5">
      <button type="button" className="shelf-nav" onClick={() => go(index - 1)} disabled={index <= 0} aria-label={label.prev}>
        <ChevronLeft className="size-4" />
      </button>
      <button type="button" className="shelf-nav" onClick={() => go(index + 1)} disabled={index >= count - 1} aria-label={label.next}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/**
 * Banner "Mulai di RAVE" (referensi: Getting started). Kiri: slider langkah bernomor (satu kartu per tampilan,
 * warna RAVE berbeda tiap langkah, kolase sampul miring, CTA + "Tips berikutnya", titik & panah).
 * Kanan (`aside`): rak pendamping, mis. "Pilihan untuk {nama}". Berdampingan di panel lebar, bertumpuk di sempit
 * (container query). Permanen di beranda (tab Semua); langkah terakhir kembali ke langkah 1.
 */
export function GettingStarted({ covers, liveOn, eventsOn, aside }: { covers: string[]; liveOn: boolean; eventsOn: boolean; aside?: ReactNode }) {
  const d = useDict('fan').home.gs;
  const c = useDict('common').layout;
  const ids: StepId[] = ['play', 'like', 'playlist', 'follow', ...(liveOn ? (['live'] as StepId[]) : []), ...(eventsOn ? (['events'] as StepId[]) : [])];
  const { ref, index, onScroll, go } = useSnapSlider(ids.length);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => go(index));
    ro.observe(el);
    return () => ro.disconnect();
  }, [go, index, ref]);

  return (
    <div className="gs-wrap @container mb-12">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 @[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-roledescription="carousel" aria-label={d.region} className="min-w-0">
          <div className="gs-head">
            <h2 className="min-w-0 truncate text-[1.75rem] leading-none text-white md:text-3xl">{d.title}</h2>
            <div className="flex items-center gap-3">
              <div className="hidden gap-1.5 sm:flex">
                {ids.map((id, i) => (
                  <button key={id} type="button" onClick={() => go(i)} aria-label={d.goTo(i + 1)} aria-current={i === index ? 'step' : undefined} className={cx('gs-dot', i === index && 'gs-dot--on')} />
                ))}
              </div>
              <NavArrows index={index} count={ids.length} go={go} label={{ prev: c.back, next: c.forward }} />
            </div>
          </div>
          <div
            ref={ref}
            onScroll={onScroll}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') (e.preventDefault(), go(index + 1));
              else if (e.key === 'ArrowLeft') (e.preventDefault(), go(index - 1));
            }}
            className="gs-track focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rave-primary"
          >
            {ids.map((id, i) => {
              const m = STEP_META[id];
              const s = d.steps[id];
              const last = i === ids.length - 1;
              return (
                <article key={id} aria-roledescription="slide" aria-label={d.step(i + 1, ids.length)} aria-hidden={i !== index} className={cx('gs-card @container/card', m.tone)}>
                  <div className="relative z-10 flex h-full max-w-[min(100%,26rem)] flex-col">
                    <p className="gs-kicker">
                      <m.icon className="size-3.5" /> {d.step(i + 1, ids.length)}
                    </p>
                    <h3 className="mt-3 font-display text-[clamp(2rem,6cqw,3.1rem)] leading-[0.9] uppercase">
                      {s.title}
                    </h3>
                    <p className="mt-3 max-w-[22rem] text-[15px] leading-snug opacity-85">{s.body}</p>
                    <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-6">
                      <Link to={m.href} tabIndex={i === index ? 0 : -1} className="gs-cta rave-btn">
                        {s.cta} <ArrowRight className="size-4" />
                      </Link>
                      <button type="button" tabIndex={i === index ? 0 : -1} onClick={() => go(last ? 0 : i + 1)} className="gs-more">
                        {last ? d.restart : d.next}
                      </button>
                    </div>
                  </div>
                  {/* kolase sampul miring — disembunyikan bila kartu sempit */}
                  <div aria-hidden className="gs-collage">
                    {[0, 1, 2].map((k) => {
                      const src = covers[(i + k) % Math.max(1, covers.length)];
                      return src ? <img key={k} src={src} alt="" loading="lazy" className={`gs-collage__img gs-collage__img--${k}`} /> : <span key={k} className={`gs-collage__img gs-collage__img--${k} bg-rave-highlight`} />;
                    })}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-3 flex justify-center gap-1.5 sm:hidden">
            {ids.map((id, i) => (
              <button key={id} type="button" onClick={() => go(i)} aria-label={d.goTo(i + 1)} aria-current={i === index ? 'step' : undefined} className={cx('gs-dot', i === index && 'gs-dot--on')} />
            ))}
          </div>
        </section>
        {aside && <div className="min-w-0">{aside}</div>}
      </div>
    </div>
  );
}

/** Rak pendamping ringkas: 2 kartu per tampilan (3 di panel lebar), kicker + judul + panah. */
export function MiniShelf({ kicker, title, href, children, tiles }: { kicker?: string; title: string; href?: string; children: ReactNode[]; tiles?: boolean }) {
  const c = useDict('common');
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
  }, [measure, children.length]);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth, behavior: 'smooth' });
  return (
    <section className="@container/pick min-w-0">
      <div className="gs-head">
        <div className="min-w-0">
          {kicker && <p className="rave-label mb-1 text-rave-muted">{kicker}</p>}
          <h2 className="truncate text-[1.75rem] leading-none text-white md:text-3xl">{href ? <Link to={href} className="hover:text-rave-primary-text">{title}</Link> : title}</h2>
        </div>
        <div className="flex items-center gap-3">
          {href && (
            <Link to={href} className="rave-label text-rave-muted transition hover:text-rave-primary-text">
              {c.fan.seeAll}
            </Link>
          )}
          {!(edge.start && edge.end) && (
            <div className="hidden gap-1.5 md:flex">
              <button type="button" onClick={() => page(-1)} disabled={edge.start} aria-label={c.layout.back} className="shelf-nav">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" onClick={() => page(1)} disabled={edge.end} aria-label={c.layout.forward} className="shelf-nav">
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className={cx('shelf shelf--mini', tiles && 'shelf--tiles')} data-start={edge.start} data-end={edge.end}>
        <div ref={ref} onScroll={measure} className="shelf__track">
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * Kartu "Pilihan untuk …" berbentuk tile penuh (tinggi = banner Mulai di RAVE): sampul mengisi kartu, judul & subjudul
 * di bawah dengan gradasi, tombol putar/jeda kotak RAVE.
 */
export function PickTile({ title, subtitle, image, href, playKey, onPlay, label }: { title: string; subtitle?: string; image?: string | null; href: string; playKey: string; onPlay: () => void; label: string }) {
  const { active } = useMediaPlaying(playKey);
  return (
    <Link to={href} className={cx('pick-tile group', active && 'pick-tile--on')}>
      {image ? <img src={image} alt="" loading="lazy" className="pick-tile__img" /> : <span className="pick-tile__img rave-dots bg-gradient-to-br from-rave-purple to-rave-plum" />}
      <span className="pick-tile__shade" aria-hidden />
      <span className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-lg font-bold', active ? 'text-rave-primary-text' : 'text-white')}>{title}</span>
          {subtitle && <span className="mt-0.5 line-clamp-2 text-sm text-white/75">{subtitle}</span>}
        </span>
        <PlayFab
          size="sm"
          playKey={playKey}
          label={label}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay();
          }}
          className={cx('transition', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
        />
      </span>
    </Link>
  );
}
