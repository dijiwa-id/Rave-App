import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Eye, EyeOff, GripVertical, ImageUp, Lock, Monitor, MousePointerClick, Plus, Redo2, RotateCcw, Smartphone, Tablet, Trash2, Undo2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { coerceLanding, LANDING_DEFAULT, LANDING_LIMITS, type L10n, type LandingContent, type LandingSectionId } from '@rave/domain/landing';
import { coerceSetting, PARTNERS_MAX, SETTINGS_BY_KEY, type PartnerEntry } from '@rave/domain/settings';
import { api, ApiError, fmt } from '@/lib/api';
import { dict, useDict, useLocale, type Locale } from '@/lib/i18n';
import { PREVIEW_MSG } from '@/lib/landing';
import type { SettingsResponse } from '@/lib/types';
import { isSuperAdmin, useAuth } from '@/stores/auth';
import { Button, cx, ErrorState, Input, Skeleton, Textarea, toast } from '@/components/ui';
import { RaveMark } from '@/components/ui/RaveLogo';
import { uploadBranding } from './PlatformSettings';

const KEY = 'content.landing';
/** Logo partner pita kuning — kunci pengaturan terpisah (format lama dipertahankan), diedit & dipublikasikan bersama landing. */
const PARTNERS_KEY = 'content.partners';
const PARTNER_RULE = SETTINGS_BY_KEY[PARTNERS_KEY].image!;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Draf editor: konten landing + daftar partner, agar undo/redo, status draf, dan publikasi mencakup keduanya. */
interface Draft {
  landing: LandingContent;
  partners: PartnerEntry[];
}

function validate(v: Draft): string | null {
  try {
    coerceLanding(v.landing);
  } catch (e) {
    return (e as Error).message;
  }
  const unnamed = v.partners.findIndex((p) => !p.name.trim());
  if (unnamed >= 0) return dict('cms').band.partners.nameRequired(unnamed + 1);
  try {
    coerceSetting(PARTNERS_KEY, v.partners);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Nilai tersimpan → daftar partner yang aman (rusak/kosong → []). */
function savedPartners(v: unknown): PartnerEntry[] {
  try {
    return coerceSetting(PARTNERS_KEY, v ?? []) as PartnerEntry[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Field dwibahasa: ID & EN berdampingan, penghitung karakter, EN boleh kosong (jatuh ke ID).
// ---------------------------------------------------------------------------------------------
function L10nField({ label, hint, value, onChange, max, multiline, rows = 3 }: { label: string; hint?: string; value: L10n; onChange: (v: L10n) => void; max: number; multiline?: boolean; rows?: number }) {
  const d = useDict('cms');
  const box = (lang: 'id' | 'en') => {
    const v = value[lang];
    const over = v.length > max;
    const missing = lang === 'id' && !v.trim();
    const common = {
      value: v,
      'aria-label': `${label} (${lang.toUpperCase()})`,
      placeholder: lang === 'en' ? d.field.enFallback : undefined,
      onChange: (e: { target: { value: string } }) => onChange({ ...value, [lang]: e.target.value }),
      className: cx('!pl-11', (over || missing) && '!border-red-500'),
    };
    return (
      <div className="relative">
        <span className={cx('absolute top-2.5 left-2.5 z-10 px-1.5 py-0.5 font-label text-[10px] font-bold tracking-[0.12em]', lang === 'id' ? 'bg-rave-purple text-white' : 'bg-b2b-ink text-b2b-on-ink')}>
          {lang === 'id' ? d.field.idTag : d.field.enTag}
        </span>
        {multiline ? <Textarea rows={rows} {...common} /> : <Input {...common} />}
        <span className={cx('mt-1 block text-right font-label text-[10px] tabular-nums', over ? 'text-red-500' : 'text-b2b-muted')}>{d.field.chars(v.length, max)}</span>
      </div>
    );
  };
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-bold text-b2b-ink">
        {label}
        {hint && <span className="ml-2 font-normal text-b2b-muted">{hint}</span>}
      </legend>
      <div className="grid gap-y-1">
        {box('id')}
        {box('en')}
      </div>
    </fieldset>
  );
}

function TextField({ label, hint, value, onChange, max, mono }: { label: string; hint?: string; value: string; onChange: (v: string) => void; max: number; mono?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-b2b-ink">
        {label}
        {hint && <span className="ml-2 font-normal text-b2b-muted">{hint}</span>}
      </span>
      <Input value={value} maxLength={max + 20} onChange={(e) => onChange(e.target.value)} className={cx(mono && 'font-mono text-sm', value.length > max && '!border-red-500')} />
    </label>
  );
}

/** Editor daftar: tambah, hapus, naik/turun, dengan batas min/maks. */
function ListEditor<T>({ items, onChange, limits, make, render }: { items: T[]; onChange: (v: T[]) => void; limits: { min: number; max: number }; make: () => T; render: (item: T, set: (v: T) => void, i: number) => ReactNode }) {
  const d = useDict('cms');
  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="border-2 border-b2b-line bg-b2b-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-label text-[11px] font-bold tracking-[0.12em] text-b2b-muted">{d.list.item(i + 1)}</span>
            <span className="flex gap-1">
              <IconAct label={d.list.up} disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp className="size-4" />} />
              <IconAct label={d.list.down} disabled={i === items.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown className="size-4" />} />
              <IconAct label={d.list.remove} disabled={items.length <= limits.min} onClick={() => onChange(items.filter((_, k) => k !== i))} icon={<Trash2 className="size-4" />} danger />
            </span>
          </div>
          {render(it, (v) => onChange(items.map((x, k) => (k === i ? v : x))), i)}
        </div>
      ))}
      <Button type="button" variant="outline-ink" size="sm" icon={<Plus className="size-4" />} disabled={items.length >= limits.max} onClick={() => onChange([...items, make()])}>
        {d.list.add}
      </Button>
    </div>
  );
}
function IconAct({ label, icon, onClick, disabled, danger }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cx('grid size-8 place-items-center border-2 border-b2b-line text-b2b-muted transition hover:text-b2b-ink disabled:opacity-30', danger && 'hover:border-red-500 hover:text-red-500')}>
      {icon}
    </button>
  );
}

