import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, ImageUp, RotateCcw, Trash2 } from 'lucide-react';
import { BRANDING_MAX_BYTES, BRANDING_PUBLIC_PREFIX, coerceSetting, SETTING_GROUPS, SETTINGS, SETTINGS_BY_KEY, type SettingDef, type SettingGroup } from '@gema/domain/settings';
import { api, ApiError, fmt } from '@/lib/api';
import type { SettingsHistoryItem, SettingsResponse } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { DEFAULT_BRAND } from '@/lib/platform';
import { fmtBytes, ReadOnlyNote, useIsSuperAdmin, WriteButton } from './Platform';

// Pengaturan platform (docs/API.md §9). Form dirender dari registri @gema/domain/settings;
// draf disimpan sebagai nilai input mentah lalu divalidasi dengan coerceSetting sebelum dikirim.

// Grup `access` dikelola di halaman matriks "Peran & Akses" (/admin/platform/roles), bukan form umum.
const GROUPS: SettingGroup[] = (Object.keys(SETTING_GROUPS) as SettingGroup[]).filter((g) => g !== 'access');

/** Nilai server → nilai input (angka & daftar sebagai teks agar bisa diketik bebas). */
function toInput(def: SettingDef, v: unknown): unknown {
  if (def.type === 'boolean') return !!v;
  if (def.type === 'number') return v == null ? '' : String(v);
  if (def.type === 'list') return Array.isArray(v) ? v.join(', ') : String(v ?? '');
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
  if (typeof v === 'boolean') return v ? 'Aktif' : 'Mati';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(kosong)';
  if (def?.type === 'enum') return def.options?.find((o) => o.value === v)?.label ?? String(v);
  if (typeof v === 'number') return `${v.toLocaleString('id-ID')}${def?.unit ? ' ' + def.unit : ''}`;
  if (def?.type === 'image' && typeof v === 'string') return v === '' ? '(bawaan GEMA)' : v.replace(BRANDING_PUBLIC_PREFIX, '');
  if (typeof v === 'string') return v === '' ? '(kosong)' : v;
  return JSON.stringify(v);
}

