import { useEffect, useState, type ComponentType, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, Headphones, Landmark, MapPin, Mic2, Monitor, Moon, Radio, Search, ShieldCheck, Sun, Ticket, TrendingUp } from 'lucide-react';
import { AppleLogo, Facebook } from '@/components/fan/BrandIcons';
import CodeSlots, { type CodeSlotsStatus } from '@/components/reactbits/CodeSlots';
import { api, fmt } from '@/lib/api';
import type { EventSummary, LiveStream, Paged, TokenResponse } from '@/lib/types';
import { isSuperAdmin, useAuth } from '@/stores/auth';
import { RaveLogo, RaveMark } from '@/components/ui/RaveLogo';
import { Vinyl } from './Vinyl';
import { cx, toast } from '@/components/ui';
import { useModule } from '@/components/ModuleGate';
import { setting, usePlatformConfig } from '@/lib/platform';
import { dict, localeTag, useDict } from '@/lib/i18n';
import { useApplyDashboardTheme, useDashboardTheme, useThemePref, type ThemeChoice } from '@/lib/theme';

/**
 * Masuk / daftar RAVE (OTP email). Mengikuti tema dasbor (terang/gelap/sistem — Super Admin & preferensi pengguna)
 * dengan gaya RAVE glass. Pilihan "Masuk sebagai" menentukan tujuan setelah login (aplikasi dengar, Artist Studio,
 * Promotor Hub) dan menyesuaikan narasi; panel samping menampilkan data nyata (siaran live & event terdekat).
 */

type Intent = 'fan' | 'artist' | 'promotor';

/** Pilihan "Masuk sebagai"; label dari kamus `login.intents`. */
const INTENTS: { id: Intent; icon: ComponentType<{ className?: string }>; home: string }[] = [
  { id: 'fan', icon: Headphones, home: '/app' },
  { id: 'artist', icon: Mic2, home: '/studio' },
  { id: 'promotor', icon: Ticket, home: '/promotor' },
];

/** Ikon keunggulan per segmen; teksnya di kamus `login.copy.<intent>.perks` (dipasangkan berdasarkan indeks). */
const PERK_ICONS: Record<Intent, ComponentType<{ className?: string }>[]> = {
  fan: [Headphones, Radio, Ticket],
  artist: [TrendingUp, CalendarDays, Landmark],
  promotor: [Search, ShieldCheck, Ticket],
};

const DEMO: { email: string; label: 'fan' | 'premium' | 'artist' | 'manager' | 'promotor' | 'admin' | 'superAdmin'; intent: Intent }[] = [
  { email: 'fan@rave.id', label: 'fan', intent: 'fan' },
  { email: 'premium@rave.id', label: 'premium', intent: 'fan' },
  { email: 'artis@rave.id', label: 'artist', intent: 'artist' },
  { email: 'manajer@rave.id', label: 'manager', intent: 'artist' },
  { email: 'promotor@rave.id', label: 'promotor', intent: 'promotor' },
  { email: 'admin@rave.id', label: 'admin', intent: 'fan' },
  { email: 'superadmin@rave.id', label: 'superAdmin', intent: 'fan' },
];

const RESEND_COOLDOWN = 30; // detik — jeda UX; batas sebenarnya ditegakkan IAM (security.otp_max_per_window)
const LAST_EMAIL = 'rave-last-email';
const readLast = () => {
  try {
    return localStorage.getItem(LAST_EMAIL) ?? '';
  } catch {
    return '';
  }
};

