import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, CreditCard, Eye, EyeOff, ExternalLink, KeyRound, Mail, PlugZap, RotateCcw, Send, XCircle } from 'lucide-react';
import { INTEGRATION_PROVIDERS, type IntegrationField, type IntegrationKind } from '@rave/domain/integrations';
import { api, ApiError, fmt } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, Field, Input, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { QueryState } from '@/components/b2b/common';

/**
 * Platform → Integrasi (khusus Super Admin): email (OTP & notifikasi) dan payment gateway.
 * Rahasia tidak pernah dikirim kembali ke browser — hanya ••••1234; kolom kosong = pertahankan nilai tersimpan.
 */

interface IntegrationView {
  kind: IntegrationKind;
  source: 'dashboard' | 'env';
  provider: string | null;
  config: Record<string, string>;
  secrets: Record<string, string | null>;
  secrets_unreadable: boolean;
  env: { provider: string; from?: string | null; mode?: string | null };
  updated_by: string | null;
  updated_at: string | null;
  last_test: { at: string; ok: boolean; message: string } | null;
}
interface IntegrationsResponse {
  data: IntegrationView[];
  history: { kind: string; provider: string; changed: string[]; reason: string; actor_name: string | null; at: string }[];
  webhook_url: string;
}

const ICON: Record<IntegrationKind, ComponentType<{ className?: string }>> = { email: Mail, payment: CreditCard };