/** Path error dari backend bisa `key`, `changes.key`, atau `/changes/key`. */
function errorKey(path: string) {
  const k = path.replace(/^\/?changes[./]/, '').replace(/\//g, '.');
  return SETTINGS_BY_KEY[k] ? k : SETTINGS_BY_KEY[path] ? path : null;
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
      className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-emerald-500' : 'bg-stone-300')}
    >
      <span className={cx('inline-block size-5 rounded-full bg-white shadow transition', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
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
      rej(new Error('PNG tidak dapat dibaca'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Field gambar branding: unggah SVG/PNG ke bucket branding (POST /v1/admin/platform/branding?slot=…),
 * lalu path-nya menjadi nilai draf — diterapkan lewat tombol Simpan (alasan + riwayat seperti pengaturan lain).
 */
function ImageSettingField({ def, value, onChange, disabled }: { def: SettingDef; value: string; onChange: (v: unknown) => void; disabled: boolean }) {
  const rule = def.image!;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const darkBg = rule.background === 'dark';

  async function pick(f: File | undefined) {
    if (!f) return;
    const type = typeOf(f);
    try {
      if (!type) throw new Error('Hanya file SVG atau PNG');
      if (f.size > BRANDING_MAX_BYTES[type]) throw new Error(`Maksimal ${fmtBytes(BRANDING_MAX_BYTES[type])} untuk ${type === 'image/png' ? 'PNG' : 'SVG'}`);
      const blob = new Blob([f], { type });
      if (type === 'image/png') {
        const d = await pngDims(blob);
        if (Math.min(d.width, d.height) < rule.minPx) throw new Error(`Resolusi minimal ${rule.minPx} px (file ${d.width}×${d.height})`);
        if (rule.square && d.width !== d.height) throw new Error(`Ikon harus persegi 1:1 (file ${d.width}×${d.height})`);
      }
      setBusy(true);
      const r = await api<{ url: string; size: number; width: number | null; height: number | null }>('/v1/admin/platform/branding', {
        method: 'POST',
        query: { slot: rule.slot },
        body: blob,
      });
      onChange(r.url);
      setInfo(`${f.name} · ${fmtBytes(r.size)}${r.width && r.height ? ` · ${Math.round(r.width)}×${Math.round(r.height)}` : ''} — klik Simpan untuk menerapkan`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className={cx(
          'grid h-24 place-items-center rounded-xl border border-b2b-line p-3',
          rule.square ? 'w-24' : 'w-64',
          darkBg ? 'bg-[#121212]' : 'bg-white',
        )}
        title={darkBg ? 'Pratinjau di latar gelap' : 'Pratinjau di latar terang'}
      >
        {/* Kosong = logo resmi bawaan aplikasi (bukan logo yang sedang aktif). */}
        <img
          src={value || { logo: DEFAULT_BRAND.logo, logo_dark: DEFAULT_BRAND.logoDark, icon: DEFAULT_BRAND.icon }[rule.slot]}
          alt={`Pratinjau ${def.label}`}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept=".svg,.png,image/svg+xml,image/png" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="outline-ink" disabled={disabled || busy} onClick={() => input.current?.click()}>
            <ImageUp className="size-4" /> {busy ? 'Mengunggah…' : value ? 'Ganti file' : 'Unggah SVG/PNG'}
          </Button>
          {value && (
            <Button size="sm" variant="outline-ink" disabled={disabled || busy} onClick={() => onChange('')}>
              <Trash2 className="size-4" /> Pakai bawaan
            </Button>
          )}
        </div>
        <p className="text-xs text-b2b-muted">
          SVG ≤ {fmtBytes(BRANDING_MAX_BYTES['image/svg+xml'])} (tanpa skrip/tautan eksternal) atau PNG ≤ {fmtBytes(BRANDING_MAX_BYTES['image/png'])}
          {rule.square ? `, persegi ≥ ${rule.minPx} px` : `, tinggi ≥ ${rule.minPx} px`}.
        </p>
        {info && <p className="text-xs font-semibold text-emerald-700">{info}</p>}
      </div>
    </div>
  );
}

function SettingControl({ def, value, onChange, disabled }: { def: SettingDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  switch (def.type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <Toggle checked={!!value} onChange={onChange} disabled={disabled} label={def.label} />
          <span className="text-sm font-semibold">{value ? 'Aktif' : 'Mati'}</span>
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
      return <Input value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="nilai1, nilai2" className="font-mono text-sm" />;
    case 'image':
      return <ImageSettingField def={def} value={String(value ?? '')} onChange={onChange} disabled={disabled} />;
    case 'text':
      return <Textarea value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} maxLength={2000} />;
    default:
      return <Input value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} maxLength={200} />;
  }
}

export function PlatformSettings() {
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
      toast.success(`${dirty.length} pengaturan disimpan · versi ${data?.version ?? ''}`);
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
      toast.success(`${keys.length} pengaturan dikembalikan ke default`);
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
      setReset(null);
      onSaved(data);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  const defs = SETTINGS.filter((s) => s.group === group);
  const nonDefaultInGroup = defs.filter((d) => !same(server(d.key), d.default)).map((d) => d.key);
  const hasClientErrors = Object.keys(clientErrors).length > 0;

  return (
    <div className={dirty.length ? 'pb-20' : undefined}>
      <PageHeader
        title="Pengaturan Platform"
        subtitle={`Konfigurasi kebijakan tanpa deploy (BRD §12.3). Perubahan diterapkan otomatis ke semua service${q.data ? ` · versi ${q.data.version}` : ''}.`}
      />
      <ReadOnlyNote>Mode baca. Hanya Super Admin yang dapat mengubah pengaturan platform.</ReadOnlyNote>
      <QueryState q={q}>
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Grup pengaturan">
            {GROUPS.map((g) => {
              const n = dirty.filter((k) => SETTINGS_BY_KEY[k].group === g).length;
              const err = Object.keys({ ...clientErrors, ...serverErrors }).some((k) => SETTINGS_BY_KEY[k]?.group === g);
              return (
                <button
                  key={g}
                  onClick={() => setParams({ group: g }, { replace: true })}
                  className={cx(
                    'flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition',
                    g === group ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink',
                  )}
                >
                  {SETTING_GROUPS[g].label}
                  {(n > 0 || err) && <span className={cx('grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold', err ? 'bg-red-500 text-white' : 'bg-amber-400 text-black')}>{n || '!'}</span>}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 space-y-6">
            <Card
              title={SETTING_GROUPS[group].label}
              action={
                sup && nonDefaultInGroup.length > 0 ? (
                  <Button size="sm" variant="outline-ink" icon={<RotateCcw className="size-4" />} onClick={() => setReset(nonDefaultInGroup)}>
                    Reset grup ke default
                  </Button>
                ) : undefined
              }
            >
              <p className="-mt-2 mb-4 text-sm text-b2b-muted">{SETTING_GROUPS[group].description}</p>
              <div className="divide-y divide-b2b-line">
                {defs.map((def) => {
                  const isDirty = def.key in draft;
                  const value = isDirty ? draft[def.key] : toInput(def, server(def.key));
                  const error = serverErrors[def.key] ?? clientErrors[def.key];
                  const meta = q.data?.meta[def.key];
                  const isDefault = same(server(def.key), def.default);
                  return (
                    <div key={def.key} id={`setting-${def.key}`} className={cx('py-5 first:pt-0 last:pb-0', isDirty && '-mx-5 bg-amber-500/5 px-5')}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-bold">
                            {def.label}
                            {def.dangerous && (
                              <Badge tone="red">
                                <AlertTriangle className="size-3" /> Berisiko
                              </Badge>
                            )}
                            {def.public && <Badge tone="blue">Publik</Badge>}
                            {def.planned && <Badge tone="purple">Disiapkan</Badge>}
                            {isDirty && <Badge tone="amber">Diubah</Badge>}
                          </p>
                          <p className="font-mono text-[11px] text-b2b-muted">{def.key}</p>
                          {def.description && <p className="mt-1 text-sm text-b2b-muted">{def.description}</p>}
                          {def.planned && (
                            <p className="mt-1.5 text-xs font-semibold text-violet-700">Belum ditegakkan — {def.planned} Nilai disimpan dan berlaku otomatis saat modulnya aktif.</p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-3 text-xs font-bold">
                          <button
                            type="button"
                            className="flex items-center gap-1 text-b2b-muted hover:text-b2b-ink"
                            onClick={() => {
                              setHistoryKey(def.key);
                              document.getElementById('settings-history')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                          >
                            <History className="size-3.5" /> Riwayat
                          </button>
                          {isDirty && (
                            <button type="button" className="text-b2b-muted hover:text-b2b-ink" onClick={() => setDraft(({ [def.key]: _, ...rest }) => rest)}>
                              Batalkan
                            </button>
                          )}
                          {sup && !isDefault && (
                            <button type="button" className="flex items-center gap-1 text-b2b-muted hover:text-b2b-ink" onClick={() => setReset([def.key])}>
                              <RotateCcw className="size-3.5" /> Reset ke default
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-3">
                        <SettingControl def={def} value={value} onChange={(v) => edit(def, v)} disabled={!sup} />
                        {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
                        {def.type === 'list' && <p className="mt-1 text-xs text-b2b-muted">Pisahkan dengan koma.</p>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-b2b-muted">
                        <span>
                          Default: <strong className="text-b2b-ink">{fmtSetting(def.default, def)}</strong>
                          {def.type === 'number' && (def.min !== undefined || def.max !== undefined) && (
                            <span>
                              {' '}
                              · rentang {def.min ?? '−∞'}–{def.max ?? '∞'}
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-1">
                          Dipakai:
                          {def.consumers.map((c) => (
                            <span key={c} className="rounded border border-b2b-line bg-b2b-bg px-1.5 py-px font-mono text-[10px] text-b2b-ink">
                              {c}
                            </span>
                          ))}
                        </span>
                        {meta?.updated_at && (
                          <span>
                            Diubah oleh <strong className="text-b2b-ink">{meta.updated_by ?? 'sistem'}</strong> · {fmt.dateTime(meta.updated_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <SettingsHistory k={historyKey} setK={setHistoryKey} />
          </div>
        </div>
      </QueryState>

      {dirty.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-b2b-line bg-b2b-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">
              {dirty.length} perubahan belum disimpan
              {hasClientErrors && <span className="ml-2 text-red-600">· perbaiki {Object.keys(clientErrors).length} kesalahan</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="outline-ink" onClick={() => (setDraft({}), setServerErrors({}))}>
                Buang perubahan
              </Button>
              <WriteButton variant="ink" disabled={hasClientErrors} onClick={() => setSaveOpen(true)}>
                Simpan…
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
        title="Kembalikan ke default"
        confirmLabel="Reset"
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
  const ok = reason.trim().length >= 5 && (!dangerous || ack);
  return (
    <Modal open onClose={onClose} title={title} wide>
      {children}
      <Field label="Alasan perubahan" hint="min. 5 karakter, tercatat di riwayat & audit log" error={reason && reason.trim().length < 5 ? 'Alasan minimal 5 karakter' : undefined}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Promo komisi Desember sesuai keputusan direksi" />
      </Field>
      {dangerous && (
        <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4" />
          <span>Saya memahami perubahan ini berisiko tinggi dan langsung memengaruhi seluruh pengguna (mis. menolak transaksi atau mematikan modul).</span>
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline-ink" onClick={onClose}>
          Batal
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
  return (
    <ReasonModal open={open} onClose={onClose} title={`Simpan ${changes.length} perubahan`} confirmLabel="Simpan & terapkan" saving={saving} dangerous={dangerous} onConfirm={onConfirm}>
      <ul className="mb-4 divide-y divide-b2b-line rounded-lg border border-b2b-line text-sm">
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
  const q = useQuery({
    queryKey: ['platform-settings-history', k],
    queryFn: () => api<{ data: SettingsHistoryItem[] }>('/v1/admin/platform/settings/history', { query: { key: k || undefined } }),
  });
  return (
    <Card
      title={
        <span id="settings-history" className="flex scroll-mt-6 items-center gap-2">
          <History className="size-4" /> Riwayat perubahan
        </span>
      }
      action={
        <Select value={k} onChange={(e) => setK(e.target.value)} className="w-64 py-1.5 text-sm">
          <option value="">Semua pengaturan</option>
          {SETTINGS.map((s) => (
            <option key={s.key} value={s.key}>
              {SETTING_GROUPS[s.group].label} · {s.label}
            </option>
          ))}
        </Select>
      }
    >
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Belum ada perubahan" /> : undefined}>
        <Table head={['Waktu', 'Pengaturan', 'Perubahan', 'Alasan', 'Oleh']} className="border-0">
          {q.data?.data.map((h) => {
            const def = SETTINGS_BY_KEY[h.key];
            return (
              <tr key={h.id} className="align-top">
                <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(h.created_at)}</td>
                <td className="px-4 py-2.5">
                  <span className="font-semibold">{def?.label ?? h.key}</span>
                  <span className="block font-mono text-[11px] text-b2b-muted">{h.key}</span>
                </td>
                <td className="max-w-xs px-4 py-2.5 text-xs">
                  <span className="text-b2b-muted line-through">{fmtSetting(h.old_value, def)}</span> → <strong>{fmtSetting(h.new_value, def)}</strong>
                </td>
                <td className="max-w-xs px-4 py-2.5 text-xs">{h.reason}</td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap">{h.by_name ?? h.by_user_id?.slice(0, 8) ?? 'sistem'}</td>
              </tr>
            );
          })}
        </Table>
      </QueryState>
    </Card>
  );
}
