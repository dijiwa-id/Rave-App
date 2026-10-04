import { SEED } from '@gema/domain';
import { publish, uuidv7, type Client, type ServiceContext } from '@gema/service-kit';
import { encrypt, mask } from './core.js';

const U = SEED.users;
const E = SEED.emails;

async function user(tx: Client, id: string, email: string, name: string, extra: Record<string, unknown> = {}) {
  const r = await tx.query(
    `INSERT INTO users (id, email, display_name, city, genres, onboarded, is_admin, premium)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [id, email, name, extra.city ?? null, extra.genres ?? [], extra.onboarded ?? false, extra.is_admin ?? false, extra.premium ?? false],
  );
  await tx.query(`INSERT INTO identities (provider, subject, user_id) VALUES ('email',$1,$2) ON CONFLICT DO NOTHING`, [email, id]);
  if (r.rowCount) await publish(tx, 'iam.user.registered', id, { userId: id, email, displayName: name });
  return !!r.rowCount;
}

async function org(tx: Client, o: { id: string; type: string; name: string; slug: string; city?: string; genres?: readonly string[]; verified?: boolean; artistId?: string; owner?: string }) {
  const r = await tx.query(
    `INSERT INTO orgs (id, type, name, slug, city, genres, verified, artist_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [o.id, o.type, o.name, o.slug, o.city ?? null, o.genres ?? [], o.verified ?? false, o.artistId ?? null],
  );
  if (o.owner) await tx.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'OWNER') ON CONFLICT DO NOTHING`, [o.id, o.owner]);
  if (r.rowCount)
    await publish(tx, 'iam.org.created', o.id, {
      orgId: o.id,
      type: o.type as any,
      name: o.name,
      ownerUserId: o.owner ?? null, // org artis belum diklaim (REQ-IAM-05) → tanpa pemilik
      artistId: o.artistId ?? null,
    });
}

export async function seed({ db, log }: ServiceContext) {
  await db.tx(async (tx) => {
    const fanNew = await user(tx, U.fan, E.fan, 'Raka Pendengar', { city: 'Bandung', genres: ['indie-pop', 'folk'], onboarded: true });
    await user(tx, U.artist, E.artist, 'Sekar (Senja Kolektif)', { city: 'Bandung', onboarded: true });
    await user(tx, U.manager, E.manager, 'Dimas Manajer', { city: 'Jakarta', onboarded: true });
    await user(tx, U.promotor, E.promotor, 'Laras Promotor', { city: 'Jakarta', onboarded: true });
    await user(tx, U.admin, E.admin, 'Admin GEMA', { city: 'Jakarta', onboarded: true, is_admin: true });

    if (fanNew) {
      const follow = [SEED.artists[0].id, SEED.artists[1].id, SEED.artists[5].id];
      await publish(tx, 'iam.user.onboarded', U.fan, { userId: U.fan, city: 'Bandung', genres: ['indie-pop', 'folk'], artistIds: follow });
    }

    for (const a of SEED.artists) {
      await org(tx, {
        id: a.orgId,
        type: 'ARTIST',
        name: a.name,
        slug: a.slug,
        city: a.city,
        genres: a.genres,
        verified: a.slug === 'senja-kolektif',
        artistId: a.id,
        owner: a.slug === 'senja-kolektif' ? U.artist : undefined,
      });
    }
    await org(tx, { id: SEED.orgs.nadaManagement, type: 'MANAGEMENT', name: 'Nada Manajemen', slug: 'nada-manajemen', city: 'Jakarta', verified: true, owner: U.manager });
    await org(tx, { id: SEED.orgs.pensiPromotor, type: 'PROMOTOR', name: 'Pensi Nusantara', slug: 'pensi-nusantara', city: 'Jakarta', verified: true, owner: U.promotor });
    await org(tx, { id: SEED.orgs.indieLabel, type: 'LABEL', name: 'Rekam Pinggir', slug: 'rekam-pinggir', city: 'Bandung', verified: true, owner: U.admin });

    const rel = await tx.query(`INSERT INTO management_artists (management_org_id, artist_org_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
      SEED.orgs.nadaManagement,
      SEED.orgs.senjaArtist,
    ]);
    if (rel.rowCount)
      await publish(tx, 'iam.org.member_added', SEED.orgs.senjaArtist, {
        orgId: SEED.orgs.senjaArtist,
        type: 'ARTIST',
        userId: U.manager,
        role: 'ADMIN',
        artistId: SEED.artists[0].id,
      });

    // KYC terverifikasi untuk promotor (individu + badan) dan artis Senja
    for (const k of [
      { user: U.promotor, org: SEED.orgs.pensiPromotor, level: 'BUSINESS', name: 'Laras Wulandari', idn: '3174012345678901' },
      { user: U.artist, org: SEED.orgs.senjaArtist, level: 'INDIVIDUAL', name: 'Sekar Ayu', idn: '3273019876543210' },
    ]) {
      const exists = await tx.query(`SELECT 1 FROM kyc_submissions WHERE user_id = $1 AND status = 'VERIFIED'`, [k.user]);
      if (exists.rowCount) continue;
      await tx.query(
        `INSERT INTO kyc_submissions (id, user_id, org_id, level, full_name, id_number_enc, id_number_masked, business_name, nib, status, decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'VERIFIED',$10, now())`,
        [uuidv7(), k.user, k.org, k.level, k.name, encrypt(k.idn), mask(k.idn), k.level === 'BUSINESS' ? 'PT Pensi Nusantara Kreatif' : null, k.level === 'BUSINESS' ? '9120001234567' : null, U.admin],
      );
      await publish(tx, 'iam.kyc.verified', k.user, { userId: k.user, orgId: k.org, level: k.level as any });
    }

    for (const p of ['personalization', 'aggregate_sharing'])
      await tx.query(`INSERT INTO consents (user_id, purpose, policy_version, granted) VALUES ($1,$2,'v1-2026-10',true) ON CONFLICT DO NOTHING`, [U.fan, p]);
  });
  log.info('seed iam: 5 user, 11 org');
}
