import type { FastifyInstance, FastifyRequest } from 'fastify';
import { INTEGRATION_KINDS, INTEGRATION_PROVIDERS, validateIntegration, type IntegrationKind } from '@rave/domain/integrations';
import {
  audit,
  badRequest,
  brandedEmail,
  callService,
  decryptSecrets,
  emailProvider,
  encryptSecrets,
  invalidateIntegration,
  maskSecret,
  requireService,
  requireSuperAdmin,
  sendEmailWith,
  setIntegrationLoader,
  z,
  type Db,
  type IntegrationConfig,
  type ServiceContext,
} from '@rave/service-kit';

/**
 * Platform → Integrasi (khusus Super Admin): email (OTP & notifikasi) dan payment gateway.
 * - Rahasia dienkripsi (service-kit/integrations), tidak pernah dikirim ke browser; UI hanya melihat ••••1234.
 * - Service lain membaca via `GET /internal/integrations/:kind` (token service; /internal/* tidak diteruskan gateway).
 * - Tanpa baris di DB → service memakai env (perilaku lama); sumber aktif ditampilkan di dasbor.
 */

const kindParam = z.object({ kind: z.enum(['email', 'payment']) });
const actorName = (req: FastifyRequest) => req.user?.name ?? req.user?.email ?? req.user?.sub ?? null;

async function load(db: Db, kind: IntegrationKind): Promise<IntegrationConfig | null> {
  const r = await db.one(`SELECT * FROM integrations WHERE kind = $1`, [kind]);
  if (!r) return null;
  let secrets: Record<string, string> = {};
  try {
    secrets = decryptSecrets(r.secrets_enc);
  } catch {
    // Kunci enkripsi berganti (INTEGRATIONS_KEY/KYC_KEY) → rahasia lama tidak terbaca; dasbor meminta isi ulang.
    secrets = {};
  }
  return { kind, provider: r.provider, config: r.config ?? {}, secrets, updated_at: r.updated_at };
}

/** Ringkasan env (tanpa nilai rahasia) — ditampilkan bila dasbor belum diatur. */
function envSummary(kind: IntegrationKind) {
  if (kind === 'email') return { provider: emailProvider(), from: process.env.EMAIL_FROM ?? null };
  return { provider: (process.env.PAYMENT_PROVIDER ?? 'sandbox').toLowerCase(), mode: process.env.MIDTRANS_MODE ?? null };
}

function view(kind: IntegrationKind, row: any, cfg: IntegrationConfig | null, decryptOk: boolean) {
  const def = cfg ? INTEGRATION_PROVIDERS[kind][cfg.provider] : undefined;
  const secretFields = (def?.fields ?? []).filter((f) => f.type === 'secret');
  return {
    kind,
    source: cfg ? 'dashboard' : 'env',
    provider: cfg?.provider ?? null,
    config: cfg?.config ?? {},
    secrets: Object.fromEntries(secretFields.map((f) => [f.key, maskSecret(cfg?.secrets[f.key])])),
    secrets_unreadable: !!row?.secrets_enc && !decryptOk,
    env: envSummary(kind),
    updated_by: row?.updated_by ?? null,
    updated_at: row?.updated_at ?? null,
    last_test: row?.last_test_at ? { at: row.last_test_at, ok: row.last_test_ok, message: row.last_test_message } : null,
  };
}

