import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';

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

let browser: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = puppeteer
      .launch({
        executablePath: findChromium(),
        headless: true,
        // Di WSL/kontainer tanpa user namespace Chromium butuh --no-sandbox; konten yang dirender sepenuhnya dikendalikan templat (JS dimatikan, jaringan diblokir).
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--proxy-server=127.0.0.1:1', '--proxy-bypass-list=<-all>'],
      })
      .catch((e) => {
        browser = null;
        throw e;
      });
  }
  return browser;
}
export async function closePdfBrowser() {
  if (browser) await (await browser).close().catch(() => undefined);
  browser = null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * HTML → PDF. Tanpa JavaScript, tanpa akses jaringan (setiap request non-`data:` dibatalkan + proxy mati + CSP di dokumen).
 * Footer tiap halaman memuat nomor kontrak, versi, dan nomor halaman.
 */
export async function renderPdf(html: string, footer: { contractNo: string; version: number; note?: string }): Promise<{ pdf: Buffer; blocked: string[] }> {
  const page = await (await getBrowser()).newPage();
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
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:8px sans-serif;color:#555;padding:0 18mm;display:flex;justify-content:space-between">
        <span>${esc(footer.contractNo)} · Versi ${footer.version}${footer.note ? ' · ' + esc(footer.note) : ''}</span>
        <span>RAVE — Dokumen elektronik · Halaman <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
      margin: { top: '22mm', bottom: '24mm', left: '18mm', right: '18mm' },
    });
    return { pdf: Buffer.from(pdf), blocked };
  } finally {
    await page.close().catch(() => undefined);
  }
}
