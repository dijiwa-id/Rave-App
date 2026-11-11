import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { usePlayer, type Quality } from '@/stores/player';
import { FanPage } from '@/components/fan';
import { Button, cx, Field, Input, Select, toast } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useDict } from '@/lib/i18n';

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
const defaultPref = (category: NotifCategory): NotifPref => ({
  category,
  push: true,
  email: category === 'booking' || category === 'payment',
  whatsapp: false,
  quiet_start: null,
  quiet_end: null,
});
const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo', 'Palembang', 'Lainnya'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 max-w-2xl">
      <h2 className="mb-4 text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx('relative h-6 w-11 shrink-0 rounded-none transition', on ? 'bg-rave-primary' : 'bg-[#535353]')}>
      <span className={cx('absolute top-1 size-4 rounded-full bg-white transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  );
}

export default function Settings() {
  const t = useDict('fan');
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const nav = useNavigate();
  const quality = usePlayer((s) => s.quality);
  const setQuality = usePlayer((s) => s.setQuality);
  const [name, setName] = useState(user?.display_name ?? '');
  const [city, setCity] = useState(user?.city ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(user?.display_name ?? '');
    setCity(user?.city ?? '');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const consents = useQuery({ queryKey: ['consents'], queryFn: () => api<{ data: { purpose: string; granted: boolean }[] }>('/v1/me/consents') });
  const granted = (p: string) => !!consents.data?.data.find((c) => c.purpose === p)?.granted;
  // Super Admin bisa mematikan Lossless (streaming.lossless_enabled) — server menurunkan kualitas diam-diam, jadi opsi disembunyikan.
  const losslessOn = setting(usePlatformConfig(), 'streaming.lossless_enabled', true);
  const qualities = QUALITIES.filter((v) => v !== 'lossless' || losslessOn);
  useEffect(() => {
    if (!losslessOn && quality === 'lossless') setQuality('high');
  }, [losslessOn, quality, setQuality]);
  // AAC 320 & Lossless khusus Premium (ditegakkan server). Preferensi tetap disimpan → langsung berlaku setelah upgrade.
  const premium = !!user?.premium;
  const locked = (v: Quality) => !premium && (v === 'high' || v === 'lossless');

  const prefs = useQuery({ queryKey: ['notif-prefs'], queryFn: () => api<{ data: NotifPref[] }>('/v1/notifications/preferences') });
  const prefOf = (c: NotifCategory) => prefs.data?.data.find((p) => p.category === c) ?? defaultPref(c);
  async function setPref(c: NotifCategory, ch: NotifChannel, value: boolean) {
    const cur = prefOf(c);
    const next = { ...cur, [ch]: value };
    qc.setQueryData<{ data: NotifPref[] }>(['notif-prefs'], (old) => ({ data: [...(old?.data ?? []).filter((p) => p.category !== c), next] }));
    try {
      await api('/v1/notifications/preferences', {
        method: 'PUT',
        body: { category: c, push: next.push, email: next.email, whatsapp: next.whatsapp, quiet_start: next.quiet_start, quiet_end: next.quiet_end },
      });
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
      toast.success(t.settings.profileSaved);
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
    if (!confirm(t.settings.confirmDelete)) return;
    try {
      await api('/v1/me', { method: 'DELETE' });
      clear();
      toast.success(t.settings.accountDeleted);
      nav('/');
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <FanPage>
      <h1 className="mb-10 text-4xl font-black tracking-tight">{t.settings.title}</h1>
      <Section title={t.settings.profile}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.settings.displayName} theme="dark">
            <Input theme="dark" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.settings.city} hint={t.settings.cityHint} theme="dark">
            <Select theme="dark" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">—</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c === 'Lainnya' ? t.settings.otherCity : c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-sm text-rave-muted">{t.settings.email(user?.email ?? '')}</p>
        <Button variant="white" className="mt-4" loading={saving} onClick={saveProfile}>
          {t.settings.saveProfile}
        </Button>
      </Section>

      <Section title={t.settings.audioQuality}>
        <div className="space-y-2" role="radiogroup" aria-label={t.settings.streamingQuality}>
          {qualities.map((v) => {
            const [l, d] = t.settings.qualities[v];
            const lock = locked(v);
            return (
            <label
              key={v}
              className={cx(
                'flex items-center gap-4 rounded-none border px-4 py-3',
                lock ? 'cursor-not-allowed border-white/10 opacity-70' : 'cursor-pointer',
                !lock && (quality === v ? 'border-rave-primary bg-rave-primary/5' : 'border-white/10 hover:border-white/30'),
              )}
            >
              <input type="radio" name="quality" className="accent-rave-primary" checked={quality === v && !lock} disabled={lock} onChange={() => setQuality(v)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-bold">
                  {l}
                  {(v === 'high' || v === 'lossless') && (
                    <span className="rave-label border border-rave-primary/60 px-1.5 py-0.5 !text-[9.5px] text-rave-primary-text">{t.settings.premiumBadge}</span>
                  )}
                </span>
                <span className="text-sm text-rave-muted">{d}</span>
              </span>
            </label>
            );
          })}
        </div>
        {!premium && (
          <p className="mt-3 text-sm text-rave-muted">
            {t.settings.premiumQualityNote}{' '}
            <Link to="/premium" className="font-bold text-rave-primary-text underline-offset-2 hover:underline">
              {t.settings.premiumQualityCta}
            </Link>
          </p>
        )}
        <p className="mt-3 text-xs text-rave-subtle">{t.settings.loudnessNote}</p>
      </Section>

      <Section title={t.settings.notifications}>
        <p className="mb-4 text-sm text-rave-muted">{t.settings.notifIntro}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs tracking-widest text-rave-muted uppercase">
                <th className="py-2 pr-4 font-normal">{t.settings.category}</th>
                {NOTIF_CHANNELS.map((ch) => (
                  <th key={ch} className="px-2 py-2 text-center font-normal">
                    {t.settings.channels[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {NOTIF_CATEGORIES.map((c) => {
                const [l, d] = t.settings.notifCategories[c];
                return (
                <tr key={c}>
                  <td className="py-4 pr-4">
                    <span className="block font-bold">{l}</span>
                    <span className="text-rave-muted">{d}</span>
                  </td>
                  {NOTIF_CHANNELS.map((ch) => (
                    <td key={ch} className="px-2 py-4">
                      <div className="flex justify-center">
                        <Toggle on={prefOf(c)[ch]} onChange={(v) => setPref(c, ch, v)} label={t.settings.channelFor(t.settings.channels[ch], l)} />
                      </div>
                    </td>
                  ))}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {prefs.isError && <p className="text-sm text-red-400">{t.settings.notifPrefsFailed}</p>}
      </Section>

      <Section title={t.settings.privacy}>
        <ul className="divide-y divide-white/10">
          {CONSENTS.map((p) => {
            const [l, d] = t.settings.consents[p];
            return (
            <li key={p} className="flex items-center justify-between gap-4 py-4">
              <span>
                <span className="block font-bold">{l}</span>
                <span className="text-sm text-rave-muted">{d}</span>
              </span>
              <Toggle on={granted(p)} onChange={(v) => setConsent(p, v)} label={l} />
            </li>
            );
          })}
        </ul>
        {consents.isError && <p className="text-sm text-red-400">{t.settings.consentsFailed}</p>}
      </Section>

      <Section title={t.settings.account}>
        <p className="mb-4 text-sm text-rave-muted">{t.settings.accountNote}</p>
        <Button variant="danger" onClick={deleteAccount}>
          {t.settings.deleteAccount}
        </Button>
      </Section>
    </FanPage>
  );
}
