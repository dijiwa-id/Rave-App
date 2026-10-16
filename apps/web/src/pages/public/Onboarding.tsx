import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, MapPin } from 'lucide-react';
import Stepper, { Step } from '@/components/reactbits/Stepper';
import { api } from '@/lib/api';
import type { ArtistSummary, Me, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { GemaLogo } from '@/components/ui/GemaLogo';
import { cx, Spinner, toast } from '@/components/ui';

const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo', 'Palembang', 'Lainnya'];
const FALLBACK_GENRES = ['indie-pop', 'folk', 'akustik', 'rock', 'post-punk', 'indie-rock', 'r-n-b', 'soul', 'shoegaze', 'dream-pop', 'hip-hop', 'pop', 'electronic', 'jazz', 'dangdut'];

/** Onboarding fan berbasis selera (REQ-IAM-02): kota, genre, ≥3 artis. */
export default function Onboarding() {
  const token = useAuth((s) => s.accessToken);
  const setUser = useAuth((s) => s.setUser);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [step, setStep] = useState(1);

  const genresQ = useQuery({ queryKey: ['genres'], queryFn: () => api<Paged<{ id: string; name: string }>>('/v1/catalog/genres') });
  const artistsQ = useQuery({ queryKey: ['artists', 'onboarding'], queryFn: () => api<Paged<ArtistSummary>>('/v1/catalog/artists', { query: { limit: 50 } }) });

  if (!token) return <Navigate to="/login?next=/onboarding" replace />;

  const genreList = genresQ.data?.data?.length ? genresQ.data.data : FALLBACK_GENRES.map((g) => ({ id: g, name: g }));
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const canNext = step === 1 ? !!city : step === 2 ? genres.length > 0 : artists.length >= 3;

  async function finish() {
    try {
      const me = await api<Me>('/v1/me/onboarding', { body: { city, genres, artist_ids: artists } });
      setUser(me);
      toast.success('Selera kamu tersimpan — selamat mendengarkan!');
      nav(params.get('next') || '/app', { replace: true });
    } catch (e) {
      toast.error(e);
      setStep(3);
    }
  }

  const chip = (active: boolean) => cx('rounded-full border px-4 py-2 text-sm font-bold transition', active ? 'border-gema-primary bg-gema-primary text-white' : 'border-white/30 text-white hover:border-white');

  return (
    <div className="min-h-full bg-gradient-to-b from-[#1e3264] to-black text-white">
      <header className="flex justify-center py-8">
        <GemaLogo />
      </header>
      <h1 className="px-4 text-center text-3xl font-black md:text-4xl">Kenalan dulu, yuk.</h1>
      <p className="mt-2 px-4 text-center text-gema-muted">Supaya beranda, chart kota, dan info manggung dekatmu terasa personal.</p>
      <Stepper
        initialStep={1}
        onStepChange={setStep}
        onFinalStepCompleted={finish}
        backButtonText="Kembali"
        nextButtonText="Lanjut"
        completeButtonText="Selesai"
        stepCircleContainerClassName="!max-w-2xl bg-[#181818] border border-white/10"
        nextButtonProps={{ disabled: !canNext, className: cx('rounded-full bg-gema-primary px-6 py-2 font-bold text-white transition hover:scale-105', !canNext && 'pointer-events-none opacity-40') }}
        disableStepIndicators
      >
        <Step>
          <h2 className="text-xl font-bold">Kamu tinggal di kota mana?</h2>
          <p className="mb-5 text-sm text-gema-muted">Kami kabari bila artis favoritmu manggung di kotamu.</p>
          <div className="flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <button key={c} type="button" onClick={() => setCity(c)} className={chip(city === c)} aria-pressed={city === c}>
                <MapPin className="mr-1 inline size-3.5" />
                {c}
              </button>
            ))}
          </div>
        </Step>
        <Step>
          <h2 className="text-xl font-bold">Genre apa yang kamu suka?</h2>
          <p className="mb-5 text-sm text-gema-muted">Pilih sebanyak yang kamu mau.</p>
          <div className="flex flex-wrap gap-2">
            {genreList.map((g) => (
              <button key={g.id} type="button" onClick={() => toggle(genres, setGenres, g.id)} className={chip(genres.includes(g.id))} aria-pressed={genres.includes(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        </Step>
        <Step>
          <h2 className="text-xl font-bold">Pilih minimal 3 artis</h2>
          <p className="mb-5 text-sm text-gema-muted">{artists.length}/3 dipilih</p>
          {artistsQ.isLoading ? (
            <Spinner />
          ) : (
            <div className="grid max-h-[340px] grid-cols-3 gap-4 overflow-y-auto pr-1 sm:grid-cols-4">
              {(artistsQ.data?.data ?? []).map((a) => {
                const on = artists.includes(a.id);
                return (
                  <button key={a.id} type="button" onClick={() => toggle(artists, setArtists, a.id)} aria-pressed={on} className="group text-center">
                    <span className="relative mx-auto block size-20">
                      {a.image_url ? <img src={a.image_url} alt="" className={cx('size-20 rounded-full object-cover transition', on && 'ring-4 ring-gema-primary')} /> : <span className="block size-20 rounded-full bg-gema-highlight" />}
                      {on && (
                        <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-gema-primary text-white">
                          <Check className="size-4" />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block truncate text-xs font-bold">{a.name}</span>
                  </button>
                );
              })}
              {artistsQ.isError && <p className="col-span-full text-sm text-gema-muted">Daftar artis belum dapat dimuat.</p>}
            </div>
          )}
        </Step>
      </Stepper>
    </div>
  );
}
