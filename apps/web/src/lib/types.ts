// Tipe respons API — cermin dari docs/API.md. Ubah dokumen kontrak dulu bila menambah field.
import type { AdBreakOutcome, AdCategory, AdCategoryTier, AdPlacement, AdType } from '@rave/domain/ads';
import type { AdminPermission } from '@rave/domain/settings';

export type OrgType = 'ARTIST' | 'MANAGEMENT' | 'LABEL' | 'PROMOTOR' | 'VENUE' | 'CREATOR';
export interface OrgClaim {
  id: string;
  type: OrgType;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'FINANCE' | 'MEMBER' | 'VIEWER';
  artist_id: string | null;
}
export interface Me {
  id: string;
  email: string;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  city: string | null;
  /** Bahasa antarmuka pilihan; null = ikuti perangkat / default platform. */
  locale?: 'id' | 'en' | null;
  genres: string[];
  roles: string[];
  orgs: OrgClaim[];
  kyc_status: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  mfa_enabled: boolean;
  onboarded: boolean;
  premium: boolean;
  /** Peran internal back office (ADMIN_ROLES di @rave/domain/settings); null = bukan admin. */
  admin_role?: string | null;
  /** Izin back office efektif ("Peran & Akses"); Super Admin = semua. */
  admin_permissions?: AdminPermission[];
  created_at: string;
}
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: Me;
}

export interface Paged<T> {
  data: T[];
  next_cursor?: string | null;
}

// ---- Catalog ----
export interface MediaItem {
  id: string;
  kind: 'release' | 'artist' | 'playlist' | 'show' | 'episode';
  title: string;
  subtitle: string;
  image_url: string;
  href: string;
}
export interface Category {
  id: string;
  name: string;
  color: string;
  image_url: string;
  href: string;
}
export interface ArtistRef {
  id: string;
  name: string;
  slug: string;
}
export interface ArtistSummary extends ArtistRef {
  image_url: string | null;
  city: string | null;
  genres: string[];
  verified: boolean;
  monthly_listeners: number;
}
/** Info audio master lagu (tanpa URL): format, lossless/hi-res, status pengolahan. null = media lama/eksternal. */
export interface TrackAudio {
  lossless: boolean;
  hires: boolean;
  sample_rate: number | null;
  bit_depth: number | null;
  codec: string | null;
  transcode_status: 'none' | 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
}
export interface Track {
  id: string;
  title: string;
  duration_ms: number;
  explicit: boolean;
  isrc: string | null;
  track_number: number;
  play_count: number;
  has_lyrics: boolean;
  artist: ArtistRef;
  release: { id: string; title: string; cover_url: string | null };
  audio?: TrackAudio | null;
}
export interface ReleaseSummary {
  id: string;
  title: string;
  type: 'SINGLE' | 'EP' | 'ALBUM';
  cover_url: string | null;
  release_date: string;
  artist: ArtistRef;
}
export interface Release extends ReleaseSummary {
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'LIVE' | 'REJECTED' | 'TAKEN_DOWN';
  label: string | null;
  genre: string | null;
  upc: string | null;
  explicit: boolean;
  tracks: Track[];
  qc_reason: string | null;
}
export interface Artist extends ArtistSummary {
  bio: string | null;
  cover_url: string | null;
  followers: number;
  top_tracks: Track[];
  releases: ReleaseSummary[];
  org_id: string | null;
}
export interface Show {
  id: string;
  kind: 'PODCAST' | 'FICTION';
  title: string;
  publisher: string;
  description: string;
  cover_url: string;
  category: string;
  age_rating?: string | null;
  content_warning?: string | null;
}
export interface Episode {
  id: string;
  show_id: string;
  title: string;
  description: string;
  duration_ms: number;
  published_at: string;
  is_premium: boolean;
  season?: number | null;
  episode_number?: number | null;
  cover_url: string;
}
export interface Split {
  id: string;
  type: 'MASTER' | 'PUBLISHING';
  party_name: string;
  email: string | null;
  pct: number;
  approved_at: string | null;
}

