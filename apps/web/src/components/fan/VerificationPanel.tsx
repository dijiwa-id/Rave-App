import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, ImagePlus, Mail, MessageCircle, Plus, Trash2, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import type { Me, VerificationState } from '@/lib/types';
import { IMAGE_ACCEPT, uploadFile } from '@/lib/upload';
import { useAuth } from '@/stores/auth';
import { Button, cx, toast } from '@/components/ui';
import { VerifiedBadge, VerifiedStamp } from '@/components/ui/VerifiedBadge';

const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo', 'Palembang', 'Lainnya'];
const GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;
const KEYS = ['full_name', 'birth_date', 'id_number', 'gender', 'bio', 'socials', 'avatar', 'city', 'email', 'phone'] as const;
const LABEL = 'mb-1.5 block text-xs font-bold tracking-wide text-rave-muted uppercase';

/**
 * Verifikasi akun (badge Verified) di Pengaturan: status + daftar periksa, formulir data diri, foto profil,
 * verifikasi email & WhatsApp lewat OTP, lalu ajukan / batalkan. Badge hanya penanda identitas — tidak mengubah tier.
 */
export function VerificationPanel() {
  const s = useDict('fan').settings.verify;
  const user = useAuth((x) => x.user);
  const setUser = useAuth((x) => x.setUser);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me-verification'], queryFn: () => api<VerificationState>('/v1/me/verification') });
  const v = q.data;
  // Badge aktif (verified) vs identitas sudah terverifikasi lewat KYC lama tetapi data diri belum lengkap (badge belum tampil).
  const badge = !!user?.verified;
  const identityOnly = v?.status === 'VERIFIED' && !badge;
  const locked = badge || v?.status === 'PENDING';
  const nikLocked = locked || identityOnly;
  const [nik, setNik] = useState('');

  const [form, setForm] = useState({ full_name: '', birth_date: '', gender: '', bio: '', city: '', socials: [''] as string[] });
  useEffect(() => {
    if (!user) return;
    setForm({
      full_name: user.full_name ?? '',
      birth_date: user.birth_date ?? '',
      gender: user.gender ?? '',
      bio: user.bio ?? '',
      city: user.city ?? '',
      socials: user.socials?.length ? user.socials : [''],
    });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = (me?: Me) => {
    if (me) setUser(me);
    void qc.invalidateQueries({ queryKey: ['me-verification'] });
  };

  async function save() {
    setSaving(true);
    try {
      const socials = form.socials.map((x) => x.trim()).filter(Boolean);
      const body: Record<string, unknown> = { gender: form.gender || null, bio: form.bio.trim() || null, city: form.city || null, socials };
      // Nama lengkap & tanggal lahir terkunci selama ditinjau/terverifikasi → jangan dikirim.
      if (!locked) Object.assign(body, { full_name: form.full_name.trim() || null, birth_date: form.birth_date || null });
      // NIK hanya dikirim bila diketik baru (nilai tersimpan tidak pernah dikirim balik ke klien).
      if (!nikLocked && nik.replace(/\s/g, '')) body.id_number = nik.replace(/\s/g, '');
      refresh(await api<Me>('/v1/me', { method: 'PATCH', body }));
      setNik('');
      toast.success(s.saved);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      await api('/v1/me/verification', { method: 'POST', body: {} });
      toast.success(s.submitted);
      refresh(await api<Me>('/v1/me'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  async function cancelRequest() {
    setBusy(true);
    try {
      await api('/v1/me/verification', { method: 'DELETE' });
      toast.success(s.cancelled);
      refresh(await api<Me>('/v1/me'));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const missing = v ? KEYS.filter((k) => !v.checklist[k]).length : KEYS.length;
  return (
    <div className="space-y-6">
      {/* Status */}
      <div
        className={cx(
          'flex flex-wrap items-center gap-4 border-2 p-4',
          badge ? 'border-rave-primary bg-rave-primary/10' : v?.status === 'REJECTED' ? 'border-rave-berry/60 bg-rave-berry/10' : 'border-white/15 bg-white/[0.03]',
        )}
      >
        {badge ? <VerifiedBadge size={44} /> : v?.status === 'PENDING' ? <Clock className="size-10 text-rave-primary-text" /> : <VerifiedBadge size={44} className="opacity-30 grayscale" />}
        <div className="min-w-0 flex-1">
          {badge && <VerifiedStamp className="mb-1.5" />}
          <p className="font-bold text-white">
            {badge ? s.statusVerified(fmt.date(v?.verified_at ?? user?.verified_at)) : identityOnly ? s.statusIdentity : v?.status === 'PENDING' ? s.statusPending : v?.status === 'REJECTED' ? s.statusRejected : s.statusNone}
          </p>
          {v?.status === 'REJECTED' && v.request?.reason && <p className="mt-0.5 text-sm text-rave-paper/80">{s.reason(v.request.reason)}</p>}
          {!badge && <p className="mt-1 text-sm text-rave-muted">{s.intro}</p>}
        </div>
      </div>

      {/* Daftar periksa */}
      {v && !badge && (
        <div>
          <p className={LABEL}>{s.checklistTitle}</p>
          <ul className="grid gap-x-6 gap-y-1.5 text-sm @[560px]:grid-cols-2">
            {KEYS.map((k) => (
              <li key={k} className={cx('flex items-center gap-2', v.checklist[k] ? 'text-white' : 'text-rave-muted')}>
                <span className={cx('grid size-4 shrink-0 place-items-center border-2', v.checklist[k] ? 'border-rave-ink bg-rave-primary text-rave-ink' : 'border-white/30')}>
                  {v.checklist[k] && <Check className="size-3" strokeWidth={4} />}
                </span>
                {s.items[k]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Foto profil */}
      <AvatarField onChange={(me) => refresh(me)} />

      {/* Data diri */}
      <div className="grid gap-3 @[560px]:grid-cols-2">
        <label className="block">
          <span className={LABEL}>
            {s.fullName} <span className="font-normal normal-case">· {s.fullNameHint}</span>
          </span>
          <input className="settings-input" value={form.full_name} disabled={locked} maxLength={120} autoComplete="name" onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </label>
        <label className="block">
          <span className={LABEL}>{s.birthDate}</span>
          <input type="date" className="settings-input" value={form.birth_date} disabled={locked} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
        </label>
        <label className="block">
          <span className={LABEL}>
            {s.idNumber} <span className="font-normal normal-case">· {s.idNumberHint}</span>
          </span>
          <input
            className="settings-input font-label tracking-[0.12em]"
            inputMode="numeric"
            autoComplete="off"
            maxLength={19}
            disabled={nikLocked}
            value={nik}
            placeholder={user?.id_number_masked ?? s.idNumberPh}
            onChange={(e) => setNik(e.target.value.replace(/[^\d ]/g, ''))}
          />
        </label>
        <label className="block">
          <span className={LABEL}>{s.gender}</span>
          <select className="settings-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">—</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {s.genders[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{s.items.city}</span>
          <select className="settings-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
            <option value="">—</option>
            {[...new Set([...CITIES, ...(form.city && !CITIES.includes(form.city) ? [form.city] : [])])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block @[560px]:col-span-2">
          <span className={LABEL}>
            {s.bio} <span className="font-normal normal-case">· {form.bio.trim().length}/280</span>
          </span>
          <textarea className="settings-input min-h-24 py-2" value={form.bio} maxLength={280} placeholder={s.bioPh} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </label>
        <div className="@[560px]:col-span-2">
          <span className={LABEL}>{s.socials}</span>
          <div className="space-y-2">
            {form.socials.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="settings-input"
                  type="url"
                  inputMode="url"
                  value={url}
                  placeholder={s.socialPh}
                  onChange={(e) => setForm({ ...form, socials: form.socials.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                {form.socials.length > 1 && (
                  <button type="button" aria-label={s.remove} onClick={() => setForm({ ...form, socials: form.socials.filter((_, j) => j !== i) })} className="grid w-10 shrink-0 place-items-center text-rave-muted hover:text-white">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            {form.socials.length < 5 && (
              <button type="button" onClick={() => setForm({ ...form, socials: [...form.socials, ''] })} className="inline-flex items-center gap-1.5 text-sm font-bold text-rave-primary-text hover:underline">
                <Plus className="size-4" /> {s.addSocial}
              </button>
            )}
          </div>
        </div>
      </div>
      {locked && <p className="text-xs text-rave-muted">{s.lockedHint}</p>}
      <div className="flex justify-end">
        <Button variant="primary" loading={saving} onClick={save}>
          {s.saveData}
        </Button>
      </div>

      {/* Kontak terverifikasi */}
      <div>
        <p className={LABEL}>{s.contactTitle}</p>
        <div className="space-y-3">
          <ContactRow channel="email" value={user?.email ?? null} ok={!!v?.checklist.email} onDone={refresh} />
          <ContactRow channel="whatsapp" value={user?.phone ?? null} ok={!!v?.checklist.phone} onDone={refresh} />
        </div>
      </div>

      {/* Ajukan */}
      {v && !badge && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-dashed border-white/15 pt-4">
          {v.status === 'PENDING' ? (
            <Button variant="outline" loading={busy} onClick={cancelRequest}>
              {s.cancelRequest}
            </Button>
          ) : (
            <>
              {!v.complete && <span className="text-sm text-rave-muted">{s.incomplete(missing)}</span>}
              <Button variant="primary" loading={busy} disabled={!v.complete} onClick={submit}>
                {identityOnly ? s.showBadge : s.submit}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Foto profil: pratinjau bulat + unggah (purpose 'avatar', ≥ 300 px) / hapus. */
function AvatarField({ onChange }: { onChange: (me: Me) => void }) {
  const s = useDict('fan').settings.verify;
  const user = useAuth((x) => x.user);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File) {
    setBusy(true);
    try {
      const url = await uploadFile(file, 'artwork', 'avatar');
      onChange(await api<Me>('/v1/me', { method: 'PATCH', body: { avatar_url: url } }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-4">
      <span className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-rave-ink bg-rave-purple shadow-[3px_3px_0_#0b0a0c]">
        {user?.avatar_url ? <img src={user.avatar_url} alt="" className="size-full object-cover" /> : <span className="font-display text-3xl text-rave-primary-text">{(user?.display_name ?? '?').slice(0, 1).toUpperCase()}</span>}
        {user?.verified && <VerifiedBadge size={24} className="absolute right-0 bottom-0" />}
      </span>
      <div>
        <p className="font-bold text-white">{s.avatar}</p>
        <p className="text-xs text-rave-muted">{s.avatarHint}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="white" loading={busy} onClick={() => input.current?.click()}>
            <ImagePlus /> {busy ? s.uploading : s.upload}
          </Button>
          {user?.avatar_url && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={async () => onChange(await api<Me>('/v1/me', { method: 'PATCH', body: { avatar_url: null } }))}>
              {s.remove}
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pick(f);
          }}
        />
      </div>
    </div>
  );
}

/** Satu kontak (email / WhatsApp): status, lalu ganti/tautkan lewat kode OTP 6 digit. */
function ContactRow({ channel, value, ok, onDone }: { channel: 'email' | 'whatsapp'; value: string | null; ok: boolean; onDone: (me?: Me) => void }) {
  const s = useDict('fan').settings.verify;
  const [editing, setEditing] = useState(false);
  const [dest, setDest] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const Icon = channel === 'email' ? Mail : MessageCircle;
  const reset = () => {
    setEditing(false);
    setDest('');
    setSentTo(null);
    setCode('');
  };
  async function send() {
    setBusy(true);
    try {
      const r = await api<{ sent: boolean; already_verified?: boolean; dev_code?: string }>('/v1/me/contact/otp', { body: { channel, destination: dest } });
      if (r.already_verified) {
        toast.success(s.contactVerified);
        reset();
        onDone(await api<Me>('/v1/me'));
        return;
      }
      setSentTo(dest);
      toast.info(s.codeSent(dest) + (r.dev_code ? ` · dev: ${r.dev_code}` : ''));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    try {
      const me = await api<Me>('/v1/me/contact/verify', { body: { channel, destination: sentTo, code } });
      toast.success(s.contactVerified);
      reset();
      onDone(me);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-2 border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="size-4 shrink-0 text-rave-muted" />
        <span className="w-20 shrink-0 text-xs font-bold tracking-wide text-rave-muted uppercase">{channel === 'email' ? s.email : s.whatsapp}</span>
        <span className="min-w-0 flex-1 truncate font-label text-sm text-white">{value ?? '—'}</span>
        <span className={cx('inline-flex items-center gap-1 text-xs font-bold', ok ? 'text-rave-primary-text' : 'text-rave-muted')}>
          {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />} {ok ? s.verifiedTag : s.notVerified}
        </span>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {value ? s.change : s.confirm}
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!sentTo ? (
            <>
              <input
                className="settings-input min-w-0 flex-1"
                type={channel === 'email' ? 'email' : 'tel'}
                inputMode={channel === 'email' ? 'email' : 'tel'}
                autoComplete={channel === 'email' ? 'email' : 'tel'}
                placeholder={channel === 'email' ? s.emailPh : s.waPh}
                value={dest}
                onChange={(e) => setDest(e.target.value)}
              />
              <Button size="sm" variant="primary" loading={busy} disabled={dest.trim().length < 5} onClick={send}>
                {s.sendCode}
              </Button>
            </>
          ) : (
            <>
              <input
                className="settings-input w-40 text-center font-label tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder={s.codePh}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <Button size="sm" variant="primary" loading={busy} disabled={code.length !== 6} onClick={confirm}>
                {s.confirm}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={reset}>
            {s.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
