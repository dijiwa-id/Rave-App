/**
 * Generator tekstur piringan hitam vintage (hyperrealistic) — dirender SEKALI ke WebP lalu dipakai web, desktop & mobile.
 *
 *   node --import tsx scripts/vinyl-textures.ts            # → apps/web/public/textures/vinyl-{disc,label}.webp
 *
 * - vinyl-disc.webp  : piringan utuh (transparan di luar lingkaran). Alur mikro + dinamika musik per band, celah antar-track,
 *                      dead wax dengan nomor matriks tergores tangan, lead-in & bevel tepi, patina cokelat (kesan "rusty"),
 *                      baret tangensial, goresan, debu, serat kain, sidik jari, dan gumpil kecil di tepi.
 * - vinyl-label.webp : lapisan usia label (dipadukan `multiply` di atas warna/cover label): kertas menguning tak rata,
 *                      foxing, noda cincin kopi, tepi gelap, dan bekas spindle di sekitar lubang.
 * Kilau cahaya TIDAK dipanggang — tetap lapisan diam terpisah agar putaran terbaca. Deterministik (PRNG berbenih).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { findChromium } from '../services/booking/src/contract-pdf.js';

const S = 1024;
const C = S / 2;
const R = C - 4;
const OUT = join(import.meta.dirname, '..', 'apps', 'web', 'public', 'textures');
const FONTS = join(import.meta.dirname, '..', 'apps', 'web', 'public', 'fonts');

let seed = 0x5eed1979;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const rr = (a: number, b: number) => a + rnd() * (b - a);
const f = (n: number) => n.toFixed(2);
const polar = (r: number, a: number) => [C + r * Math.cos(a), C + r * Math.sin(a)];
function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${f(x0)},${f(y0)} A${f(r)},${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(x1)},${f(y1)}`;
}

/** Zona radial (×R). */
const Z = { label: 0.31, wax: 0.46, grooveEnd: 0.962, leadIn: 0.982 };

function disc(): string {
  const p: string[] = [];
  // 1) Dinamika musik: band alur dengan kilap berbeda (bagian keras = alur lebar, lebih memantul).
  for (let r = Z.wax * R; r < Z.grooveEnd * R; ) {
    const w = rr(0.6, 3.4);
    const light = rnd() < 0.55;
    p.push(`<circle cx="${C}" cy="${C}" r="${f(r)}" fill="none" stroke="${light ? '#3a332c' : '#000'}" stroke-opacity="${f(rr(0.06, light ? 0.3 : 0.4))}" stroke-width="${f(w)}"/>`);
    r += w * rr(0.6, 1.6);
  }
  // 2) Celah antar-track: alur kosong yang lebih halus & gelap dengan tepi tipis berkilau.
  for (const t of [0.548, 0.627, 0.701, 0.789, 0.861, 0.924]) {
    const r = t * R;
    p.push(`<circle cx="${C}" cy="${C}" r="${f(r)}" fill="none" stroke="#060504" stroke-width="3.6"/>`);
    p.push(`<circle cx="${C}" cy="${C}" r="${f(r + 2.1)}" fill="none" stroke="#f4e2c6" stroke-opacity="0.07" stroke-width="0.7"/>`);
    p.push(`<circle cx="${C}" cy="${C}" r="${f(r - 2.1)}" fill="none" stroke="#f4e2c6" stroke-opacity="0.04" stroke-width="0.6"/>`);
  }
  return p.join('');
}

