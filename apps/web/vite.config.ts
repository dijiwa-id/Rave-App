import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Versioning: package.json root = sumber kebenaran; build Docker dapat menimpa lewat APP_VERSION / GIT_SHA.
const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** Dev: sajikan folder ./downloads di /downloads/ (produksi: nginx alias, infra/docker/nginx). */
const DOWNLOADS = fileURLToPath(new URL('../../downloads/', import.meta.url));
const MIME: Record<string, string> = { json: 'application/json', apk: 'application/vnd.android.package-archive', exe: 'application/x-msdownload', msi: 'application/x-msi' };
const serveDownloads: Plugin = {
  name: 'rave-downloads',
  configureServer(server) {
    server.middlewares.use('/downloads', (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
      if (!rel || rel.split('/').some((p) => p === '..' || p.startsWith('.'))) return next();
      const file = DOWNLOADS + rel;
      if (!existsSync(file) || !statSync(file).isFile()) return next();
      const ext = rel.slice(rel.lastIndexOf('.') + 1);
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      res.setHeader('Content-Length', statSync(file).size);
      res.setHeader('Cache-Control', 'no-cache');
      if (ext !== 'json') res.setHeader('Content-Disposition', 'attachment');
      createReadStream(file).pipe(res);
    });
  },
};

/**
 * LCP: gambar latar yang jadi elemen LCP halaman publik (poster hero di `/`, tekstur halftone di halaman perusahaan)
 * baru ditemukan browser setelah JS merender. Skrip kecil di <head> memulai unduhannya lebih awal sesuai rute —
 * hanya di halaman publik, agar tidak berebut bandwidth dengan JS di /app, Studio, dst.
 */
const preloadHeroArt: Plugin = {
  name: 'rave-preload-hero-art',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const find = (n: string) => Object.keys(ctx.bundle ?? {}).find((f) => f.includes(`${n}-`) && f.endsWith('.webp'));
      // Kamus EN dimuat lazy setelah JS utama berjalan (waterfall); mulai lebih awal bila bahasa EN yang akan dipakai
      // (logika sama dengan lib/i18n: pilihan tersimpan → bahasa browser).
      const en = Object.keys(ctx.bundle ?? {}).find((f) => /(^|\/)en-[\w-]+\.js$/.test(f));
      const enJs = en
        ? `(function(){try{var s=localStorage.getItem('rave-locale');var l=s;if(!l){var ls=navigator.languages||[navigator.language];for(var i=0;i<ls.length;i++){var x=(ls[i]||'').toLowerCase();if(x.indexOf('id')===0||x.indexOf('ms')===0){l='id';break}if(x.indexOf('en')===0){l='en';break}}}if(l==='en'){var m=document.createElement('link');m.rel='modulepreload';m.href='/${en}';document.head.appendChild(m)}}catch(e){}})();`
        : '';
      const poster = find('hero-poster-folded');
      const halftone = find('paper-halftone');
      // Disisipkan di AWAL <head>: skrip inline setelah <link rel=stylesheet> menunggu CSS selesai diunduh.
      const inject = (code: string) => html.replace(/<head>/, `<head>\n    <script>${code}</script>`);
      if (!poster || !halftone) return enJs ? inject(enJs) : html;
      const js = enJs + `(function(){var p=location.pathname,u=[];if(p==='/')u=['/${poster}','/${halftone}'];else if(!/^\\/(app|studio|promotor|admin|podcaster|login|onboarding|epk|kontrak)(\\/|$)/.test(p))u=['/${halftone}'];u.forEach(function(h){var l=document.createElement('link');l.rel='preload';l.as='image';l.href=h;l.fetchPriority='high';document.head.appendChild(l)})})()`;
      return inject(js);
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), serveDownloads, preloadHeroArt],
  // Container dev: cache optimizer di luar bind mount/volume node_modules (selalu bisa ditulis, tidak lambat di /mnt/*).
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || rootPkg.version),
    __GIT_SHA__: JSON.stringify(process.env.GIT_SHA || 'dev'),
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    host: true,
    // Semua panggilan API lewat API Gateway (satu origin untuk browser).
    // Di container dev, gateway berada di host `gateway` (VITE_API_PROXY); di host lokal tetap 127.0.0.1.
    proxy: {
      '/v1': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8080', changeOrigin: true },
      // Tautan bagikan pendek (produksi: nginx) → halaman Open Graph catalog.
      '/s/t/': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8080', changeOrigin: true, rewrite: (p) => p.replace(/^\/s\/t\//, '/v1/catalog/share/t/') },
    },
    // Bind mount Docker/WSL (/mnt/*) tidak meneruskan event inotify → polling bila diminta.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 500 } : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) hanya menerima bentuk fungsi.
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion';
          return undefined;
        },
      },
    },
  },
});
