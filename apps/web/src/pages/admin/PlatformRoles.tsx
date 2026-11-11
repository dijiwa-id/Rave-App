import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  accessKey,
  ADMIN_PERMISSION_KEYS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_LABEL,
  CONFIGURABLE_ADMIN_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  type AdminPermission,
} from '@rave/domain/settings';
import { api, ApiError } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import type { AdminUser, SettingsResponse } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Modal, PageHeader, Textarea, toast } from '@/components/ui';
import { QueryState } from '@/components/b2b/common';

type Role = (typeof CONFIGURABLE_ADMIN_ROLES)[number];
type Matrix = Record<Role, AdminPermission[]>;

/** Izin dikelompokkan per area, urutan sesuai registri. */
const AREAS = ADMIN_PERMISSION_KEYS.reduce<{ area: string; perms: AdminPermission[] }[]>((acc, k) => {
  const area = ADMIN_PERMISSIONS[k].area;
  const g = acc.find((x) => x.area === area);
  if (g) g.perms.push(k);
  else acc.push({ area, perms: [k] });
  return acc;
}, []);

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Super Admin → "Peran & Akses": matriks izin back office per peran admin. Disimpan sebagai pengaturan platform
 * (`access.role.*`) sehingga berlaku seketika di semua service, dengan alasan, riwayat, dan audit log.
 * Area Platform tidak ada di matriks: selalu khusus Super Admin.
 */