export function PlatformIntegrations() {
  const t = useDict('admin').integrations;
  const q = useQuery({ queryKey: ['platform-integrations'], queryFn: () => api<IntegrationsResponse>('/v1/admin/platform/integrations') });
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryState q={q}>
        {q.data && (
          <div className="space-y-6">
            {q.data.data.map((v) => (
              <IntegrationCard key={v.kind} view={v} webhookUrl={q.data!.webhook_url} />
            ))}
            {q.data.history.length > 0 && (
              <Card title={t.history}>
                <ul className="divide-y divide-b2b-line text-sm">
                  {q.data.history.map((h, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                      <span className="text-xs whitespace-nowrap text-b2b-muted">{fmt.dateTime(h.at)}</span>
                      <Badge tone="neutral">{t.kind[h.kind as IntegrationKind] ?? h.kind}</Badge>
                      <span className="font-semibold">{h.provider}</span>
                      {h.changed.length > 0 && <span className="font-mono text-[11px] text-b2b-muted">{h.changed.join(', ')}</span>}
                      <span className="min-w-0 flex-1 text-b2b-muted italic">“{h.reason}”</span>
                      <span className="text-xs text-b2b-muted">{h.actor_name}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function IntegrationCard({ view, webhookUrl }: { view: IntegrationView; webhookUrl: string }) {
  const t = useDict('admin').integrations;
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const defs = INTEGRATION_PROVIDERS[view.kind];
  const initialProvider = view.provider ?? (view.env.provider in defs ? view.env.provider : Object.keys(defs)[0]!);
  const [provider, setProvider] = useState(initialProvider);
  const [config, setConfig] = useState<Record<string, string>>(view.config);
  /** Rahasia: undefined = pertahankan, string = ganti, null = hapus. */
  const [secrets, setSecrets] = useState<Record<string, string | null | undefined>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'reset'>('');
  const [testTo, setTestTo] = useState(me?.email ?? '');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Muat ulang form saat data server berubah (setelah simpan / reset).
  useEffect(() => {
    setProvider(view.provider ?? (view.env.provider in defs ? view.env.provider : Object.keys(defs)[0]!));
    setConfig(view.config);
    setSecrets({});
    setEditing({});
    setErrors({});
  }, [view.updated_at, view.source]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = defs[provider]!;
  const sameProvider = view.source === 'dashboard' && view.provider === provider;
  const fieldValue = (f: IntegrationField) => config[f.key] ?? f.default ?? '';
  const dirty = useMemo(() => {
    if (view.source !== 'dashboard' || view.provider !== provider) return true;
    if (Object.values(secrets).some((v) => v !== undefined)) return true;
    return def.fields.some((f) => f.type !== 'secret' && (view.config[f.key] ?? f.default ?? '') !== (config[f.key] ?? f.default ?? ''));
  }, [view, provider, config, secrets, def]);
  const production = view.kind === 'payment' && provider === 'midtrans' && fieldValue({ key: 'MIDTRANS_MODE', default: 'sandbox' } as IntegrationField) === 'production';
  const Icon = ICON[view.kind];

  async function save() {
    setBusy('save');
    setErrors({});
    try {
      const cfg: Record<string, string> = {};
      for (const f of def.fields) if (f.type !== 'secret') cfg[f.key] = fieldValue(f);
      const sec: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(secrets)) if (v !== undefined) sec[k] = v;
      await api(`/v1/admin/platform/integrations/${view.kind}`, { method: 'PUT', body: { provider, config: cfg, secrets: sec, reason } });
      toast.success(t.saved);
      setReason('');
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ['platform-integrations'] });
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) setErrors(Object.fromEntries(e.problem.errors.map((x) => [x.path, x.message])));
      toast.error(e);
    } finally {
      setBusy('');
    }
  }
  async function test() {
    setBusy('test');
    setTestResult(null);
    try {
      const r = await api<{ ok: boolean; message: string }>(`/v1/admin/platform/integrations/${view.kind}/test`, { body: view.kind === 'email' ? { to: testTo || undefined } : {} });
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ['platform-integrations'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  }
  async function resetToEnv() {
    if (!confirm(t.resetConfirm)) return;
    setBusy('reset');
    try {
      await api(`/v1/admin/platform/integrations/${view.kind}`, { method: 'DELETE', body: { reason: reason.trim().length >= 5 ? reason : t.resetReason } });
      toast.success(t.resetDone);
      qc.invalidateQueries({ queryKey: ['platform-integrations'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  }

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Icon className="size-4" /> {t.kind[view.kind]}
          {view.source === 'dashboard' ? <Badge tone="green">{t.sourceDashboard}</Badge> : <Badge tone="neutral">{t.sourceEnv(view.env.provider)}</Badge>}
          {view.last_test && <Badge tone={view.last_test.ok ? 'green' : 'red'}>{view.last_test.ok ? t.lastTestOk : t.lastTestFail}</Badge>}
        </span>
      }
    >
      {view.source === 'env' && <p className="mb-4 text-sm text-b2b-muted">{t.envNote(view.env.provider)}</p>}
      {view.secrets_unreadable && (
        <p className="mb-4 flex items-start gap-2 border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t.unreadable}
        </p>
      )}

      {/* Pilih provider */}
      <fieldset>
        <legend className="mb-2 text-xs font-bold tracking-[0.14em] text-b2b-muted uppercase">{t.provider}</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(defs).map(([id, d]) => {
            const on = id === provider;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setProvider(id);
                  setErrors({});
                }}
                className={cx(
                  'flex flex-col items-start gap-1 border-2 p-3 text-left transition',
                  on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink shadow-[inset_0_-3px_0_var(--color-rave-primary)]' : 'border-b2b-line hover:border-b2b-ink/40',
                )}
              >
                <span className="flex w-full items-center gap-2 text-sm font-bold">
                  {d.label}
                  {view.source === 'dashboard' && view.provider === id && <span className={cx('ml-auto text-[10px] font-bold tracking-wider uppercase', on ? 'text-rave-primary' : 'text-emerald-700')}>{t.active}</span>}
                </span>
                <span className={cx('text-xs leading-snug', on ? 'text-b2b-on-ink/75' : 'text-b2b-muted')}>{d.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Field provider */}
      {def.fields.length > 0 && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {def.fields.map((f) => {
            const err = errors[f.key];
            if (f.type === 'secret') {
              const stored = sameProvider ? view.secrets[f.key] : null;
              const pending = secrets[f.key];
              const showInput = !stored || editing[f.key] || pending === null;
              return (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} error={err}>
                  {stored && !showInput ? (
                    <div className="flex items-center gap-2">
                      <span className="flex h-10 flex-1 items-center gap-2 border border-b2b-line bg-b2b-card px-3 font-mono text-sm">
                        <KeyRound className="size-4 text-b2b-muted" /> {stored}
                      </span>
                      <Button size="sm" variant="outline-ink" onClick={() => setEditing({ ...editing, [f.key]: true })}>
                        {t.replace}
                      </Button>
                      {!f.required && (
                        <Button size="sm" variant="ghost" onClick={() => setSecrets({ ...secrets, [f.key]: null })}>
                          {t.remove}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      <Input
                        type={reveal[f.key] ? 'text' : 'password'}
                        autoComplete="new-password"
                        spellCheck={false}
                        value={typeof pending === 'string' ? pending : ''}
                        onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })}
                        placeholder={pending === null ? t.willRemove : stored ? t.keepPlaceholder : (f.placeholder ?? '')}
                        className="pr-10 font-mono"
                      />
                      <button type="button" onClick={() => setReveal({ ...reveal, [f.key]: !reveal[f.key] })} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-b2b-muted hover:text-b2b-ink" aria-label={t.toggleReveal}>
                        {reveal[f.key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  )}
                </Field>
              );
            }
            if (f.type === 'select')
              return (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} error={err}>
                  <Select value={fieldValue(f)} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
                    {f.options!.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            return (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} error={err}>
                <Input type={f.type === 'url' ? 'url' : 'text'} value={fieldValue(f)} placeholder={f.placeholder} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
              </Field>
            );
          })}
        </div>
      )}
      {def.docs && (
        <a href={def.docs} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-b2b-muted underline-offset-4 hover:text-b2b-ink hover:underline">
          {t.getKeys(def.label)} <ExternalLink className="size-3" />
        </a>
      )}

      {/* Payment: URL notifikasi + peringatan produksi */}
      {view.kind === 'payment' && provider === 'midtrans' && (
        <div className="mt-5 space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-bold">{t.notificationUrl}</p>
            <div className="flex items-center gap-2">
              <code className="flex h-10 min-w-0 flex-1 items-center truncate border border-b2b-line bg-b2b-card px-3 text-xs">{webhookUrl}</code>
              <Button
                size="sm"
                variant="outline-ink"
                icon={<Copy className="size-3.5" />}
                onClick={() => navigator.clipboard.writeText(webhookUrl).then(() => toast.success(t.copied), () => toast.info(webhookUrl))}
              >
                {t.copy}
              </Button>
            </div>
            <p className="mt-1 text-xs text-b2b-muted">{t.notificationHint}</p>
          </div>
          {production && (
            <p className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t.productionWarning}
            </p>
          )}
        </div>
      )}
      {def.inert && <p className="mt-4 flex items-start gap-2 text-sm text-amber-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {view.kind === 'email' ? t.inertEmail : t.inertPayment}</p>}

      {/* Simpan */}
      <div className="mt-6 grid gap-3 border-t border-b2b-line pt-5 md:grid-cols-[1fr_auto] md:items-end">
        <Field label={t.reason} hint={t.reasonHint}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} />
        </Field>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {view.source === 'dashboard' && (
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} loading={busy === 'reset'} onClick={resetToEnv}>
              {t.resetToEnv}
            </Button>
          )}
          <Button variant="ink" loading={busy === 'save'} disabled={!dirty || reason.trim().length < 5} onClick={save}>
            {production && view.config.MIDTRANS_MODE !== 'production' ? t.saveProduction : t.save}
          </Button>
        </div>
      </div>

      {/* Uji */}
      <div className="mt-5 border border-dashed border-b2b-line p-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <PlugZap className="size-4" /> {view.kind === 'email' ? t.testEmailTitle : t.testPaymentTitle}
        </p>
        {view.source !== 'dashboard' || dirty ? (
          <p className="mt-1 text-sm text-b2b-muted">{t.saveFirst}</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {view.kind === 'email' && (
              <div className="min-w-56 flex-1">
                <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="nama@email.com" aria-label={t.testTo} />
              </div>
            )}
            <Button variant="outline-ink" icon={<Send className="size-4" />} loading={busy === 'test'} onClick={test}>
              {view.kind === 'email' ? t.sendTest : t.testConnection}
            </Button>
          </div>
        )}
        {(testResult ?? (view.last_test && !dirty ? view.last_test : null)) && (
          <p className={cx('mt-3 flex items-start gap-2 text-sm', (testResult ?? view.last_test)!.ok ? 'text-emerald-700' : 'text-red-600')}>
            {(testResult ?? view.last_test)!.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span>
              {(testResult ?? view.last_test)!.message}
              {!testResult && view.last_test && <span className="ml-1 text-xs text-b2b-muted">· {fmt.dateTime(view.last_test.at)}</span>}
            </span>
          </p>
        )}
      </div>
      {view.updated_at && (
        <p className="mt-3 text-xs text-b2b-muted">{t.updated(fmt.dateTime(view.updated_at), view.updated_by ?? '—')}</p>
      )}
    </Card>
  );
}
