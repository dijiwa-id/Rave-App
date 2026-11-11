import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import type { Artist } from '@/lib/types';
import { Button, Card, Field, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { CITIES, GENRES, QueryState, useCurrentArtist } from '@/components/b2b/common';
import { uploadFile } from './NewRelease';
import { useDict } from '@/lib/i18n';

function ImagePicker({ label, url, onChange, wide }: { label: string; url: string; onChange: (u: string) => void; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  const t = useDict('b2b').studio.profile;
  return (
    <div>
      <p className="mb-1.5 text-sm font-bold">{label}</p>
      <div className="flex items-center gap-3">
        {url ? (
          <img src={url} alt="" className={wide ? 'h-20 w-48 rounded-none object-cover' : 'size-20 rounded-full object-cover'} />
        ) : (
          <div className={wide ? 'h-20 w-48 rounded-none bg-b2b-bg' : 'size-20 rounded-full bg-b2b-bg'} />
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-b2b-line bg-b2b-card px-4 py-1.5 text-sm font-bold hover:border-b2b-ink">
          <Upload className="size-4" /> {busy ? t.uploading : t.upload}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              try {
                onChange(await uploadFile(f, 'artwork'));
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {url && (
          <button type="button" onClick={() => onChange('')} className="text-sm font-bold text-b2b-muted hover:text-red-600">
            {t.remove}
          </button>
        )}
      </div>
    </div>
  );
}

/** Profil publik artis (bio, foto, sampul, kota, genre) — PATCH /v1/studio/artists/:artistId. */
export default function StudioProfile() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['artist', aid], queryFn: () => api<Artist>(`/v1/catalog/artists/${aid}`) });
  const [f, setF] = useState<{ bio: string; image_url: string; cover_url: string; city: string; genres: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useDict('b2b').studio.profile;
  useEffect(() => {
    if (q.data)
      setF({ bio: q.data.bio ?? '', image_url: q.data.image_url ?? '', cover_url: q.data.cover_url ?? '', city: q.data.city ?? '', genres: q.data.genres ?? [] });
  }, [q.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true);
    try {
      await api(`/v1/studio/artists/${aid}`, {
        method: 'PATCH',
        body: { bio: f.bio || null, image_url: f.image_url || null, cover_url: f.cover_url || null, city: f.city || null, genres: f.genres },
      });
      qc.invalidateQueries({ queryKey: ['artist', aid] });
      toast.success(t.saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          q.data?.slug && (
            <Link to={`/app/artist/${q.data.slug}`} className="inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
              {t.viewPublic} <ExternalLink className="size-4" />
            </Link>
          )
        }
      />
      <QueryState q={q}>
        {f && (
          <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card title={t.about}>
              <Field label={t.bio} hint={`${f.bio.length}/5000`}>
                <Textarea rows={8} maxLength={5000} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder={t.bioPlaceholder} />
              </Field>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label={t.hometown}>
                  <Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
                    <option value="">—</option>
                    {[...new Set([...(f.city ? [f.city] : []), ...CITIES])].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="mt-4 mb-1.5 text-sm font-bold">{t.genres}</p>
              <div className="flex flex-wrap gap-2">
                {[...new Set([...f.genres, ...GENRES])].map((g) => {
                  const on = f.genres.includes(g);
                  return (
                    <button
                      type="button"
                      key={g}
                      aria-pressed={on}
                      disabled={!on && f.genres.length >= 10}
                      onClick={() => setF({ ...f, genres: on ? f.genres.filter((x) => x !== g) : [...f.genres, g] })}
                      className={`rounded-none border px-3 py-1 text-xs font-bold disabled:opacity-40 ${on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted'}`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </Card>
            <div className="space-y-6">
              <Card title={t.visual}>
                <div className="space-y-4">
                  <ImagePicker label={t.photo} url={f.image_url} onChange={(u) => setF({ ...f, image_url: u })} />
                  <ImagePicker label={t.cover} url={f.cover_url} wide onChange={(u) => setF({ ...f, cover_url: u })} />
                </div>
              </Card>
              <Button variant="ink" type="submit" loading={busy} className="w-full">
                {t.save}
              </Button>
            </div>
          </form>
        )}
      </QueryState>
    </div>
  );
}
