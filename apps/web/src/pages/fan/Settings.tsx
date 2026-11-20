import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Bell, ChevronDown, Copy, Download, KeyRound, Monitor, Moon, Sun, Globe, Library, MonitorPlay, RotateCcw, Search, ShieldCheck, SlidersHorizontal, TriangleAlert, User, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api, fmt } from '@/lib/api';
import type { Me, TokenResponse } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { usePlayer, type Quality } from '@/stores/player';
import { EQ_PRESETS, presetOf, usePrefs, type EqPreset } from '@/stores/prefs';
import { ChoiceChips, FanPage } from '@/components/fan';
import { Equalizer } from '@/components/fan/Equalizer';
import { switchLanguage } from '@/components/LanguageSwitch';
import { Button, confirmDialog, cx, toast } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';
import { LOCALES, useDict, useLocale, type Locale } from '@/lib/i18n';
import { usePlayerTheme } from '@/lib/theme';
import { setPlayerTheme } from '@/lib/playerTheme';

const QUALITIES: Quality[] = ['auto', 'low', 'normal', 'high', 'lossless'];
const CONSENTS = ['personalization', 'marketing', 'ads', 'aggregate_sharing'] as const;
type NotifCategory = 'booking' | 'payment' | 'event' | 'release' | 'system' | 'social';
type NotifChannel = 'push' | 'email' | 'whatsapp';
interface NotifPref {
  category: NotifCategory;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
  quiet_start: number | null;
  quiet_end: number | null;
}
const NOTIF_CATEGORIES: NotifCategory[] = ['event', 'release', 'payment', 'booking', 'system', 'social'];
const NOTIF_CHANNELS: NotifChannel[] = ['push', 'email', 'whatsapp'];
/** Default server bila belum ada baris preferensi (notification/notify.ts): push aktif, email hanya booking/pembayaran, WhatsApp mati. */
const defaultPref = (category: NotifCategory): NotifPref => ({ category, push: true, email: category === 'booking' || category === 'payment', whatsapp: false, quiet_start: null, quiet_end: null });
const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo', 'Palembang', 'Lainnya'];

type SectionId = 'account' | 'language' | 'audio' | 'eq' | 'library' | 'display' | 'notifications' | 'privacy' | 'security' | 'danger';
const SECTION_ICON: Record<SectionId, any> = { account: User, language: Globe, audio: AudioLines, eq: SlidersHorizontal, library: Library, display: MonitorPlay, notifications: Bell, privacy: ShieldCheck, security: KeyRound, danger: TriangleAlert };

// ───────────────────────── primitif tata letak ─────────────────────────
/** Kata kunci pencarian aktif; baris yang tidak cocok tidak dirender, bagian tanpa baris disembunyikan via CSS :has(). */
const QueryCtx = createContext('');
const matches = (q: string, ...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));

function Section({ id, title, children, tone }: { id: SectionId; title: string; children: ReactNode; tone?: 'danger' }) {
  const Icon = SECTION_ICON[id];
  return (
    <section id={`set-${id}`} aria-labelledby={`set-${id}-h`} className="settings-section scroll-mt-24">
      <h2 id={`set-${id}-h`} className="mb-3 flex items-center gap-2.5 font-display text-2xl leading-none tracking-wide text-rave-paper uppercase">
        <span className={cx('grid size-7 place-items-center border-2 border-rave-ink', tone === 'danger' ? 'bg-rave-berry text-white' : 'bg-rave-primary text-rave-on-primary')}>
          <Icon className="size-4" />
        </span>
        {title}
      </h2>
      <div className={cx('settings-card', tone === 'danger' && 'settings-card--danger')}>{children}</div>
    </section>
  );
}

/** Satu baris pengaturan: label + deskripsi di kiri, kontrol di kanan (bertumpuk di panel sempit). */
function Row({ label, desc, children, keywords, stack, htmlFor }: { label: string; desc?: ReactNode; children?: ReactNode; keywords?: string; stack?: boolean; htmlFor?: string }) {
  const q = useContext(QueryCtx);
  if (!matches(q, label, typeof desc === 'string' ? desc : undefined, keywords)) return null;
  return (
    <div className={cx('settings-row', stack && 'settings-row--stack')}>
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block font-bold text-white">
            {label}
          </label>
        ) : (
          <p className="font-bold text-white">{label}</p>
        )}
        {desc && <div className="mt-0.5 text-sm leading-snug text-rave-muted">{desc}</div>}
      </div>
      {children && <div className={cx('shrink-0', stack && 'w-full')}>{children}</div>}
    </div>
  );
}