// ---- Library ----
export interface PlaylistSummary {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  owner: { id: string; name: string };
  visibility: 'PUBLIC' | 'PRIVATE' | 'COLLAB';
  track_count: number;
  is_editorial: boolean;
  /** true = sampul diunggah pemilik; false = otomatis dari lagu pertama. */
  has_custom_cover?: boolean;
}
export interface Playlist extends PlaylistSummary {
  items: { item_id: string; added_at: string; track: Track }[];
}

// ---- Playback ----
export interface PlaybackSession {
  session_id: string;
  stream_url: string;
  expires_at: string;
  quality: string;
  codec_label: string;
  requested_quality?: string;
  /** Kualitas diturunkan: premium (HQ/Lossless khusus Premium) | preview | disabled | unavailable. */
  quality_capped?: 'premium' | 'preview' | 'disabled' | 'unavailable' | null;
  loudness_gain_db: number;
  preview_only: boolean;
  preview_ms: number | null;
  duration_ms: number;
}
export interface ArtistAnalytics {
  artist_id: string;
  days: number;
  streams: number;
  listeners: number;
  followers_gained: number;
  save_rate: number;
  skip_rate: number;
  daily: { date: string; streams: number; listeners: number }[];
  top_cities: { city: string; listeners: number }[];
  top_tracks: { track_id: string; title: string; streams: number }[];
  sources: { source: string; pct: number }[];
  age_groups: { group: string; pct: number }[];
}

// ---- Booking ----
export type BookingStatus =
  | 'DRAFT'
  | 'INQUIRY'
  | 'NEGOTIATING'
  | 'AGREED'
  | 'CONTRACT_SENT'
  | 'SIGNED'
  | 'BOOKED'
  | 'BOOKED_AND_SECURED'
  | 'AT_RISK'
  | 'SHOW_DAY'
  | 'COMPLETED'
  | 'SETTLED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED_BY_PROMOTOR'
  | 'CANCELLED_BY_ARTIST'
  | 'FORCE_MAJEURE'
  | 'DISPUTED';
