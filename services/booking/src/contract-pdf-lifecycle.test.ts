import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Siklus hidup Chromium untuk PDF kontrak (issue #4) dengan `puppeteer-core` tiruan — jalan tanpa Chromium.
 * Setiap tes memuat ulang modul agar state singleton/semaphore tidak bocor antar tes.
 */

type Listener = () => void;
class FakePage {
  constructor(private readonly gate: () => Promise<void>, private readonly owner: FakeBrowser) {}
  closed = false;
  async setJavaScriptEnabled() {}
  async setRequestInterception() {}
  on() {}
  async setContent() {}
  async pdf() {
    this.owner.rendering++;
    this.owner.maxRendering = Math.max(this.owner.maxRendering, this.owner.rendering);
    try {
      await this.gate();
      if (!this.owner.connected) throw new Error('Target closed');
      return new Uint8Array(Buffer.from('%PDF-1.4 fake'));
    } finally {
      this.owner.rendering--;
    }
  }
  async close() {
    this.closed = true;
  }
}
class FakeBrowser {
  connected = true;
  closeCalls = 0;
  rendering = 0;
  maxRendering = 0;
  private listeners: Listener[] = [];
  constructor(private readonly gate: () => Promise<void>) {}
  isConnected() {
    return this.connected;
  }
  on(ev: string, cb: Listener) {
    if (ev === 'disconnected') this.listeners.push(cb);
  }
  async newPage() {
    if (!this.connected) throw new Error('Browser disconnected');
    return new FakePage(this.gate, this);
  }
  async close() {
    this.closeCalls++;
    this.crash();
  }
  /** Simulasi Chromium mati (crash/OOM) → event `disconnected`. */
  crash() {
    if (!this.connected) return;
    this.connected = false;
    for (const l of this.listeners) l();
  }
}

const h = vi.hoisted(() => ({
  browsers: [] as any[],
  launchOpts: [] as any[],
  failNext: false,
  gate: (() => Promise.resolve()) as () => Promise<void>,
  makeBrowser: null as null | (() => any),
}));
vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(async (opts: unknown) => {
      h.launchOpts.push(opts);
      if (h.failNext) {
        h.failNext = false;
        throw new Error('launch gagal');
      }
      const b = h.makeBrowser!();
      h.browsers.push(b);
      return b;
    }),
  },
}));

type Mod = typeof import('./contract-pdf.js');
let mod: Mod;
const footer = { contractNo: 'RAVE/SPK/X', version: 1 };
const flush = () => new Promise((r) => setImmediate(r));

/** Gerbang manual: render tertahan di `page.pdf()` sampai `open()` dipanggil. */
function manualGate() {
  let waiting: Array<() => void> = [];
  let isOpen = false;
  return {
    wait: () => (isOpen ? Promise.resolve() : new Promise<void>((r) => waiting.push(r))),
    releaseOne: () => waiting.shift()?.(),
    open: () => {
      isOpen = true;
      waiting.forEach((r) => r());
      waiting = [];
    },
    get pending() {
      return waiting.length;
    },
  };
}

beforeEach(async () => {
  vi.useRealTimers();
  process.env.CHROMIUM_PATH = process.execPath; // findChromium() butuh path yang ada; launch tetap tiruan
  delete process.env.CONTRACT_PDF_MAX_RENDERS;
  delete process.env.CONTRACT_PDF_IDLE_MS;
  delete process.env.CONTRACT_PDF_CONCURRENCY;
  h.browsers = [];
  h.launchOpts = [];
  h.failNext = false;
  h.gate = () => Promise.resolve();
  h.makeBrowser = () => new FakeBrowser(() => h.gate());
  vi.resetModules();
  mod = await import('./contract-pdf.js');
});
afterEach(async () => {
  await mod.closePdfBrowser();
  vi.useRealTimers();
});

