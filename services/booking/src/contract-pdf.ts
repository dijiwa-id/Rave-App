import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

/** Cari Chromium: CHROMIUM_PATH → cache Playwright/Puppeteer → path sistem. */
export function findChromium(): string {
  const env = process.env.CHROMIUM_PATH;
  if (env && existsSync(env)) return env;
  const roots = [join(homedir(), '.cache', 'ms-playwright'), join(homedir(), '.cache', 'puppeteer')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => /headless_shell|chrome/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/headless_shell', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-headless-shell']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
        const nested = existsSync(join(root, d)) ? readdirSync(join(root, d)).map((x) => join(root, d, x, rel)).find(existsSync) : undefined;
        if (nested) return nested;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  throw new Error('Chromium tidak ditemukan. Set CHROMIUM_PATH atau pasang Chromium (lihat docs/generated-contract.md).');
}

/** Bilangan bulat positif dari env; kosong/tidak valid → default. Dibaca saat dipakai (bisa diatur tanpa rebuild). */
function envInt(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
}
/** Recycle browser setelah N render (Chromium menumpuk memori/zombie renderer seiring waktu). */
const maxRenders = () => envInt('CONTRACT_PDF_MAX_RENDERS', 25);
/** Tutup browser bila tidak ada render selama sekian ms (VPS 2 GB — jangan simpan Chromium menganggur). */
const idleMs = () => envInt('CONTRACT_PDF_IDLE_MS', 60_000);
/** Render PDF bersamaan maksimum; sisanya antre FIFO. */
const maxConcurrency = () => envInt('CONTRACT_PDF_CONCURRENCY', 2);

/** Satu instance Chromium. `active` = render yang sedang memakai; browser yang `retired` ditutup saat active = 0. */
interface Slot {
  browser: Promise<Browser>;
  instance: Browser | null;
  renders: number;
  active: number;
  retired: boolean;
  closed: boolean;
}
let current: Slot | null = null;
/** Semua slot yang belum ditutup (termasuk yang sudah retired tapi masih dipakai render). */
const live = new Set<Slot>();
let idleTimer: NodeJS.Timeout | null = null;

function launchSlot(): Slot {
  const slot: Slot = { browser: null as unknown as Promise<Browser>, instance: null, renders: 0, active: 0, retired: false, closed: false };
  slot.browser = puppeteer
    .launch({
      executablePath: findChromium(),
      headless: true,
      // Di WSL/kontainer tanpa user namespace Chromium butuh --no-sandbox; konten yang dirender sepenuhnya dikendalikan templat (JS dimatikan, jaringan diblokir).
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--proxy-server=127.0.0.1:1', '--proxy-bypass-list=<-all>'],
    })
    .then((b) => {
      slot.instance = b;
      // Chromium crash / dibunuh OOM → singleton di-reset agar render berikutnya meluncurkan browser baru.
      b.on('disconnected', () => {
        slot.retired = true;
        slot.closed = true;
        live.delete(slot);
        if (current === slot) current = null;
      });
      return b;
    })
    .catch((e) => {
      slot.retired = true;
      slot.closed = true;
      live.delete(slot);
      if (current === slot) current = null;
      throw e;
    });
  live.add(slot);
  return slot;
}

function closeSlot(slot: Slot): Promise<void> {
  slot.retired = true;
  if (current === slot) current = null;
  live.delete(slot);
  if (slot.closed && !slot.instance) return Promise.resolve();
  slot.closed = true;
  return slot.browser.then((b) => b.close()).catch(() => undefined);
}

function clearIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