export async function integrationRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // Service platform sendiri (mis. email uji) membaca DB-nya langsung, bukan HTTP ke dirinya.
  setIntegrationLoader((kind) => load(db, kind));

  app.get('/internal/integrations/:kind', { preHandler: requireService }, async (req) => {
    const { kind } = kindParam.parse(req.params);
    return { integration: await load(db, kind) };
  });

  await app.register(async (a) => {
    a.addHook('preHandler', requireSuperAdmin);

    a.get('/v1/admin/platform/integrations', async () => {
      const out = [];
      for (const kind of INTEGRATION_KINDS) {
        const row = await db.one(`SELECT * FROM integrations WHERE kind = $1`, [kind]);
        let ok = true;
        if (row?.secrets_enc) {
          try {
            decryptSecrets(row.secrets_enc);
          } catch {
            ok = false;
          }
        }
        out.push(view(kind, row, await load(db, kind), ok));
      }
      const history = await db.query(`SELECT kind, provider, changed, reason, actor_name, at FROM integration_history ORDER BY at DESC LIMIT 20`);
      return { data: out, history, webhook_url: `${(process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/v1/webhooks/pg/midtrans` };
    });

    /**
     * Simpan. `secrets`: nilai baru = ganti, `null` = hapus, kunci tidak disebut = pertahankan (bila provider sama).
     * Mengganti provider membuang rahasia provider lama.
     */
    a.put('/v1/admin/platform/integrations/:kind', async (req) => {
      const { kind } = kindParam.parse(req.params);
      const b = z
        .object({
          provider: z.string().min(2).max(40),
          config: z.record(z.string().max(500)).default({}),
          secrets: z.record(z.string().max(2000).nullable()).default({}),
          reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500),
        })
        .parse(req.body);
      const def = INTEGRATION_PROVIDERS[kind][b.provider];
      if (!def) throw badRequest(`Provider tidak dikenal: ${b.provider}`);
      const prev = await load(db, kind);
      const keep = prev && prev.provider === b.provider ? { ...prev.secrets } : {};
      const secretKeys = new Set(def.fields.filter((f) => f.type === 'secret').map((f) => f.key));
      for (const [k, v] of Object.entries(b.secrets)) {
        if (!secretKeys.has(k)) throw badRequest(`Field rahasia tidak dikenal: ${k}`);
        if (v === null || v.trim() === '') delete keep[k];
        else keep[k] = v.trim();
      }
      for (const k of Object.keys(keep)) if (!secretKeys.has(k)) delete keep[k];
      const config = Object.fromEntries(Object.entries(b.config).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''));
      const errors = validateIntegration(kind, b.provider, config, new Set(Object.keys(keep)));
      if (errors.length) throw badRequest('Konfigurasi integrasi tidak valid: ' + errors.map((e) => e.message).join('; '), { type: 'https://rave.id/problems/validation', errors });

      const changed = [
        ...(prev?.provider !== b.provider ? ['provider'] : []),
        ...Object.keys({ ...prev?.config, ...config }).filter((k) => (prev?.config?.[k] ?? '') !== (config[k] ?? '')),
        ...[...secretKeys].filter((k) => (prev?.secrets?.[k] ?? '') !== (keep[k] ?? '')),
      ];
      await db.tx(async (c) => {
        await c.query(
          `INSERT INTO integrations (kind, provider, config, secrets_enc, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT (kind) DO UPDATE SET provider=$2, config=$3, secrets_enc=$4, updated_by=$5, updated_at=now(),
             last_test_at = CASE WHEN integrations.provider = $2 THEN integrations.last_test_at END,
             last_test_ok = CASE WHEN integrations.provider = $2 THEN integrations.last_test_ok END,
             last_test_message = CASE WHEN integrations.provider = $2 THEN integrations.last_test_message END`,
          [kind, b.provider, JSON.stringify(config), Object.keys(keep).length ? encryptSecrets(keep) : null, actorName(req)],
        );
        await c.query(`INSERT INTO integration_history (kind, provider, changed, reason, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,$6)`, [
          kind,
          b.provider,
          changed,
          b.reason,
          req.user!.sub,
          actorName(req),
        ]);
        // Audit tanpa nilai rahasia — hanya nama field yang berubah.
        await audit(c, { actorId: req.user!.sub, action: 'integration.update', entity: 'integration', entityId: kind, data: { provider: b.provider, changed, reason: b.reason }, ip: req.ip });
      });
      invalidateIntegration(kind);
      const row = await db.one(`SELECT * FROM integrations WHERE kind = $1`, [kind]);
      return view(kind, row, await load(db, kind), true);
    });

    /** Kembali ke env (hapus konfigurasi dasbor). */
    a.delete('/v1/admin/platform/integrations/:kind', async (req) => {
      const { kind } = kindParam.parse(req.params);
      const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body ?? {});
      await db.tx(async (c) => {
        const r = await c.query(`DELETE FROM integrations WHERE kind = $1 RETURNING provider`, [kind]);
        if (r.rowCount) {
          await c.query(`INSERT INTO integration_history (kind, provider, changed, reason, actor_id, actor_name) VALUES ($1,'(env)','{reset}',$2,$3,$4)`, [kind, reason, req.user!.sub, actorName(req)]);
          await audit(c, { actorId: req.user!.sub, action: 'integration.reset', entity: 'integration', entityId: kind, data: { reason }, ip: req.ip });
        }
      });
      invalidateIntegration(kind);
      return view(kind, null, null, true);
    });

    /** Uji konfigurasi tersimpan: email → kirim email uji; payment → cek kredensial ke penyedia (tanpa transaksi). */
    a.post('/v1/admin/platform/integrations/:kind/test', async (req) => {
      const { kind } = kindParam.parse(req.params);
      const b = z.object({ to: z.string().email().optional() }).parse(req.body ?? {});
      const cfg = await load(db, kind);
      if (!cfg) throw badRequest('Simpan konfigurasi di dasbor terlebih dahulu (saat ini memakai env)');
      let result: { ok: boolean; message: string };
      if (kind === 'email') {
        const to = b.to ?? req.user!.email;
        if (!to) throw badRequest('Alamat tujuan email uji wajib diisi');
        if (INTEGRATION_PROVIDERS.email[cfg.provider]?.inert) result = { ok: false, message: 'Provider "log" tidak mengirim email — pilih provider nyata.' };
        else {
          try {
            const m = brandedEmail({
              heading: 'Email uji RAVE',
              lines: [`Konfigurasi email ${cfg.provider} berhasil mengirim pesan ini.`, `Dikirim ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB oleh ${actorName(req) ?? 'Super Admin'}.`],
            });
            const r = await sendEmailWith({ provider: cfg.provider, get: (k) => cfg.secrets[k] || cfg.config[k] || undefined }, { to, subject: 'Email uji RAVE', ...m, tag: 'test' });
            result = { ok: true, message: `Terkirim ke ${to} lewat ${r.provider}${r.id ? ` (id ${r.id})` : ''}. Periksa kotak masuk & folder spam.` };
          } catch (e: any) {
            result = { ok: false, message: e?.message ?? String(e) };
          }
        }
      } else {
        result = await callService<{ ok: boolean; message: string }>('platform', 'finance', '/internal/payment/test', {
          method: 'POST',
          body: { provider: cfg.provider, server_key: cfg.secrets.MIDTRANS_SERVER_KEY, mode: cfg.config.MIDTRANS_MODE },
        }).catch((e: any) => ({ ok: false, message: `Service finance tidak terjangkau: ${e?.message ?? e}` }));
      }
      await db.query(`UPDATE integrations SET last_test_at = now(), last_test_ok = $2, last_test_message = $3 WHERE kind = $1`, [kind, result.ok, result.message.slice(0, 500)]);
      await audit(db, { actorId: req.user!.sub, action: 'integration.test', entity: 'integration', entityId: kind, data: { provider: cfg.provider, ok: result.ok }, ip: req.ip });
      return result;
    });
  });
}
