import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, MapPin } from 'lucide-react';
import Stepper, { Step } from '@/components/reactbits/Stepper';
import { api } from '@/lib/api';
import type { ArtistSummary, Me, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { cx, Spinner, toast } from '@/components/ui';
import { dict, useDict } from '@/lib/i18n';

/** Nilai kota disimpan apa adanya (termasuk 'Lainnya'); hanya label yang diterjemahkan. */
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
  const d = useDict('public').onboarding;

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
      toast.success(dict('public').onboarding.saved);
      nav(params.get('next') || '/app', { replace: true });
    } catch (e) {
      toast.error(e);
      setStep(3);
    }
  }

  const chip = (active: boolean) => cx('rounded-none border px-4 py-2 text-sm font-bold transition', active ? 'border-rave-primary bg-rave-primary text-rave-on-primary' : 'border-white/30 text-white hover:border-white');

  return (
    <div className="min-h-full bg-gradient-to-b from-[#2A1233] to-[#181818] text-white">
      <header className="flex justify-center py-8">
        <RaveLogo />
      </header>
      <h1 className="px-4 text-center text-3xl font-black md:text-4xl">{d.title}</h1>
      <p className="mt-2 px-4 text-center text-rave-muted">{d.lead}</p>
      <Stepper
        initialStep={1}
        onStepChange={setStep}
        onFinalStepCompleted={finish}
        backButtonText={d.back}
        nextButtonText={d.next}
        completeButtonText={d.finish}
        stepCircleContainerClassName="!max-w-2xl bg-[#181818] border border-white/10"
        nextButtonProps={{ disabled: !canNext, className: cx('rounded-none bg-rave-primary px-6 py-2 font-bold text-rave-on-primary transition hover:scale-105', !canNext && 'pointer-events-none opacity-40') }}
        disableStepIndicators
      >
        <Step>
          <h2 className="text-xl font-bold">{d.cityTitle}</h2>
          <p className="mb-5 text-sm text-rave-muted">{d.cityBody}</p>
          <div className="flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <button key={c} type="button" onClick={() => setCity(c)} className={chip(city === c)} aria-pressed={city === c}>
                <MapPin className="mr-1 inline size-3.5" />
                {c === 'Lainnya' ? d.otherCity : c}
              </button>
            ))}
          </div>
        </Step>
        <Step>
          <h2 className="text-xl font-bold">{d.genreTitle}</h2>
          <p className="mb-5 text-sm text-rave-muted">{d.genreBody}</p>
          <div className="flex flex-wrap gap-2">
            {genreList.map((g) => (
              <button key={g.id} type="button" onClick={() => toggle(genres, setGenres, g.id)} className={chip(genres.includes(g.id))} aria-pressed={genres.includes(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        </Step>
        <Step>
          <h2 className="text-xl font-bold">{d.artistTitle}</h2>
          <p className="mb-5 text-sm text-rave-muted">{d.selected(artists.length)}</p>
          {artistsQ.isLoading ? (
            <Spinner />
          ) : (
            <div className="grid max-h-[340px] grid-cols-3 gap-4 overflow-y-auto pr-1 sm:grid-cols-4">
              {(artistsQ.data?.data ?? []).map((a) => {
                const on = artists.includes(a.id);
                return (
                  <button key={a.id} type="button" onClick={() => toggle(artists, setArtists, a.id)} aria-pressed={on} className="group text-center">
                    <span className="relative mx-auto block size-20">
                      {a.image_url ? <img src={a.image_url} alt="" className={cx('size-20 rounded-full object-cover transition', on && 'ring-4 ring-rave-primary')} /> : <span className="block size-20 rounded-full bg-rave-highlight" />}
                      {on && (
                        <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-rave-primary text-rave-on-primary">
                          <Check className="size-4" />
                        </span>
                      )}
                    </span>
                    <span className="mt-2 block truncate text-xs font-bold">{a.name}</span>
                  </button>
                );
              })}
              {artistsQ.isError && <p className="col-span-full text-sm text-rave-muted">{d.artistsError}</p>}
            </div>
          )}
        </Step>
      </Stepper>
    </div>
  );
}
