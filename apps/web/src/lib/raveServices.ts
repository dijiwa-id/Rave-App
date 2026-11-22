import type { ComponentType } from 'react';
import { AudioWaveform, BadgeCheck, CalendarCheck, Coins, Crown, Download, FileSignature, Headphones, Megaphone, Mic, Radio, Scale, Share2, Ticket, UploadCloud, Wallet } from 'lucide-react';
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
  /**
   * Tab Laporan: `true` = `GET /v1/admin/reports/<id>` tersedia; `'soon'` = layanan sudah berjalan tetapi endpoint laporannya
   * belum ada → tab menampilkan "laporan segera hadir" + metrik yang direncanakan (tanpa angka palsu).
   */
  report?: boolean | 'soon';
  /** false = tidak tampil di sidebar (dibuka dari halaman lain, mis. Iklan → Kebijakan). */
  nav?: boolean;
}

const isPro = (k: string) => k.startsWith('subscription.pro_');
const isDownload = (k: string) => k === 'subscription.download_devices';
/** Unduhan offline (P-7): grup `download` + batas perangkat yang tinggal di grup subscription. */
const isDownloadService = (k: string) => k.startsWith('download.') || isDownload(k);

export const RAVE_SERVICES: RaveService[] = [
  // Musik & streaming
  { id: 'streaming', report: true, type: 'music', icon: Headphones, status: 'ready', groups: ['streaming'] },
  { id: 'transcoding', report: true, type: 'music', icon: AudioWaveform, status: 'ready', groups: ['transcoding'] },
  { id: 'upload', type: 'music', icon: UploadCloud, status: 'ready', groups: ['upload'] },
  { id: 'podcast', type: 'music', icon: Mic, status: 'ready', groups: ['podcast'] },
  { id: 'share', report: true, type: 'music', icon: Share2, status: 'ready', groups: ['share'] },
  { id: 'royalty', report: true, type: 'music', icon: Coins, status: 'ready', groups: ['royalty'] },
  { id: 'downloads', report: 'soon', type: 'music', icon: Download, status: 'ready', groups: ['download', 'subscription'], keys: isDownloadService },
  // Event & live
  { id: 'live', report: true, type: 'event', icon: Radio, status: 'ready', groups: ['live'] },
  { id: 'booking', report: true, type: 'event', icon: CalendarCheck, status: 'ready', groups: ['booking', 'commission'] },
  { id: 'contract', report: true, type: 'event', icon: FileSignature, status: 'ready', groups: ['legal'] },
  { id: 'ticketing', report: true, type: 'event', icon: Ticket, status: 'ready', groups: ['refund'] },
  // Monetisasi — pengaturan Iklan dibuka dari Iklan → Kebijakan (tidak diduplikasi di sidebar).
  { id: 'ads', type: 'money', icon: Megaphone, status: 'ready', groups: ['ads'], nav: false },
  { id: 'finance', type: 'money', icon: Scale, status: 'ready', groups: ['finance'] },
  { id: 'payout', report: true, type: 'money', icon: Wallet, status: 'ready', groups: ['payout'] },
  { id: 'subscription', report: true, type: 'money', icon: Crown, status: 'soon', groups: ['subscription'], keys: (k) => !isPro(k) && !isDownload(k) },
  { id: 'pro', report: true, type: 'money', icon: BadgeCheck, status: 'ready', groups: ['subscription'], keys: isPro },
];

export const serviceHref = (s: RaveService | string) => `/admin/platform/services/${typeof s === 'string' ? s : s.id}`;
