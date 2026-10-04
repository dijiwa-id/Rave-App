// Tipe respons API — cermin dari docs/API.md. Ubah dokumen kontrak dulu bila menambah field.

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
  genres: string[];
  roles: string[];
  orgs: OrgClaim[];
  kyc_status: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  mfa_enabled: boolean;
  onboarded: boolean;
  premium: boolean;
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
  status: 'SENT' | 'SIGNED' | 'VOID';
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
export interface Order {
  id: string;
  event_id: string;
  status: 'RESERVED' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  total: number;
  reserved_until: string;
  invoice_id: string;
  items: { ticket_type_id: string; name: string; quantity: number; price: number }[];
}
export interface Ticket {
  id: string;
  event: EventSummary;
  type_name: string;
  status: 'VALID' | 'CHECKED_IN' | 'REFUNDED';
  holder_name: string;
  checked_in_at: string | null;
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
