import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { usePlayerThemePref, type ThemeChoice } from '@/lib/theme';
import { useAuth } from '@/stores/auth';
import { toast } from '@/components/ui';

/**
 * Ganti tema aplikasi dengar: langsung berlaku (optimistis), disimpan di perangkat, dan — bila masuk — di akun
 * (`PATCH /v1/me { theme }`) agar ikut ke desktop & mobile. Gagal simpan ke akun → dikembalikan + pesan galat.
 */
export async function setPlayerTheme(choice: ThemeChoice) {
  usePlayerThemePref.getState().set(choice);
  const { accessToken, user, setUser } = useAuth.getState();
  if (!accessToken || !user || user.theme === choice) return;
  const prev = user;
  setUser({ ...user, theme: choice });
  try {
    setUser(await api<Me>('/v1/me', { method: 'PATCH', body: { theme: choice } }));
  } catch (e) {
    setUser(prev);
    toast.error(e);
  }
}
