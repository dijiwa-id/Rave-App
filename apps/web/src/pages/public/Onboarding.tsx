import { POPULAR_GENRE_IDS, genreName as domainGenreName } from '@rave/domain/genres';
import { useMemo, useState, type ComponentType } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Disc3, Lock, MapPin, Mic2, Search, Sparkles, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { ArtistSummary, Me, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { cx, Spinner, toast } from '@/components/ui';
import { dict, useDict } from '@/lib/i18n';
import { useApplyDashboardTheme, useDashboardTheme } from '@/lib/theme';

/**
 * Onboarding fan berbasis selera (REQ-IAM-02): kota → genre → ≥3 artis.
 * Mengikuti tema dasbor seperti halaman Login. Desktop: daftar langkah + ringkasan pilihan di kiri;
 * mobile: progres di atas dan bilah aksi lengket di bawah. Artis yang cocok dengan genre/kota pilihan diurutkan lebih dulu.
 */

/** Nilai kota disimpan apa adanya (termasuk 'Lainnya'); hanya label yang diterjemahkan. */
const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo', 'Palembang', 'Lainnya'];
const FALLBACK_GENRES = POPULAR_GENRE_IDS;
const MIN_ARTISTS = 3;

type StepId = 'city' | 'genre' | 'artist';
const STEPS: { id: StepId; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'city', icon: MapPin },
  { id: 'genre', icon: Disc3 },
  { id: 'artist', icon: Mic2 },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export default function Onboarding() {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const d = useDict('public').onboarding;
  const reduce = useReducedMotion();
  const { resolved } = useDashboardTheme();
  useApplyDashboardTheme(resolved);
  const dark = resolved === 'dark';

  const [step, setStep] = useState(0);
  const [city, setCity] = useState(user?.city ?? '');
  const [genres, setGenres] = useState<string[]>(user?.genres ?? []);
  const [artists, setArtists] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const genresQ = useQuery({ queryKey: ['genres'], queryFn: () => api<Paged<{ id: string; name: string }>>('/v1/catalog/genres'), enabled: !!token });
  const artistsQ = useQuery({
    queryKey: ['artists', 'onboarding'],
    queryFn: () => api<Paged<ArtistSummary>>('/v1/catalog/artists', { query: { limit: 50 } }),
    enabled: !!token,
  });

  const genreList = genresQ.data?.data?.length ? genresQ.data.data : FALLBACK_GENRES.map((g) => ({ id: g, name: domainGenreName(g) }));
  const genreName = (id: string) => genreList.find((g) => g.id === id)?.name ?? id;
  const [allGenres, setAllGenres] = useState(false);
  const allArtists = artistsQ.data?.data ?? [];

  // Artis yang cocok dengan genre & kota pilihan naik ke atas (urutan katalog dipertahankan untuk skor sama).
  const ranked = useMemo(() => {
    const score = (a: ArtistSummary) => a.genres.filter((g) => genres.includes(g)).length * 2 + (city && a.city === city ? 1 : 0);
    return allArtists.map((a, i) => ({ a, s: score(a), i })).sort((x, y) => y.s - x.s || x.i - y.i);
  }, [allArtists, genres, city]);
  const term = q.trim().toLowerCase();
  const visible = term ? ranked.filter(({ a }) => a.name.toLowerCase().includes(term)) : ranked;
  const picked = artists.map((id) => allArtists.find((a) => a.id === id)).filter((a): a is ArtistSummary => !!a);

  if (!token) return <Navigate to="/login?next=/onboarding" replace />;

  const valid: Record<StepId, boolean> = { city: !!city, genre: genres.length > 0, artist: artists.length >= MIN_ARTISTS };
  const current = STEPS[step]!.id;
  const isLast = step === STEPS.length - 1;
  // Langkah bisa dibuka bila semua langkah sebelumnya valid.
  const reachable = (i: number) => STEPS.slice(0, i).every((s) => valid[s.id]);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const summary: Record<StepId, string> = {
    city: city ? (city === 'Lainnya' ? d.otherCity : city) : d.notChosen,
    genre: genres.length ? d.genresCount(genres.length) : d.notChosen,
    artist: d.selected(artists.length),
  };
  const hint: Record<StepId, string> = {
    city: city ? d.cityHintDone : d.cityHint,
    genre: genres.length ? d.genresCount(genres.length) : d.genreHint,
    artist: artists.length >= MIN_ARTISTS ? d.artistReady : d.artistRemaining(MIN_ARTISTS - artists.length),
  };

  async function finish() {
    setBusy(true);
    try {
      const me = await api<Me>('/v1/me/onboarding', { body: { city, genres, artist_ids: artists } });
      setUser(me);
      toast.success(dict('public').onboarding.saved);
      nav(params.get('next') || '/app', { replace: true });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (!valid[current] || busy) return;
    if (isLast) void finish();
    else setStep(step + 1);
  }

  const progress = ((step + (valid[current] ? 1 : 0)) / STEPS.length) * 100;
  const pane = {
    initial: reduce ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? undefined : { opacity: 0, y: -6 },
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
  };
  const option = (on: boolean) =>
    cx(
      'relative flex items-center gap-2 rounded-none border-2 text-left text-sm font-bold transition focus-visible:ring-4 focus-visible:ring-rave-accent/25 focus-visible:outline-none',
      on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink shadow-[inset_0_-3px_0_var(--color-rave-primary)]' : 'border-b2b-line bg-b2b-card text-b2b-ink hover:border-b2b-ink/50',
    );

  return (
    <div className="b2b-canvas flex min-h-full flex-col bg-b2b-bg text-b2b-ink">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8 md:py-5">
        <RaveLogo dark={!dark} className="h-8 md:h-9" />
        <span className="font-label text-[11px] font-bold tracking-[0.14em] text-b2b-muted uppercase">{d.stepOf(step + 1, STEPS.length)}</span>
      </header>

      {/* Progres tipis (semua ukuran layar) */}
      <div className="mx-auto w-full max-w-6xl px-4 md:px-8" aria-hidden>
        <div className="h-1 w-full bg-b2b-line">
          <div className="h-full bg-rave-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 pt-6 pb-28 md:px-8 md:pt-8 lg:grid-cols-[300px_1fr] lg:gap-10 lg:pb-12">
        {/* Kiri: sapaan + daftar langkah dengan ringkasan pilihan */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <p className="font-label text-[11px] font-bold tracking-[0.16em] text-b2b-muted uppercase">{user?.display_name ? d.greeting(user.display_name) : d.greetingAnon}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-balance md:text-4xl">{d.title}</h1>
          <p className="mt-2 text-sm text-b2b-muted">{d.lead}</p>

          <ol className="mt-6 grid grid-cols-3 gap-2 lg:mt-8 lg:grid-cols-1" aria-label={d.stepsLabel}>
            {STEPS.map((s, i) => {
              const active = i === step;
              const done = valid[s.id] && i !== step;
              const can = reachable(i);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!can}
                    onClick={() => setStep(i)}
                    aria-current={active ? 'step' : undefined}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-none border-2 p-2.5 text-left transition lg:p-3',
                      active ? 'border-b2b-ink bg-b2b-card' : 'border-transparent hover:border-b2b-line',
                      !can && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-8 shrink-0 place-items-center border-2 text-xs font-black',
                        active ? 'border-b2b-ink bg-rave-primary text-rave-ink' : done ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted',
                      )}
                    >
                      {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold sm:text-sm">{d.steps[s.id]}</span>
                      <span className="hidden truncate text-xs text-b2b-muted sm:block">{summary[s.id]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <p className="mt-8 hidden items-start gap-2 text-xs leading-relaxed text-b2b-muted lg:flex">
            <Lock className="mt-0.5 size-3.5 shrink-0" /> {d.privacyNote}
          </p>
        </aside>

        {/* Kanan: konten langkah */}
        <section className="b2b-surface b2b-accent-top relative flex min-w-0 flex-col rounded-none border border-b2b-line">
          <div className="flex-1 p-5 sm:p-8">
            <AnimatePresence mode="wait" initial={false}>
              {current === 'city' && (
                <motion.div key="city" {...pane}>
                  <h2 className="text-xl font-black tracking-tight sm:text-2xl">{d.cityTitle}</h2>
                  <p className="mt-1 text-sm text-b2b-muted">{d.cityBody}</p>
                  <div role="radiogroup" aria-label={d.cityTitle} className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {CITIES.map((c) => {
                      const on = city === c;
                      return (
                        <button key={c} type="button" role="radio" aria-checked={on} onClick={() => setCity(c)} className={cx(option(on), 'h-12 px-3')}>
                          <MapPin className={cx('size-4 shrink-0', on ? 'text-rave-primary' : 'text-b2b-muted')} />
                          <span className="truncate">{c === 'Lainnya' ? d.otherCity : c}</span>
                          {on && <Check className="ml-auto size-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {current === 'genre' && (
                <motion.div key="genre" {...pane}>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-black tracking-tight sm:text-2xl">{d.genreTitle}</h2>
                      <p className="mt-1 text-sm text-b2b-muted">{d.genreBody}</p>
                    </div>
                    {genres.length > 0 && (
                      <button type="button" onClick={() => setGenres([])} className="text-xs font-bold text-b2b-muted underline-offset-4 hover:text-b2b-ink hover:underline">
                        {d.clear}
                      </button>
                    )}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={d.genreTitle}>
                    {(allGenres ? genreList : genreList.filter((g) => POPULAR_GENRE_IDS.includes(g.id) || genres.includes(g.id))).map((g) => {
                      const on = genres.includes(g.id);
                      return (
                        <button key={g.id} type="button" aria-pressed={on} onClick={() => toggle(genres, setGenres, g.id)} className={cx(option(on), 'h-10 px-3.5')}>
                          {on ? <Check className="size-3.5" /> : <span className="size-3.5" aria-hidden />}
                          <span className="capitalize">{g.name}</span>
                        </button>
                      );
                    })}
                    {genreList.length > POPULAR_GENRE_IDS.length && (
                      <button type="button" onClick={() => setAllGenres((v) => !v)} aria-expanded={allGenres} className="h-10 px-3.5 text-xs font-bold text-b2b-muted underline underline-offset-4 hover:text-b2b-ink">
                        {allGenres ? d.fewerGenres : d.allGenres(genreList.length)}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {current === 'artist' && (
                <motion.div key="artist" {...pane}>
                  <h2 className="text-xl font-black tracking-tight sm:text-2xl">{d.artistTitle}</h2>
                  <p className="mt-1 text-sm text-b2b-muted">
                    {d.artistBody}
                    {ranked.some((r) => r.s > 0) && (
                      <span className="ml-1 inline-flex items-center gap-1 align-middle">
                        <span className="grid size-4 place-items-center rounded-full bg-b2b-ink text-b2b-on-ink" aria-hidden>
                          <Sparkles className="size-2.5" />
                        </span>
                        {d.matchLegend}
                      </span>
                    )}
                  </p>

                  <label className="relative mt-5 block">
                    <span className="sr-only">{d.searchArtist}</span>
                    <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-b2b-muted" />
                    <input
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={d.searchArtist}
                      className="h-11 w-full rounded-none border border-b2b-line bg-b2b-card pr-4 pl-10 text-sm text-b2b-ink transition placeholder:text-b2b-muted/70 focus:border-rave-accent/60 focus:ring-4 focus:ring-rave-accent/12 focus:outline-none"
                    />
                  </label>

                  {/* Baki pilihan: hapus cepat tanpa mencari ulang di grid */}
                  {picked.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-2" aria-label={d.selected(artists.length)}>
                      {picked.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => toggle(artists, setArtists, a.id)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-none border border-b2b-ink bg-b2b-ink pr-2 pl-1 text-xs font-bold text-b2b-on-ink transition hover:opacity-85"
                            aria-label={d.remove(a.name)}
                          >
                            {a.image_url ? <img src={a.image_url} alt="" className="size-6 rounded-full object-cover" /> : <span className="grid size-6 place-items-center rounded-full bg-rave-primary text-[10px] text-rave-ink">{initials(a.name)}</span>}
                            <span className="max-w-[9rem] truncate">{a.name}</span>
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-6">
                    {artistsQ.isLoading ? (
                      <div className="grid place-items-center py-16">
                        <Spinner />
                      </div>
                    ) : artistsQ.isError ? (
                      <div className="grid place-items-center gap-3 py-12 text-center">
                        <p className="text-sm text-b2b-muted">{d.artistsError}</p>
                        <button type="button" onClick={() => artistsQ.refetch()} className="h-9 border-2 border-b2b-ink px-4 text-xs font-bold">
                          {d.retry}
                        </button>
                      </div>
                    ) : visible.length === 0 ? (
                      <p className="py-12 text-center text-sm text-b2b-muted">{d.noArtistMatch}</p>
                    ) : (
                      <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5">
                        {visible.map(({ a, s }) => {
                          const on = artists.includes(a.id);
                          return (
                            <li key={a.id}>
                              <button type="button" aria-pressed={on} onClick={() => toggle(artists, setArtists, a.id)} className="group w-full rounded-none p-1 text-center focus-visible:ring-4 focus-visible:ring-rave-accent/25 focus-visible:outline-none">
                                <span className="relative mx-auto block aspect-square w-full max-w-[6.5rem]">
                                  {a.image_url ? (
                                    <img src={a.image_url} alt="" loading="lazy" className={cx('size-full rounded-full object-cover transition group-hover:scale-[1.03] motion-reduce:transition-none', on && 'ring-4 ring-rave-primary ring-offset-2 ring-offset-b2b-card')} />
                                  ) : (
                                    <span className={cx('grid size-full place-items-center rounded-full bg-b2b-ink/10 text-lg font-black text-b2b-muted', on && 'ring-4 ring-rave-primary ring-offset-2 ring-offset-b2b-card')}>{initials(a.name)}</span>
                                  )}
                                  {on && (
                                    <span className="absolute right-0 bottom-0 grid size-7 place-items-center rounded-full border-2 border-b2b-card bg-rave-primary text-rave-ink">
                                      <Check className="size-4" />
                                    </span>
                                  )}
                                  {!on && s > 0 && !term && (
                                    <span className="absolute top-0 right-0 grid size-6 place-items-center rounded-full border-2 border-b2b-card bg-b2b-ink text-b2b-on-ink" title={d.matchTaste}>
                                      <Sparkles className="size-3" />
                                    </span>
                                  )}
                                </span>
                                <span className="mt-2 flex items-center justify-center gap-1 text-xs font-bold sm:text-[13px]">
                                  <span className="truncate">{a.name}</span>
                                  {a.verified && <BadgeCheck className="size-3.5 shrink-0 text-rave-accent" aria-label={d.verified} />}
                                </span>
                                <span className="block truncate text-[11px] text-b2b-muted">
                                  {a.genres[0] ? genreName(a.genres[0]) : a.city ?? ''}
                                  {a.monthly_listeners > 0 && <span className="hidden sm:inline"> · {d.listeners(fmt.compact(a.monthly_listeners))}</span>}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Bilah aksi: lengket di bawah layar pada mobile, footer kartu pada desktop */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-b2b-line bg-b2b-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:bg-transparent lg:px-8 lg:py-5 lg:backdrop-blur-none">
            <div className="mx-auto flex max-w-6xl items-center gap-3">
              {step > 0 ? (
                <button type="button" onClick={() => setStep(step - 1)} disabled={busy} className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-bold text-b2b-muted transition hover:text-b2b-ink disabled:opacity-50 sm:px-3">
                  <ArrowLeft className="size-4" /> <span className="hidden sm:inline">{d.back}</span>
                </button>
              ) : (
                <span className="hidden sm:block sm:w-3" />
              )}
              <p className={cx('min-w-0 flex-1 truncate text-xs font-semibold sm:text-sm', valid[current] ? 'text-b2b-ink' : 'text-b2b-muted')} aria-live="polite">
                {hint[current]}
              </p>
              <button
                type="button"
                onClick={next}
                disabled={!valid[current] || busy}
                className="group inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-none bg-b2b-ink px-5 text-sm font-bold text-b2b-on-ink transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 sm:min-w-36"
              >
                {busy ? d.saving : isLast ? d.finish : d.next}
                {!busy && (isLast ? <Check className="size-4" /> : <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />)}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