export function PlatformRoles() {
  const d = useDict('admin');
  const t = d.roles;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<SettingsResponse>('/v1/admin/platform/settings') });
  const admins = useQuery({ queryKey: ['platform-admins'], queryFn: () => api<{ data: AdminUser[] }>('/v1/admin/iam/admins') });
  const [draft, setDraft] = useState<Partial<Matrix>>({});
  const [saving, setSaving] = useState<null | 'save' | 'reset'>(null);
  const [confirm, setConfirm] = useState<null | 'save' | 'reset'>(null);
  const [reason, setReason] = useState('');

  const server = useMemo(() => {
    const m = {} as Matrix;
    for (const r of CONFIGURABLE_ADMIN_ROLES) m[r] = ((q.data?.values[accessKey(r)] as AdminPermission[] | undefined) ?? DEFAULT_ROLE_PERMISSIONS[r]).filter((p) => p in ADMIN_PERMISSIONS);
    return m;
  }, [q.data]);
  const current = (r: Role) => draft[r] ?? server[r];
  const dirty = CONFIGURABLE_ADMIN_ROLES.filter((r) => draft[r] && !same(draft[r]!, server[r]));
  const holders = (r: string) => (admins.data?.data ?? []).filter((a) => a.admin_role === r && !a.suspended_at).length;
  const revoked = dirty.flatMap((r) => server[r].filter((p) => !current(r).includes(p)).map((p) => ({ r, p }))).filter((x) => holders(x.r) > 0);
  const nonDefault = CONFIGURABLE_ADMIN_ROLES.filter((r) => !same(server[r], DEFAULT_ROLE_PERMISSIONS[r]));

  function toggle(r: Role, p: AdminPermission) {
    const now = current(r);
    const next = now.includes(p) ? now.filter((x) => x !== p) : ADMIN_PERMISSION_KEYS.filter((k) => k === p || now.includes(k));
    setDraft((d) => ({ ...d, [r]: next }));
  }

  async function submit() {
    const kind = confirm!;
    setSaving(kind);
    try {
      if (kind === 'save') {
        await api('/v1/admin/platform/settings', { method: 'PUT', body: { changes: Object.fromEntries(dirty.map((r) => [accessKey(r), current(r)])), reason: reason.trim() } });
        toast.success(t.toastSaved);
      } else {
        await api('/v1/admin/platform/settings/reset', { body: { keys: nonDefault.map((r) => accessKey(r)), reason: reason.trim() } });
        toast.success(t.toastReset);
      }
      setDraft({});
      setConfirm(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['platform-settings'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t.saveFailed);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <span className="flex gap-2">
            {nonDefault.length > 0 && !dirty.length && (
              <Button variant="outline-ink" icon={<RotateCcw className="size-4" />} onClick={() => setConfirm('reset')}>
                {t.resetDefault}
              </Button>
            )}
            <Link to="/admin/platform/admins">
              <Button variant="outline-ink" icon={<ShieldCheck className="size-4" />}>
                {t.manageHolders}
              </Button>
            </Link>
          </span>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-none border border-b2b-line bg-b2b-card p-4 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-b2b-muted" />
        <p className="text-b2b-muted">
          <strong className="text-b2b-ink">Super Admin</strong> {t.noteA} <strong className="text-b2b-ink">Platform</strong> {t.noteB}
        </p>
      </div>

      <QueryState q={q}>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-b2b-line text-left">
                <th className="px-4 py-3 font-bold">{t.permission}</th>
                <th className="px-3 py-3 text-center font-bold">
                  Super Admin
                  <span className="block text-[11px] font-normal text-b2b-muted">{t.adminCount(holders('SUPER_ADMIN'))}</span>
                </th>
                {CONFIGURABLE_ADMIN_ROLES.map((r) => (
                  <th key={r} className={cx('px-3 py-3 text-center font-bold', dirty.includes(r) && 'bg-amber-500/10')}>
                    {ADMIN_ROLE_LABEL[r]}
                    <span className="block text-[11px] font-normal text-b2b-muted">{admins.data ? t.adminCount(holders(r)) : '…'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AREAS.map(({ area, perms }) => [
                <tr key={area} className="bg-b2b-bg">
                  <td colSpan={2 + CONFIGURABLE_ADMIN_ROLES.length} className="px-4 py-2 text-[11px] font-bold tracking-[0.12em] text-b2b-muted uppercase">
                    {area}
                  </td>
                </tr>,
                ...perms.map((p) => (
                  <tr key={p} className="border-t border-b2b-line">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-b2b-ink">{ADMIN_PERMISSIONS[p].label}</p>
                      <p className="font-mono text-[11px] text-b2b-muted">{p}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-grid size-6 place-items-center rounded-none bg-b2b-ink/10 text-b2b-muted" title={t.superHasAll}>
                        <Check className="size-4" />
                      </span>
                    </td>
                    {CONFIGURABLE_ADMIN_ROLES.map((r) => {
                      const on = current(r).includes(p);
                      const changed = on !== server[r].includes(p);
                      return (
                        <td key={r} className={cx('px-3 py-2.5 text-center', dirty.includes(r) && 'bg-amber-500/5')}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            aria-label={t.permFor(ADMIN_PERMISSIONS[p].label, ADMIN_ROLE_LABEL[r])}
                            onClick={() => toggle(r, p)}
                            className={cx(
                              'inline-grid size-6 place-items-center rounded-none border transition',
                              on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line bg-b2b-card hover:border-b2b-ink',
                              changed && 'ring-2 ring-amber-500 ring-offset-1',
                            )}
                          >
                            {on && <Check className="size-4" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </Card>
      </QueryState>

      {dirty.length > 0 && (
        <div className="sticky bottom-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-none border border-amber-500/40 bg-b2b-card p-4 shadow-lg">
          <p className="text-sm">
            <Badge tone="amber">{t.rolesChanged(dirty.length)}</Badge>{' '}
            <span className="text-b2b-muted">{dirty.map((r) => ADMIN_ROLE_LABEL[r]).join(', ')}</span>
          </p>
          <span className="flex gap-2">
            <Button variant="outline-ink" onClick={() => setDraft({})}>
              {t.discard}
            </Button>
            <Button variant="ink" onClick={() => setConfirm('save')}>
              {t.saveChanges}
            </Button>
          </span>
        </div>
      )}

      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title={confirm === 'save' ? t.confirmSaveTitle : t.confirmResetTitle}>
          <div className="space-y-4 text-sm">
            {confirm === 'reset' && <p>{t.resetBody(nonDefault.map((r) => ADMIN_ROLE_LABEL[r]).join(', '))}</p>}
            {confirm === 'save' && revoked.length > 0 && (
              <div className="rounded-none border border-red-500/30 bg-red-500/5 p-3">
                <p className="font-bold text-red-700">{t.revokedTitle}</p>
                <ul className="mt-1 list-disc pl-5 text-b2b-ink">
                  {revoked.map(({ r, p }) => (
                    <li key={r + p}>
                      {ADMIN_ROLE_LABEL[r]} ({t.adminCount(holders(r))}): {ADMIN_PERMISSIONS[p].label}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-b2b-muted">{t.revokedBody}</p>
              </div>
            )}
            <Field label={t.reason} hint={t.reasonHint}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setConfirm(null)}>
                {d.common.cancel}
              </Button>
              <Button variant={revoked.length ? 'danger' : 'ink'} loading={!!saving} disabled={reason.trim().length < 5} onClick={submit}>
                {confirm === 'save' ? t.saveApply : t.resetDefault}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