const emptyL = (): L10n => ({ id: '', en: '' });

type BlockId = 'hero' | 'band' | LandingSectionId;
type Device = 'desktop' | 'tablet' | 'mobile';
const DEVICE_W: Record<Device, number> = { desktop: 1280, tablet: 820, mobile: 390 };
/** Section yang isinya diedit di CMS; sisanya hanya urutan & visibilitas (sumber konten lain). */
const EDITABLE: BlockId[] = ['hero', 'band', 'stats', 'testimonial', 'faq', 'sponsor'];

// ---------------------------------------------------------------------------------------------
// Riwayat draf (undo/redo). Ketikan beruntun digabung (jeda < 600 ms) agar satu undo = satu perubahan berarti.
// ---------------------------------------------------------------------------------------------
function useHistory(initial: Draft | null) {
  const [state, setState] = useState<{ past: Draft[]; present: Draft | null; future: Draft[] }>({ past: [], present: initial, future: [] });
  const last = useRef(0);
  const set = (next: Draft) =>
    setState((s) => {
      if (!s.present || same(next, s.present)) return s;
      const now = Date.now();
      const merge = now - last.current < 600 && s.past.length > 0;
      last.current = now;
      return { past: merge ? s.past : [...s.past.slice(-79), s.present], present: next, future: [] };
    });
  const reset = (v: Draft) => setState({ past: [], present: v, future: [] });
  const undo = () => setState((s) => (s.past.length && s.present ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  const redo = () => setState((s) => (s.future.length && s.present ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  return { draft: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

// ---------------------------------------------------------------------------------------------
// Kanvas: iframe landing (?cms_preview) diskalakan agar muat; pilih section dengan klik di kanvas.
// ---------------------------------------------------------------------------------------------
function Canvas({ draft, partners, device, lang, selected, onPick }: { draft: LandingContent; partners: PartnerEntry[]; device: Device; lang: Locale; selected: BlockId | null; onPick: (id: BlockId) => void }) {
  const d = useDict('cms');
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  const vw = DEVICE_W[device];
  const pad = 32;
  const scale = Math.min(1, (size.w - pad * 2) / vw);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const post = (msg: object) => frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  const sync = () => {
    post({ type: PREVIEW_MSG, content: draft, partners });
    post({ type: `${PREVIEW_MSG}:select`, id: selected });
  };
  useEffect(() => post({ type: PREVIEW_MSG, content: draft, partners }), [draft, partners]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => post({ type: `${PREVIEW_MSG}:select`, id: selected }), [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === `${PREVIEW_MSG}:ready`) sync();
      if (e.data?.type === `${PREVIEW_MSG}:pick`) onPick(e.data.id as BlockId);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });
  const frameH = (size.h - pad * 2) / scale;
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-[#0f0e11] bg-[radial-gradient(rgba(237,237,237,0.06)_1px,transparent_1.3px)] bg-[length:14px_14px]">
      <div className="absolute inset-0 grid place-items-center" style={{ padding: pad }}>
        <div className="relative shadow-[8px_8px_0_#F4C21F] ring-2 ring-[#0b0a0c] transition-[width] duration-300" style={{ width: vw * scale, height: size.h - pad * 2 }}>
          <iframe
            ref={frame}
            key={lang}
            title={d.preview.title}
            src={`/?cms_preview=1&cms_lang=${lang}`}
            onLoad={sync}
            className="absolute top-0 left-0 origin-top-left border-0 bg-[#181818]"
            style={{ width: vw, height: frameH, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 bg-black/70 px-3 py-1.5 font-label text-[10.5px] font-bold tracking-[0.1em] text-white/75 uppercase">
        <MousePointerClick className="size-3.5 text-rave-primary" /> {d.builder.canvasHint} · {Math.round(scale * 100)}%
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Navigator struktur: hero & pita terkunci di atas; section lain dapat diseret (atau naik/turun via tombol).
// ---------------------------------------------------------------------------------------------
function Structure({ draft, onChange, onSelect }: { draft: LandingContent; onChange: (v: LandingContent) => void; onSelect: (id: BlockId) => void }) {
  const d = useDict('cms');
  const [dragging, setDragging] = useState<LandingSectionId | null>(null);
  const [over, setOver] = useState<LandingSectionId | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.order.length || from === to) return;
    const order = [...draft.order];
    const [x] = order.splice(from, 1);
    order.splice(to, 0, x);
    onChange({ ...draft, order });
  };
  const toggle = (id: LandingSectionId) => onChange({ ...draft, sections: { ...draft.sections, [id]: !draft.sections[id] } });
  const row = 'group flex w-full items-center gap-2 border-2 bg-b2b-card px-2 py-2 text-left text-sm font-bold transition';
  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="mb-2 font-label text-[10.5px] font-bold tracking-[0.14em] text-b2b-muted uppercase">{d.builder.pinned}</p>
        <div className="space-y-1.5">
          {(['hero', 'band'] as const).map((id) => (
            <button key={id} type="button" onClick={() => onSelect(id)} className={cx(row, 'border-b2b-line hover:border-b2b-ink')}>
              <Lock className="size-3.5 shrink-0 text-b2b-muted" />
              <span className="flex-1">{d.sectionNames[id]}</span>
              <span className="font-label text-[10px] tracking-[0.1em] text-rave-accent uppercase opacity-0 transition group-hover:opacity-100">{d.builder.content}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-label text-[10.5px] font-bold tracking-[0.14em] text-b2b-muted uppercase">{d.builder.structure}</p>
        <p className="mb-2 text-xs text-b2b-muted">{d.builder.dragHint}</p>
        <ol className="space-y-1.5">
          {draft.order.map((id, i) => {
            const on = draft.sections[id];
            return (
              <li
                key={id}
                draggable
                onDragStart={(e) => {
                  setDragging(id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(id);
                }}
                onDragLeave={() => over === id && setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) move(draft.order.indexOf(dragging), i);
                  setDragging(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className={cx(row, 'cursor-grab active:cursor-grabbing', dragging === id ? 'border-dashed border-rave-accent opacity-50' : over === id ? 'border-rave-primary shadow-[inset_0_3px_0_var(--color-rave-primary)]' : 'border-b2b-line hover:border-b2b-ink', !on && 'bg-transparent')}
              >
                <GripVertical className="size-4 shrink-0 text-b2b-muted" aria-hidden />
                <button type="button" onClick={() => onSelect(id)} className={cx('min-w-0 flex-1 truncate text-left', !on && 'text-b2b-muted line-through decoration-2')}>
                  {d.sectionNames[id]}
                </button>
                {!EDITABLE.includes(id) && <span className="hidden font-label text-[9.5px] tracking-[0.08em] text-b2b-muted uppercase sm:inline">auto</span>}
                <span className="flex shrink-0 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
                  <IconAct label={d.builder.moveUp} disabled={i === 0} onClick={() => move(i, i - 1)} icon={<ArrowUp className="size-3.5" />} />
                  <IconAct label={d.builder.moveDown} disabled={i === draft.order.length - 1} onClick={() => move(i, i + 1)} icon={<ArrowDown className="size-3.5" />} />
                  <IconAct label={on ? d.builder.hide : d.builder.show} onClick={() => toggle(id)} icon={on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Logo partner pita kuning: kartu ringkas (panel 380 px) — logo, nama, tautan, urutan, hapus.
// Logo diunggah ke bucket branding (slot `partner`) dan baru tampil publik setelah draf dipublikasikan.
// ---------------------------------------------------------------------------------------------
function PartnersField({ items, onChange }: { items: PartnerEntry[]; onChange: (v: PartnerEntry[]) => void }) {
  const t = useDict('cms').band.partners;
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const patch = (i: number, p: Partial<PartnerEntry>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  async function pick(f: File | undefined) {
    const i = target.current;
    if (!f || i == null) return;
    try {
      setBusy(i);
      const r = await uploadBranding(f, PARTNER_RULE);
      patch(i, { logo: r.url });
      toast.success(t.uploaded(items[i]?.name.trim() || t.partner));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      target.current = null;
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const choose = (i: number) => {
    target.current = i;
    fileRef.current?.click();
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-b2b-muted">{t.hint}</p>
      <input ref={fileRef} type="file" accept=".svg,.png,image/svg+xml,image/png" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {items.length === 0 && <p className="border border-dashed border-b2b-line px-3 py-4 text-xs text-b2b-muted">{t.empty}</p>}
      <ol className="space-y-3">
        {items.map((pt, i) => (
          <li key={i} className="space-y-2.5 border-2 border-b2b-line bg-b2b-card p-3">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={busy != null}
                onClick={() => choose(i)}
                title={pt.logo ? t.replaceLogo : t.logo}
                className="flex h-14 min-w-0 flex-1 items-center justify-center overflow-hidden bg-rave-mustard px-3 text-rave-ink transition hover:brightness-95 disabled:opacity-60"
              >
                {busy === i ? (
                  <span className="text-xs font-bold">{t.uploading}</span>
                ) : pt.logo ? (
                  <img src={pt.logo} alt={t.logoAlt(pt.name)} className="h-9 w-full object-contain [filter:brightness(0)]" />
                ) : pt.name.trim() ? (
                  <span className="truncate font-display text-xl leading-none uppercase">{pt.name}</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <ImageUp className="size-4" /> {t.logo}
                  </span>
                )}
              </button>
              <div className="grid grid-cols-2 gap-1">
                <IconAct label={t.moveUp} icon={<ArrowUp className="size-3.5" />} onClick={() => move(i, -1)} disabled={i === 0} />
                <IconAct label={t.moveDown} icon={<ArrowDown className="size-3.5" />} onClick={() => move(i, 1)} disabled={i === items.length - 1} />
                <IconAct label={pt.logo ? t.removeLogo : t.logo} icon={<ImageUp className={cx('size-3.5', pt.logo && 'opacity-50')} />} onClick={() => (pt.logo ? patch(i, { logo: '' }) : choose(i))} />
                <IconAct label={t.remove} icon={<Trash2 className="size-3.5" />} onClick={() => onChange(items.filter((_, j) => j !== i))} danger />
              </div>
            </div>
            <TextField label={t.name} value={pt.name} onChange={(v) => patch(i, { name: v })} max={80} />
            <TextField label={t.url} value={pt.url} onChange={(v) => patch(i, { url: v })} max={300} mono />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline-ink" disabled={items.length >= PARTNERS_MAX} onClick={() => onChange([...items, { name: '', logo: '', url: '' }])}>
          <Plus className="size-4" /> {t.add}
        </Button>
        <span className="font-label text-[10.5px] text-b2b-muted">{t.rules(PARTNER_RULE.minPx, items.length, PARTNERS_MAX)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Properti section terpilih
// ---------------------------------------------------------------------------------------------
function Properties({ id, draft, set, partners, setPartners }: { id: BlockId; draft: LandingContent; set: (v: LandingContent) => void; partners: PartnerEntry[]; setPartners: (v: PartnerEntry[]) => void }) {
  const d = useDict('cms');
  const put = <K extends keyof LandingContent>(k: K, v: LandingContent[K]) => set({ ...draft, [k]: v });
  const hero = draft.hero;
  const setHero = <K extends keyof LandingContent['hero']>(k: K, v: LandingContent['hero'][K]) => put('hero', { ...hero, [k]: v });
  const group = (title: string, children: ReactNode) => (
    <section className="space-y-5 border-b-2 border-b2b-line p-4 last:border-b-0">
      <p className="font-label text-[10.5px] font-bold tracking-[0.14em] text-b2b-muted uppercase">{title}</p>
      {children}
    </section>
  );
  const visibility =
    id !== 'hero' && id !== 'band'
      ? group(
          d.builder.visibility,
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-b2b-muted">{d.builder.visibleHint}</p>
            <button
              type="button"
              role="switch"
              aria-checked={draft.sections[id]}
              onClick={() => put('sections', { ...draft.sections, [id]: !draft.sections[id] })}
              className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 border-2 px-3 font-label text-[11px] font-bold tracking-[0.08em] uppercase transition', draft.sections[id] ? 'border-b2b-ink bg-rave-primary text-rave-on-primary' : 'border-b2b-line text-b2b-muted')}
            >
              {draft.sections[id] ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              {draft.sections[id] ? d.sections.shown : d.sections.hidden}
            </button>
          </div>,
        )
      : null;

  let content: ReactNode = null;
  if (id === 'hero')
    content = (
      <>
        {group(
          d.builder.content,
          <>
            <L10nField label={d.hero.kicker} value={hero.kicker} onChange={(v) => setHero('kicker', v)} max={60} />
            <L10nField label={d.hero.line1} value={hero.line1} onChange={(v) => setHero('line1', v)} max={22} />
            <L10nField label={d.hero.line2} value={hero.line2} onChange={(v) => setHero('line2', v)} max={22} />
            <L10nField label={d.hero.prefix} value={hero.prefix} onChange={(v) => setHero('prefix', v)} max={8} />
            <div>
              <p className="mb-1 text-sm font-bold">{d.hero.words}</p>
              <p className="mb-3 text-xs text-b2b-muted">{d.hero.wordsHint}</p>
              <ListEditor items={hero.words} onChange={(v) => setHero('words', v)} limits={LANDING_LIMITS.words} make={emptyL} render={(w, setW) => <L10nField label={d.hero.words} value={w} onChange={setW} max={14} />} />
            </div>
            <L10nField label={d.hero.lead} value={hero.lead} onChange={(v) => setHero('lead', v)} max={280} multiline />
          </>,
        )}
        {group(
          d.hero.badge,
          <>
            <L10nField label={d.hero.badge} value={hero.badge} onChange={(v) => setHero('badge', v)} max={16} />
            <L10nField label={d.hero.badgeLink} value={hero.badge_link} onChange={(v) => setHero('badge_link', v)} max={40} />
            <TextField label={d.hero.badgeHref} hint={d.hero.hrefHint} value={hero.badge_href} onChange={(v) => setHero('badge_href', v)} max={300} mono />
          </>,
        )}
        {group(
          d.hero.ctaPrimary + ' · ' + d.hero.ctaSecondary,
          <>
            <L10nField label={d.hero.ctaPrimary} value={hero.cta_primary} onChange={(v) => setHero('cta_primary', v)} max={32} />
            <TextField label={d.hero.href} value={hero.cta_primary_href} onChange={(v) => setHero('cta_primary_href', v)} max={300} mono />
            <L10nField label={d.hero.ctaSecondary} value={hero.cta_secondary} onChange={(v) => setHero('cta_secondary', v)} max={32} />
            <TextField label={d.hero.href} value={hero.cta_secondary_href} onChange={(v) => setHero('cta_secondary_href', v)} max={300} mono />
          </>,
        )}
      </>
    );
  else if (id === 'band')
    content = (
      <>
        <p className="mx-4 mt-4 border-l-4 border-rave-primary bg-b2b-ink/5 px-3 py-2 text-xs font-bold" role="status">
          {d.band.mode(partners.filter((p) => p.name.trim()).length)}
        </p>
        {group(d.band.partners.title, <PartnersField items={partners} onChange={setPartners} />)}
        {group(
          d.band.title,
          <>
            <p className="text-xs text-b2b-muted">{d.band.hint}</p>
            <ListEditor items={draft.band} onChange={(v) => put('band', v)} limits={LANDING_LIMITS.band} make={emptyL} render={(b, setB) => <L10nField label={d.band.title} value={b} onChange={setB} max={30} />} />
          </>,
        )}
      </>
    );
  else if (id === 'stats')
    content = group(
      d.band.stats,
      <>
        <p className="text-xs text-b2b-muted">{d.band.statsHint}</p>
        <ListEditor
          items={draft.stats}
          onChange={(v) => put('stats', v)}
          limits={LANDING_LIMITS.stats}
          make={() => ({ value: 0, suffix: emptyL(), label: emptyL() })}
          render={(st, setSt) => (
            <div className="space-y-3">
              <label className="block max-w-[10rem]">
                <span className="mb-1.5 block text-sm font-bold">{d.band.value}</span>
                <Input type="number" min={0} value={st.value} onChange={(e) => setSt({ ...st, value: Number(e.target.value) })} />
              </label>
              <L10nField label={d.band.suffix} value={st.suffix} onChange={(v) => setSt({ ...st, suffix: v })} max={12} />
              <L10nField label={d.band.label} value={st.label} onChange={(v) => setSt({ ...st, label: v })} max={40} />
            </div>
          )}
        />
      </>,
    );
  else if (id === 'testimonial')
    content = group(
      d.builder.content,
      <>
        <L10nField label={d.testimonial.quote} value={draft.testimonial.quote} onChange={(v) => put('testimonial', { ...draft.testimonial, quote: v })} max={300} multiline rows={4} />
        <TextField label={d.testimonial.name} value={draft.testimonial.name} onChange={(v) => put('testimonial', { ...draft.testimonial, name: v })} max={60} />
        <L10nField label={d.testimonial.role} value={draft.testimonial.role} onChange={(v) => put('testimonial', { ...draft.testimonial, role: v })} max={60} />
        <L10nField label={d.testimonial.stamp} value={draft.testimonial.stamp} onChange={(v) => put('testimonial', { ...draft.testimonial, stamp: v })} max={40} />
      </>,
    );
  else if (id === 'faq')
    content = group(
      d.builder.content,
      <>
        <p className="text-xs text-b2b-muted">{d.faq.hint}</p>
        <ListEditor
          items={draft.faq}
          onChange={(v) => put('faq', v)}
          limits={LANDING_LIMITS.faq}
          make={() => ({ q: emptyL(), a: emptyL() })}
          render={(f, setF) => (
            <div className="space-y-3">
              <L10nField label={d.faq.question} value={f.q} onChange={(v) => setF({ ...f, q: v })} max={140} />
              <L10nField label={d.faq.answer} value={f.a} onChange={(v) => setF({ ...f, a: v })} max={800} multiline rows={4} />
            </div>
          )}
        />
      </>,
    );
  else if (id === 'sponsor')
    content = group(
      d.builder.content,
      <>
        <p className="text-xs text-b2b-muted">{d.sponsor.hint}</p>
        <TextField label={d.sponsor.advertiser} value={draft.sponsor.advertiser} onChange={(v) => put('sponsor', { ...draft.sponsor, advertiser: v })} max={60} />
        <TextField label={d.sponsor.handle} value={draft.sponsor.handle} onChange={(v) => put('sponsor', { ...draft.sponsor, handle: v })} max={60} />
        <L10nField label={d.sponsor.headline} value={draft.sponsor.headline} onChange={(v) => put('sponsor', { ...draft.sponsor, headline: v })} max={70} />
        <L10nField label={d.sponsor.body} value={draft.sponsor.body} onChange={(v) => put('sponsor', { ...draft.sponsor, body: v })} max={160} multiline rows={2} />
        <L10nField label={d.sponsor.cta} value={draft.sponsor.cta} onChange={(v) => put('sponsor', { ...draft.sponsor, cta: v })} max={24} />
        <TextField label={d.sponsor.href} hint={d.hero.hrefHint} value={draft.sponsor.href} onChange={(v) => put('sponsor', { ...draft.sponsor, href: v })} max={300} mono />
      </>,
    );
  else
    content = group(
      d.builder.sourceTitle,
      <p className="border-2 border-dashed border-b2b-line p-3 text-sm text-b2b-muted">{d.builder.sources[id as keyof typeof d.builder.sources]}</p>,
    );
  return (
    <>
      {content}
      {visibility}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Halaman builder (layar penuh)
// ---------------------------------------------------------------------------------------------
export function PlatformLanding() {
  const d = useDict('cms');
  const nav = useNavigate();
  const qc = useQueryClient();
  const sup = isSuperAdmin(useAuth((s) => s.user));
  const uiLocale = useLocale((s) => s.locale);
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<SettingsResponse>('/v1/admin/platform/settings') });
  const saved = useMemo<Draft>(() => {
    let landing = LANDING_DEFAULT;
    try {
      landing = coerceLanding(q.data?.values[KEY] ?? LANDING_DEFAULT);
    } catch {
      /* rusak → default */
    }
    return { landing, partners: savedPartners(q.data?.values[PARTNERS_KEY]) };
  }, [q.data]);
  const h = useHistory(null);
  const full = h.draft;
  const draft = full?.landing ?? null;
  const partners = full?.partners ?? [];
  const setLanding = (v: LandingContent) => full && h.set({ ...full, landing: v });
  const setPartners = (v: PartnerEntry[]) => full && h.set({ ...full, partners: v });
  const [selected, setSelected] = useState<BlockId | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [lang, setLang] = useState<Locale>(uiLocale);
  useEffect(() => {
    if (q.data && !full) h.reset(clone(saved));
  }, [q.data, saved, full]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!full && !same(full, saved);
  const error = full ? validate(full) : null;

  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);
  // Ctrl/Cmd+Z & Shift+Z (di luar kolom teks — kolom teks memakai undo bawaan browser).
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) h.redo();
      else h.undo();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  });

  const done = async (msg: string) => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['platform-settings'] }), qc.invalidateQueries({ queryKey: ['platform-config'] })]);
    toast.success(msg);
  };
  const save = useMutation({
    // Satu permintaan atomik; hanya kunci yang berubah dikirim (riwayat & audit tetap bersih).
    mutationFn: () => {
      const changes: Record<string, unknown> = {};
      if (!same(full!.landing, saved.landing)) changes[KEY] = full!.landing;
      if (!same(full!.partners, saved.partners)) changes[PARTNERS_KEY] = full!.partners;
      // Alasan wajib di server (riwayat & audit) — diisi otomatis dari bagian yang berubah, tanpa input pengguna.
      const reason = d.save.autoReason(KEY in changes, PARTNERS_KEY in changes);
      return api<SettingsResponse>('/v1/admin/platform/settings', { method: 'PUT', body: { changes, reason } });
    },
    onSuccess: (data) => {
      qc.setQueryData(['platform-settings'], data);
      h.reset(clone({ landing: coerceLanding(data.values[KEY]), partners: savedPartners(data.values[PARTNERS_KEY]) }));
      void done(d.save.saved);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e : String(e)),
  });
  const reset = useMutation({
    mutationFn: () => api<SettingsResponse>('/v1/admin/platform/settings/reset', { body: { keys: [KEY], reason: d.save.resetReason } }),
    // Reset hanya konten landing; logo partner (dan draf partner yang belum dipublikasikan) dipertahankan.
    onSuccess: () => {
      h.reset(clone({ landing: LANDING_DEFAULT, partners: full?.partners ?? saved.partners }));
      void done(d.save.resetDone);
    },
    onError: (e) => toast.error(e),
  });

  const exit = () => {
    if (dirty && !window.confirm(d.save.dirty + '?')) return;
    nav('/admin/platform');
  };

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const meta = q.data?.meta[KEY];
  const seg = (on: boolean) => cx('inline-flex h-8 items-center gap-1.5 px-2.5 font-label text-[11px] font-bold tracking-[0.08em] uppercase transition', on ? 'bg-rave-primary text-rave-ink' : 'text-white/60 hover:text-white');
  const iconBtn = 'grid size-8 place-items-center text-white/70 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30';

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-b2b-bg text-b2b-ink">
      {/* Bilah atas */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-rave-primary bg-rave-ink px-3 text-rave-paper">
        <button type="button" onClick={exit} className={iconBtn} aria-label={d.builder.exit} title={d.builder.exit}>
          <X className="size-5" />
        </button>
        <RaveMark className="size-7" />
        <p className="hidden font-display text-xl leading-none uppercase md:block">{d.title}</p>
        <div className="mx-auto flex items-center gap-2">
          <div className="inline-flex border border-white/15" role="group" aria-label={d.preview.title}>
            <button type="button" aria-pressed={device === 'desktop'} title={d.preview.desktop} className={seg(device === 'desktop')} onClick={() => setDevice('desktop')}>
              <Monitor className="size-3.5" /> <span className="hidden xl:inline">{d.preview.desktop}</span>
            </button>
            <button type="button" aria-pressed={device === 'tablet'} title={d.builder.tablet} className={seg(device === 'tablet')} onClick={() => setDevice('tablet')}>
              <Tablet className="size-3.5" /> <span className="hidden xl:inline">{d.builder.tablet}</span>
            </button>
            <button type="button" aria-pressed={device === 'mobile'} title={d.preview.mobile} className={seg(device === 'mobile')} onClick={() => setDevice('mobile')}>
              <Smartphone className="size-3.5" /> <span className="hidden xl:inline">{d.preview.mobile}</span>
            </button>
          </div>
          <div className="inline-flex border border-white/15" role="group" aria-label={d.preview.language}>
            {(['id', 'en'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} className={seg(lang === l)} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
          <button type="button" className={iconBtn} onClick={h.undo} disabled={!h.canUndo} aria-label={d.builder.undo} title={d.builder.undo}>
            <Undo2 className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={h.redo} disabled={!h.canRedo} aria-label={d.builder.redo} title={d.builder.redo}>
            <Redo2 className="size-4" />
          </button>
        </div>
        <p className={cx('hidden max-w-[22rem] truncate text-xs font-bold lg:block', error ? 'text-red-400' : dirty ? 'text-rave-primary' : 'text-white/50')} role="status" title={error ?? undefined}>
          {error ?? (dirty ? d.save.dirty : meta?.updated_at ? d.save.lastUpdated(fmt.dateTime(meta.updated_at), meta.updated_by ?? '—') : d.save.clean)}
        </p>
        <a href="/" target="_blank" rel="noopener" className={iconBtn} aria-label={d.openLanding} title={d.openLanding}>
          <ExternalLink className="size-4" />
        </a>
        {sup && (
          <>
            <button
              type="button"
              className={iconBtn}
              disabled={reset.isPending || save.isPending || same(saved.landing, LANDING_DEFAULT)}
              onClick={() => window.confirm(d.save.resetConfirm) && reset.mutate()}
              aria-label={d.save.reset}
              title={d.save.reset}
            >
              <RotateCcw className="size-4" />
            </button>
            <Button type="button" size="sm" loading={save.isPending} disabled={!dirty || !!error || reset.isPending} onClick={() => save.mutate()}>
              {d.builder.publish}
            </Button>
          </>
        )}
      </header>

      {!draft ? (
        <div className="p-6">
          <Skeleton className="h-[70vh]" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Panel kiri */}
          <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-b-2 border-b2b-line bg-b2b-bg md:max-h-none md:w-[380px] md:border-r-2 md:border-b-0">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b-2 border-b2b-line px-3">
              {selected ? (
                <>
                  <button type="button" onClick={() => setSelected(null)} className="grid size-8 place-items-center border-2 border-b2b-line text-b2b-muted hover:border-b2b-ink hover:text-b2b-ink" aria-label={d.builder.allSections} title={d.builder.allSections}>
                    <ArrowLeft className="size-4" />
                  </button>
                  <p className="min-w-0 flex-1 truncate font-display text-lg leading-none uppercase">{d.sectionNames[selected]}</p>
                  {selected !== 'hero' && selected !== 'band' && !draft.sections[selected] && (
                    <span className="bg-b2b-ink/10 px-2 py-0.5 font-label text-[10px] font-bold tracking-[0.1em] uppercase">{d.builder.hiddenBadge}</span>
                  )}
                </>
              ) : (
                <p className="font-display text-lg leading-none uppercase">{d.builder.allSections}</p>
              )}
            </div>
            <fieldset disabled={!sup} className="min-h-0 flex-1 overflow-y-auto">
              {!sup && <p className="m-4 border-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm font-bold">{d.forbidden}</p>}
              {selected ? <Properties key={selected} id={selected} draft={draft} set={setLanding} partners={partners} setPartners={setPartners} /> : <Structure draft={draft} onChange={setLanding} onSelect={setSelected} />}
            </fieldset>
          </aside>

          <Canvas draft={draft} partners={partners} device={device} lang={lang} selected={selected} onPick={setSelected} />
        </div>
      )}
    </div>
  );
}
export default PlatformLanding;
