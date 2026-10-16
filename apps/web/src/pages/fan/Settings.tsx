import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { usePlayer, type Quality } from '@/stores/player';
import { FanPage } from '@/components/fan';
import { Button, cx, Field, Input, Select, toast } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';

const QUALITIES: [Quality, string, string][] = [
  ['auto', 'Otomatis', 'Menyesuaikan jaringan (disarankan)'],
  ['low', 'Hemat', 'HE-AAC ~48 kbps — paling irit kuota'],
  ['normal', 'Normal', 'AAC 160 kbps'],
  ['high', 'Tinggi', 'AAC 320 kbps'],
  ['lossless', 'Lossless', 'FLAC 16-bit/44,1 kHz — gunakan Wi-Fi'],
];
const CONSENTS: [string, string, string][] = [
  ['personalization', 'Personalisasi', 'Rekomendasi berdasarkan riwayat dengar.'],
  ['marketing', 'Pemasaran', 'Promo, presale, dan kabar GEMA via email/WhatsApp.'],
  ['ads', 'Iklan bertarget', 'Iklan sesuai minat & kotamu (tier Gratis). Tanpa persetujuan, iklan hanya berdasarkan genre yang diputar.'],
  ['aggregate_sharing', 'Data agregat untuk promotor', 'Data anonim (k≥50) untuk EPK & Audience Match artis.'],
];
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
const NOTIF_CATEGORIES: [NotifCategory, string, string][] = [
  ['event', 'Event & live', 'Manggung dekatmu, siaran live, dan tiket.'],
  ['release', 'Rilis baru', 'Lagu & album baru dari artis yang kamu ikuti.'],
  ['payment', 'Pembayaran', 'Status pembayaran, pengembalian dana, dan pencairan.'],
  ['booking', 'Booking', 'Inquiry, offer, dan status booking (artis & promotor).'],
  ['system', 'Akun & sistem', 'Keamanan akun, verifikasi, dan pengumuman penting.'],
  ['social', 'Sosial', 'Aktivitas pengikut & playlist kolaborasi.'],
];
const NOTIF_CHANNELS: [NotifChannel, string][] = [
  ['push', 'Push'],
  ['email', 'Email'],
  ['whatsapp', 'WhatsApp'],
];
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
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-gema-primary' : 'bg-[#535353]')}>
      <span className={cx('absolute top-1 size-4 rounded-full bg-white transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  );
}

export default function Settings() {
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
  const qualities = QUALITIES.filter(([v]) => v !== 'lossless' || losslessOn);
  useEffect(() => {
    if (!losslessOn && quality === 'lossless') setQuality('high');
  }, [losslessOn, quality, setQuality]);

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
      toast.success('Profil disimpan');
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
    if (!confirm('Hapus akun secara permanen? Riwayat, playlist, dan tiket akan dihapus sesuai kebijakan retensi.')) return;
    try {
      await api('/v1/me', { method: 'DELETE' });
      clear();
      toast.success('Akun dihapus');
      nav('/');
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <FanPage>
      <h1 className="mb-10 text-4xl font-black tracking-tight">Pengaturan</h1>
      <Section title="Profil">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama tampilan" theme="dark">
            <Input theme="dark" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Kota domisili" hint="untuk event dekatmu" theme="dark">
            <Select theme="dark" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">—</option>
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-sm text-gema-muted">Email: {user?.email}</p>
        <Button variant="white" className="mt-4" loading={saving} onClick={saveProfile}>
          Simpan profil
        </Button>
      </Section>

      <Section title="Kualitas audio">
        <div className="space-y-2" role="radiogroup" aria-label="Kualitas streaming">
          {qualities.map(([v, l, d]) => (
            <label key={v} className={cx('flex cursor-pointer items-center gap-4 rounded-lg border px-4 py-3', quality === v ? 'border-gema-primary bg-gema-primary/5' : 'border-white/10 hover:border-white/30')}>
              <input type="radio" name="quality" className="accent-gema-primary" checked={quality === v} onChange={() => setQuality(v)} />
              <span>
                <span className="block font-bold">{l}</span>
                <span className="text-sm text-gema-muted">{d}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gema-subtle">Normalisasi loudness −14 LUFS aktif. Berlaku untuk lagu berikutnya.</p>
      </Section>

      <Section title="Notifikasi">
        <p className="mb-4 text-sm text-gema-muted">Notifikasi di aplikasi selalu tersimpan. Pilih kanal tambahan per kategori.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs tracking-widest text-gema-muted uppercase">
                <th className="py-2 pr-4 font-normal">Kategori</th>
                {NOTIF_CHANNELS.map(([ch, l]) => (
                  <th key={ch} className="px-2 py-2 text-center font-normal">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {NOTIF_CATEGORIES.map(([c, l, d]) => (
                <tr key={c}>
                  <td className="py-4 pr-4">
                    <span className="block font-bold">{l}</span>
                    <span className="text-gema-muted">{d}</span>
                  </td>
                  {NOTIF_CHANNELS.map(([ch, chl]) => (
                    <td key={ch} className="px-2 py-4">
                      <div className="flex justify-center">
                        <Toggle on={prefOf(c)[ch]} onChange={(v) => setPref(c, ch, v)} label={`${chl} untuk ${l}`} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {prefs.isError && <p className="text-sm text-red-400">Preferensi notifikasi belum dapat dimuat.</p>}
      </Section>

      <Section title="Privasi & consent (UU PDP)">
        <ul className="divide-y divide-white/10">
          {CONSENTS.map(([p, l, d]) => (
            <li key={p} className="flex items-center justify-between gap-4 py-4">
              <span>
                <span className="block font-bold">{l}</span>
                <span className="text-sm text-gema-muted">{d}</span>
              </span>
              <Toggle on={granted(p)} onChange={(v) => setConsent(p, v)} label={l} />
            </li>
          ))}
        </ul>
        {consents.isError && <p className="text-sm text-red-400">Pengaturan consent belum dapat dimuat.</p>}
      </Section>

      <Section title="Akun">
        <p className="mb-4 text-sm text-gema-muted">Kamu berhak meminta penghapusan data pribadi. Data transaksi finansial disimpan sesuai kewajiban hukum lalu dihapus.</p>
        <Button variant="danger" onClick={deleteAccount}>
          Hapus akun
        </Button>
      </Section>
    </FanPage>
  );
}