export interface RateItem {
  category: string;
  format: string;
  zone: string;
  duration_min: number;
  fee: number;
  rider_estimate: number;
  accommodation_by_promotor: boolean;
  transport_by_promotor: boolean;
}
export interface RateCard {
  artist_id: string;
  visibility: 'PUBLIC' | 'VERIFIED_PROMOTOR' | 'BY_REQUEST';
  valid_from: string | null;
  valid_to: string | null;
  from_fee: number | null;
  items: RateItem[];
}
export interface EpkContent {
  bio_short: string;
  bio_long: string;
  press_photos: string[];
  videos: string[];
  press_quotes: { quote: string; source: string }[];
  achievements: string[];
  rider: Record<string, unknown>;
  members: { name: string; role: string }[];
  public_metrics: string[];
}
export interface Epk extends EpkContent {
  artist: ArtistSummary;
  stats: {
    monthly_listeners: number;
    growth_90d_pct: number;
    top_cities: { city: string; listeners: number }[];
    age_groups: { group: string; pct: number }[];
    shows_12m: number;
    avg_rating: number | null;
    on_time_rate: number | null;
  };
  rate_card: { from_fee: number | null; visibility: string };
  contact: { name: string; email: string; phone: string };
  updated_at: string;
}
export interface CalendarSlot {
  id: string;
  artist_id: string;
  start_date: string;
  end_date: string;
  status: string;
  booking_id: string | null;
  note: string | null;
}
export interface DiscoveryResult {
  artist: ArtistSummary;
  from_fee: number | null;
  audience_match: number;
  listeners_in_city: number | null;
  avg_rating: number | null;
  shows_12m: number;
  available: boolean | null;
}
export interface BookingSummary {
  id: string;
  status: BookingStatus;
  status_label: string;
  artist: { id: string; name: string; image_url: string | null };
  promotor_org: { id: string; name: string };
  event_name: string;
  event_date: string;
  city: string;
  venue: string;
  category: string;
  format: string;
  latest_fee: number | null;
  budget: number;
  updated_at: string;
}
export interface Contract {
  id: string;
  booking_id: string;
  template_version: string;
  body_markdown: string;
  sha256: string;
  /** SENT/SIGNED/VOID = kontrak lama; selainnya status kontrak baru (OTP). */
  status: string;
  version?: number;
  contract_no?: string | null;
  require_artist_ack?: boolean;
  pdf_ready?: boolean;
  created_at: string;
  signed_at: string | null;
}
export interface Dispute {
  id: string;
  booking_id: string;
  by_party: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
  outcome: string | null;
  note: string | null;
  created_at: string;
  kind?: 'GENERAL' | 'FORCE_MAJEURE';
  evidence?: string | null;
  claimed_costs?: number | null;
  awarded_costs?: number | null;
}
export interface Booking extends BookingSummary {
  start_time: string;
  duration_min: number;
  capacity: number;
  notes: string | null;
  hold_expires_at: string | null;
  offers: { id: string; by_party: 'promotor' | 'management'; fee: number; dp_pct: number; settlement_days_before: number; rider_notes: string | null; message: string | null; created_at: string }[];
  messages: { id: string; by_party: string; author_name: string; body: string; created_at: string }[];
  timeline: { from_status: string | null; to_status: string; actor: string; note: string | null; created_at: string }[];
  contract: Contract | null;
  invoice: { service_fee: number; dp: number; settlement: number; total_promotor: number; artist_commission: number } | null;
  contact: { name: string; email: string; phone: string };
  my_party: 'promotor' | 'management' | 'admin';
  signatures: { party: string; signer_name: string; signed_at: string }[];
  show_done: { promotor: boolean; management: boolean };
  rating: { mine_submitted: boolean; revealed: boolean; received?: { scores: Record<string, number>; comment: string | null } };
  dispute: Dispute | null;
}

// ---- Finance ----
export interface Invoice {
  id: string;
  purpose: 'BOOKING_DP' | 'BOOKING_SETTLEMENT' | 'TICKET_ORDER';
  reference_id: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  due_at: string;
  paid_at: string | null;
  payer_user_id: string;
  payer_org_id: string | null;
  description: string;
  va_number: string | null;
  qris_payload: string | null;
  /** Penyedia tempat invoice dibayar / akan dibayar ('sandbox' | 'midtrans'). */
  provider?: string;
  checkout_url?: string | null;
}
export interface EscrowStatus {
  reference_id: string;
  status: string;
  held_amount: number;
  released_amount: number;
  refunded_amount: number;
  invoices: Invoice[];
}
export interface Wallet {
  party_id: string;
  balances: { royalty: number; offair: number; ticket: number; merch: number; tip: number; total: number };
  transactions: { id: string; source: string; amount: number; description: string; created_at: string }[];
  payouts: Payout[];
}
export type PayoutStatus = 'PENDING_APPROVAL' | 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED';
/** Penarikan dana. PENDING_APPROVAL = menunggu dual control; REQUESTED + hold_until = tertahan masa tunggu rekening baru. */
export interface Payout {
  id: string;
  party_id: string;
  amount: number;
  status: PayoutStatus;
  approval_required: boolean;
  hold_until: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  completed_at: string | null;
}
/** Baris antrean persetujuan payout di back office. */
export interface AdminPayoutRow {
  id: string;
  party_id: string;
  amount: number;
  status: PayoutStatus;
  bank: { bank: string; number: string; holder: string };
  requested_by: string;
  approval_required: boolean;
  hold_until: string | null;
  bank_changed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  transfer_ref?: string | null;
  account_stored?: boolean;
  created_at: string;
  completed_at: string | null;
}

