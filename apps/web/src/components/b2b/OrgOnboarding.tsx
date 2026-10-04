import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Mic2, ShieldCheck, Ticket } from 'lucide-react';
import { api, forceRefresh } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { Badge, Button, Field, Input, Select, toast } from '@/components/ui';
import { GemaMark } from '@/components/ui/GemaLogo';
import { CITIES, GENRES } from './common';

async function refreshMe() {
  await forceRefresh();
  const me = await api<Me>('/v1/me');
  useAuth.getState().setUser(me);
  return me;
}

/** Onboarding B2B: daftar sebagai artis/manajemen (Studio) atau promotor + KYC (Promotor Hub). */
export function OrgOnboarding({ kind }: { kind: 'artist' | 'promotor' }) {
  const user = useAuth((s) => s.user);
  const [type, setType] = useState<'ARTIST' | 'MANAGEMENT' | 'PROMOTOR'>(kind === 'artist' ? 'ARTIST' : 'PROMOTOR');
  const [name, setName] = useState('');
  const [city, setCity] = useState(user?.city ?? 'Jakarta');
  const [genres, setGenres] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const hasPromotor = user?.orgs.some((o) => o.type === 'PROMOTOR');
  const hasManagement = user?.orgs.some((o) => o.type === 'MANAGEMENT');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/v1/orgs', { body: { type, name, city, genres: type === 'ARTIST' ? genres : undefined } });
      await refreshMe();
      toast.success(type === 'ARTIST' ? 'Profil artis dibuat' : 'Organisasi dibuat');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const Icon = kind === 'artist' ? Mic2 : Ticket;
  return (
    <div className="min-h-full bg-b2b-bg text-b2b-ink">
      <header className="flex items-center justify-between border-b border-b2b-line bg-white px-6 py-4">
        <Link to="/app" className="flex items-center gap-2 font-extrabold">
          <GemaMark className="size-8" invert /> Gema
        </Link>
        <Link to="/app" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">
          Kembali ke aplikasi
        </Link>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-2">
        <div>
          <span className="grid size-12 place-items-center rounded-xl bg-b2b-ink text-white">
            <Icon className="size-6" />
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{kind === 'artist' ? 'Kelola karier & panggungmu' : 'Temukan & booking artis dengan aman'}</h1>
          <ul className="mt-6 space-y-3 text-sm">
            {(kind === 'artist'
              ? ['Upload karya, split hak, dan rilis terjadwal', 'EPK dinamis dengan data pendengar per kota', 'Kalender anti-bentrok & inbox booking', 'Kontrak otomatis & dibayar lewat rekening bersama']
              : ['Cari artis berdasarkan audiens di kotamu', 'Harga transparan dari rate card', 'Kontrak elektronik & dana aman di escrow', 'Jual tiket & check-in di satu tempat']
            ).map((t) => (
              <li key={t} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {t}
              </li>
            ))}
          </ul>
          {kind === 'artist' && hasManagement && (
            <p className="mt-6 rounded-xl border border-b2b-line bg-white p-4 text-sm text-b2b-muted">
              Anda sudah punya organisasi manajemen. Minta artis mengundang Anda, atau buat profil artis baru di sini untuk roster Anda.
            </p>
          )}
        </div>

        {kind === 'promotor' && hasPromotor ? (
          <KycForm />
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-b2b-line bg-white p-6">
            <h2 className="text-lg font-extrabold">{kind === 'artist' ? 'Daftar sebagai Artis' : 'Daftar sebagai Promotor'}</h2>
            {kind === 'artist' && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(['ARTIST', 'MANAGEMENT'] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => setType(t)}
                    className={`rounded-xl border p-3 text-left text-sm ${type === t ? 'border-b2b-ink ring-1 ring-b2b-ink' : 'border-b2b-line'}`}
                  >
                    <p className="font-bold">{t === 'ARTIST' ? 'Saya artis / band' : 'Saya manajemen'}</p>
                    <p className="text-xs text-b2b-muted">{t === 'ARTIST' ? 'Profil artis + studio' : 'Kelola banyak artis'}</p>
                  </button>
                ))}
              </div>
            )}
            <Field label={type === 'ARTIST' ? 'Nama panggung' : type === 'MANAGEMENT' ? 'Nama manajemen' : 'Nama promotor / EO'}>
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Kota">
              <Select value={city} onChange={(e) => setCity(e.target.value)}>
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            {type === 'ARTIST' && (
              <div>
                <p className="mb-1.5 text-sm font-bold">Genre</p>
                <div className="flex flex-wrap gap-2">
                  {GENRES.map((g) => (
                    <button
                      type="button"
                      key={g}
                      aria-pressed={genres.includes(g)}
                      onClick={() => setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])}
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${genres.includes(g) ? 'border-b2b-ink bg-b2b-ink text-white' : 'border-b2b-line text-b2b-muted'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button variant="ink" type="submit" loading={busy} className="w-full">
              Buat {type === 'ARTIST' ? 'profil artis' : 'organisasi'}
            </Button>
            {type === 'MANAGEMENT' && <p className="text-xs text-b2b-muted">Setelah membuat manajemen, tambahkan profil artis untuk roster Anda dari halaman ini.</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/** KYC (REQ-IAM-04): wajib sebelum mengirim inquiry/offer atau menerima pembayaran. */
export function KycForm({ compact }: { compact?: boolean }) {
  const user = useAuth((s) => s.user);
  const kyc = useQuery({ queryKey: ['kyc'], queryFn: () => api<any>('/v1/me/kyc') });
  const org = user?.orgs.find((o) => o.type === 'PROMOTOR');
  const [f, setF] = useState({ level: 'BUSINESS' as 'INDIVIDUAL' | 'BUSINESS', full_name: user?.display_name ?? '', id_number: '', business_name: org?.name ?? '', nib: '' });
  const [busy, setBusy] = useState(false);
  const status = kyc.data?.status ?? user?.kyc_status ?? 'NONE';
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/v1/me/kyc', { body: { ...f, org_id: org?.id } });
      await kyc.refetch();
      await refreshMe();
      toast.success('KYC dikirim — menunggu verifikasi');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  if (status === 'VERIFIED' || status === 'PENDING')
    return (
      <div className="rounded-2xl border border-b2b-line bg-white p-6">
        <ShieldCheck className="size-8 text-emerald-600" />
        <h2 className="mt-3 text-lg font-extrabold">Verifikasi identitas</h2>
        <Badge tone={status === 'VERIFIED' ? 'green' : 'amber'} className="mt-2">
          {status === 'VERIFIED' ? 'Terverifikasi' : 'Menunggu review'}
        </Badge>
        <p className="mt-3 text-sm text-b2b-muted">
          {status === 'VERIFIED' ? 'Badge "Terverifikasi" tampil di profil Anda. Anda dapat mengirim inquiry dan pembayaran.' : 'Tim kami memverifikasi data Anda. Inquiry dapat dikirim setelah KYC terverifikasi.'}
        </p>
        {!compact && (
          <Link to="/promotor" onClick={() => void refreshMe()} className="mt-4 inline-block text-sm font-bold underline">
            Lanjut ke Promotor Hub
          </Link>
        )}
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-b2b-line bg-white p-6">
      <h2 className="text-lg font-extrabold">Verifikasi identitas (KYC/KYB)</h2>
      <p className="text-sm text-b2b-muted">Wajib sebelum mengirim inquiry ke artis. Data KTP/NIB disimpan terenkripsi sesuai UU PDP.</p>
      {status === 'REJECTED' && <Badge tone="red">Ditolak: {kyc.data?.reason ?? 'periksa data'}</Badge>}
      <div className="grid grid-cols-2 gap-2">
        {(['BUSINESS', 'INDIVIDUAL'] as const).map((l) => (
          <button type="button" key={l} onClick={() => setF({ ...f, level: l })} className={`rounded-xl border p-3 text-sm font-bold ${f.level === l ? 'border-b2b-ink ring-1 ring-b2b-ink' : 'border-b2b-line'}`}>
            {l === 'BUSINESS' ? 'Badan usaha' : 'Perorangan'}
          </button>
        ))}
      </div>
      <Field label="Nama lengkap (sesuai KTP)">
        <Input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      </Field>
      <Field label="NIK">
        <Input required inputMode="numeric" pattern="\d{16}" title="16 digit NIK" value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} />
      </Field>
      {f.level === 'BUSINESS' && (
        <>
          <Field label="Nama badan usaha">
            <Input required value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} />
          </Field>
          <Field label="NIB">
            <Input required value={f.nib} onChange={(e) => setF({ ...f, nib: e.target.value })} />
          </Field>
        </>
      )}
      <Button variant="ink" type="submit" loading={busy} className="w-full">
        Kirim verifikasi
      </Button>
    </form>
  );
}
