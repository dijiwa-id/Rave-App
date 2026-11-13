import type { ComponentType } from 'react';
import { AudioWaveform, BadgeCheck, CalendarCheck, Coins, Crown, Download, FileSignature, Headphones, Megaphone, Radio, Ticket, Wallet } from 'lucide-react';
import type { SettingGroup } from '@rave/domain/settings';

/**
 * Layanan RAVE di menu Super Admin ("Pengaturan Layanan"). `ready` → membuka grup pengaturannya di Platform → Pengaturan;
 * `soon` → halaman "Dalam pengembangan" (fitur inti belum dibangun; pengaturannya bertanda `planned` di registri).
 * Ubah `status` ke 'ready' begitu layanannya selesai.
 */
export type ServiceStatus = 'ready' | 'soon';
/** Jenis layanan — pengelompokan di sidebar Super Admin. */
export type ServiceType = 'music' | 'event' | 'money';
export const SERVICE_TYPES: ServiceType[] = ['music', 'event', 'money'];
export interface RaveService {
  id: string;
  icon: ComponentType<{ className?: string }>;
  status: ServiceStatus;
  type: ServiceType;
  /** Grup pengaturan registri (@rave/domain/settings) yang diedit di halaman layanan ini — tiap grup hanya di satu layanan. */
  groups: SettingGroup[];
  /** Batasi kunci dalam grup (mis. RAVE Pro & unduhan offline berbagi grup subscription). */
  keys?: (key: string) => boolean;
  /** Punya laporan `GET /v1/admin/reports/<id>` (tab Laporan). */
  report?: boolean;
  /** false = tidak tampil di sidebar (dibuka dari halaman lain, mis. Iklan → Kebijakan). */
  nav?: boolean;
}

const isPro = (k: string) => k.startsWith('subscription.pro_');
const isDownload = (k: string) => k === 'subscription.download_devices';

export const RAVE_SERVICES: RaveService[] = [
  // Musik & streaming
  { id: 'streaming', report: true, type: 'music', icon: Headphones, status: 'ready', groups: ['streaming'] },
  { id: 'transcoding', report: true, type: 'music', icon: AudioWaveform, status: 'ready', groups: ['transcoding'] },
  { id: 'royalty', report: true, type: 'music', icon: Coins, status: 'soon', groups: ['royalty'] },
  { id: 'downloads', type: 'music', icon: Download, status: 'soon', groups: ['subscription'], keys: isDownload },
  // Event & live
  { id: 'live', report: true, type: 'event', icon: Radio, status: 'ready', groups: ['live'] },
  { id: 'booking', report: true, type: 'event', icon: CalendarCheck, status: 'ready', groups: ['booking', 'commission'] },
  { id: 'contract', report: true, type: 'event', icon: FileSignature, status: 'ready', groups: ['legal'] },
  { id: 'ticketing', report: true, type: 'event', icon: Ticket, status: 'ready', groups: ['refund'] },
  // Monetisasi — pengaturan Iklan dibuka dari Iklan → Kebijakan (tidak diduplikasi di sidebar).
  { id: 'ads', type: 'money', icon: Megaphone, status: 'ready', groups: ['ads'], nav: false },
  { id: 'payout', report: true, type: 'money', icon: Wallet, status: 'ready', groups: ['payout'] },
  { id: 'subscription', report: true, type: 'money', icon: Crown, status: 'soon', groups: ['subscription'], keys: (k) => !isPro(k) && !isDownload(k) },
  { id: 'pro', report: true, type: 'money', icon: BadgeCheck, status: 'soon', groups: ['subscription'], keys: isPro },
];

export const serviceHref = (s: RaveService | string) => `/admin/platform/services/${typeof s === 'string' ? s : s.id}`;
