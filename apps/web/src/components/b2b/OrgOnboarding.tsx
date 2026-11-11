import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Mic2, ShieldCheck, Ticket } from 'lucide-react';
import { api, forceRefresh } from '@/lib/api';
import type { Me } from '@/lib/types';
import { managementOrgs, promotorOrgs, useAuth } from '@/stores/auth';
import { Badge, Button, Field, Input, Select, toast } from '@/components/ui';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { CITIES, GENRES } from './common';
import { PendingSplits } from './PendingSplits';
import { useDict } from '@/lib/i18n';

async function refreshMe() {
  await forceRefresh();
  const me = await api<Me>('/v1/me');
  useAuth.getState().setUser(me);
  return me;
}

/** Onboarding B2B: daftar sebagai artis/manajemen (Studio) atau promotor + KYC (Promotor Hub). */
export function OrgOnboarding({ kind }: { kind: 'artist' | 'promotor' }) {
  const user = useAuth((s) => s.user);
  const [type, setType] = useState<'ARTIST' | 'MANAGEMENT' | 'PROMOTOR' | 'VENUE'>(kind === 'artist' ? 'ARTIST' : 'PROMOTOR');
  const [name, setName] = useState('');
  const [city, setCity] = useState(user?.city ?? 'Jakarta');
  const [genres, setGenres] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const hasPromotor = promotorOrgs(user).length > 0;
  const hasManagement = user?.orgs.some((o) => o.type === 'MANAGEMENT');
  // Manajemen (OWNER) yang membuat profil artis baru: langsung masukkan ke roster.
  const mgmt = managementOrgs(user);
  const [rosterOrg, setRosterOrg] = useState<string>(mgmt[0]?.id ?? '');
  const d = useDict('b2b').onboarding;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const org = await api<{ id: string }>('/v1/orgs', { body: { type, name, city, genres: type === 'ARTIST' ? genres : undefined } });
      if (type === 'ARTIST' && rosterOrg) await api(`/v1/orgs/${rosterOrg}/manage-artist`, { body: { artist_org_id: org.id } });
      await refreshMe();
      toast.success(type === 'ARTIST' ? (rosterOrg ? d.artistCreatedRoster : d.artistCreated) : d.orgCreated);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const Icon = kind === 'artist' ? Mic2 : Ticket;
  return (
    <div className="min-h-full bg-b2b-bg text-b2b-ink">
      <header className="flex items-center justify-between border-b border-b2b-line bg-b2b-card px-6 py-4">
        <Link to="/app" className="flex items-center gap-2 font-extrabold">
          <RaveLogo dark className="h-8" />
        </Link>
        <Link to="/app" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">
          {d.back}
        </Link>
      </header>
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-2">
        <div>
          <span className="grid size-12 place-items-center rounded-none bg-b2b-ink text-b2b-on-ink">
            <Icon className="size-6" />
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{kind === 'artist' ? d.artistHeadline : d.promotorHeadline}</h1>
          <ul className="mt-6 space-y-3 text-sm">
            {(kind === 'artist' ? d.artistPoints : d.promotorPoints).map((t) => (
              <li key={t} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> {t}
              </li>
            ))}
          </ul>
          {kind === 'artist' && hasManagement && (
            <p className="mt-6 rounded-none border border-b2b-line bg-b2b-card p-4 text-sm text-b2b-muted">
              {d.hasMgmtPre}<strong>{d.hasMgmtAdmin}</strong>{d.hasMgmtPost}
            </p>
          )}
          {kind === 'artist' && <PendingSplits className="mt-6" />}
        </div>

        {kind === 'promotor' && hasPromotor ? (
          <KycForm />
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-none border border-b2b-line bg-b2b-card p-6">
            <h2 className="text-lg font-extrabold">{kind === 'artist' ? d.registerArtist : d.registerPromotor}</h2>
            {kind === 'promotor' && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(['PROMOTOR', 'VENUE'] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => setType(t)}
                    className={`rounded-none border p-3 text-left text-sm ${type === t ? 'border-b2b-ink ring-1 ring-b2b-ink' : 'border-b2b-line'}`}
                  >
                    <p className="font-bold">{t === 'PROMOTOR' ? d.promotorEo : d.venue}</p>
                    <p className="text-xs text-b2b-muted">{t === 'PROMOTOR' ? d.promotorEoDesc : d.venueDesc}</p>
                  </button>
                ))}
              </div>
            )}
            {kind === 'artist' && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(['ARTIST', 'MANAGEMENT'] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => setType(t)}
                    className={`rounded-none border p-3 text-left text-sm ${type === t ? 'border-b2b-ink ring-1 ring-b2b-ink' : 'border-b2b-line'}`}
                  >
                    <p className="font-bold">{t === 'ARTIST' ? d.iAmArtist : d.iAmMgmt}</p>
                    <p className="text-xs text-b2b-muted">{t === 'ARTIST' ? d.iAmArtistDesc : d.iAmMgmtDesc}</p>
                  </button>
                ))}
              </div>
            )}
            <Field label={type === 'ARTIST' ? d.stageName : type === 'MANAGEMENT' ? d.mgmtName : type === 'VENUE' ? d.venueName : d.promotorName}>
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={d.city}>
              <Select value={city} onChange={(e) => setCity(e.target.value)}>
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            {type === 'ARTIST' && (
              <div>
                <p className="mb-1.5 text-sm font-bold">{d.genre}</p>
                <div className="flex flex-wrap gap-2">
                  {GENRES.map((g) => (
                    <button
                      type="button"
                      key={g}
                      aria-pressed={genres.includes(g)}
                      onClick={() => setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])}
                      className={`rounded-none border px-3 py-1 text-xs font-bold ${genres.includes(g) ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {type === 'ARTIST' && mgmt.length > 0 && (
              <Field label={d.addToRoster}>
                <Select value={rosterOrg} onChange={(e) => setRosterOrg(e.target.value)}>
                  <option value="">{d.independent}</option>
                  {mgmt.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Button variant="ink" type="submit" loading={busy} className="w-full">
              {type === 'ARTIST' ? d.createArtist : d.createOrg}
            </Button>
            {type === 'MANAGEMENT' && <p className="text-xs text-b2b-muted">{d.mgmtHint}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/** KYC (REQ-IAM-04): wajib sebelum mengirim inquiry/offer atau menerima pembayaran. */
export function KycForm({ compact, orgId, nextLink: nextLinkProp }: { compact?: boolean; orgId?: string; nextLink?: { to: string; label: string } | null }) {
  const user = useAuth((s) => s.user);
  const d = useDict('b2b').onboarding;
  const nextLink = nextLinkProp === undefined ? { to: '/promotor', label: d.nextPromotor } : nextLinkProp;
  const kyc = useQuery({ queryKey: ['kyc'], queryFn: () => api<any>('/v1/me/kyc') });
  // KYB butuh org tempat user OWNER/ADMIN: org yang diberikan pemanggil (Studio), atau org promotor pertama.
  const org = orgId ? user?.orgs.find((o) => o.id === orgId) : promotorOrgs(user)[0];
  const canBusiness = !!org && ['OWNER', 'ADMIN'].includes(org.role);
  const [f, setF] = useState({ level: (canBusiness ? 'BUSINESS' : 'INDIVIDUAL') as 'INDIVIDUAL' | 'BUSINESS', full_name: user?.display_name ?? '', id_number: '', business_name: org?.name ?? '', nib: '' });
  const [busy, setBusy] = useState(false);
  const status = kyc.data?.status ?? user?.kyc_status ?? 'NONE';
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/v1/me/kyc', { body: { ...f, org_id: f.level === 'BUSINESS' ? org?.id : undefined } });
      await kyc.refetch();
      await refreshMe();
      toast.success(d.kycSent);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  if (status === 'VERIFIED' || status === 'PENDING')
    return (
      <div className="rounded-none border border-b2b-line bg-b2b-card p-6">
        <ShieldCheck className="size-8 text-emerald-600" />
        <h2 className="mt-3 text-lg font-extrabold">{d.identity}</h2>
        <Badge tone={status === 'VERIFIED' ? 'green' : 'amber'} className="mt-2">
          {status === 'VERIFIED' ? d.verified : d.pendingReview}
        </Badge>
        <p className="mt-3 text-sm text-b2b-muted">
          {status === 'VERIFIED' ? d.verifiedBody : d.pendingBody}
        </p>
        {!compact && nextLink && (
          <Link to={nextLink.to} onClick={() => void refreshMe()} className="mt-4 inline-block text-sm font-bold underline">
            {nextLink.label}
          </Link>
        )}
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4 rounded-none border border-b2b-line bg-b2b-card p-6">
      <h2 className="text-lg font-extrabold">{d.kycTitle}</h2>
      <p className="text-sm text-b2b-muted">{d.kycNote}</p>
      {status === 'REJECTED' && <Badge tone="red">{d.rejected(kyc.data?.reason ?? d.checkData)}</Badge>}
      <div className="grid grid-cols-2 gap-2">
        {(['BUSINESS', 'INDIVIDUAL'] as const).map((l) => (
          <button
            type="button"
            key={l}
            disabled={l === 'BUSINESS' && !canBusiness}
            title={l === 'BUSINESS' && !canBusiness ? d.kybOnly : undefined}
            onClick={() => setF({ ...f, level: l })}
            className={`rounded-none border p-3 text-sm font-bold disabled:opacity-40 ${f.level === l ? 'border-b2b-ink ring-1 ring-b2b-ink' : 'border-b2b-line'}`}
          >
            {l === 'BUSINESS' ? d.business : d.individual}
          </button>
        ))}
      </div>
      <Field label={d.fullName}>
        <Input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      </Field>
      <Field label={d.nik}>
        <Input required inputMode="numeric" pattern="\d{16}" title={d.nikTitle} value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} />
      </Field>
      {f.level === 'BUSINESS' && (
        <>
          <Field label={d.businessName}>
            <Input required value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} />
          </Field>
          <Field label={d.nib}>
            <Input required value={f.nib} onChange={(e) => setF({ ...f, nib: e.target.value })} />
          </Field>
        </>
      )}
      <Button variant="ink" type="submit" loading={busy} className="w-full">
        {d.submitKyc}
      </Button>
    </form>
  );
}