describe('contract-pdf: siklus hidup Chromium', () => {
  it('memakai ulang satu browser lalu recycle setelah N render (default 25)', async () => {
    for (let i = 0; i < 25; i++) await mod.renderPdf('<p>x</p>', footer);
    expect(h.browsers).toHaveLength(1);
    await flush();
    expect(h.browsers[0].closeCalls).toBe(1); // render ke-25 = terakhir → browser ditutup
    expect(mod.pdfBrowserStats().browsers).toBe(0);
    await mod.renderPdf('<p>x</p>', footer);
    expect(h.browsers).toHaveLength(2);
    expect(h.browsers[1].connected).toBe(true);
  });

  it('CONTRACT_PDF_MAX_RENDERS mengatur ambang recycle', async () => {
    process.env.CONTRACT_PDF_MAX_RENDERS = '3';
    for (let i = 0; i < 7; i++) await mod.renderPdf('<p>x</p>', footer);
    expect(h.browsers).toHaveLength(3); // 3 + 3 + 1
    await flush();
    expect(h.browsers.map((b) => b.connected)).toEqual([false, false, true]);
  });

  it('browser lama baru ditutup setelah render yang masih berjalan selesai', async () => {
    process.env.CONTRACT_PDF_MAX_RENDERS = '2';
    const g = manualGate();
    h.gate = g.wait;
    const r1 = mod.renderPdf('<p>1</p>', footer);
    const r2 = mod.renderPdf('<p>2</p>', footer);
    await vi.waitFor(() => expect(g.pending).toBe(2));
    // Browser #1 sudah retired (2 render) tapi masih dipakai → belum boleh ditutup.
    g.releaseOne();
    await r1;
    await flush();
    expect(h.browsers[0].closeCalls).toBe(0);
    g.open();
    await expect(r2).resolves.toMatchObject({ blocked: [] });
    await flush();
    expect(h.browsers[0].closeCalls).toBe(1);
  });

  it('reset singleton saat Chromium disconnect (crash) — render berikutnya meluncurkan browser baru', async () => {
    await mod.renderPdf('<p>x</p>', footer);
    h.browsers[0].crash();
    expect(mod.pdfBrowserStats().browsers).toBe(0);
    await mod.renderPdf('<p>x</p>', footer);
    expect(h.browsers).toHaveLength(2);
  });

  it('isConnected() false tanpa event → tetap diganti browser baru', async () => {
    await mod.renderPdf('<p>x</p>', footer);
    h.browsers[0].connected = false; // putus tanpa event disconnected
    await mod.renderPdf('<p>x</p>', footer);
    expect(h.browsers).toHaveLength(2);
  });

  it('crash di tengah render → render itu gagal, semaphore & penghitung pulih, render berikutnya sukses', async () => {
    const g = manualGate();
    h.gate = g.wait;
    const r = mod.renderPdf('<p>x</p>', footer);
    await vi.waitFor(() => expect(g.pending).toBe(1));
    h.browsers[0].crash();
    g.open();
    await expect(r).rejects.toThrow('Target closed');
    expect(mod.pdfBrowserStats()).toMatchObject({ active: 0, queued: 0 });
    await expect(mod.renderPdf('<p>x</p>', footer)).resolves.toBeTruthy();
    expect(h.browsers).toHaveLength(2);
  });

  it('launch gagal → error diteruskan, singleton di-reset, percobaan berikutnya meluncurkan ulang', async () => {
    h.failNext = true;
    await expect(mod.renderPdf('<p>x</p>', footer)).rejects.toThrow('launch gagal');
    expect(mod.pdfBrowserStats()).toMatchObject({ browsers: 0, active: 0 });
    await expect(mod.renderPdf('<p>x</p>', footer)).resolves.toBeTruthy();
    expect(h.launchOpts).toHaveLength(2);
  });

  it('Chromium tidak ditemukan → error, slot semaphore tidak bocor', async () => {
    process.env.CONTRACT_PDF_CONCURRENCY = '1';
    process.env.CHROMIUM_PATH = '/tidak/ada';
    const realExists = (await import('node:fs')).existsSync;
    // Bila mesin punya Chromium sistem, findChromium tetap sukses — tes ini hanya berarti tanpa Chromium.
    const hasSystem = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].some(realExists);
    if (hasSystem) return;
    let failed = 0;
    for (let i = 0; i < 3; i++) await mod.renderPdf('<p>x</p>', footer).catch(() => failed++);
    expect(failed).toBeGreaterThan(0);
    expect(mod.pdfBrowserStats()).toMatchObject({ active: 0, queued: 0 });
  });

  it('idle: timer penutupan di-unref (tidak menahan proses)', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    await mod.renderPdf('<p>x</p>', footer);
    const timer = spy.mock.results.at(-1)?.value as NodeJS.Timeout;
    spy.mockRestore();
    expect(timer.hasRef()).toBe(false);
  });

  it('idle: browser ditutup setelah CONTRACT_PDF_IDLE_MS tanpa render', async () => {
    process.env.CONTRACT_PDF_IDLE_MS = '1000';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mod.renderPdf('<p>x</p>', footer);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.browsers[0].closeCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.browsers[0].closeCalls).toBe(1);
    expect(mod.pdfBrowserStats().browsers).toBe(0);
    vi.useRealTimers();
    await mod.renderPdf('<p>x</p>', footer);
    expect(h.browsers).toHaveLength(2);
  });

  it('idle: render baru sebelum timeout membatalkan penutupan', async () => {
    process.env.CONTRACT_PDF_IDLE_MS = '1000';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mod.renderPdf('<p>x</p>', footer);
    await vi.advanceTimersByTimeAsync(900);
    await mod.renderPdf('<p>x</p>', footer);
    await vi.advanceTimersByTimeAsync(900);
    expect(h.browsers[0].closeCalls).toBe(0);
    expect(h.browsers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.browsers[0].closeCalls).toBe(1);
  });

  it('konkurensi dibatasi (default 2) — sisanya antre FIFO dan semua selesai', async () => {
    const g = manualGate();
    h.gate = g.wait;
    const done: number[] = [];
    const all = Array.from({ length: 5 }, (_, i) => mod.renderPdf(`<p>${i}</p>`, footer).then(() => done.push(i)));
    await vi.waitFor(() => expect(g.pending).toBe(2));
    await flush();
    expect(mod.pdfBrowserStats()).toMatchObject({ active: 2, queued: 3 });
    g.open();
    await Promise.all(all);
    expect(done).toEqual([0, 1, 2, 3, 4]);
    expect(h.browsers[0].maxRendering).toBe(2);
    expect(mod.pdfBrowserStats()).toMatchObject({ active: 0, queued: 0 });
  });

  it('CONTRACT_PDF_CONCURRENCY=1 menserialkan render; launch serentak tidak membuat dua browser', async () => {
    process.env.CONTRACT_PDF_CONCURRENCY = '1';
    await Promise.all(Array.from({ length: 4 }, () => mod.renderPdf('<p>x</p>', footer)));
    expect(h.browsers).toHaveLength(1);
    expect(h.browsers[0].maxRendering).toBe(1);
  });

  it('closePdfBrowser (shutdown) menutup browser aktif maupun yang retired tapi masih dipakai', async () => {
    process.env.CONTRACT_PDF_MAX_RENDERS = '1';
    const g = manualGate();
    h.gate = g.wait;
    const r1 = mod.renderPdf('<p>1</p>', footer).catch((e: Error) => e);
    const r2 = mod.renderPdf('<p>2</p>', footer).catch((e: Error) => e);
    await vi.waitFor(() => expect(g.pending).toBe(2));
    expect(h.browsers).toHaveLength(2); // keduanya retired (max 1) dan masih merender
    await mod.closePdfBrowser();
    expect(h.browsers.every((b) => !b.connected)).toBe(true);
    g.open();
    expect(await r1).toBeInstanceOf(Error);
    expect(await r2).toBeInstanceOf(Error);
    expect(mod.pdfBrowserStats()).toMatchObject({ browsers: 0, active: 0, queued: 0 });
  });

  it('closePdfBrowser saat browser masih launching tetap menutupnya', async () => {
    let resolveLaunch!: () => void;
    const b = new FakeBrowser(() => Promise.resolve());
    h.makeBrowser = () => b;
    const pup = (await import('puppeteer-core')).default as unknown as { launch: ReturnType<typeof vi.fn> };
    pup.launch.mockImplementationOnce(() => new Promise((r) => (resolveLaunch = () => r(b))));
    const r = mod.renderPdf('<p>x</p>', footer).catch((e: Error) => e);
    await flush();
    const closing = mod.closePdfBrowser();
    resolveLaunch();
    await closing;
    await r;
    expect(b.closeCalls).toBeGreaterThanOrEqual(1);
    expect(b.connected).toBe(false);
  });

  it('opsi launch Chromium tidak berubah (args sandbox/proxy)', async () => {
    await mod.renderPdf('<p>x</p>', footer);
    expect(h.launchOpts[0]).toEqual({
      executablePath: process.execPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--proxy-server=127.0.0.1:1', '--proxy-bypass-list=<-all>'],
    });
  });
});

describe('entrypoint booking: shutdown', () => {
  it('createService menerima onShutdown yang memanggil closePdfBrowser (dipicu SIGTERM/SIGINT oleh service-kit)', async () => {
    vi.resetModules();
    const close = vi.fn(async () => {});
    let def: any;
    vi.doMock('./contract-pdf.js', async (orig) => ({ ...(await orig<Mod>()), closePdfBrowser: close }));
    vi.doMock('@rave/service-kit', async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      createService: (d: unknown) => {
        def = d;
        return { start: async () => {} };
      },
    }));
    try {
      await import('./index.js');
      expect(typeof def?.onShutdown).toBe('function');
      await def.onShutdown({});
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('./contract-pdf.js');
      vi.doUnmock('@rave/service-kit');
    }
  });
});