/** Pinjam browser untuk satu render. Wajib dipasangkan dengan `releaseBrowser`. */
function leaseBrowser(): Slot {
  clearIdle();
  let slot = current;
  if (slot && (slot.retired || (slot.instance && !slot.instance.isConnected()))) {
    slot.retired = true;
    if (slot.active === 0) void closeSlot(slot); // sisanya ditutup releaseBrowser saat render terakhir selesai
    else if (current === slot) current = null;
    slot = null;
  }
  if (!slot) slot = current = launchSlot();
  slot.active++;
  slot.renders++;
  // Render ke-N memakai browser ini untuk terakhir kali; render berikutnya meluncurkan yang baru.
  if (slot.renders >= maxRenders()) {
    slot.retired = true;
    if (current === slot) current = null;
  }
  return slot;
}

function releaseBrowser(slot: Slot) {
  slot.active--;
  if (slot.retired && slot.active === 0 && !slot.closed) void closeSlot(slot);
  if (current && current.active === 0 && !idleTimer) {
    const idle = current;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (current === idle && idle.active === 0) void closeSlot(idle);
    }, idleMs());
    idleTimer.unref(); // timer idle tidak boleh menahan proses tetap hidup
  }
}

/** Semaphore FIFO kecil: membatasi jumlah tab Chromium yang merender bersamaan. */
let running = 0;
const waiters: Array<() => void> = [];
async function acquireRenderSlot(): Promise<void> {
  if (running < maxConcurrency()) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function releaseRenderSlot() {
  const next = waiters.shift();
  if (next) next(); // slot diteruskan langsung ke antrean (running tetap)
  else running--;
}

/** Tutup semua Chromium sekarang (shutdown service / akhir tes). Render yang sedang berjalan akan gagal. */
export async function closePdfBrowser() {
  clearIdle();
  const slots = [...live];
  current = null;
  await Promise.all(slots.map(closeSlot));
}

/** Diagnostik (tes/ops): jumlah browser hidup, render aktif & antrean. */
export function pdfBrowserStats() {
  return { browsers: live.size, active: running, queued: waiters.length, currentRenders: current?.renders ?? 0 };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Format tanggal PDF (`D:YYYYMMDDHHmmSS+00'00'`) — panjang selalu tetap. */
export function pdfDate(d: Date | string): string {
  const iso = new Date(d).toISOString(); // 2026-10-16T07:05:09.000Z
  return `D:${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}+00'00'`;
}

/**
 * Chromium menulis /CreationDate & /ModDate = waktu render, sehingga byte PDF berbeda tiap render.
 * Ganti keduanya dengan tanggal tetap (panjang sama → offset xref tetap valid) agar hash deterministik.
 */
export function normalizePdfDates(pdf: Buffer, d: Date | string): Buffer {
  const fixed = pdfDate(d);
  const s = pdf.toString('latin1').replace(/\/(CreationDate|ModDate) \(D:\d{14}[^)]{0,7}\)/g, (m, k: string) => {
    const r = `/${k} (${fixed})`;
    return r.length === m.length ? r : m;
  });
  const out = Buffer.from(s, 'latin1');
  if (out.length !== pdf.length) throw new Error('Normalisasi tanggal PDF mengubah panjang dokumen');
  return out;
}

export interface PdfFooter {
  contractNo: string;
  version: number;
  note?: string;
  /** SVG QR verifikasi (dari `qrSvg`) — dicetak di footer SETIAP halaman. */
  qrSvg?: string;
  /** Tanggal tetap untuk metadata PDF (hash deterministik). */
  fixedDate?: Date | string;
  /** SHA-256 yang dirujuk (mis. draf yang ditandatangani pada dokumen final) — dicetak ringkas di footer. */
  sha256?: string | null;
  /** Logo header (data URI PNG/SVG). Kosong = header tanpa logo. */
  logoDataUri?: string | null;
  /** Teks di samping logo (mis. "RAVE" bila memakai tanda bawaan). */
  logoText?: string | null;
}

const DATA_IMG = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
/** SVG QR berasal dari pustaka qrcode (bukan input pengguna); hanya elemen <svg>/<path> yang diizinkan masuk footer. */
const safeQr = (svg?: string) => !!svg && /^<svg[\s\S]*<\/svg>\s*$/.test(svg) && !/<(?!\/?(svg|path)\b)/.test(svg);

/** Header & footer Puppeteer (berlaku di setiap halaman). Font wajib eksplisit; template berjalan tanpa CSS dokumen. */
export function headerFooter(f: PdfFooter): { headerTemplate: string; footerTemplate: string } {
  const sans = "font-family:'Liberation Sans',Arial,sans-serif";
  const logo = f.logoDataUri && DATA_IMG.test(f.logoDataUri) ? `<img src="${f.logoDataUri}" style="height:7mm;width:auto;vertical-align:middle">` : '';
  const headerTemplate = `<div style="width:100%;${sans};font-size:7.5px;color:#444;padding:0 25mm;display:flex;align-items:center;justify-content:space-between;-webkit-print-color-adjust:exact">
    <span style="display:flex;align-items:center;gap:5px">${logo}${f.logoText ? `<b style="font-size:10px;letter-spacing:.12em;color:#111">${esc(f.logoText)}</b>` : ''}</span>
    <span style="text-align:right">Surat Perjanjian Kerjasama Pertunjukan<br><b style="color:#111">No. ${esc(f.contractNo)}</b> · Versi ${f.version}${f.note ? ' · ' + esc(f.note) : ''}</span></div>`;
  const qr = safeQr(f.qrSvg) ? `<span style="width:13mm;height:13mm;flex:none;display:inline-block">${f.qrSvg!.replace('<svg', '<svg width="100%" height="100%"')}</span>` : '';
  const sha = f.sha256 && /^[0-9a-f]{64}$/.test(f.sha256) ? ` · SHA-256 ${f.sha256.slice(0, 12)}…${f.sha256.slice(-6)}` : '';
  const footerTemplate = `<div style="width:100%;${sans};font-size:7.5px;color:#555;padding:0 25mm;display:flex;align-items:center;gap:8px;-webkit-print-color-adjust:exact">${qr}
    <span style="flex:1;border-top:0.5px solid #999;padding-top:2px">${esc(f.contractNo)} · Versi ${f.version}${f.note ? ' · ' + esc(f.note) : ''}${sha}<br>Dokumen elektronik RAVE — pindai QR untuk verifikasi keaslian</span>
    <span style="white-space:nowrap;border-top:0.5px solid #999;padding-top:2px">Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`;
  return { headerTemplate, footerTemplate };
}

/**
 * HTML → PDF. Tanpa JavaScript, tanpa akses jaringan (setiap request non-`data:` dibatalkan + proxy mati + CSP di dokumen).
 * Header tiap halaman: logo + nomor kontrak; footer: QR verifikasi, nomor kontrak, versi, SHA-256 ringkas, "Halaman x dari y".
 */
export async function renderPdf(html: string, footer: PdfFooter): Promise<{ pdf: Buffer; blocked: string[] }> {
  await acquireRenderSlot();
  try {
    const slot = leaseBrowser(); // bisa melempar (Chromium tidak ditemukan) → slot semaphore tetap dilepas
    try {
      return await renderOnPage(await (await slot.browser).newPage(), html, footer);
    } finally {
      releaseBrowser(slot);
    }
  } finally {
    releaseRenderSlot();
  }
}

async function renderOnPage(page: Page, html: string, footer: PdfFooter): Promise<{ pdf: Buffer; blocked: string[] }> {
  const blocked: string[] = [];
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('data:') || u === 'about:blank') return void r.continue();
      blocked.push(u);
      void r.abort('blockedbyclient');
    });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      ...headerFooter(footer),
      margin: { top: '27mm', bottom: '27mm', left: '25mm', right: '25mm' },
    });
    const pdf = Buffer.from(raw);
    return { pdf: footer.fixedDate ? normalizePdfDates(pdf, footer.fixedDate) : pdf, blocked };
  } finally {
    await page.close().catch(() => undefined);
  }
}
