import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Versioning: package.json root = sumber kebenaran; build Docker dapat menimpa lewat APP_VERSION / GIT_SHA.
const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    proxy: { '/v1': { target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8080', changeOrigin: true } },
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