// ---- Ticketing ----
export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  poster_url: string | null;
  city: string;
  venue_name: string;
  starts_at: string;
  min_price: number | null;
  status: string;
  artists: { id: string; name: string }[];
}
export interface EventDetail extends EventSummary {
  description: string;
  venue_address: string;
  ends_at: string;
  rules: string | null;
  org_id: string;
  booking_id: string | null;
  ticket_types: { id: string; name: string; price: number; quota: number; remaining: number; max_per_account: number; sale_starts_at: string | null; presale: boolean }[];
}
export type TicketRefundReason = 'event_cancelled' | 'rescheduled' | 'buyer_request' | 'late_payment' | 'admin';
/** Jejak refund sebuah order tiket (null bila tidak pernah direfund). */
export interface OrderRefund {
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVIEW';
  reason: TicketRefundReason;
  pct: number | null;
  amount: number | null;
  requested_at: string | null;
  refunded_at: string | null;
}
export interface RefundQuote {
  eligible: boolean;
  reason: TicketRefundReason | null;
  pct: number;
  refund_fee: boolean;
  amount: number;
  deadline: string | null;
  message: string;
}
export interface Order {
  id: string;
  event_id: string;
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';
  total: number;
  reserved_until: string;
  invoice_id: string;
  items: { ticket_type_id: string; name: string; quantity: number; price: number }[];
  refund: OrderRefund | null;
}
export interface Ticket {
  id: string;
  order_id: string;
  event: EventSummary;
  type_name: string;
  status: 'VALID' | 'CHECKED_IN' | 'REFUNDED';
  holder_name: string;
  checked_in_at: string | null;
  refund: OrderRefund | null;
}
/** Baris antrean refund di back office. */
export interface AdminRefundRow {
  order_id: string;
  user_id: string;
  holder_name: string;
  total: number;
  order_status: Order['status'];
  event: { id: string; title: string; starts_at: string; status: string };
  note: string | null;
  refund: OrderRefund;
}

