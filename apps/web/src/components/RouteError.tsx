import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { safeGet, safeRemove, safeSet } from '@/lib/storage';

const CHUNK_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_KEY = 'gema-chunk-reload';

export const isChunkError = (e: unknown) => CHUNK_RE.test(String((e as any)?.message ?? e ?? ''));

/** Chunk hilang (deploy baru) → muat ulang sekali per sesi; flag mencegah loop bila tetap gagal. */
export function reloadOnceForChunkError(): boolean {
  if (safeGet(RELOAD_KEY, 'session')) return false;
  safeSet(RELOAD_KEY, '1', 'session');
  window.location.reload();
  return true;
}

// Halaman berhasil dimuat → izinkan reload otomatis lagi untuk deploy berikutnya.
if (typeof window !== 'undefined') window.addEventListener('load', () => setTimeout(() => safeRemove(RELOAD_KEY, 'session'), 10_000));

/** errorElement rute: halaman crash tidak mengosongkan shell. `b2b` = token terang dasbor. */
export function RouteError({ variant = 'fan' }: { variant?: 'fan' | 'b2b' }) {
  const error = useRouteError();
  const chunk = isChunkError(error);
  // Render pertama saat chunk gagal: coba reload sekali; jika sudah pernah, tampilkan pesan.
  if (chunk && reloadOnceForChunkError()) return null;

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = notFound ? 'Halaman tidak ditemukan' : chunk ? 'Versi aplikasi diperbarui' : 'Terjadi kesalahan';
  const detail = notFound
    ? 'Tautan mungkin salah atau halaman sudah dipindahkan.'
    : chunk
      ? 'Sebagian aplikasi gagal dimuat. Muat ulang untuk memakai versi terbaru.'
      : ((error as any)?.message ?? 'Halaman ini gagal ditampilkan.');
  const b2b = variant === 'b2b';
  const home = b2b ? '/' : '/app';

  return (
    <div role="alert" className={b2b ? 'grid min-h-[60vh] place-items-center bg-b2b-bg p-8 text-center text-b2b-ink' : 'grid h-full min-h-[60vh] place-items-center bg-gema-base p-8 text-center text-white'}>
      <div className="max-w-md">
        <p className="text-2xl font-black">{title}</p>
        <p className={b2b ? 'mt-2 text-sm text-b2b-muted' : 'mt-2 text-sm text-gema-muted'}>{detail}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className={b2b ? 'rounded-full bg-b2b-ink px-6 py-2.5 text-sm font-bold text-b2b-on-ink' : 'rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black'}
          >
            Muat ulang
          </button>
          {/* <a> biasa (bukan <Link>): reset penuh state router/komponen yang crash. */}
          <a href={home} className={b2b ? 'rounded-full border border-b2b-line px-6 py-2.5 text-sm font-bold' : 'rounded-full border border-white/40 px-6 py-2.5 text-sm font-bold hover:border-white'}>
            Kembali ke beranda
          </a>
        </div>
      </div>
    </div>
  );
}