function wear(): string {
  const p: string[] = [];
  // Baret tangensial (mengikuti alur) — gesekan sleeve & jarum bertahun-tahun.
  for (let i = 0; i < 320; i++) {
    const r = rr(Z.wax, Z.leadIn) * R;
    const a0 = rr(0, Math.PI * 2);
    p.push(`<path d="${arc(r, a0, a0 + rr(0.05, 1.1))}" stroke="#efe2cc" stroke-opacity="${f(rr(0.015, 0.075))}" stroke-width="${f(rr(0.4, 1.6))}" fill="none"/>`);
  }
  // Goresan acak (melintang alur), sebagian dalam: inti gelap + tepi terang.
  for (let i = 0; i < 46; i++) {
    const deep = i < 5;
    const a = rr(0, Math.PI * 2);
    const r = rr(Z.wax + 0.02, 0.97) * R;
    const [x, y] = polar(r, a);
    const len = deep ? rr(60, 220) : rr(14, 150);
    const dir = rr(0, Math.PI * 2);
    const bend = rr(-0.25, 0.25) * len;
    const x2 = x + len * Math.cos(dir);
    const y2 = y + len * Math.sin(dir);
    const mx = (x + x2) / 2 - bend * Math.sin(dir);
    const my = (y + y2) / 2 + bend * Math.cos(dir);
    const d = `M${f(x)},${f(y)} Q${f(mx)},${f(my)} ${f(x2)},${f(y2)}`;
    if (deep) p.push(`<path d="${d}" stroke="#000" stroke-opacity="0.55" stroke-width="1.6" fill="none"/>`);
    p.push(`<path d="${d}" stroke="#f6ead6" stroke-opacity="${f(deep ? 0.32 : rr(0.06, 0.2))}" stroke-width="${f(deep ? 0.7 : rr(0.35, 0.9))}" fill="none" stroke-linecap="round"/>`);
  }
  // Debu: titik halus, menumpuk di dekat tepi & dead wax (tempat jarum tidak menyapu).
  for (let i = 0; i < 520; i++) {
    const edge = rnd() < 0.35;
    const r = (edge ? rr(0.9, 0.995) : rr(Z.label, 0.995)) * R;
    const [x, y] = polar(r, rr(0, Math.PI * 2));
    p.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr(0.3, rnd() < 0.06 ? 2.2 : 1.1))}" fill="#eee4d2" fill-opacity="${f(rr(0.06, rnd() < 0.1 ? 0.55 : 0.28))}"/>`);
  }
  // Serat kain / lint.
  for (let i = 0; i < 9; i++) {
    const [x, y] = polar(rr(0.5, 0.97) * R, rr(0, Math.PI * 2));
    let d = `M${f(x)},${f(y)}`;
    let cx = x;
    let cy = y;
    for (let k = 0; k < 4; k++) {
      const nx = cx + rr(-14, 14);
      const ny = cy + rr(-14, 14);
      d += ` Q${f(cx + rr(-10, 10))},${f(cy + rr(-10, 10))} ${f(nx)},${f(ny)}`;
      cx = nx;
      cy = ny;
    }
    p.push(`<path d="${d}" stroke="#d9cfbf" stroke-opacity="0.42" stroke-width="0.6" fill="none" stroke-linecap="round"/>`);
  }
  return p.join('');
}

/** Nomor matriks tergores tangan di dead wax. */
const MATRIX = `<text font-family="Space Mono" font-size="15" letter-spacing="3" fill="#cbbca4" fill-opacity="0.22" stroke="#000" stroke-opacity="0.5" stroke-width="0.4"><textPath href="#wax" startOffset="8%">RAVE·LP·001·A1   ✱ dijiwa   △ 7915   ROLLIEMONKIE</textPath></text>`;

