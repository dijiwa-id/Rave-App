import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, History, ImageUp, RotateCcw, Trash2 } from 'lucide-react';
import { BRANDING_MAX_BYTES, BRANDING_PUBLIC_PREFIX, coerceSetting, SETTING_GROUPS, SETTINGS, SETTINGS_BY_KEY, type PartnerEntry, type SettingDef, type SettingGroup } from '@rave/domain/settings';
import { api, ApiError, fmt } from '@/lib/api';
import { dict, localeTag, useDict } from '@/lib/i18n';
import type { SettingsHistoryItem, SettingsResponse } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { DEFAULT_BRAND } from '@/lib/platform';
import { fmtBytes, ReadOnlyNote, useIsSuperAdmin, WriteButton } from './Platform';

// Pengaturan platform (docs/API.md §9). Form dirender dari registri @rave/domain/settings;
// draf disimpan sebagai nilai input mentah lalu divalidasi dengan coerceSetting sebelum dikirim.

// Grup `access` dikelola di halaman matriks "Peran & Akses" (/admin/platform/roles), bukan form umum.
// 'access' punya halaman sendiri (Peran & Akses); 'content' (konten landing & logo partner pita kuning) dikelola di Editor Landing.
const GROUPS: SettingGroup[] = (Object.keys(SETTING_GROUPS) as SettingGroup[]).filter((g) => g !== 'access' && g !== 'content');

