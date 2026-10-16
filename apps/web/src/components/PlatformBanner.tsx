import { useState } from 'react';
import { AlertTriangle, Info, Wrench, X } from 'lucide-react';
import { cx } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';
import { safeGet, safeSet } from '@/lib/storage';

const LEVEL = {
  info: 'bg-[#2e77d0] text-white',
  warning: 'bg-amber-400 text-black',
  critical: 'bg-[#dc2626] text-white',
} as const;

const DISMISS_KEY = 'gema-dismissed-announcement';
const readDismissed = () => safeGet(DISMISS_KEY, 'session');

/**
 * Banner global dari Super Admin: pengumuman (`general.announcement`, bisa ditutup per sesi)
 * dan mode pemeliharaan (`maintenance.enabled` + `maintenance.message`, tidak bisa ditutup).
 */
export function PlatformBanner() {
  const cfg = usePlatformConfig();
  const [dismissed, setDismissed] = useState(readDismissed);
  const announcement = setting(cfg, 'general.announcement', '').trim();
  const level = setting<keyof typeof LEVEL>(cfg, 'general.announcement_level', 'info');
  const maintenance = setting(cfg, 'maintenance.enabled', false);
  const message = setting(cfg, 'maintenance.message', '');
  const showAnnouncement = !!announcement && dismissed !== announcement;
  if (!maintenance && !showAnnouncement) return null;
  return (
    <div className="shrink-0">
      {maintenance && (
        <div role="status" className="flex items-center gap-2.5 bg-amber-400 px-4 py-2 text-sm font-semibold text-black">
          <Wrench className="size-4 shrink-0" />
          <span className="min-w-0">
            <strong className="mr-1">Mode pemeliharaan.</strong>
            {message}
          </span>
        </div>
      )}
      {showAnnouncement && (
        <div role="status" className={cx('flex items-center gap-2.5 px-4 py-2 text-sm font-semibold', LEVEL[level] ?? LEVEL.info)}>
          {level === 'info' ? <Info className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1 whitespace-pre-line">{announcement}</span>
          <button
            aria-label="Tutup pengumuman"
            className="shrink-0 opacity-70 hover:opacity-100"
            onClick={() => {
              safeSet(DISMISS_KEY, announcement, 'session');
              setDismissed(announcement);
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
