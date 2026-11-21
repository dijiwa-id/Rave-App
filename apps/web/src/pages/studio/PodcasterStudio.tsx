import { useState } from 'react';
import { create } from 'zustand';
import { Link } from 'react-router-dom';
import { Headphones, Lock } from 'lucide-react';
import { api, forceRefresh } from '@/lib/api';
import type { Me, OrgClaim } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { B2BLayout } from '@/layouts/B2BLayout';
import { Button, Field, Input, toast } from '@/components/ui';
import { JoinCardTitle, JoinShell } from '@/components/b2b/JoinShell';
import { OrgSwitcher } from '@/components/b2b/common';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useDict } from '@/lib/i18n';
import { PodcastManager } from './Podcasts';

/**
 * Podcaster Studio (/podcaster) — untuk akun Kreator (org CREATOR) yang menerbitkan podcast tanpa profil artis.
 * Artis/manajemen/label memakai menu Podcast di Artist Studio. Siapa yang boleh: Pengaturan → Podcaster.
 */
export const creatorOrgs = (u: Me | null): OrgClaim[] => (u?.orgs ?? []).filter((o) => o.type === 'CREATOR');

const useCreatorOrg = create<{ id: string | null; set: (id: string) => void }>((set) => ({ id: null, set: (id) => set({ id }) }));
function useCurrentCreator(): { orgs: OrgClaim[]; org: OrgClaim | undefined; setOrgId: (id: string) => void } {
  const user = useAuth((s) => s.user);
  const { id, set } = useCreatorOrg();
  const orgs = creatorOrgs(user);
  return { orgs, org: orgs.find((o) => o.id === id) ?? orgs[0], setOrgId: set };
}

export function PodcasterLayout() {
  const t = useDict('b2b').podcaster;
  const { orgs, org, setOrgId } = useCurrentCreator();
  if (!org) return <CreatorOnboarding />;
  return (
    <B2BLayout
      product="Podcaster Studio"
      accent="#1F5C52"
      nav={[{ to: '/podcaster', label: t.title, icon: Headphones, end: true }]}
      context={orgs.length > 1 ? <OrgSwitcher label={t.account} orgs={orgs} value={org.id} onChange={setOrgId} /> : undefined}
    />
  );
}

/** Isi /podcaster (Outlet B2BLayout). */
export function PodcasterHome() {
  const { org } = useCurrentCreator();
  return org ? <PodcastManager key={org.id} org={org} /> : null;
}

function CreatorOnboarding() {
  const t = useDict('b2b').podcaster;
  const cfg = usePlatformConfig();
  const allowed = setting<string[]>(cfg, 'podcast.creator_org_types', ['ARTIST', 'CREATOR']).includes('CREATOR') && setting(cfg, 'podcast.creator_enabled', true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/v1/orgs', { body: { type: 'CREATOR', name: name.trim() } });
      await forceRefresh();
      useAuth.getState().setUser(await api<Me>('/v1/me'));
      toast.success(t.creatorCreated);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <JoinShell
      product="Podcaster Studio"
      icon={Headphones}
      title={t.onboardTitle}
      lead={t.onboardLead}
      points={t.onboardPoints}
      backLabel={t.back}
      aside={
        <p className="border border-b2b-line bg-b2b-card p-4 text-sm text-b2b-muted">
          {t.artistHint}{' '}
          <Link to="/studio" className="font-bold text-b2b-ink underline underline-offset-4">
            Artist Studio
          </Link>
        </p>
      }
    >
      {allowed ? (
        <form onSubmit={submit} className="space-y-4">
          <JoinCardTitle title={t.onboardForm} subtitle={t.onboardFormSub} />
          <Field label={t.creatorName} hint={t.creatorNameHint}>
            <Input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" variant="ink" loading={busy} disabled={name.trim().length < 2} className="h-11 w-full">
            {t.onboardSubmit}
          </Button>
        </form>
      ) : (
        <div className="flex items-start gap-3 text-sm text-b2b-muted">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>{t.creatorClosed}</p>
        </div>
      )}
    </JoinShell>
  );
}
