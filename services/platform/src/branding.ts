import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { BRANDING_MAX_BYTES, BRANDING_PUBLIC_PREFIX, BRANDING_SLOTS, SETTINGS, type BrandingSlot } from '@gema/domain/settings';
import { audit, badRequest, notFound, requireSuperAdmin, settings, unprocessable, type ServiceContext } from '@gema/service-kit';
import { BUCKETS, invalidateBucket } from './storage.js';

type ImageType = keyof typeof BRANDING_MAX_BYTES;

/** Definisi registri per slot (aturan dimensi & latar pratinjau). */
const SLOT_DEF = Object.fromEntries(SETTINGS.filter((d) => d.image).map((d) => [d.image!.slot, d])) as Record<BrandingSlot, (typeof SETTINGS)[number]>;

/** Nama file branding yang sedang dipakai pengaturan (untuk penanda "Dipakai" & proteksi hapus). */
export function brandingReferences(): Set<string> {
  const out = new Set<string>();
  for (const d of SETTINGS)
    if (d.type === 'image') {
      const v = settings.get<string>(d.key);
      if (v?.startsWith(BRANDING_PUBLIC_PREFIX)) out.add(v.slice(BRANDING_PUBLIC_PREFIX.length));
    }
  return out;
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * SVG adalah dokumen aktif → tolak apa pun yang bisa mengeksekusi kode atau memuat sumber eksternal.
 * (Allowlist parser penuh lebih ketat; aturan ini menutup vektor umum dan file tetap dilayani dengan CSP ketat.)
 */
const SVG_FORBIDDEN: [RegExp, string][] = [
  [/<!DOCTYPE|<!ENTITY/i, 'DOCTYPE/ENTITY'],
  [/<script[\s>/]/i, '<script>'],
  [/<foreignObject[\s>/]/i, '<foreignObject>'],
  [/<(iframe|embed|object|audio|video|canvas|handler|listener)[\s>/]/i, 'elemen tertanam'],
  [/\son[a-z]+\s*=/i, 'atribut event (on…)'],
  [/javascript:|vbscript:|data:text\/html/i, 'URL skrip'],
  [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(png|jpeg|gif|webp);)/i, 'tautan/gambar eksternal'],
  [/@import|url\(\s*["']?\s*(?!#|data:image\/)/i, 'CSS eksternal'],
];

function svgInfo(buf: Buffer): { width: number | null; height: number | null } {
  const text = buf.toString('utf8');
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) throw unprocessable('File bukan SVG yang valid (elemen akar harus <svg>)');
  for (const [re, what] of SVG_FORBIDDEN) if (re.test(text)) throw unprocessable(`SVG ditolak demi keamanan: mengandung ${what}`);
  const root = text.match(/<svg[^>]*>/i)![0];
  const vb = root.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const w = root.match(/\swidth\s*=\s*["']\s*([\d.]+)/i);
  const h = root.match(/\sheight\s*=\s*["']\s*([\d.]+)/i);
  const width = vb ? Number(vb[1]) : w ? Number(w[1]) : null;
  const height = vb ? Number(vb[2]) : h ? Number(h[1]) : null;
  return { width, height };
}

/** Validasi file terhadap aturan slot. Mengembalikan dimensi (SVG: dari viewBox). */
export function validateBranding(slot: BrandingSlot, type: ImageType, buf: Buffer) {
  const rule = SLOT_DEF[slot].image!;
  if (buf.length > BRANDING_MAX_BYTES[type]) throw unprocessable(`Ukuran maksimum ${Math.round(BRANDING_MAX_BYTES[type] / 1024)} KB untuk ${type === 'image/png' ? 'PNG' : 'SVG'}`);
  if (type === 'image/png') {
    const d = pngSize(buf);
    if (!d) throw unprocessable('File bukan PNG yang valid');
    if (Math.min(d.width, d.height) < rule.minPx) throw unprocessable(`Resolusi minimal ${rule.minPx} px (diterima ${d.width}×${d.height})`);
    if (rule.square && d.width !== d.height) throw unprocessable(`Ikon harus persegi 1:1 (diterima ${d.width}×${d.height})`);
    return d;
  }
  const d = svgInfo(buf);
  // SVG vektor: dimensi minimum tidak relevan, tetapi rasio tetap dicek bila viewBox tersedia.
  if (rule.square && d.width && d.height && Math.abs(d.width / d.height - 1) > 0.02) throw unprocessable(`Ikon harus persegi 1:1 (viewBox ${d.width}×${d.height})`);
  return d;
}

export async function brandingRoutes(app: FastifyInstance, { db }: ServiceContext) {
  for (const ct of Object.keys(BRANDING_MAX_BYTES)) {
    app.addContentTypeParser(ct, { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  }

  // Publik: dipakai web (logo, favicon) tanpa login. Nama file = hash isi → aman di-cache selamanya.
  app.get('/v1/platform/branding/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[\w-]+\.(svg|png)$/.test(file)) throw notFound('File');
    const p = join(BUCKETS.branding.path, file);
    if (!existsSync(p)) throw notFound('File');
    const svg = file.endsWith('.svg');
    reply.header('content-type', svg ? 'image/svg+xml' : 'image/png');
    reply.header('content-length', statSync(p).size);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.header('x-content-type-options', 'nosniff');
    // Bila SVG dibuka langsung di tab: tidak ada skrip/sumber eksternal yang boleh jalan.
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    return reply.send(createReadStream(p));
  });

  /**
   * Unggah file branding. Belum dipakai sampai pengaturan `branding.*_url` disimpan (dengan alasan) —
   * sehingga perubahan tetap lewat alur riwayat & audit yang sama. File yang tidak pernah disimpan tampil "Yatim" di Storage.
   */
  app.post('/v1/admin/platform/branding', { preHandler: requireSuperAdmin }, async (req, reply) => {
    const slot = (req.query as { slot?: string }).slot as BrandingSlot;
    if (!BRANDING_SLOTS.includes(slot)) throw badRequest(`slot harus salah satu: ${BRANDING_SLOTS.join(', ')}`);
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() as ImageType;
    if (!(type in BRANDING_MAX_BYTES)) throw unprocessable('Hanya SVG (image/svg+xml) atau PNG (image/png)');
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest('File kosong');
    const dim = validateBranding(slot, type, buf);
    const hash = createHash('sha256').update(buf).digest('hex');
    const file = `${slot.replace('_', '-')}-${hash.slice(0, 16)}.${type === 'image/png' ? 'png' : 'svg'}`;
    writeFileSync(join(BUCKETS.branding.path, file), buf);
    invalidateBucket('branding');
    await audit(db, { actorId: req.user!.sub, action: 'branding.upload', entity: 'branding', entityId: file, data: { slot, type, size: buf.length, ...dim } });
    reply.status(201);
    return { slot, url: BRANDING_PUBLIC_PREFIX + file, content_type: type, size: buf.length, width: dim.width, height: dim.height, sha256: hash };
  });
}