/** Saklar RAVE: trek kotak bertepi ink, kenop kotak; aktif = mustard. */
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cx('rave-switch', on && 'rave-switch--on')}>
      <span className="rave-switch__knob" />
    </button>
  );
}

/** Kolom kode 6 digit (angka saja, cocok untuk isi-otomatis OTP di ponsel). */
function CodeInput({ value, onChange, label, onEnter }: { value: string; onChange: (v: string) => void; label: string; onEnter: () => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold tracking-wide text-rave-muted uppercase">{label}</span>
      <input
        className="settings-input w-44 font-label text-lg tracking-[0.3em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => e.key === 'Enter' && value.length === 6 && onEnter()}
      />
    </label>
  );
}

/** Daftar kode pemulihan (tampil sekali) + salin / unduh .txt. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const d = useDict('fan').settings.totp;
  const email = useAuth((x) => x.user?.email) ?? '';
  const text = `${d.fileHeader}\n${email}\n${new Date().toISOString().slice(0, 10)}\n\n${codes.join('\n')}\n`;
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'rave-kode-pemulihan.txt' });
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mt-2 space-y-4 border-2 border-rave-primary bg-white/[0.03] p-4" role="region" aria-label={d.recoveryTitle}>
      <div>
        <p className="font-bold text-white">{d.recoveryTitle}</p>
        <p className="mt-1 text-sm text-rave-muted">{d.recoveryBody}</p>
      </div>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-label text-sm text-white @[560px]:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast.success(d.copied), () => {})}>
          {d.copy}
        </Button>
        <Button variant="outline" size="sm" icon={<Download className="size-4" />} onClick={download}>
          {d.download}
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          {d.saved}
        </Button>
      </div>
    </div>
  );
}

/** Verifikasi 2 langkah (aplikasi authenticator): QR → konfirmasi kode → kode pemulihan; buat ulang kode / nonaktifkan. */
function TotpRow() {
  const s = useDict('fan').settings;
  const d = s.totp;
  const setSession = useAuth((x) => x.setSession);
  const setUser = useAuth((x) => x.setUser);
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['me-totp'], queryFn: () => api<{ enabled: boolean; enabled_at: string | null; recovery_remaining: number }>('/v1/me/totp') });
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [action, setAction] = useState<'disable' | 'regenerate' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [byRecovery, setByRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const on = !!status.data?.enabled;
  const left = status.data?.recovery_remaining ?? 0;

  function reset() {
    setSetup(null);
    setAction(null);
    setCode('');
    setRecovery('');
    setByRecovery(false);
  }
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['me-totp'] });
    api<Me>('/v1/me').then(setUser).catch(() => {});
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const factor = () => (byRecovery ? { recovery_code: recovery.trim() } : { code });
  const factorReady = byRecovery ? recovery.trim().length >= 8 : code.length === 6;
  const start = () =>
    run(async () => {
      setSetup(await api<{ secret: string; otpauth_uri: string }>('/v1/me/totp/setup', { method: 'POST', body: {} }));
      setCode('');
    });
  const confirm = () =>
    run(async () => {
      const r = await api<{ recovery_codes: string[]; session: TokenResponse }>('/v1/me/totp/enable', { method: 'POST', body: { code } });
      setSession(r.session); // sesi lain dicabut server; perangkat ini memakai sesi baru
      reset();
      setCodes(r.recovery_codes);
      toast.success(d.enabled);
      await refresh();
    });
  const submitAction = () =>
    run(async () => {
      if (action === 'regenerate') {
        const r = await api<{ recovery_codes: string[] }>('/v1/me/totp/recovery-codes', { method: 'POST', body: factor() });
        setCodes(r.recovery_codes);
        toast.success(d.regenerated);
      } else {
        await api('/v1/me/totp/disable', { method: 'POST', body: factor() });
        toast.success(d.disabled);
      }
      reset();
      await refresh();
    });

  const desc = on ? (
    <>
      {d.descOn(fmt.date(status.data?.enabled_at), left)}
      {left <= 3 && <span className="mt-1 block font-semibold text-rave-primary">{d.lowRecovery}</span>}
    </>
  ) : (
    d.descOff
  );

  return (
    <Row label={d.title} desc={desc} keywords="2fa mfa two factor verifikasi dua langkah authenticator totp keamanan security google authy pemulihan recovery" stack={!!setup || !!action || !!codes}>
      {status.isError ? (
        <p className="text-sm text-red-400">{d.loadFailed}</p>
      ) : codes ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      ) : setup ? (
        <div className="mt-2 grid gap-5 @[560px]:grid-cols-[auto_minmax(0,1fr)]">
          <div className="w-fit border-2 border-rave-ink bg-white p-3">
            <QRCodeSVG value={setup.otpauth_uri} size={168} level="M" bgColor="#ffffff" fgColor="#000000" title={d.scan} />
          </div>
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-rave-paper">{d.scan}</p>
            <div>
              <p className="text-xs text-rave-muted">{d.manual}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 font-label text-sm break-all text-white">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
                <button
                  type="button"
                  aria-label={d.copy}
                  title={d.copy}
                  className="shrink-0 p-1.5 text-rave-muted hover:text-white"
                  onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success(d.copied), () => {})}
                >
                  <Copy className="size-4" />
                </button>
              </div>
            </div>
            <p className="text-sm text-rave-paper">{d.confirmStep}</p>
            <CodeInput value={code} onChange={setCode} label={d.codeLabel} onEnter={confirm} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={confirm}>
                {d.confirm}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                {d.cancel}
              </Button>
            </div>
          </div>
        </div>
      ) : action ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-rave-muted">{action === 'regenerate' ? d.regenerateHint : d.disableHint}</p>
          {byRecovery ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold tracking-wide text-rave-muted uppercase">{d.recoveryLabel}</span>
              <input
                className="settings-input w-56 font-label tracking-widest"
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="xxxxx-xxxxx"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && factorReady && submitAction()}
              />
            </label>
          ) : (
            <CodeInput value={code} onChange={setCode} label={d.codeLabel} onEnter={submitAction} />
          )}
          {action === 'disable' && (
            <button type="button" className="text-xs font-bold text-rave-muted underline-offset-4 hover:text-white hover:underline" onClick={() => setByRecovery((v) => !v)}>
              {byRecovery ? d.useApp : d.useRecovery}
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant={action === 'disable' ? 'danger' : 'primary'} loading={busy} disabled={!factorReady} onClick={submitAction}>
              {action === 'disable' ? d.disable : d.regenerate}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {d.cancel}
            </Button>
          </div>
        </div>
      ) : on ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAction('regenerate')}>
            {d.regenerate}
          </Button>
          <Button variant="danger" onClick={() => setAction('disable')}>
            {d.disable}
          </Button>
        </div>
      ) : (
        <Button variant="primary" loading={busy} onClick={start} disabled={status.isLoading}>
          {d.setup}
        </Button>
      )}
    </Row>
  );
}

