import { useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button, cx, Field, Modal, Textarea, toast } from '@/components/ui';
import { useDict } from '@/lib/i18n';

/**
 * Blok penyusun popup detail Back Office (pengguna, member, organisasi/Pro) agar tata letaknya seragam:
 * kepala (identitas + badge + aksi) → strip ringkasan → bagian berbingkai (label–nilai) → aksi di kanan bawah.
 */

/** Kepala popup: avatar/ikon, judul + badge, baris meta (kontak/ID), aksi cepat di kanan. */
export function DetailHeader({ avatar, title, badges, meta, actions }: { avatar: ReactNode; title: ReactNode; badges?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-b2b-ink bg-rave-purple">{avatar}</span>
      <div className="min-w-[12rem] flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xl font-bold">
          <span className="min-w-0 break-words">{title}</span>
          {badges}
        </p>
        {meta && <div className="mt-1 flex flex-col gap-0.5 text-sm text-b2b-muted">{meta}</div>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

/** Huruf awal sebagai avatar cadangan. */
export function Initial({ name }: { name: string }) {
  return <span className="font-display text-2xl text-rave-primary">{name.slice(0, 1).toUpperCase()}</span>;
}

/** Ringkasan satu nilai di strip atas popup. */
export function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 border-2 border-b2b-line bg-b2b-card px-3 py-2" title={hint}>
      <p className="font-label text-[10px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{label}</p>
      <div className="mt-0.5 text-sm leading-snug font-bold break-words">{value}</div>
    </div>
  );
}

/** Strip ringkasan responsif (2 kolom di HP, hingga `cols` di layar lebar). */
export function StatStrip({ children, cols = 6 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const lg = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols];
  return <div className={cx('grid grid-cols-2 gap-2 sm:grid-cols-3', lg)}>{children}</div>;
}

/** Bagian berbingkai dengan judul label kecil + aksi opsional di kanan. */
export function DetailSection({ title, children, tone, action, className }: { title: string; children: ReactNode; tone?: 'danger'; action?: ReactNode; className?: string }) {
  return (
    <section className={cx('border-2 p-4', tone === 'danger' ? 'border-red-500/40 bg-red-500/[0.04]' : 'border-b2b-line bg-b2b-card', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className={cx('font-label text-[11px] font-bold tracking-[0.12em] uppercase', tone === 'danger' ? 'text-red-600' : 'text-b2b-muted')}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Baris label–nilai ringkas (gunakan di dalam `<dl>`). */
export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-b2b-muted">{k}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </div>
  );
}

/** Pesan status sebaris (peringatan/bahaya) di bawah kepala popup. */
export function DetailNotice({ tone = 'danger', children }: { tone?: 'danger' | 'warn'; children: ReactNode }) {
  return (
    <p role="status" className={cx('border-l-4 px-3 py-2 text-sm font-semibold', tone === 'danger' ? 'border-red-500 bg-red-500/10 text-red-700' : 'border-amber-500 bg-amber-500/10 text-amber-800')}>
      {children}
    </p>
  );
}

/** Teks yang bisa disalin (ID, email, nomor) dengan umpan balik toast. */
export function CopyText({ value, label, mono, className }: { value: string; label: string; mono?: boolean; className?: string }) {
  const t = useDict('admin').users;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        toast.success(t.copiedValue(label));
      }}
      title={t.copyValue(label)}
      className={cx('inline-flex max-w-full items-center gap-1 truncate text-left hover:text-b2b-ink', mono && 'font-mono', className)}
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3 shrink-0 opacity-60" aria-hidden />
    </button>
  );
}

/** Pilihan berbentuk kartu (radiogroup) — judul + keterangan singkat. */
export function ChoiceCards<T extends string>({ label, value, options, onChange, cols = 2 }: { label: string; value: T; options: { value: T; title: ReactNode; hint?: ReactNode }[]; onChange: (v: T) => void; cols?: 2 | 3 | 4 }) {
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[cols];
  return (
    <div role="radiogroup" aria-label={label} className={cx('grid gap-2', grid)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'border-2 px-3 py-2.5 text-left transition',
              on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink shadow-[3px_3px_0_#F4C21F]' : 'border-b2b-line bg-b2b-card text-b2b-ink hover:border-b2b-ink',
            )}
          >
            <span className="block text-sm font-bold">{o.title}</span>
            {o.hint && <span className={cx('mt-0.5 block text-xs', on ? 'opacity-80' : 'text-b2b-muted')}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Baris aksi popup: Batal di kiri tombol utama, semuanya rata kanan. */
export function ModalActions({ onCancel, cancelLabel, children }: { onCancel: () => void; cancelLabel: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t-2 border-dashed border-b2b-line pt-4">
      <Button type="button" variant="outline-ink" onClick={onCancel}>
        {cancelLabel}
      </Button>
      {children}
    </div>
  );
}

/** Dialog alasan (pengganti prompt bawaan): alasan wajib ≥ 5 karakter, tercatat di audit log. */
export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const t = useDict('admin').users;
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason('');
  }
  const ok = reason.trim().length >= 5;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !busy) onSubmit(reason.trim());
        }}
      >
        <div className="text-sm">{body}</div>
        <Field label={t.reason} hint={t.reasonHint}>
          <Textarea autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholderAction} />
        </Field>
        <ModalActions onCancel={onClose} cancelLabel={t.cancel}>
          <Button type="submit" variant={danger ? 'danger' : 'ink'} loading={busy} disabled={!ok}>
            {confirmLabel}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