export interface Notification {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// ---- Platform (Super Admin, docs/API.md §9) ----
export interface PlatformOverview {
  generated_at: string;
  services: { name: string; ok: boolean; latency_ms: number | null; uptime_s: number | null; memory_mb: number | null; settings_loaded_at: string | null; metrics: Record<string, number | string> }[];
  kpis: {
    users_total: number;
    users_7d: number;
    artists: number;
    orgs: number;
    tracks_live: number;
    releases_in_review: number;
    streams_today: number;
    streams_28d: number;
    bookings_active: number;
    bookings_settled: number;
    gmv_offair: number;
    escrow_held: number;
    tickets_sold: number;
    ticket_gmv: number;
    kyc_pending: number;
    disputes_open: number;
  };
  bus: { events_total: number; max_lag: number; dead_letters: number };
  storage: { disk_used_pct: number; disk_free_bytes: number; db_bytes: number; uploads_bytes: number; backups_bytes: number; last_backup_at: string | null; warning: boolean };
  alerts: { level: 'info' | 'warning' | 'critical'; message: string; href: string | null }[];
  settings_version: number;
  maintenance: boolean;
}

export type BucketName = 'uploads' | 'backups' | 'branding';
export interface StorageOverview {
  disk: { path: string; total_bytes: number; used_bytes: number; free_bytes: number; used_pct: number; warn_pct: number };
  buckets: { name: BucketName; description: string; path: string; files: number; bytes: number; quota_bytes: number | null; used_pct: number | null; by_type: { type: string; files: number; bytes: number }[] }[];
  database: {
    total_bytes: number;
    schemas: { schema: string; service: string; bytes: number; tables: number; rows_est: number }[];
    largest_tables: { schema: string; table: string; bytes: number; rows_est: number }[];
  };
  bus: { events: number; bytes: number; oldest_at: string | null; prunable: number };
  retention: { bus_days: number; idempotency_days: number };
  trend: { at: string; disk_used_bytes: number; db_bytes: number; uploads_bytes: number; backups_bytes: number }[];
}
export interface StoredFile {
  bucket: BucketName;
  key: string;
  size: number;
  content_type: string | null;
  modified_at: string;
  url: string | null;
  /** null = tidak diperiksa (mis. bucket backups). */
  referenced: boolean | null;
}
export interface StoredFilePage {
  data: StoredFile[];
  next_cursor: string | null;
  total_files: number;
  total_bytes: number;
}
export interface Backup {
  id: string;
  filename: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  size_bytes: number | null;
  sha256: string | null;
  trigger: 'manual' | 'schedule';
  note: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  created_by: string | null;
}
export interface BackupsResponse {
  data: Backup[];
  schedule: { enabled: boolean; interval_hours: number; keep: number; next_run_at: string | null };
}
export interface DeadLetter {
  group: string;
  event_id: string;
  topic: string;
  error: string;
  attempts: number;
  failed_at: string;
  retry_requested_at: string | null;
}
export interface BusOverview {
  topics: { topic: string; events: number; last_at: string | null }[];
  consumers: { group: string; topic: string; last_seq: number; head_seq: number; lag: number }[];
  dead_letters: DeadLetter[];
}
export interface SettingsResponse {
  version: number;
  values: Record<string, unknown>;
  meta: Record<string, { updated_by: string | null; updated_at: string | null }>;
}
export interface SettingsHistoryItem {
  id: string;
  key: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  by_user_id: string | null;
  by_name: string | null;
  created_at: string;
}
export interface PlatformConfig {
  version: number;
  /** Kunci publik registri (bertitik, mis. `general.announcement`) → nilai. */
  settings: Record<string, unknown>;
}
export type AdminUser = Me & { admin_role: string | null; suspended_at: string | null };

// ---- Live Streaming (docs/API.md §10) ----
export type LiveStatus = 'SCHEDULED' | 'LIVE' | 'INTERRUPTED' | 'ENDED';
export type LiveAccess = 'PUBLIC' | 'TICKET';
export interface LiveStream {
  id: string;
  title: string;
  description: string | null;
  status: LiveStatus;
  access: LiveAccess;
  event: { id: string; slug: string; title: string; city: string; starts_at: string } | null;
  artist: { id: string; name: string; slug: string; image_url: string | null } | null;
  org: { id: string; name: string; type: OrgType };
  cover_url: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  /** Penonton aktif (heartbeat ≤ 30 dtk). */
  viewers: number;
  peak_viewers: number;
  total_views: number;
  ingest: 'rtmp' | 'browser' | 'demo' | null;
  chat_enabled: boolean;
  is_demo: boolean;
  /** Hanya untuk anggota org pemilik / admin: 4 karakter terakhir stream key. */
  key_hint?: string;
}
export type LiveAccessReason = null | 'login_required' | 'ticket_required' | 'not_live';
export type LiveStreamDetail = LiveStream & { can_watch: boolean; access_reason: LiveAccessReason };
export interface LivePlayback {
  hls_url: string;
  expires_at: string;
}
export interface LiveChatMessage {
  id: number;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
  mine: boolean;
}
export interface LiveChatPage {
  data: LiveChatMessage[];
  last_id: number | null;
  chat_enabled: boolean;
  slowmode_s: number;
}
export interface StreamHealth {
  status: LiveStatus;
  ingest: LiveStream['ingest'];
  uptime_s: number;
  bitrate_kbps: number | null;
  last_segment_at: string | null;
  segment_age_s: number | null;
  transcoder: 'idle' | 'starting' | 'running' | 'restarting' | 'failed';
  restarts: number;
  viewers: number;
  warnings: string[];
}
export interface LiveKeyInfo {
  stream_key: string;
  rtmp_url: string;
  rtmp_server: string;
}

// ---- Iklan — kebijakan penayangan tier Gratis (docs/API.md §11) ----
export type { AdBreakOutcome, AdCategory, AdCategoryTier, AdPlacement, AdType } from '@rave/domain/ads';

export interface AdCreative {
  impression_id: string;
  campaign_id: string;
  type: AdType;
  advertiser: string;
  title: string;
  body: string | null;
  image_url: string | null;
  audio_url: string | null;
  click_url: string | null;
  cta_label: string | null;
  /** Warna latar kartu display bila tanpa gambar. */
  theme_color: string | null;
  duration_s: number;
  /** null = tidak bisa dilewati. */
  skippable_after_s: number | null;
  label: 'Iklan' | 'Dari RAVE';
  is_house: boolean;
}
export interface AdBreakRequest {
  placement: AdPlacement;
  content?: { kind: 'track' | 'episode'; id: string; genres?: string[]; content_warning?: boolean; premium?: boolean };
}
export interface AdBreakResponse {
  break_id: string | null;
  ads: AdCreative[];
  outcome: AdBreakOutcome;
  reason: string;
}
export type AdImpressionEvent = 'start' | 'complete' | 'skip' | 'click';

export type CampaignStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'ENDED';
export interface CampaignStats {
  impressions: number;
  completes: number;
  skips: number;
  clicks: number;
  ctr: number;
  completion_rate: number;
}
export interface Campaign {
  id: string;
  advertiser: string;
  name: string;
  category: AdCategory;
  license_ref: string | null;
  type: AdType;
  title: string;
  body: string | null;
  image_url: string | null;
  audio_url: string | null;
  click_url: string | null;
  cta_label: string | null;
  theme_color: string | null;
  duration_s: number;
  target_genres: string[];
  target_cities: string[];
  start_at: string;
  end_at: string | null;
  max_impressions: number | null;
  /** 1..10 */
  priority: number;
  is_house: boolean;
  status: CampaignStatus;
  review_note: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  stats: CampaignStats;
}
/** Field kampanye yang dapat ditulis (POST/PATCH) + `submit` untuk langsung mengajukan tinjauan. */
export type CampaignInput = Pick<Campaign, 'advertiser' | 'name' | 'category' | 'type' | 'title' | 'duration_s'> &
  Partial<
    Pick<
      Campaign,
      | 'license_ref'
      | 'body'
      | 'image_url'
      | 'audio_url'
      | 'click_url'
      | 'cta_label'
      | 'theme_color'
      | 'target_genres'
      | 'target_cities'
      | 'start_at'
      | 'end_at'
      | 'max_impressions'
      | 'priority'
      | 'is_house'
    >
  > & { submit?: boolean };

export interface AdsOverview {
  kpis: {
    impressions: number;
    completes: number;
    clicks: number;
    ctr: number;
    completion_rate: number;
    fill_rate: number;
    breaks: number;
    active_campaigns: number;
    pending_review: number;
  };
  by_day: { date: string; impressions: number; clicks: number; breaks: number }[];
  outcomes: { outcome: AdBreakOutcome | string; label: string; n: number }[];
  top_campaigns: Campaign[];
  policy: {
    fixed_rules: string[];
    categories: { key: AdCategory; label: string; tier: AdCategoryTier; license: string | null; blocked: boolean }[];
  };
}
export interface AdSimulateInput {
  premium: boolean;
  anonymous?: boolean;
  consent?: boolean;
  placement: AdPlacement;
  premium_content?: boolean;
  content_warning?: boolean;
  streams_today: number;
  streams_since_break: number;
  minutes_since_break: number | null;
  ads_last_hour: number;
  city?: string;
  genres?: string[];
}
export interface AdSimulateResult {
  outcome: AdBreakOutcome;
  label: string;
  slots: number;
  trace: { rule: string; pass: boolean; detail: string }[];
  eligible_campaigns: { id: string; name: string; advertiser: string; is_house: boolean; reason: string | null }[];
}