/** Nilai server → nilai input (angka & daftar sebagai teks agar bisa diketik bebas). */
function toInput(def: SettingDef, v: unknown): unknown {
  if (def.type === 'boolean') return !!v;
  if (def.type === 'number') return v == null ? '' : String(v);
  if (def.type === 'list') return Array.isArray(v) ? v.join(', ') : String(v ?? '');
  if (def.type === 'partners') return Array.isArray(v) ? v : [];
  return v ?? '';
}
/** Nilai input → nilai untuk coerceSetting (angka kosong = null agar ditolak, bukan 0). */
function fromInput(def: SettingDef, v: unknown): unknown {
  if (def.type === 'number') return typeof v === 'string' && v.trim() === '' ? null : v;
  return v;
}
function coerce(def: SettingDef, input: unknown): { value?: unknown; error?: string } {
  try {
    return { value: coerceSetting(def.key, fromInput(def, input)) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Tampilan ringkas nilai (riwayat, default, modal konfirmasi). */
export function fmtSetting(v: unknown, def?: SettingDef): string {
  if (v === undefined || v === null) return '—';
  const t = dict('admin').settings.value;
  if (typeof v === 'boolean') return v ? t.on : t.off;
  if (def?.type === 'partners' && Array.isArray(v)) return v.length ? (v as PartnerEntry[]).map((p) => p.name + (p.logo ? '' : t.noLogo)).join(', ') : t.emptyPartners;
  if (Array.isArray(v)) return v.length ? v.join(', ') : t.empty;
  if (def?.type === 'enum') return def.options?.find((o) => o.value === v)?.label ?? String(v);
  if (typeof v === 'number') return `${v.toLocaleString(localeTag())}${def?.unit ? ' ' + def.unit : ''}`;
  if (def?.type === 'image' && typeof v === 'string') return v === '' ? t.defaultImage : v.replace(BRANDING_PUBLIC_PREFIX, '');
  if (typeof v === 'string') return v === '' ? t.empty : v;
  // Objek besar (mis. konten landing) diringkas — detail lengkap ada di panel Detail riwayat.
  if (typeof v === 'object') return dict('admin').settings.objectSummary(Object.keys(v as object).length);
  return String(v);
}

/** Path error dari backend bisa `key`, `changes.key`, atau `/changes/key`. */
function errorKey(path: string) {
  const k = path.replace(/^\/?changes[./]/, '').replace(/\//g, '.');
  if (SETTINGS_BY_KEY[k]) return k;
  if (SETTINGS_BY_KEY[path]) return path;
  // Error per item (mis. `content.partners.2.logo`) → kunci induknya.
  const parent = Object.keys(SETTINGS_BY_KEY).find((key) => k.startsWith(key + '.'));
  return parent ?? null;
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 items-center border-2 border-b2b-ink transition disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-rave-primary shadow-[2px_2px_0_var(--b2b-card-border)]' : 'bg-b2b-bg',
      )}
    >
      <span className={cx('inline-block size-[18px] border-2 border-b2b-ink transition-transform duration-150', checked ? 'translate-x-[22px] bg-rave-ink' : 'translate-x-[3px] bg-b2b-card')} />
    </button>
  );
}

type BrandingType = keyof typeof BRANDING_MAX_BYTES;
const typeOf = (f: File): BrandingType | null =>
  f.type === 'image/png' || /\.png$/i.test(f.name) ? 'image/png' : f.type === 'image/svg+xml' || /\.svg$/i.test(f.name) ? 'image/svg+xml' : null;

function pngDims(f: Blob): Promise<{ width: number; height: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      res({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      rej(new Error(dict('admin').settings.upload.pngUnreadable));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Field gambar branding: unggah SVG/PNG ke bucket branding (POST /v1/admin/platform/branding?slot=…),
 * lalu path-nya menjadi nilai draf — diterapkan lewat tombol Simpan (alasan + riwayat seperti pengaturan lain).
 */
/** Validasi di klien lalu unggah satu file ke bucket branding (slot sesuai registri). */
/** Unggah file branding (logo/ikon/logo partner) setelah validasi jenis, ukuran & resolusi di klien. Dipakai juga oleh Editor Landing. */
export async function uploadBranding(f: File, rule: NonNullable<SettingDef['image']>) {
  const t = dict('admin').settings.upload;
  const type = typeOf(f);
  if (!type) throw new Error(t.onlySvgPng);
  if (f.size > BRANDING_MAX_BYTES[type]) throw new Error(t.maxSize(fmtBytes(BRANDING_MAX_BYTES[type]), type === 'image/png' ? 'PNG' : 'SVG'));
  const blob = new Blob([f], { type });
  if (type === 'image/png') {
    const d = await pngDims(blob);
    if (Math.min(d.width, d.height) < rule.minPx) throw new Error(t.minResolution(rule.minPx, d.width, d.height));
    if (rule.square && d.width !== d.height) throw new Error(t.mustBeSquare(d.width, d.height));
  }
  return api<{ url: string; size: number; width: number | null; height: number | null }>('/v1/admin/platform/branding', {
    method: 'POST',
    query: { slot: rule.slot },
    body: blob,
  });
}

function ImageSettingField({ def, value, onChange, disabled }: { def: SettingDef; value: string; onChange: (v: unknown) => void; disabled: boolean }) {
  const rule = def.image!;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const darkBg = rule.background === 'dark';
  const t = useDict('admin').settings.upload;

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      setBusy(true);
      const r = await uploadBranding(f, rule);
      onChange(r.url);
      setInfo(`${f.name} · ${fmtBytes(r.size)}${r.width && r.height ? ` · ${Math.round(r.width)}×${Math.round(r.height)}` : ''} — ${t.clickSave}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {/* Kotak pratinjau ukuran tetap: gambar diposisikan absolut + object-contain → selalu muat, tidak pernah keluar kotak. */}
      <div
        className={cx(
          'relative h-24 max-w-full shrink-0 overflow-hidden border-2 border-b2b-line',
          rule.square ? 'w-24' : 'w-full sm:w-72',
          darkBg ? 'bg-[#181818]' : 'bg-white',
        )}
        title={darkBg ? t.previewDark : t.previewLight}
      >
        {/* Kosong = logo resmi bawaan aplikasi (bukan logo yang sedang aktif). */}
        <img
          src={value || { logo: DEFAULT_BRAND.logo, logo_dark: DEFAULT_BRAND.logoDark, icon: DEFAULT_BRAND.icon, partner: DEFAULT_BRAND.icon }[rule.slot]}
          alt={t.previewAlt(def.label)}
          className="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] object-contain"
        />
        <span className="absolute right-1 bottom-1 bg-black/55 px-1 font-label text-[8.5px] font-bold tracking-[0.1em] text-white uppercase">{darkBg ? 'dark' : 'light'}</span>
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept=".svg,.png,image/svg+xml,image/png" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="outline-ink" disabled={disabled || busy} onClick={() => input.current?.click()}>
            <ImageUp className="size-4" /> {busy ? t.uploading : value ? t.replaceFile : t.uploadSvgPng}
          </Button>
          {value && (
            <Button size="sm" variant="outline-ink" disabled={disabled || busy} onClick={() => onChange('')}>
              <Trash2 className="size-4" /> {t.useDefault}
            </Button>
          )}
        </div>
        <p className="text-xs text-b2b-muted">
          {t.rules(fmtBytes(BRANDING_MAX_BYTES['image/svg+xml']), fmtBytes(BRANDING_MAX_BYTES['image/png']))}
          {rule.square ? t.ruleSquare(rule.minPx) : t.ruleHeight(rule.minPx)}.
        </p>
        {info && <p className="text-xs font-semibold text-emerald-700">{info}</p>}
      </div>
    </div>
  );
}

function FontSettingField({ def, value, onChange, disabled }: { def: SettingDef; value: string; onChange: (v: unknown) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label={def.label} className="grid gap-3 sm:grid-cols-2">
      {def.options?.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'border-2 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'border-b2b-ink bg-b2b-card shadow-[4px_4px_0_var(--color-rave-mustard)]' : 'border-b2b-line bg-b2b-card hover:border-b2b-ink/60',
            )}
          >
            <span className="flex items-center justify-between gap-2 font-label text-[10px] font-bold tracking-[0.12em] text-b2b-muted uppercase">
              {o.label}
              <span className={cx('grid size-4 shrink-0 place-items-center rounded-full border-2', active ? 'border-b2b-ink' : 'border-b2b-line')} aria-hidden>
                {active && <span className="size-2 rounded-full bg-b2b-ink" />}
              </span>
            </span>
            <span className="mt-3 block truncate text-3xl leading-none uppercase" style={{ fontFamily: def.fontPreview?.[o.value], fontWeight: def.fontPreviewWeight?.[o.value], fontSizeAdjust: def.fontPreviewAdjust?.[o.value] }}>
              Dengar gratis. Datang ke panggungnya.
            </span>
            <span className="mt-2 block text-2xl leading-none" style={{ fontFamily: def.fontPreview?.[o.value], fontWeight: def.fontPreviewWeight?.[o.value], fontSizeAdjust: def.fontPreviewAdjust?.[o.value] }}>
              Aa Bb Cc 0123456789 ÀÉ
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SettingControl({ def, value, onChange, disabled }: { def: SettingDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const t = useDict('admin').settings;
  switch (def.type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <Toggle checked={!!value} onChange={onChange} disabled={disabled} label={def.label} />
          <span className="text-sm font-semibold">{value ? t.value.on : t.value.off}</span>
        </div>
      );
    case 'number':
      return (
        <div className="flex max-w-xs items-center gap-2">
          <Input type="number" inputMode="decimal" value={String(value)} min={def.min} max={def.max} step={def.step ?? 1} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
          {def.unit && <span className="shrink-0 text-sm font-semibold text-b2b-muted">{def.unit}</span>}
        </div>
      );
    case 'enum':
      if (def.fontPreview) return <FontSettingField def={def} value={String(value)} onChange={onChange} disabled={disabled} />;
      return (
        <Select value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="max-w-xs">
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'list':
      return <Input value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={t.listPlaceholder} className="font-mono text-sm" />;
    case 'image':
      return <ImageSettingField def={def} value={String(value ?? '')} onChange={onChange} disabled={disabled} />;
    case 'text':
      return <Textarea value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} maxLength={2000} />;
    default:
      return <Input value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} maxLength={200} />;
  }
}

export function PlatformSettings() {
  const d = useDict('admin');
  const t = d.settings;
  const qc = useQueryClient();
  const sup = useIsSuperAdmin();
  const [params, setParams] = useSearchParams();
  const group = (GROUPS.includes(params.get('group') as SettingGroup) ? params.get('group') : 'general') as SettingGroup;
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<SettingsResponse>('/v1/admin/platform/settings') });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reset, setReset] = useState<string[] | null>(null);
  const [historyKey, setHistoryKey] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const server = (key: string) => {
    const def = SETTINGS_BY_KEY[key];
    const v = q.data?.values[key];
    return v === undefined ? def.default : v;
  };
  const dirty = Object.keys(draft);
  const clientErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of dirty) {
      const r = coerce(SETTINGS_BY_KEY[k], draft[k]);
      if (r.error) out[k] = r.error;
    }
    return out;
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(def: SettingDef, input: unknown) {
    setServerErrors(({ [def.key]: _, ...rest }) => rest);
    setDraft((d) => {
      const next = { ...d, [def.key]: input };
      const r = coerce(def, input);
      if (!r.error && same(r.value, server(def.key))) delete next[def.key];
      return next;
    });
  }

  function onSaved(data: SettingsResponse | null) {
    if (data?.values) qc.setQueryData(['platform-settings'], data);
    qc.invalidateQueries({ queryKey: ['platform-settings'] });
    qc.invalidateQueries({ queryKey: ['platform-settings-history'] });
    qc.invalidateQueries({ queryKey: ['platform-config'] });
    qc.invalidateQueries({ queryKey: ['platform-overview'] });
  }

  async function save(reason: string) {
    const changes = Object.fromEntries(dirty.map((k) => [k, coerce(SETTINGS_BY_KEY[k], draft[k]).value]));
    setSaving(true);
    try {
      const data = await api<SettingsResponse>('/v1/admin/platform/settings', { method: 'PUT', body: { changes, reason } });
      toast.success(t.toastSaved(dirty.length, data?.version ?? ''));
      setDraft({});
      setServerErrors({});
      setSaveOpen(false);
      onSaved(data);
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) {
        const errs: Record<string, string> = {};
        for (const er of e.problem.errors) {
          const k = errorKey(er.path);
          if (k) errs[k] = er.message;
        }
        setServerErrors(errs);
        setSaveOpen(false);
        // Pindah ke grup pertama yang error agar pesannya terlihat.
        const first = Object.keys(errs)[0];
        if (first) setParams({ group: SETTINGS_BY_KEY[first].group }, { replace: true });
      }
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function doReset(keys: string[], reason: string) {
    setSaving(true);
    try {
      const data = await api<SettingsResponse | null>('/v1/admin/platform/settings/reset', { body: { keys, reason } });
      toast.success(t.toastReset(keys.length));
      setDraft((dr) => Object.fromEntries(Object.entries(dr).filter(([k]) => !keys.includes(k))));
      setReset(null);
      onSaved(data);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  // content.landing & content.partners punya editor sendiri (Platform → Editor Landing), tidak dirender di form umum.
  const defs = SETTINGS.filter((s) => s.group === group && s.type !== 'landing' && s.type !== 'partners');
  const nonDefaultInGroup = defs.filter((d) => !same(server(d.key), d.default)).map((d) => d.key);
  const hasClientErrors = Object.keys(clientErrors).length > 0;
  // Ponsel: bilah grup bergulir horizontal — pastikan grup aktif terlihat.
  useEffect(() => {
    document.querySelector('nav[aria-label] button[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [group]);

  return (
    <div className={dirty.length ? 'pb-20' : undefined}>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle(q.data ? t.versionSuffix(q.data.version) : '')}
      />
      <ReadOnlyNote>{t.readOnly}</ReadOnlyNote>
      <QueryState q={q}>
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <nav className="b2b-surface flex gap-1 overflow-x-auto border border-b2b-line p-1.5 lg:sticky lg:top-6 lg:flex-col lg:self-start lg:overflow-visible lg:p-2" aria-label={t.groupsAria}>
            <p className="hidden px-2 pt-1 pb-2 font-label text-[10px] font-bold tracking-[0.14em] text-b2b-muted uppercase lg:block">{t.groupsTitle}</p>
            {GROUPS.map((g) => {
              const n = dirty.filter((k) => SETTINGS_BY_KEY[k].group === g).length;
              const err = Object.keys({ ...clientErrors, ...serverErrors }).some((k) => SETTINGS_BY_KEY[k]?.group === g);
              const custom = SETTINGS.filter((d) => d.group === g && d.type !== 'landing' && d.type !== 'partners' && !same(server(d.key), d.default)).length;
              const on = g === group;
              return (
                <button
                  key={g}
                  onClick={() => setParams({ group: g }, { replace: true })}
                  aria-current={on ? 'page' : undefined}
                  className={cx(
                    'relative flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-bold whitespace-nowrap transition lg:whitespace-normal',
                    on ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink',
                  )}
                >
                  {on && <span className="absolute inset-y-0 left-0 hidden w-1 bg-rave-primary lg:block" aria-hidden />}
                  <span className="min-w-0">{SETTING_GROUPS[g].label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {custom > 0 && !n && !err && <span className={cx('font-label text-[10px] tabular-nums', on ? 'text-b2b-on-ink/70' : 'text-b2b-muted')} title={t.customized(custom)}>{custom}</span>}
                    {(n > 0 || err) && <span className={cx('grid min-w-5 place-items-center px-1.5 text-[11px] font-bold', err ? 'bg-red-500 text-white' : 'bg-rave-primary text-rave-ink')}>{n || '!'}</span>}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 space-y-6">
            <section className="b2b-surface border border-b2b-line">
              <header className="flex flex-col gap-3 border-b-2 border-b2b-line px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h2 className="!font-display text-3xl leading-none !font-normal !uppercase">{SETTING_GROUPS[group].label}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-b2b-muted">{SETTING_GROUPS[group].description}</p>
                  <p className="mt-2 font-label text-[10.5px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{t.groupStats(defs.length, nonDefaultInGroup.length)}</p>
                </div>
                {sup && nonDefaultInGroup.length > 0 && (
                  <Button size="sm" variant="outline-ink" className="shrink-0" icon={<RotateCcw className="size-4" />} onClick={() => setReset(nonDefaultInGroup)}>
                    {t.resetGroup}
                  </Button>
                )}
              </header>
              <div className="divide-y divide-b2b-line">
                {defs.map((def) => {
                  const isDirty = def.key in draft;
                  const value = isDirty ? draft[def.key] : toInput(def, server(def.key));
                  const error = serverErrors[def.key] ?? clientErrors[def.key];
                  const meta = q.data?.meta[def.key];
                  const isDefault = same(server(def.key), def.default);
                  return (
                    <div
                      key={def.key}
                      id={`setting-${def.key}`}
                      className={cx('relative grid scroll-mt-24 gap-x-8 gap-y-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,400px)]', isDirty && 'bg-rave-primary/[0.07]')}
                    >
                      {isDirty && <span className="absolute inset-y-0 left-0 w-1 bg-rave-primary" aria-hidden />}
                      <div className="min-w-0">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-bold">
                            {def.label}
                            {def.dangerous && (
                              <Badge tone="red">
                                <AlertTriangle className="size-3" /> {t.badge.dangerous}
                              </Badge>
                            )}
                            {def.public && <Badge tone="blue">{t.badge.public}</Badge>}
                            {def.planned && <Badge tone="purple">{t.badge.planned}</Badge>}
                            {isDirty && <Badge tone="amber">{t.badge.changed}</Badge>}
                          </p>
                          <p className="font-mono text-[11px] text-b2b-muted">{def.key}</p>
                          {def.description && <p className="mt-1 text-sm text-b2b-muted">{def.description}</p>}
                          {def.planned && (
                            <p className="mt-1.5 text-xs font-semibold text-violet-700">{t.notEnforced} — {def.planned} {t.plannedNote}</p>
                          )}
                        </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-b2b-muted">
                        <span>
                          {t.defaultLabel} <strong className="text-b2b-ink">{fmtSetting(def.default, def)}</strong>
                          {def.type === 'number' && (def.min !== undefined || def.max !== undefined) && (
                            <span>
                              {' '}
                              · {t.range(def.min ?? '−∞', def.max ?? '∞')}
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-1">
                          {t.usedBy}
                          {def.consumers.map((c) => (
                            <span key={c} className="rounded-none border border-b2b-line bg-b2b-bg px-1.5 py-px font-mono text-[10px] text-b2b-ink">
                              {c}
                            </span>
                          ))}
                        </span>
                        {meta?.updated_at && (
                          <span>
                            {t.changedBy} <strong className="text-b2b-ink">{meta.updated_by ?? t.system}</strong> · {fmt.dateTime(meta.updated_at)}
                          </span>
                        )}
                      </div>
                      </div>
                      <div className="min-w-0 xl:pt-0.5">
                        <SettingControl def={def} value={value} onChange={(v) => edit(def, v)} disabled={!sup} />
                        {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
                        {def.type === 'list' && <p className="mt-1 text-xs text-b2b-muted">{t.commaSeparated}</p>}
                                                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
                          <button
                            type="button"
                            className="flex items-center gap-1 text-b2b-muted hover:text-b2b-ink"
                            onClick={() => {
                              setHistoryKey(def.key);
                              document.getElementById('settings-history')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                          >
                            <History className="size-3.5" /> {t.history}
                          </button>
                          {isDirty && (
                            <button type="button" className="text-b2b-muted hover:text-b2b-ink" onClick={() => setDraft(({ [def.key]: _, ...rest }) => rest)}>
                              {t.undo}
                            </button>
                          )}
                          {sup && !isDefault && (
                            <button type="button" className="flex items-center gap-1 text-b2b-muted hover:text-b2b-ink" onClick={() => setReset([def.key])}>
                              <RotateCcw className="size-3.5" /> {t.resetToDefault}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <SettingsHistory k={historyKey} setK={setHistoryKey} />
          </div>
        </div>
      </QueryState>

      {dirty.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-b2b-line bg-b2b-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">
              {t.unsaved(dirty.length)}
              {hasClientErrors && <span className="ml-2 text-red-600">· {t.fixErrors(Object.keys(clientErrors).length)}</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="outline-ink" onClick={() => (setDraft({}), setServerErrors({}))}>
                {t.discard}
              </Button>
              <WriteButton variant="ink" disabled={hasClientErrors} onClick={() => setSaveOpen(true)}>
                {t.saveEllipsis}
              </WriteButton>
            </div>
          </div>
        </div>
      )}

      <SaveModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        changes={dirty.map((k) => ({ def: SETTINGS_BY_KEY[k], from: server(k), to: coerce(SETTINGS_BY_KEY[k], draft[k]).value }))}
        saving={saving}
        onConfirm={save}
      />
      <ReasonModal
        open={!!reset}
        onClose={() => setReset(null)}
        title={t.resetTitle}
        confirmLabel={t.reset}
        saving={saving}
        dangerous={reset?.some((k) => SETTINGS_BY_KEY[k]?.dangerous) ?? false}
        onConfirm={(reason) => reset && doReset(reset, reason)}
      >
        <ul className="mb-4 space-y-1 text-sm">
          {reset?.map((k) => {
            const def = SETTINGS_BY_KEY[k];
            return (
              <li key={k}>
                <strong>{def.label}</strong>: {fmtSetting(server(k), def)} → <strong>{fmtSetting(def.default, def)}</strong>
              </li>
            );
          })}
        </ul>
      </ReasonModal>
    </div>
  );
}

type ReasonModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  confirmLabel: string;
  saving: boolean;
  dangerous: boolean;
  onConfirm: (reason: string) => void;
  children?: React.ReactNode;
};

/** Modal alasan (min 5 karakter) + checkbox konfirmasi tambahan untuk kunci berisiko. State direset tiap dibuka. */
function ReasonModal(props: ReasonModalProps) {
  return props.open ? <ReasonModalBody {...props} /> : null;
}

function ReasonModalBody({
  onClose,
  title,
  confirmLabel,
  saving,
  dangerous,
  onConfirm,
  children,
}: ReasonModalProps) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const d = useDict('admin');
  const t = d.settings.reason;
  const ok = reason.trim().length >= 5 && (!dangerous || ack);
  return (
    <Modal open onClose={onClose} title={title} wide>
      {children}
      <Field label={t.label} hint={t.hint} error={reason && reason.trim().length < 5 ? t.tooShort : undefined}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.placeholder} />
      </Field>
      {dangerous && (
        <label className="mt-3 flex items-start gap-2.5 rounded-none border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4" />
          <span>{t.ack}</span>
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline-ink" onClick={onClose}>
          {d.common.cancel}
        </Button>
        <Button variant={dangerous ? 'danger' : 'ink'} loading={saving} disabled={!ok} onClick={() => onConfirm(reason.trim())}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

function SaveModal({
  open,
  onClose,
  changes,
  saving,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  changes: { def: SettingDef; from: unknown; to: unknown }[];
  saving: boolean;
  onConfirm: (reason: string) => void;
}) {
  const dangerous = changes.some((c) => c.def.dangerous);
  const t = useDict('admin').settings;
  return (
    <ReasonModal open={open} onClose={onClose} title={t.saveTitle(changes.length)} confirmLabel={t.saveApply} saving={saving} dangerous={dangerous} onConfirm={onConfirm}>
      <ul className="mb-4 divide-y divide-b2b-line rounded-none border border-b2b-line text-sm">
        {changes.map(({ def, from, to }) => (
          <li key={def.key} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
            <span className="font-bold">
              {def.label}
              {def.dangerous && <AlertTriangle className="ml-1 inline size-3.5 text-red-600" />}
            </span>
            <span className="max-w-full truncate text-b2b-muted">
              {fmtSetting(from, def)} → <strong className="text-b2b-ink">{fmtSetting(to, def)}</strong>
            </span>
          </li>
        ))}
      </ul>
    </ReasonModal>
  );
}

function SettingsHistory({ k, setK }: { k: string; setK: (k: string) => void }) {
  const t = useDict('admin').settings;
  const [limit, setLimit] = useState<number>(5);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['platform-settings-history', k],
    queryFn: () => api<{ data: SettingsHistoryItem[] }>('/v1/admin/platform/settings/history', { query: { key: k || undefined } }),
  });
  const all = q.data?.data ?? [];
  const rows = limit ? all.slice(0, limit) : all;
  /** Nilai lengkap untuk panel detail (objek → JSON rapi). */
  const full = (v: unknown, def?: SettingDef) => (v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v, null, 2) : fmtSetting(v, def));
  return (
    <Card
      title={
        <span id="settings-history" className="flex scroll-mt-6 items-center gap-2">
          <History className="size-4" /> {t.historyTitle}
        </span>
      }
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={k} onChange={(e) => setK(e.target.value)} aria-label={t.allSettings} className="!min-h-9 !w-56 !py-1.5 text-sm">
            <option value="">{t.allSettings}</option>
            {SETTINGS.map((s) => (
              <option key={s.key} value={s.key}>
                {SETTING_GROUPS[s.group].label} · {s.label}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 font-label text-[10.5px] font-bold tracking-[0.12em] text-b2b-muted uppercase">
            {t.historyView}
            <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} className="!min-h-9 !w-36 !py-1.5 font-sans text-sm tracking-normal normal-case">
              {[5, 10, 25].map((n) => (
                <option key={n} value={n}>
                  {t.historyRows(n)}
                </option>
              ))}
              <option value="0">{t.historyAll}</option>
            </Select>
          </label>
        </div>
      }
    >
      <QueryState q={q} empty={q.data && !all.length ? <Empty title={t.noHistory} /> : undefined}>
        <Table head={[...t.historyHead, '']} className="border-0">
          {rows.map((h) => {
            const def = SETTINGS_BY_KEY[h.key];
            const isOpen = open === h.id;
            return (
              <Fragment key={h.id}>
                <tr>
                  <td className="whitespace-nowrap">{fmt.dateTime(h.created_at)}</td>
                  <td className="max-w-[14rem]">
                    <span className="block truncate">{def?.label ?? h.key}</span>
                    <span className="block truncate font-mono text-xs font-normal text-b2b-muted">{h.key}</span>
                  </td>
                  <td className="max-w-[18rem]">
                    <span className="flex min-w-0 items-center gap-1.5" title={`${fmtSetting(h.old_value, def)} → ${fmtSetting(h.new_value, def)}`}>
                      <span className="min-w-0 truncate text-b2b-muted line-through">{fmtSetting(h.old_value, def)}</span>
                      <span className="shrink-0 text-b2b-muted">→</span>
                      <strong className="min-w-0 truncate">{fmtSetting(h.new_value, def)}</strong>
                    </span>
                  </td>
                  <td className="max-w-[16rem]">
                    <span className="block truncate" title={h.reason}>{h.reason}</span>
                  </td>
                  <td className="whitespace-nowrap">{h.by_name ?? h.by_user_id?.slice(0, 8) ?? t.system}</td>
                  <td className="text-right">
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.id)} className="inline-flex items-center gap-1 font-label text-[10.5px] font-bold tracking-[0.1em] text-b2b-muted uppercase hover:text-b2b-ink">
                      {isOpen ? t.historyHide : t.historyDetail}
                      <ChevronDown className={cx('size-3.5 transition', isOpen && 'rotate-180')} />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} className="!font-normal">
                      <div className="grid gap-3 md:grid-cols-2">
                        {([['historyBefore', h.old_value], ['historyAfter', h.new_value]] as const).map(([lbl, v]) => (
                          <div key={lbl} className="min-w-0">
                            <p className="mb-1 font-label text-[10px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{t[lbl]}</p>
                            <pre className="max-h-64 overflow-auto border-2 border-b2b-line bg-b2b-bg p-3 font-mono text-xs whitespace-pre-wrap break-words">{full(v, def)}</pre>
                          </div>
                        ))}
                        <p className="text-xs text-b2b-muted md:col-span-2">{h.reason}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </Table>
        {all.length > rows.length && (
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-b2b-muted">
            <span>{t.historyShowing(rows.length, all.length)}</span>
            <button type="button" onClick={() => setLimit(0)} className="font-label text-[10.5px] font-bold tracking-[0.1em] uppercase hover:text-b2b-ink">
              {t.historyAll} →
            </button>
          </div>
        )}
      </QueryState>
    </Card>
  );
}