function intentFrom(params: URLSearchParams): Intent {
  const as = params.get('as');
  if (as === 'artist' || as === 'promotor' || as === 'fan') return as;
  const next = params.get('next') ?? '';
  if (next.startsWith('/studio')) return 'artist';
  if (next.startsWith('/promotor')) return 'promotor';
  return 'fan';
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Tombol tema ringkas: terang → gelap → ikuti sistem (disembunyikan bila Super Admin mengunci tema). */
function ThemeToggle() {
  const { choice, allowUser, platformDefault } = useDashboardTheme();
  const setPref = useThemePref((s) => s.set);
  const d = useDict('public').login.theme;
  if (!allowUser) return null;
  const order: ThemeChoice[] = ['light', 'dark', 'system'];
  const nextChoice = order[(order.indexOf(choice) + 1) % order.length];
  const Icon = choice === 'dark' ? Moon : choice === 'system' ? Monitor : Sun;
  const label = { light: d.light, dark: d.dark, system: d.system }[choice];
  return (
    <button
      onClick={() => setPref(nextChoice === platformDefault ? null : nextChoice)}
      className="b2b-chrome inline-flex h-9 items-center gap-2 rounded-none border border-b2b-line px-3 text-xs font-bold text-b2b-muted transition hover:text-b2b-ink"
      aria-label={d.aria(label)}
    >
      <Icon className="size-4" /> <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Panel kiri: narasi per segmen + data nyata (siaran yang sedang live, event terdekat). */
function Showcase({ intent }: { intent: Intent }) {
  const liveOn = useModule('live');
  const ticketing = useModule('ticketing');
  const live = useQuery({
    queryKey: ['live-streams', 'live', 'login'],
    queryFn: () => api<{ data: LiveStream[] }>('/v1/live/streams', { query: { status: 'live', limit: 1 } }),
    enabled: liveOn,
    refetchInterval: 30_000,
    retry: false,
  });
  const events = useQuery({
    queryKey: ['events', 'login'],
    queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { limit: 3 } }),
    enabled: ticketing,
    retry: false,
  });
  const onAir = live.data?.data?.[0] ?? null;
  const next = (events.data?.data ?? []).find((e) => new Date(e.starts_at).getTime() > Date.now()) ?? null;
  const d = useDict('public').login;
  const copy = d.copy[intent];
  const c = { ...copy, perks: PERK_ICONS[intent].map((icon, i) => ({ icon, t: copy.perks[i] })) };
  const reduce = useReducedMotion();

  return (
    <div className="rave-glass-strong relative isolate flex h-full flex-col overflow-hidden rounded-none bg-[#170b1c] p-8 text-white xl:p-10">
      {/* Piringan RAVE berputar pelan di tepi kanan — mengisi ruang tanpa mengganggu teks. */}
      <Vinyl className="absolute top-[46%] -right-[38%] -z-10 w-[78%] opacity-70" discClassName="animate-[rave-spin_14s_linear_infinite] motion-reduce:animate-none" />
      <div className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(244,194,31,0.45),transparent)] blur-2xl" aria-hidden />
      <RaveMark className="size-11" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={intent}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10"
        >
          <p className="text-xs font-bold tracking-[0.18em] text-white/70 uppercase">{c.kicker}</p>
          <h2 className="rave-display mt-4 !font-display text-5xl !uppercase text-balance xl:text-6xl">{c.title}</h2>
          <p className="mt-4 max-w-md text-white/80">{c.body}</p>
          <ul className="mt-7 space-y-3">
            {c.perks.map((p) => (
              <li key={p.t} className="flex items-center gap-3 text-sm font-semibold">
                <span className="grid size-8 shrink-0 place-items-center rounded-none border border-white/20 bg-black/20">
                  <p.icon className="size-4" />
                </span>
                {p.t}
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>

      <div className="relative mt-auto grid gap-3 pt-10">
        {onAir && (
          <Link to={`/app/live/${onAir.id}`} className="flex items-center gap-3 rounded-none border border-white/20 bg-black/30 p-3 backdrop-blur transition hover:bg-black/40">
            <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-red-600">
              <Radio className="size-4" />
              <span className="absolute inset-0 animate-ping rounded-full bg-red-600/50 motion-reduce:animate-none" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold tracking-wider text-red-300 uppercase">{d.liveWatching(fmt.compact(Math.max(onAir.viewers, 1)))}</span>
              <span className="block truncate text-sm font-bold">{onAir.title}</span>
            </span>
          </Link>
        )}
        {next && (
          <Link to={`/e/${next.slug}`} className="flex items-center gap-3 rounded-none border border-white/20 bg-black/30 p-3 backdrop-blur transition hover:bg-black/40">
            <span className="grid size-11 shrink-0 place-items-center rounded-none bg-white text-center leading-none text-black">
              <span>
                <span className="block text-base font-black">{new Date(next.starts_at).getDate()}</span>
                <span className="block text-[9px] font-bold uppercase">{new Date(next.starts_at).toLocaleDateString(localeTag(), { month: 'short' })}</span>
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold tracking-wider text-white/70 uppercase">{d.nextEvent}</span>
              <span className="block truncate text-sm font-bold">{next.title}</span>
              <span className="flex items-center gap-1 truncate text-xs text-white/70">
                <MapPin className="size-3" /> {next.city}
                {next.min_price != null && <> · {d.from(fmt.idrShort(next.min_price))}</>}
              </span>
            </span>
          </Link>
        )}
        <p className="text-sm font-bold text-white/85">{c.cta}</p>
      </div>
    </div>
  );
}

export default function Login() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const pub = useDict('public');
  const d = pub.login;
  const reduce = useReducedMotion();
  const setSession = useAuth((s) => s.setSession);
  const { resolved } = useDashboardTheme();
  useApplyDashboardTheme(resolved);
  const dark = resolved === 'dark';
  // Super Admin bisa menutup pendaftaran (general.registrations_open) — IAM menolak akun baru, jadi jangan menjanjikannya.
  const registrationsOpen = setting(usePlatformConfig(), 'general.registrations_open', true);
  const signup = params.get('signup') === '1' && registrationsOpen;
  const [intent, setIntent] = useState<Intent>(() => intentFrom(params));
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState(readLast);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<CodeSlotsStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (step !== 'otp') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);
  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  const cooldown = Math.max(0, Math.round((resendAt - now) / 1000));

  function done(t: TokenResponse, as: Intent = intent) {
    setSession(t);
    try {
      localStorage.setItem(LAST_EMAIL, t.user.email ?? email.trim());
    } catch {
      /* penyimpanan diblokir — abaikan */
    }
    const next = params.get('next');
    // Tanpa ?next: pilihan "Masuk sebagai" artis/promotor → dasbornya (tanpa org → onboarding org di sana);
    // pendengar → Super Admin ke dasbor platform, admin ke Back Office, lainnya ke aplikasi dengar.
    const roleHome = isSuperAdmin(t.user) ? '/admin/platform' : t.user.roles.includes('admin') ? '/admin' : '/app';
    const home = as === 'fan' ? roleHome : INTENTS.find((i) => i.id === as)!.home;
    nav(!t.user.onboarded ? `/onboarding?next=${encodeURIComponent(next || home)}` : next || home, { replace: true });
  }

  async function requestOtp(dest: string) {
    const r = await api<{ sent: boolean; expires_in?: number; dev_code?: string }>('/v1/auth/otp', { body: { channel: 'email', destination: dest }, auth: false });
    return r;
  }

  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const r = await requestOtp(email.trim());
      setDevCode(r.dev_code ?? null);
      setExpiresAt(Date.now() + (r.expires_in ?? 300) * 1000);
      setResendAt(Date.now() + RESEND_COOLDOWN * 1000);
      setNow(Date.now());
      setStep('otp');
      setCode('');
      setStatus('idle');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(c: string) {
    setBusy(true);
    try {
      const t = await api<TokenResponse>('/v1/auth/token', { body: { grant_type: 'otp', destination: email.trim(), code: c }, auth: false });
      setStatus('success');
      setTimeout(() => done(t), 350);
    } catch (err) {
      setStatus('error');
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function demo(d: (typeof DEMO)[number]) {
    setBusy(true);
    try {
      const r = await requestOtp(d.email);
      if (!r.dev_code) throw new Error(dict('public').login.devCodeUnavailable);
      const t = await api<TokenResponse>('/v1/auth/token', { body: { grant_type: 'otp', destination: d.email, code: r.dev_code }, auth: false });
      done(t, d.intent);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const soon = () => toast.info(d.socialSoon);
  const social = 'b2b-surface flex h-11 flex-1 items-center justify-center gap-2 rounded-none border border-b2b-line text-sm font-bold text-b2b-ink transition hover:-translate-y-0.5 hover:border-rave-accent/40';
  const step$ = {
    initial: reduce ? false : { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? undefined : { opacity: 0, x: -16 },
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const },
  };
  const heading = signup
    ? d.headingSignup[intent]
    : d.headingLogin[intent];

  return (
    <div className="b2b-canvas min-h-full bg-b2b-bg text-b2b-ink">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 md:px-8">
        <Link to="/" aria-label={pub.homeAria}>
          <RaveLogo dark={!dark} className="h-9" />
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-4 pb-12 md:px-8 lg:min-h-[calc(100dvh-5.5rem)] lg:grid-cols-[1.05fr_1fr] lg:items-stretch lg:pb-8">
        <div className="relative hidden lg:block">
          <Showcase intent={intent} />
        </div>

        <div className="flex items-center justify-center">
          <div className="b2b-surface b2b-accent-top relative w-full max-w-[460px] rounded-none border border-b2b-line p-6 sm:p-9">
            {/* Mode: Masuk | Daftar */}
            {registrationsOpen && step === 'email' && (
              <div role="tablist" aria-label={`${d.tabLogin} / ${d.tabSignup}`} className="mb-7 grid grid-cols-2 border-2 border-b2b-ink">
                {([false, true] as const).map((isSignup) => {
                  const on = signup === isSignup;
                  return (
                    <button
                      key={String(isSignup)}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => {
                        const p = new URLSearchParams(params);
                        if (isSignup) p.set('signup', '1');
                        else p.delete('signup');
                        setParams(p, { replace: true });
                      }}
                      className={cx(
                        'h-10 font-label text-[11.5px] font-bold tracking-[0.14em] uppercase transition',
                        on ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink',
                      )}
                    >
                      {isSignup ? d.tabSignup : d.tabLogin}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Langkah 01 Email → 02 Kode */}
            <div className="mb-5 flex items-center justify-between gap-3">
            <ol className="flex items-center gap-3 font-label text-[10.5px] font-bold tracking-[0.14em] uppercase" aria-label={d.stepLabel}>
              {[d.stepEmail, d.stepCode].map((label, i) => {
                const active = (i === 0 && step === 'email') || (i === 1 && step === 'otp');
                const done = i === 0 && step === 'otp';
                return (
                  <li key={label} className="flex items-center gap-3" aria-current={active ? 'step' : undefined}>
                    {i > 0 && <span className={cx('h-0.5 w-8', done || active ? 'bg-rave-primary' : 'bg-b2b-line')} aria-hidden />}
                    <span className={cx('flex items-center gap-1.5', active ? 'text-b2b-ink' : done ? 'text-b2b-muted' : 'text-b2b-muted/60')}>
                      <span className={cx('grid size-5 place-items-center border-2 text-[9.5px]', active ? 'border-b2b-ink bg-rave-primary text-rave-ink' : done ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line')}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
            {/* Stiker sapaan (fun, dekoratif) */}
            <span className="pointer-events-none shrink-0 rotate-[5deg] border-2 border-rave-ink bg-rave-primary px-2 pt-1 pb-0.5 text-center text-rave-ink shadow-[2px_2px_0_#0b0a0c]" aria-hidden>
              <span className="block font-display text-[15px] leading-none uppercase">{signup ? d.stickerSignup : d.stickerLogin}</span>
              <span className="block font-label text-[7.5px] font-bold tracking-[0.16em] uppercase">{d.stickerTop}</span>
            </span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {step === 'email' ? (
                <motion.div key="email" {...step$}>
                  <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{heading}</h1>
                  <p className="mt-2 text-sm text-b2b-muted">{signup ? d.subSignup : d.subLogin}</p>

                  <fieldset className="mt-7">
                    <legend className="mb-2 text-xs font-bold tracking-[0.14em] text-b2b-muted uppercase">{signup ? d.signupAs : d.loginAs}</legend>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup">
                      {INTENTS.map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          role="radio"
                          aria-checked={intent === i.id}
                          onClick={() => setIntent(i.id)}
                          className={cx(
                            'relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-none border-2 px-1.5 py-2 text-center text-[11px] leading-tight font-bold break-words transition sm:flex-row sm:gap-2 sm:text-[12px]',
                            intent === i.id
                              ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink shadow-[inset_0_-3px_0_var(--color-rave-primary)]'
                              : 'border-b2b-line text-b2b-muted hover:border-b2b-ink/40 hover:text-b2b-ink',
                          )}
                        >
                          <i.icon className="size-4 shrink-0" />
                          <span className="min-w-0">{d.intents[i.id]}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <form onSubmit={sendOtp} className="mt-6 space-y-4">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-bold">{d.emailLabel}</span>
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={d.emailPlaceholder}
                        className="h-12 w-full rounded-none border border-b2b-line bg-b2b-card px-4 text-b2b-ink transition placeholder:text-b2b-muted/70 focus:border-rave-accent/60 focus:ring-4 focus:ring-rave-accent/12 focus:outline-none"
                      />
                    </label>
                    <p className="text-xs leading-relaxed text-b2b-muted">
                      {d.weSend}{' '}
                      {registrationsOpen ? d.newHere : d.registrationsClosed}
                    </p>
                    <button disabled={busy} className="group flex h-12 w-full items-center justify-center gap-2 rounded-none bg-b2b-ink text-sm font-bold text-b2b-on-ink transition hover:scale-[1.01] disabled:opacity-60">
                      {busy ? d.sending : d.sendCode}
                      {!busy && <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />}
                    </button>
                  </form>

                  <div className="my-6 flex items-center gap-4 text-xs font-bold text-b2b-muted">
                    <hr className="flex-1 border-b2b-line" /> {d.orContinue} <hr className="flex-1 border-b2b-line" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={soon} className={social} aria-label={d.continueWith('Google')}>
                      <GoogleG /> <span className="hidden sm:inline">Google</span>
                    </button>
                    <button onClick={soon} className={social} aria-label={d.continueWith('Apple')}>
                      <AppleLogo className="size-5" /> <span className="hidden sm:inline">Apple</span>
                    </button>
                    <button onClick={soon} className={social} aria-label={d.continueWith('Facebook')}>
                      <Facebook className="size-5 text-[#1877f2]" /> <span className="hidden sm:inline">Facebook</span>
                    </button>
                  </div>

                  {import.meta.env.DEV && (
                    <div className="mt-7 rounded-none border border-dashed border-b2b-line p-4">
                      <p className="mb-3 text-[11px] font-bold tracking-[0.14em] text-b2b-muted uppercase">{d.demoTitle}</p>
                      <div className="flex flex-wrap gap-2">
                        {DEMO.map((acc) => (
                          <button
                            key={acc.email}
                            disabled={busy}
                            onClick={() => demo(acc)}
                            className="rounded-none border border-b2b-line px-3 py-1.5 text-xs font-bold text-b2b-muted transition hover:border-rave-accent/50 hover:text-b2b-ink disabled:opacity-50"
                          >
                            {d.demo[acc.label]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div key="otp" {...step$} className="text-center">
                  <button onClick={() => setStep('email')} className="mb-6 inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
                    <ArrowLeft className="size-4" /> {d.changeEmail}
                  </button>
                  <span className="mx-auto grid size-14 place-items-center rounded-none bg-b2b-ink text-b2b-on-ink">
                    <BadgeCheck className="size-7" />
                  </span>
                  <h1 className="mt-5 text-2xl font-black tracking-tight">{d.checkEmail}</h1>
                  <p className="mt-2 text-sm text-b2b-muted">
                    {d.sentBefore} <strong className="text-b2b-ink">{email}</strong>{d.sentAfter}
                  </p>
                  <div className="mt-8 flex justify-center">
                    <CodeSlots
                      length={6}
                      value={code}
                      onChange={(c) => {
                        setCode(c);
                        if (status === 'error') setStatus('idle');
                      }}
                      onComplete={verify}
                      status={status}
                      autoFocus
                      disabled={busy || left === 0}
                      accentColor="#5B2A6E"
                      inkColor={dark ? '#f5f3f7' : '#111111'}
                      slotColor={dark ? '#211b2a' : '#f3eff6'}
                      ariaLabel={d.otpAria}
                    />
                  </div>
                  <p className={cx('mt-4 text-xs font-semibold', left === 0 ? 'text-red-500' : 'text-b2b-muted')} aria-live="polite">
                    {left === 0 ? d.expired : d.validFor(mmss(left))}
                  </p>
                  {devCode && left > 0 && (
                    <p className="mt-2 text-xs text-b2b-muted">
                      {d.devCode}{' '}
                      <button
                        className="font-mono font-bold text-b2b-ink underline"
                        onClick={() => {
                          setCode(devCode);
                          void verify(devCode);
                        }}
                      >
                        {devCode}
                      </button>
                    </p>
                  )}
                  <button onClick={() => sendOtp()} disabled={busy || cooldown > 0} className="mt-8 text-sm font-bold text-b2b-ink underline-offset-4 hover:underline disabled:text-b2b-muted disabled:no-underline">
                    {cooldown > 0 ? d.resendIn(cooldown) : d.resend}
                  </button>
                  <p className="mt-6 text-xs text-b2b-muted">{d.spamHint}</p>
                </motion.div>
              )}
            </AnimatePresence>
            <hr className="my-7 border-b2b-line" />
            <p className="text-center text-xs leading-relaxed text-b2b-muted">
              {d.agreeBefore} <Link to="/ketentuan" className="font-semibold underline decoration-2 underline-offset-2 hover:text-b2b-ink">{d.termsLink}</Link> {d.and} <Link to="/privasi" className="font-semibold underline decoration-2 underline-offset-2 hover:text-b2b-ink">{d.privacyLink}</Link> {d.agreeAfter}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