/** Select gelap berbingkai RAVE dengan chevron. */
function SelectBox({ id, value, onChange, children, className }: { id?: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="settings-select">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-rave-muted" />
    </div>
  );
}

// ───────────────────────── halaman ─────────────────────────
export default function Settings() {
  const t = useDict('fan');
  const s = t.settings;
  const c = useDict('common');
  const user = useAuth((x) => x.user);
  const setUser = useAuth((x) => x.setUser);
  const clear = useAuth((x) => x.clear);
  const qc = useQueryClient();
  const nav = useNavigate();
  const locale = useLocale((x) => x.locale);
  const quality = usePlayer((x) => x.quality);
  const setQuality = usePlayer((x) => x.setQuality);
  const prefs = usePrefs();
  const theme = usePlayerTheme(user?.theme);
  const [name, setName] = useState(user?.display_name ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  useEffect(() => {
    setName(user?.display_name ?? '');
    setCity(user?.city ?? '');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const consents = useQuery({ queryKey: ['consents'], queryFn: () => api<{ data: { purpose: string; granted: boolean }[] }>('/v1/me/consents') });
  const granted = (p: string) => !!consents.data?.data.find((c) => c.purpose === p)?.granted;
  // Kebijakan kualitas Super Admin (ditegakkan server di playback): plafon Free & Premium, batas resolusi Lossless.
  const cfg = usePlatformConfig();
  const losslessOn = setting(cfg, 'streaming.lossless_enabled', true);
  const freeMax = setting(cfg, 'streaming.free_max_quality', 'normal') as Quality;
  const premiumMaxRaw = setting(cfg, 'streaming.premium_max_quality', 'lossless') as Quality;
  const premiumMax: Quality = !losslessOn && premiumMaxRaw === 'lossless' ? 'high' : premiumMaxRaw;
  const capRes = ({ '16_44': '16-bit/44.1 kHz', '24_48': '24-bit/48 kHz', '24_96': '24-bit/96 kHz' } as Record<string, string>)[setting(cfg, 'streaming.lossless_max_resolution', '24_96') as string] ?? '24-bit/96 kHz';
  const rankQ = (q: Quality) => QUALITIES.indexOf(q);
  // Opsi di atas plafon Premium disembunyikan (tak bisa didapat siapa pun); di atas plafon Free dikunci untuk akun Gratis.
  const qualities = QUALITIES.filter((v) => rankQ(v) <= rankQ(premiumMax));
  useEffect(() => {
    if (rankQ(quality) > rankQ(premiumMax)) setQuality(premiumMax);
  }, [premiumMax, quality, setQuality]); // eslint-disable-line react-hooks/exhaustive-deps
  const premium = !!user?.premium;
  const locked = (v: Quality) => !premium && v !== 'auto' && rankQ(v) > rankQ(freeMax);
  const qualityDesc = (v: Quality) => (v === 'lossless' ? s.losslessCap(capRes) : s.qualities[v][1]);

  const notif = useQuery({ queryKey: ['notif-prefs'], queryFn: () => api<{ data: NotifPref[] }>('/v1/notifications/preferences') });
  const prefOf = (c: NotifCategory) => notif.data?.data.find((p) => p.category === c) ?? defaultPref(c);
  async function setPref(c: NotifCategory, ch: NotifChannel, value: boolean) {
    const next = { ...prefOf(c), [ch]: value };
    qc.setQueryData<{ data: NotifPref[] }>(['notif-prefs'], (old) => ({ data: [...(old?.data ?? []).filter((p) => p.category !== c), next] }));
    try {
      await api('/v1/notifications/preferences', { method: 'PUT', body: { category: c, push: next.push, email: next.email, whatsapp: next.whatsapp, quiet_start: next.quiet_start, quiet_end: next.quiet_end } });
    } catch (e) {
      toast.error(e);
    } finally {
      qc.invalidateQueries({ queryKey: ['notif-prefs'] });
    }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      setUser(await api<Me>('/v1/me', { method: 'PATCH', body: { display_name: name, city: city || null } }));
      toast.success(s.profileSaved);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }
  async function setConsent(purpose: string, value: boolean) {
    try {
      await api('/v1/me/consents', { method: 'PUT', body: { purpose, granted: value } });
      qc.invalidateQueries({ queryKey: ['consents'] });
    } catch (e) {
      toast.error(e);
    }
  }
  async function deleteAccount() {
    const ok = await confirmDialog({ title: s.deleteTitle, body: s.confirmDelete, confirmLabel: s.deleteCta, danger: true });
    if (!ok) return;
    try {
      await api('/v1/me', { method: 'DELETE' });
      clear();
      toast.success(s.accountDeleted);
      nav('/');
    } catch (e) {
      toast.error(e);
    }
  }

  const preset = presetOf(prefs.eq);
  const presetOptions = useMemo(
    () => [...(Object.keys(EQ_PRESETS) as EqPreset[]).map((k) => ({ value: k as EqPreset | 'custom', label: s.eqPresets[k] })), ...(preset ? [] : [{ value: 'custom' as const, label: s.eqCustom }])],
    [s, preset],
  );
  const sections: SectionId[] = ['account', 'language', 'audio', 'eq', 'library', 'display', 'notifications', 'privacy', 'security', 'danger'];
  const jump = (id: SectionId) => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const [ql, qd] = s.qualityRow;

  return (
    <FanPage className="@container">
      <QueryCtx.Provider value={q}>
        {/* Kepala halaman: judul + cari pengaturan */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-4xl leading-none md:text-6xl">{s.title}</h1>
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-rave-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.searchPlaceholder} aria-label={s.searchPlaceholder} className="settings-input pr-9 pl-9" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label={c.shell.clearSearch} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-rave-muted hover:text-white">
                <X className="size-4" />
              </button>
            )}
          </label>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 @[920px]:grid-cols-[200px_minmax(0,1fr)]">
          {/* Navigasi bagian: kolom lengket di panel lebar, chip bergulir di panel sempit */}
          <nav aria-label={s.sectionsLabel} className="@[920px]:sticky @[920px]:top-24 @[920px]:self-start">
            <div className="hidden flex-col @[920px]:flex">
              {sections.map((id) => {
                const Icon = SECTION_ICON[id];
                return (
                  <button key={id} type="button" onClick={() => jump(id)} className="shell-row flex h-10 items-center gap-3 px-2 text-left text-sm font-semibold text-rave-paper/80 hover:text-white">
                    <Icon className="size-4 shrink-0 text-rave-muted" />
                    {s.sections[id]}
                  </button>
                );
              })}
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] @[920px]:hidden">
              {sections.map((id) => {
                const Icon = SECTION_ICON[id];
                return (
                  <button key={id} type="button" onClick={() => jump(id)} className="choice-chip">
                    <Icon className="size-4 shrink-0" />
                    {s.sections[id]}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="settings-list min-w-0 space-y-10">
            <Section id="account" title={s.sections.account}>
              <Row label={s.profile} keywords={`${s.displayName} ${s.city}`} stack>
                <div className="grid gap-3 @[560px]:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold tracking-wide text-rave-muted uppercase">{s.displayName}</span>
                    <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold tracking-wide text-rave-muted uppercase">
                      {s.city} <span className="font-normal normal-case">· {s.cityHint}</span>
                    </span>
                    <SelectBox value={city} onChange={setCity}>
                      <option value="">—</option>
                      {CITIES.map((c) => (
                        <option key={c} value={c}>
                          {c === 'Lainnya' ? s.otherCity : c}
                        </option>
                      ))}
                    </SelectBox>
                  </label>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="primary" loading={saving} onClick={saveProfile} disabled={name.trim() === (user?.display_name ?? '') && (city || '') === (user?.city ?? '')}>
                    {s.saveProfile}
                  </Button>
                </div>
              </Row>
              <Row label={s.emailRow} desc={s.emailHint} keywords="email login">
                <span className="font-label text-sm text-rave-paper">{user?.email}</span>
              </Row>
            </Section>

            <Section id="language" title={s.sections.language}>
              <Row label={s.languageRow[0]} desc={s.languageRow[1]} keywords="language bahasa" htmlFor="set-lang">
                <SelectBox id="set-lang" value={locale} onChange={(v) => void switchLanguage(v as Locale)} className="w-56">
                  {LOCALES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </SelectBox>
              </Row>
            </Section>

            <Section id="audio" title={s.sections.audio}>
              <Row
                label={ql}
                htmlFor="set-quality"
                keywords="kbps flac lossless aac quality kualitas"
                desc={
                  <>
                    {qualityDesc(quality)} · {qd}
                    {!premium && (
                      <span className="mt-1 block">
                        {s.freeQualityNote(s.qualities[freeMax][0])}{' '}
                        <Link to="/premium" className="font-bold text-rave-primary-text underline-offset-2 hover:underline">
                          {s.premiumQualityCta}
                        </Link>
                      </span>
                    )}
                  </>
                }
              >
                <SelectBox id="set-quality" value={quality} onChange={(v) => setQuality(v as Quality)} className="w-56">
                  {qualities.map((v) => (
                    <option key={v} value={v} disabled={locked(v)}>
                      {s.qualities[v][0]}
                      {locked(v) ? ` · ${s.qualityLocked}` : ''}
                    </option>
                  ))}
                </SelectBox>
              </Row>
              <Row label={s.normalizeRow[0]} desc={s.normalizeRow[1]} keywords="loudness normalize">
                <Toggle on={prefs.normalize} onChange={(v) => prefs.set({ normalize: v })} label={s.normalizeRow[0]} />
              </Row>
            </Section>

            <Section id="eq" title={s.sections.eq}>
              <Row
                label={s.eqRow[0]}
                keywords="equalizer equaliser bass treble eq premium"
                desc={
                  <>
                    {s.eqRow[1]} {s.eqDeviceNote}
                    {!premium && (
                      <span className="mt-1 block">
                        <span className="rave-label mr-1.5 border border-rave-primary/60 px-1.5 py-0.5 !text-[9.5px] text-rave-primary-text">{s.premiumBadge}</span>
                        {s.eqPremium}{' '}
                        <Link to="/premium" className="font-bold text-rave-primary-text underline-offset-2 hover:underline">
                          {s.eqPremiumCta}
                        </Link>
                      </span>
                    )}
                  </>
                }
              >
                <Toggle on={premium && prefs.eqOn} onChange={(v) => prefs.set({ eqOn: v })} label={s.eqRow[0]} disabled={!premium} />
              </Row>
              <Row label={s.eqCurve} keywords="equalizer equaliser bass treble eq preset" stack>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <ChoiceChips
                    value={(preset ?? 'custom') as EqPreset | 'custom'}
                    onChange={(v) => premium && v !== 'custom' && prefs.set({ eq: [...EQ_PRESETS[v as EqPreset]], eqOn: true })}
                    options={presetOptions}
                    label={s.eqRow[0]}
                    className="!pb-0"
                  />
                  <button type="button" onClick={() => prefs.set({ eq: [...EQ_PRESETS.flat] })} disabled={!premium || preset === 'flat'} className="flex h-9 items-center gap-1.5 border border-white/15 px-3 text-sm font-bold text-rave-muted transition hover:border-white/40 hover:text-white disabled:opacity-40">
                    <RotateCcw className="size-3.5" /> {s.eqReset}
                  </button>
                </div>
                <div className="mt-4">
                  <Equalizer values={prefs.eq} onChange={prefs.setBand} disabled={!premium || !prefs.eqOn} />
                  {premium && !prefs.eqOn && <p className="mt-3 text-xs text-rave-subtle">{s.eqOffNote}</p>}
                </div>
              </Row>
            </Section>

            <Section id="library" title={s.sections.library}>
              <Row label={s.compactRow[0]} desc={s.compactRow[1]} keywords="compact ringkas side a">
                <Toggle on={prefs.compactLibrary} onChange={(v) => prefs.set({ compactLibrary: v })} label={s.compactRow[0]} />
              </Row>
            </Section>

            <Section id="display" title={s.sections.display}>
              <Row label={s.themeRow[0]} desc={theme.allowUser ? s.themeRow[1] : s.themeLocked} keywords="theme tema dark light gelap terang" stack>
                <div role="radiogroup" aria-label={s.themeRow[0]} className="grid grid-cols-3 gap-3">
                  {(['dark', 'light', 'system'] as const).map((v) => {
                    const on = theme.choice === v;
                    return (
                      <button key={v} type="button" role="radio" aria-checked={on} disabled={!theme.allowUser} onClick={() => void setPlayerTheme(v)} className={cx('theme-card', on && 'theme-card--on')}>
                        <span className={cx('theme-card__preview', `theme-card__preview--${v}`)} aria-hidden>
                          <span />
                          <span />
                          <span />
                        </span>
                        <span className="flex items-center gap-1.5 text-sm font-bold">
                          {v === 'dark' ? <Moon className="size-3.5" /> : v === 'light' ? <Sun className="size-3.5" /> : <Monitor className="size-3.5" />}
                          {s.themes[v]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row label={s.autoOpenRow[0]} desc={s.autoOpenRow[1]} keywords="side b now playing panel">
                <Toggle on={prefs.autoOpenNowPlaying} onChange={(v) => prefs.set({ autoOpenNowPlaying: v })} label={s.autoOpenRow[0]} />
              </Row>
              <Row label={s.vinylRow[0]} desc={s.vinylRow[1]} keywords="vinyl animation animasi piringan canvas">
                <Toggle on={prefs.vinylMotion} onChange={(v) => prefs.set({ vinylMotion: v })} label={s.vinylRow[0]} />
              </Row>
            </Section>

            <Section id="notifications" title={s.sections.notifications}>
              <Row label={s.notifications} desc={s.notifIntro} keywords="push email whatsapp notifikasi notification" stack>
                <div className="settings-notif" role="table" aria-label={s.notifications}>
                  <div role="row" className="settings-notif__head">
                    <span role="columnheader">{s.category}</span>
                    {NOTIF_CHANNELS.map((ch) => (
                      <span role="columnheader" key={ch}>
                        {s.channels[ch]}
                      </span>
                    ))}
                  </div>
                  {NOTIF_CATEGORIES.map((c) => {
                    const [l, dsc] = s.notifCategories[c];
                    return (
                      <div role="row" key={c} className="settings-notif__row">
                        <div role="cell" className="min-w-0">
                          <p className="font-bold text-white">{l}</p>
                          <p className="text-sm text-rave-muted">{dsc}</p>
                        </div>
                        {NOTIF_CHANNELS.map((ch) => (
                          <div role="cell" key={ch} className="settings-notif__cell">
                            <span className="settings-notif__label">{s.channels[ch]}</span>
                            <Toggle on={prefOf(c)[ch]} onChange={(v) => setPref(c, ch, v)} label={s.channelFor(s.channels[ch], l)} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                {notif.isError && <p className="mt-2 text-sm text-red-400">{s.notifPrefsFailed}</p>}
              </Row>
            </Section>

            <Section id="privacy" title={s.privacy}>
              {CONSENTS.map((p) => {
                const [l, dsc] = s.consents[p];
                return (
                  <Row key={p} label={l} desc={dsc} keywords="privacy privasi consent pdp">
                    <Toggle on={granted(p)} onChange={(v) => setConsent(p, v)} label={l} />
                  </Row>
                );
              })}
              {consents.isError && <p className="px-5 pb-4 text-sm text-red-400">{s.consentsFailed}</p>}
            </Section>

            <Section id="security" title={s.sections.security}>
              <TotpRow />
            </Section>

            <Section id="danger" title={s.sections.danger} tone="danger">
              <Row label={s.deleteAccount} desc={`${s.accountNote} ${s.dangerNote}`} keywords="delete hapus akun account">
                <Button variant="danger" onClick={deleteAccount}>
                  {s.deleteAccount}
                </Button>
              </Row>
            </Section>

            {q && <p className="settings-empty hidden border-l-2 border-rave-primary bg-white/[0.04] px-4 py-3 text-sm text-rave-muted">{s.noResults(query.trim())}</p>}
          </div>
        </div>

        <SettingsFooter />
      </QueryCtx.Provider>
    </FanPage>
  );
}

/** Tautan kaki halaman (referensi): Perusahaan · Komunitas · Tautan berguna · Paket, lalu baris legal. */
function SettingsFooter() {
  const f = useDict('fan').settings.footer;
  const cols: [string, [string, string][]][] = [
    [f.company, [[f.links.about, '/tentang'], [f.links.jobs, '/karier'], [f.links.press, '/media'], [f.links.investors, '/investor']]],
    [f.communities, [[f.links.artists, '/untuk-artis'], [f.links.promoters, '/untuk-promotor'], [f.links.developers, '/developer'], [f.links.advertise, '/iklan']]],
    [f.useful, [[f.links.help, '/bantuan'], [f.links.news, '/berita']]],
    [f.plans, [[f.links.premium, '/premium'], [f.links.free, '/premium#gratis']]],
  ];
  return (
    <footer className="mt-16 border-t border-white/10 pt-10">
      <div className="grid grid-cols-2 gap-8 @[640px]:grid-cols-4">
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="mb-3 font-label text-[11px] font-bold tracking-[0.14em] text-rave-paper uppercase">{title}</p>
            <ul className="space-y-2">
              {links.map(([l, href]) => (
                <li key={href}>
                  <Link to={href} className="text-sm text-rave-muted transition hover:text-white hover:underline">
                    {l}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-rave-muted">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(
            [
              [f.legal.terms, '/ketentuan'],
              [f.legal.privacy, '/privasi'],
              [f.legal.copyright, '/hak-cipta'],
              [f.legal.cookies, '/cookie'],
            ] as const
          ).map(([l, href]) => (
            <Link key={href} to={href} className="hover:text-white">
              {l}
            </Link>
          ))}
        </div>
        <span>{f.rights(new Date().getFullYear())}</span>
      </div>
    </footer>
  );
}
