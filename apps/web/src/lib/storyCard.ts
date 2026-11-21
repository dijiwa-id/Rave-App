/**
 * Kartu cerita Instagram 1080×1920 (PNG) untuk lagu yang dibagikan: latar sampul buram + gelap, sampul persegi,
 * judul, artis, merek RAVE, dan tautan. Dibuat di browser (canvas) — tidak ada beban server. Sampul diambil sebagai
 * blob (same-origin /v1/catalog/media) agar canvas tidak "tainted"; gagal memuat sampul → kartu tetap dibuat tanpa sampul.
 */
const W = 1080;
const H = 1920;

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    const sameOrigin = new URL(url, location.href);
    // URL absolut server (PUBLIC_WEB_URL) bisa beda origin di dev → pakai path relatif bila path-nya media lokal.
    const src = sameOrigin.pathname.startsWith('/v1/') ? `${sameOrigin.pathname}${sameOrigin.search}` : url;
    const r = await fetch(src, { credentials: 'omit' });
    if (!r.ok) return null;
    const obj = URL.createObjectURL(await r.blob());
    const img = new Image();
    img.decoding = 'async';
    img.src = obj;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Potong teks ke maks. `lines` baris selebar `maxW` (elipsis di akhir). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) cur = next;
    else {
      if (cur) out.push(cur);
      cur = w;
    }
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(' ') !== out.join(' ')) {
    let last = out[lines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    out[lines - 1] = `${last}…`;
  }
  return out;
}

export async function renderStoryCard(s: { title: string; artist: string; url: string; image_url: string | null; tagline: string }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  await document.fonts?.ready;
  // Logo RAVE asli (versi latar gelap: huruf putih + piringan ungu) — sama dengan gambar pratinjau X/Facebook.
  const [cover, logo] = await Promise.all([loadImage(s.image_url), loadImage('/rave-logo.png')]);

  // Latar: sampul diperbesar & diburamkan + gradasi ungu RAVE.
  ctx.fillStyle = '#181818';
  ctx.fillRect(0, 0, W, H);
  if (cover) {
    ctx.save();
    ctx.filter = 'blur(60px) saturate(1.2) brightness(0.55)';
    const scale = Math.max(W / cover.width, H / cover.height) * 1.15;
    ctx.drawImage(cover, (W - cover.width * scale) / 2, (H - cover.height * scale) / 2, cover.width * scale, cover.height * scale);
    ctx.restore();
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(91,42,110,0.55)');
  g.addColorStop(0.55, 'rgba(24,24,24,0.35)');
  g.addColorStop(1, 'rgba(11,10,12,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Sampul persegi dengan bayangan sablon RAVE.
  const size = 760;
  const x = (W - size) / 2;
  const y = 330;
  ctx.fillStyle = '#0b0a0c';
  ctx.fillRect(x + 22, y + 22, size, size);
  if (cover) {
    const side = Math.min(cover.width, cover.height);
    ctx.drawImage(cover, (cover.width - side) / 2, (cover.height - side) / 2, side, side, x, y, size, size);
  } else {
    const cg = ctx.createLinearGradient(x, y, x + size, y + size);
    cg.addColorStop(0, '#5B2A6E');
    cg.addColorStop(1, '#F4C21F');
    ctx.fillStyle = cg;
    ctx.fillRect(x, y, size, size);
  }
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#0b0a0c';
  ctx.strokeRect(x, y, size, size);

  // Label kecil, judul, artis.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#F4C21F';
  ctx.font = "700 30px 'Space Mono', ui-monospace, monospace";
  ctx.fillText(s.tagline.toUpperCase(), W / 2, 250);
  ctx.fillStyle = '#EDEDED';
  ctx.font = "84px Staatliches, Impact, sans-serif";
  const titleLines = wrap(ctx, s.title.toUpperCase(), W - 160, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, 1240 + i * 92));
  ctx.fillStyle = 'rgba(237,237,237,0.75)';
  ctx.font = "600 44px 'Bricolage Grotesque', system-ui, sans-serif";
  ctx.fillText(wrap(ctx, s.artist, W - 160, 1)[0] ?? '', W / 2, 1240 + titleLines.length * 92 + 30);

  // Merek (logo asli; cadangan teks bila logo gagal dimuat) & tautan.
  if (logo) {
    const lw = 400;
    const lh = (logo.height / logo.width) * lw;
    ctx.drawImage(logo, (W - lw) / 2, 1690 - lh, lw, lh);
  } else {
    ctx.fillStyle = '#EDEDED';
    ctx.font = "120px Staatliches, Impact, sans-serif";
    ctx.fillText('RAVE', W / 2, 1700);
  }
  ctx.fillStyle = 'rgba(237,237,237,0.6)';
  ctx.font = "700 28px 'Space Mono', ui-monospace, monospace";
  ctx.fillText(s.url.replace(/^https?:\/\//, ''), W / 2, 1772);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}