function discSvg(): string {
  const waxR = ((Z.label + Z.wax) / 2) * R;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <clipPath id="clip"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
    <radialGradient id="base" cx="${C}" cy="${C}" r="${R}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#16120f"/><stop offset="0.6" stop-color="#110e0c"/><stop offset="0.97" stop-color="#0f0d0b"/><stop offset="1" stop-color="#1d1915"/>
    </radialGradient>
    <!-- Alur mikro: gradien radial berulang (periode ±2,4 px) -->
    <radialGradient id="groove" cx="${C}" cy="${C}" r="2.4" gradientUnits="userSpaceOnUse" spreadMethod="repeat">
      <stop offset="0" stop-color="#090807"/><stop offset="0.42" stop-color="#211d19"/><stop offset="0.55" stop-color="#0d0b0a"/><stop offset="1" stop-color="#090807"/>
    </radialGradient>
    <mask id="grooveZone">
      <circle cx="${C}" cy="${C}" r="${Z.leadIn * R}" fill="#fff"/><circle cx="${C}" cy="${C}" r="${Z.wax * R}" fill="#000"/>
    </mask>
    <radialGradient id="rim" cx="${C}" cy="${C}" r="${R}" gradientUnits="userSpaceOnUse">
      <stop offset="${Z.leadIn}" stop-color="#000" stop-opacity="0"/><stop offset="0.988" stop-color="#2c2620"/><stop offset="0.994" stop-color="#4a4036"/><stop offset="1" stop-color="#070605"/>
    </radialGradient>
    <!-- Patina cokelat tak rata: piringan tua yang lama tersimpan (kesan rusty/vintage) -->
    <filter id="patina" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0065" numOctaves="5" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.27  0 0 0 0 0.14  0 0 0 1.5 -0.62"/>
    </filter>
    <!-- Bintik oksidasi kecil kemerahan -->
    <filter id="rust" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="21"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.24  0 0 0 0 0.1  0 0 0 9 -6.4"/>
    </filter>
    <!-- Butiran permukaan halus -->
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.9  0 0 0 0 0.86  0 0 0 0 0.8  0 0 0 1.2 -0.55"/>
    </filter>
    <filter id="soft"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="blur1"><feGaussianBlur stdDeviation="0.6"/></filter>
    <path id="wax" d="M${C},${C} m-${waxR},0 a${waxR},${waxR} 0 1,1 ${waxR * 2},0 a${waxR},${waxR} 0 1,1 -${waxR * 2},0"/>
  </defs>
  <g clip-path="url(#clip)">
    <circle cx="${C}" cy="${C}" r="${R}" fill="url(#base)"/>
    <circle cx="${C}" cy="${C}" r="${R}" fill="url(#groove)" mask="url(#grooveZone)"/>
    <g mask="url(#grooveZone)">${disc()}</g>
    <!-- lead-in & bevel tepi -->
    <circle cx="${C}" cy="${C}" r="${Z.grooveEnd * R + 6}" fill="none" stroke="#050403" stroke-width="5"/>
    <circle cx="${C}" cy="${C}" r="${R}" fill="url(#rim)"/>
    <!-- dead wax: halus, sedikit lebih terang, dengan bekas cetak -->
    <circle cx="${C}" cy="${C}" r="${Z.wax * R}" fill="none" stroke="#1b1713" stroke-width="2"/>
    <circle cx="${C}" cy="${C}" r="${(Z.wax - 0.004) * R}" fill="none" stroke="#e8d8bd" stroke-opacity="0.05" stroke-width="1"/>
    <circle cx="${C}" cy="${C}" r="${(Z.label + 0.03) * R}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="3"/>
    ${MATRIX}
    <rect width="${S}" height="${S}" filter="url(#patina)" opacity="0.2"/>
    <rect width="${S}" height="${S}" filter="url(#rust)" opacity="0.28"/>
    <rect width="${S}" height="${S}" filter="url(#grain)" opacity="0.14"/>
    <!-- sidik jari / noda minyak -->
    <ellipse cx="${C + 0.62 * R}" cy="${C - 0.38 * R}" rx="46" ry="30" fill="#d8c9b0" opacity="0.05" filter="url(#soft)" transform="rotate(-28 ${C + 0.62 * R} ${C - 0.38 * R})"/>
    <ellipse cx="${C - 0.7 * R}" cy="${C + 0.44 * R}" rx="38" ry="24" fill="#d8c9b0" opacity="0.045" filter="url(#soft)"/>
    <g filter="url(#blur1)">${wear()}</g>
  </g>
  <!-- gumpil kecil di tepi -->
  <path d="M${f(polar(R, 2.2)[0])},${f(polar(R, 2.2)[1])} l7,3 l-2,6 l-6,-2 z" fill="#2e2822"/>
</svg>`;
}

function labelSvg(): string {
  const p: string[] = [];
  // Foxing: bintik cokelat khas kertas tua.
  for (let i = 0; i < 70; i++) {
    const [x, y] = polar(rr(0.08, 0.97) * R, rr(0, Math.PI * 2));
    p.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr(1.5, rnd() < 0.15 ? 16 : 6))}" fill="#8a5a2c" opacity="${f(rr(0.12, 0.45))}" filter="url(#fox)"/>`);
  }
  // Bekas spindle: goresan melengkung gelap di sekitar lubang (pemutar yang meleset bertahun-tahun).
  for (let i = 0; i < 60; i++) {
    const r = rr(0.05, 0.24) * R;
    const a0 = rr(0, Math.PI * 2);
    p.push(`<path d="${arc(r, a0, a0 + rr(0.2, 1.4))}" stroke="#2c2620" stroke-opacity="${f(rr(0.15, 0.55))}" stroke-width="${f(rr(0.8, 2.6))}" fill="none" stroke-linecap="round"/>`);
  }
  // Goresan kecil pada kertas.
  for (let i = 0; i < 26; i++) {
    const [x, y] = polar(rr(0.2, 0.95) * R, rr(0, Math.PI * 2));
    const a = rr(0, Math.PI);
    const l = rr(10, 70);
    p.push(`<path d="M${f(x)},${f(y)} l${f(l * Math.cos(a))},${f(l * Math.sin(a))}" stroke="#5b4a38" stroke-opacity="${f(rr(0.1, 0.3))}" stroke-width="${f(rr(0.6, 1.4))}"/>`);
  }
  const ringX = C + 0.28 * R;
  const ringY = C + 0.18 * R;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <clipPath id="clip"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
    <radialGradient id="tone" cx="${C}" cy="${C}" r="${R}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fbf3e4"/><stop offset="0.7" stop-color="#f1e1c4"/><stop offset="0.93" stop-color="#d9bf93"/><stop offset="1" stop-color="#8c6c44"/>
    </radialGradient>
    <filter id="blotch" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="4" seed="12"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.75  0 0 0 0 0.58  0 0 0 0 0.36  0 0 0 2.2 -0.95"/>
    </filter>
    <filter id="fiber" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55 0.9" numOctaves="3" seed="5"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.47  0 0 0 0 0.38  0 0 0 1.1 -0.45"/>
    </filter>
    <filter id="fox"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="stain"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <g clip-path="url(#clip)">
    <circle cx="${C}" cy="${C}" r="${R}" fill="url(#tone)"/>
    <rect width="${S}" height="${S}" filter="url(#blotch)" opacity="0.7"/>
    <rect width="${S}" height="${S}" filter="url(#fiber)" opacity="0.35"/>
    <!-- noda cincin gelas/kopi -->
    <circle cx="${ringX}" cy="${ringY}" r="${0.42 * R}" fill="none" stroke="#9b7144" stroke-opacity="0.38" stroke-width="7" stroke-dasharray="${0.42 * R * 4.4} ${0.42 * R * 1.9}" filter="url(#stain)"/>
    <circle cx="${ringX}" cy="${ringY}" r="${0.42 * R - 4}" fill="none" stroke="#7b5530" stroke-opacity="0.25" stroke-width="1.6" stroke-dasharray="${0.42 * R * 3.6} ${0.42 * R * 2.7}"/>
    ${p.join('')}
    <!-- tepi label menggelap & aus -->
    <circle cx="${C}" cy="${C}" r="${R - 6}" fill="none" stroke="#5a4129" stroke-opacity="0.55" stroke-width="12" filter="url(#stain)"/>
  </g>
</svg>`;
}

async function render(svg: string, file: string) {
  const fontCss = `@font-face{font-family:'Space Mono';src:url(data:font/woff2;base64,${readFileSync(join(FONTS, 'space-mono-700-latin.woff2')).toString('base64')}) format('woff2');font-weight:400 700}`;
  const browser = await puppeteer.launch({ executablePath: findChromium(), args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: S, height: S, deviceScaleFactor: 1 });
    await page.setContent(`<html><head><style>${fontCss}html,body{margin:0;background:transparent}</style></head><body>${svg}</body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'webp', quality: 86, omitBackground: true, clip: { x: 0, y: 0, width: S, height: S } });
    writeFileSync(join(OUT, file), buf);
    console.log(`✓ ${file} ${(buf.length / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
  }
}

mkdirSync(OUT, { recursive: true });
await render(discSvg(), 'vinyl-disc.webp');
await render(labelSvg(), 'vinyl-label.webp');
