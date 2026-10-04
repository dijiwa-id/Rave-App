import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppleLogo, Facebook } from '@/components/fan/BrandIcons';
import CodeSlots, { type CodeSlotsStatus } from '@/components/reactbits/CodeSlots';
import { api } from '@/lib/api';
import type { TokenResponse } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { GemaLogo } from '@/components/ui/GemaLogo';
import { toast } from '@/components/ui';

const DEMO = [
  ['fan@gema.id', 'Fan'],
  ['artis@gema.id', 'Artis'],
  ['manajer@gema.id', 'Manajer'],
  ['promotor@gema.id', 'Promotor'],
  ['admin@gema.id', 'Admin'],
] as const;

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Login() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const signup = params.get('signup') === '1';
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<CodeSlotsStatus>('idle');
  const [busy, setBusy] = useState(false);

  function done(t: TokenResponse) {
    setSession(t);
    const next = params.get('next');
    nav(!t.user.onboarded ? `/onboarding${next ? `?next=${encodeURIComponent(next)}` : ''}` : next || '/app', { replace: true });
  }

  async function requestOtp(dest: string) {
    const r = await api<{ sent: boolean; dev_code?: string }>('/v1/auth/otp', { body: { channel: 'email', destination: dest }, auth: false });
    return r.dev_code ?? null;
  }

  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      setDevCode(await requestOtp(email.trim()));
      setStep('otp');
      setCode('');
      setStatus('idle');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(c: string) {
    setBusy(true);
    try {
      const t = await api<TokenResponse>('/v1/auth/token', { body: { grant_type: 'otp', destination: email.trim(), code: c }, auth: false });
      setStatus('success');
      setTimeout(() => done(t), 350);
    } catch (err) {
      setStatus('error');
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function demo(addr: string) {
    setBusy(true);
    try {
      const c = await requestOtp(addr);
      if (!c) throw new Error('dev_code tidak tersedia (mode produksi)');
      const t = await api<TokenResponse>('/v1/auth/token', { body: { grant_type: 'otp', destination: addr, code: c }, auth: false });
      done(t);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const soon = () => toast.info('Login sosial segera hadir');
  const social = 'flex h-12 w-full items-center justify-center gap-3 rounded-full text-sm font-bold tracking-[0.1em] uppercase transition hover:scale-[1.02]';

  return (
    <div className="min-h-full bg-white text-black">
      <header className="flex justify-center border-b border-neutral-200 py-6">
        <Link to="/" aria-label="Beranda GEMA">
          <GemaLogo dark />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[450px] px-4 py-10">
        {step === 'email' ? (
          <>
            <h1 className="mb-8 text-center text-2xl font-black">{signup ? 'Daftar gratis untuk mulai mendengarkan.' : 'Untuk melanjutkan, masuk ke GEMA.'}</h1>
            <div className="space-y-3">
              <button onClick={soon} className={`${social} bg-[#1877f2] text-white`}>
                <Facebook className="size-5" /> Lanjutkan dengan Facebook
              </button>
              <button onClick={soon} className={`${social} bg-[#191414] text-white`}>
                <AppleLogo className="size-5" /> Lanjutkan dengan Apple
              </button>
              <button onClick={soon} className={`${social} border border-neutral-400 text-neutral-600`}>
                <GoogleG /> Lanjutkan dengan Google
              </button>
            </div>
            <div className="my-6 flex items-center gap-4">
              <hr className="flex-1 border-neutral-300" />
              <span className="text-sm font-bold">ATAU</span>
              <hr className="flex-1 border-neutral-300" />
            </div>
            <form onSubmit={sendOtp} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-bold">Alamat email</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@email.com"
                  className="h-12 w-full rounded border border-neutral-400 px-3.5 focus:border-black focus:outline-none"
                />
              </label>
              <p className="text-xs text-neutral-500">Kami akan mengirim kode 6 digit ke email ini. Belum punya akun? Akun dibuat otomatis saat pertama masuk.</p>
              <div className="flex justify-end">
                <button disabled={busy} className="h-12 rounded-full bg-gema-green px-10 text-sm font-bold tracking-[0.1em] text-black uppercase transition hover:scale-105 disabled:opacity-60">
                  {busy ? 'Mengirim…' : 'Kirim kode'}
                </button>
              </div>
            </form>
            {import.meta.env.DEV && (
              <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-4">
                <p className="mb-3 text-xs font-bold tracking-wide text-neutral-500 uppercase">Akun demo (mode dev)</p>
                <div className="flex flex-wrap gap-2">
                  {DEMO.map(([addr, label]) => (
                    <button key={addr} disabled={busy} onClick={() => demo(addr)} className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-bold hover:border-black disabled:opacity-50">
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center">
            <button onClick={() => setStep('email')} className="mb-6 inline-flex items-center gap-1 text-sm font-bold text-neutral-500 hover:text-black">
              <ArrowLeft className="size-4" /> Ganti email
            </button>
            <h1 className="text-2xl font-black">Masukkan kode 6 digit</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Dikirim ke <strong>{email}</strong>. Berlaku 5 menit.
            </p>
            <div className="mt-8 flex justify-center">
              <CodeSlots
                length={6}
                value={code}
                onChange={(c) => {
                  setCode(c);
                  if (status === 'error') setStatus('idle');
                }}
                onComplete={verify}
                status={status}
                autoFocus
                disabled={busy}
                accentColor="#1ed760"
                inkColor="#111111"
                slotColor="#f2f2f2"
                ariaLabel="Kode OTP"
              />
            </div>
            {devCode && (
              <p className="mt-4 text-xs text-neutral-500">
                Kode dev: <button className="font-mono font-bold text-black underline" onClick={() => { setCode(devCode); void verify(devCode); }}>{devCode}</button>
              </p>
            )}
            <button onClick={() => sendOtp()} disabled={busy} className="mt-8 text-sm font-bold underline disabled:opacity-50">
              Kirim ulang kode
            </button>
          </div>
        )}
        <hr className="my-8 border-neutral-200" />
        <p className="text-center text-xs text-neutral-500">
          Dengan melanjutkan, kamu menyetujui Ketentuan Layanan dan Kebijakan Privasi GEMA (sesuai UU PDP).
        </p>
      </main>
    </div>
  );
}
