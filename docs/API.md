# GEMA API Contract v1

> Acuan bersama backend ↔ frontend. Sumber: BRD/TDD v2.0 §11.2. Semua lewat **API Gateway** `http://localhost:8080` (browser memakai proxy Vite `/v1`).
> Perubahan kontrak = ubah dokumen ini dulu.

## Konvensi
- JSON, **snake_case**, versi di path `/v1`. Waktu ISO-8601 UTC. Tanggal acara `YYYY-MM-DD`.
- Uang: **integer Rupiah** (`fee`, `amount`, `price` …). Tidak pernah float.
- List: `{ "data": [...], "next_cursor": string|null }`, query `?cursor=&limit=` (default 20, maks 100).
- Error: RFC 9457 `application/problem+json` → `{ type, title, status, detail?, errors?: [{path,message}] }`.
- Auth: `Authorization: Bearer <access_token>` (JWT 15 menit). Refresh dengan `POST /v1/auth/token` grant `refresh_token` (rotasi; token lama tidak berlaku).
- **`Idempotency-Key` wajib** pada POST yang membuat transaksi: inquiry, offer, sign, order tiket, payout, simulate-pay. Respons ulang memuat header `Idempotent-Replayed: true`.
- Klaim JWT: `sub, email, name, roles[] (fan|artist|manager|label|promotor|creator|admin), orgs[] {id,type,role,artist_id?}, city, kyc, premium`.

## Peta service & prefix (gateway routing)

| Prefix | Service | Port | Schema |
|---|---|---|---|
| `/v1/auth`, `/v1/me`, `/v1/orgs`, `/v1/waitlist`, `/v1/admin/iam` | iam | 4001 | `iam` |
| `/v1/catalog`, `/v1/studio`, `/v1/admin/qc` | catalog | 4002 | `catalog` |
| `/v1/library` | library | 4003 | `library` |
| `/v1/playback`, `/v1/events/play`, `/v1/analytics` | playback | 4004 | `playback` |
| `/v1/booking`, `/v1/admin/disputes` | booking | 4005 | `booking` |
| `/v1/finance`, `/v1/webhooks/pg`, `/v1/admin/finance` | finance | 4006 | `finance` |
| `/v1/ticketing` | ticketing | 4007 | `ticketing` |
| `/v1/notifications` | notification | 4008 | `notify` |

Endpoint internal antar-service memakai prefix `/internal/...` (TIDAK diekspos gateway; wajib token role `service`).

---

## 1. IAM (REQ-IAM-01..06, REQ-WEB-02)

| Method & Path | Auth | Body / Query | Respons |
|---|---|---|---|
| `POST /v1/auth/otp` | – | `{ channel: "email"\|"whatsapp", destination }` | `{ sent: true, expires_in: 300, dev_code?: "123456" }` (`dev_code` hanya NODE_ENV≠production) |
| `POST /v1/auth/token` | – | `{ grant_type:"otp", destination, code }` atau `{ grant_type:"refresh_token", refresh_token }` | `TokenResponse` |
| `POST /v1/auth/logout` | – | `{ refresh_token }` | `{ ok: true }` |
| `POST /v1/auth/oauth/:provider` | – | google/apple | `501` (adapter belum dipasang) |
| `GET /v1/me` | ✓ | | `Me` |
| `PATCH /v1/me` | ✓ | `{ display_name?, avatar_url?, city? }` | `Me` |
| `POST /v1/me/onboarding` | ✓ | `{ city, genres: string[], artist_ids: string[] (min 3) }` | `Me` |
| `DELETE /v1/me` | ✓ | | `{ deleted: true }` (hak subjek data) |
| `GET /v1/me/consents` / `PUT /v1/me/consents` | ✓ | `{ purpose: "marketing"\|"personalization"\|"ads"\|"aggregate_sharing", granted: bool }` | `{ data: Consent[] }` |
| `POST /v1/me/kyc` | ✓ | `{ level:"INDIVIDUAL"\|"BUSINESS", full_name, id_number, org_id?, business_name?, nib? }` | `KycSubmission` (status PENDING) |
| `GET /v1/me/kyc` | ✓ | | `KycSubmission \| null` |
| `POST /v1/orgs` | ✓ | `{ type: "ARTIST"\|"MANAGEMENT"\|"LABEL"\|"PROMOTOR", name, city?, genres? }` → ARTIST juga membuat profil artis (event `iam.org.created` → catalog) | `Org` (+ `artist_id` untuk ARTIST). **Klien wajib refresh token** agar `orgs` di JWT terbarui |
| `GET /v1/orgs/:id` | anggota | | `Org & { members: Member[] }` |
| `POST /v1/orgs/:id/members` | OWNER/ADMIN | `{ email, role: "ADMIN"\|"FINANCE"\|"MEMBER"\|"VIEWER" }` | `Member` |
| `POST /v1/orgs/:id/manage-artist` | MANAGEMENT OWNER | `{ artist_org_id }` | relasi manajemen↔artis |
| `POST /v1/waitlist` | – | `{ email, name?, segment:"fan"\|"artist"\|"management"\|"label"\|"promotor", city?, consent_marketing: bool, referral_code? }` | `{ position, referral_code }` |
| `GET /v1/admin/iam/kyc?status=PENDING` | admin | | `{ data: KycSubmission[] }` |
| `POST /v1/admin/iam/kyc/:id/decision` | admin | `{ approve: bool, reason? }` | `KycSubmission` |
| `GET /v1/admin/iam/users?q=` | admin | | `{ data: Me[] }` |
| `GET /v1/admin/iam/audit-logs` | admin | | `{ data: AuditLog[] }` |

```ts
TokenResponse = { access_token, refresh_token, token_type: "Bearer", expires_in: 900, user: Me }
Me = { id, email, phone, display_name, avatar_url, city, genres: string[], roles: string[],
       orgs: { id, type, name, role, artist_id: string|null }[], kyc_status: "NONE"|"PENDING"|"VERIFIED"|"REJECTED",
       mfa_enabled: boolean, onboarded: boolean, premium: boolean, created_at }
Org = { id, type, name, slug, city, verified: boolean, artist_id: string|null, created_at }
KycSubmission = { id, user_id, org_id, level, full_name, id_number_masked, status, reason, created_at, decided_at }
```

## 2. Catalog (REQ-STR-03/05/07, REQ-POD/FIC, REQ-STU-01/02, REQ-ADM-02)

Publik (token opsional):

| Method & Path | Query | Respons |
|---|---|---|
| `GET /v1/catalog/home` | `city?` | `{ quick_picks: MediaItem[6], sections: { id, title, kind: "releases"\|"artists"\|"shows"\|"episodes", items: MediaItem[] }[] }` |
| `GET /v1/catalog/browse` | | `{ data: Category[] }` (tile warna — mockup Spotify 2) |
| `GET /v1/catalog/search` | `q, type?` | `{ artists: ArtistSummary[], tracks: Track[], releases: ReleaseSummary[], shows: Show[], episodes: Episode[] }` (toleran typo: pg_trgm) |
| `GET /v1/catalog/artists` | `genre?, city?, ids?` | `{ data: ArtistSummary[] }` |
| `GET /v1/catalog/artists/:idOrSlug` | | `Artist` |
| `GET /v1/catalog/releases/:id` | | `Release` |
| `GET /v1/catalog/tracks` | `ids=a,b,c` | `{ data: Track[] }` (batch hydrate) |
| `GET /v1/catalog/tracks/:id` | | `Track` |
| `GET /v1/catalog/tracks/:id/lyrics` | | `{ synced: boolean, lines: { time_ms, text }[] }` / 404 |
| `GET /v1/catalog/genres` | | `{ data: { id, name }[] }` |
| `GET /v1/catalog/shows` | `kind?: "PODCAST"\|"FICTION", category?` | `{ data: Show[] }` |
| `GET /v1/catalog/shows/:id` | | `Show & { episodes: Episode[] }` |
| `GET /v1/catalog/episodes/:id` | | `Episode & { show: Show }` |

Artist Studio (role artist/manager/label; ABAC: `artist_id ∈ token.orgs[].artist_id`):

| Method & Path | Body | Respons |
|---|---|---|
| `GET /v1/studio/artists/:artistId/releases` | | `{ data: Release[] }` (semua status) |
| `PATCH /v1/studio/artists/:artistId` | `{ bio?, image_url?, cover_url?, city?, genres? }` | `Artist` |
| `POST /v1/studio/releases` | `{ artist_id, title, type:"SINGLE"\|"EP"\|"ALBUM", release_date, genre, label?, cover_url?, explicit?, tracks: { title, duration_ms?, isrc?, explicit?, audio_url? }[] }` | `Release` (DRAFT) |
| `PATCH /v1/studio/releases/:id` | subset | `Release` |
| `POST /v1/studio/uploads` | `{ kind: "audio"\|"artwork", filename, content_type, size }` | `{ upload_id, upload_url, public_url }` (dev: PUT biner ke `upload_url`) |
| `PUT /v1/studio/uploads/:id` | biner | `{ public_url }` |
| `POST /v1/studio/releases/:id/submit` | | `Release` → IN_REVIEW, atau `422 { errors }` (validasi: artwork, audio, split 100%) |
| `GET /v1/studio/tracks/:id/splits` | | `{ master: Split[], publishing: Split[], fully_approved }` |
| `PUT /v1/studio/tracks/:id/splits` | `{ master: {party_name, email?, pct}[], publishing: [...] }` | sama |
| `POST /v1/studio/splits/:splitId/approve` | | `Split` |

Admin QC: `GET /v1/admin/qc/releases?status=IN_REVIEW` → `{ data: Release[] }`; `POST /v1/admin/qc/releases/:id/decision` `{ approve, reason? }` → LIVE + event `catalog.release.published`.

```ts
MediaItem = { id, kind: "release"|"artist"|"playlist"|"show"|"episode", title, subtitle, image_url, href }
Category = { id, name, color, image_url, href }
ArtistSummary = { id, slug, name, image_url, city, genres: string[], verified, monthly_listeners }
Artist = ArtistSummary & { bio, cover_url, followers, top_tracks: Track[], releases: ReleaseSummary[], org_id }
ReleaseSummary = { id, title, type, cover_url, release_date, artist: { id, name, slug } }
Release = ReleaseSummary & { status: "DRAFT"|"IN_REVIEW"|"SCHEDULED"|"LIVE"|"REJECTED"|"TAKEN_DOWN", label, genre, upc, explicit, tracks: Track[], qc_reason }
Track = { id, title, duration_ms, explicit, isrc, track_number, play_count, has_lyrics,
          artist: { id, name, slug }, release: { id, title, cover_url } }
Show = { id, kind: "PODCAST"|"FICTION", title, publisher, description, cover_url, category, age_rating?, content_warning? }
Episode = { id, show_id, title, description, duration_ms, published_at, is_premium, season?, episode_number?, cover_url }
Split = { id, type: "MASTER"|"PUBLISHING", party_name, email, pct, approved_at }
```

## 3. Library (REQ-STR-04)

| Method & Path | Body / Query | Respons |
|---|---|---|
| `GET /v1/library/summary` | | `{ liked_count, playlists: PlaylistSummary[], followed_artists: string[], saved_releases: string[], recent_track_ids: string[] }` |
| `GET /v1/library/likes` | | `{ data: Track[] }` (hydrated dari catalog) |
| `GET /v1/library/likes/contains` | `ids=a,b` | `{ ids: string[] }` |
| `PUT /v1/library/likes/:trackId` / `DELETE` | | `{ liked: bool }` |
| `PUT /v1/library/follows/:artistId` / `DELETE` | | `{ following: bool }` |
| `GET /v1/library/follows/:artistId` | | `{ following: bool }` |
| `PUT /v1/library/releases/:releaseId` / `DELETE` | | `{ saved: bool }` |
| `GET /v1/library/playlists` | | `{ data: PlaylistSummary[] }` (milik user) |
| `GET /v1/library/playlists/featured` | `tag?` | `{ data: PlaylistSummary[] }` (editorial, publik) |
| `POST /v1/library/playlists` | `{ title, description?, visibility?: "PUBLIC"\|"PRIVATE"\|"COLLAB" }` | `Playlist` |
| `GET /v1/library/playlists/:id` | | `Playlist` (publik boleh tanpa token) |
| `PATCH /v1/library/playlists/:id` / `DELETE` | | `Playlist` |
| `POST /v1/library/playlists/:id/items` | `{ track_id }` | `PlaylistItem` (batas 10.000) |
| `DELETE /v1/library/playlists/:id/items/:itemId` | | `{ ok }` |
| `POST /v1/library/playlists/:id/items/:itemId/move` | `{ after_item_id: string\|null }` | `{ ok }` (fractional index) |
| `GET /v1/library/history` | | `{ data: Track[] }` |

```ts
PlaylistSummary = { id, title, description, cover_url, owner: { id, name }, visibility, track_count, is_editorial }
Playlist = PlaylistSummary & { items: { item_id, added_at, track: Track }[] }
```

## 4. Playback & Analytics (REQ-STR-01/02, REQ-WEB-04, REQ-STU-03)

| Method & Path | Auth | Body / Query | Respons |
|---|---|---|---|
| `POST /v1/playback/sessions` | opsional | `{ track_id? , episode_id?, quality: "auto"\|"low"\|"normal"\|"high"\|"lossless" }` | `PlaybackSession` — anonim → `preview_only: true` (30 dtk); episode premium tanpa premium → 402 |
| `GET /v1/playback/stream/:sessionId` | – (URL bertanda tangan `?exp&sig`) | | 302 ke sumber media |
| `POST /v1/events/play` | opsional | `{ events: { session_id, track_id?, episode_id?, type: "start"\|"progress"\|"complete"\|"skip", position_ms, played_ms, at }[] }` | `{ accepted: n, qualified: n }` (qualified ≥ 30 dtk → event `playback.stream.qualified`) |
| `GET /v1/analytics/artists/:artistId/summary` | pemilik/admin | `days=28` | `ArtistAnalytics` |
| `GET /v1/analytics/artists/:artistId/export.csv` | pemilik/admin | `days` | CSV |

```ts
PlaybackSession = { session_id, stream_url, expires_at, quality, codec_label: "HE-AAC 48"|"AAC 160"|"AAC 320"|"FLAC 16/44.1",
                    loudness_gain_db, preview_only: boolean, preview_ms: number|null, duration_ms }
ArtistAnalytics = { artist_id, days, streams, listeners, followers_gained, save_rate, skip_rate,
  daily: { date, streams, listeners }[], top_cities: { city, listeners }[] /* k-anon ≥50, sisanya "Lainnya" */,
  top_tracks: { track_id, title, streams }[], sources: { source, pct }[], age_groups: { group, pct }[] }
```

Internal: `GET /internal/analytics/artists/:artistId/epk` → `{ monthly_listeners, growth_90d_pct, top_cities, age_groups, engagement_rate }`; `GET /internal/analytics/city-listeners?city=` → `{ data: { artist_id, listeners }[] }`.

## 5. Booking / Off-Air (REQ-B2B-01..13)

| Method & Path | Aktor | Body / Query | Respons |
|---|---|---|---|
| `GET /v1/booking/artists/:artistId/epk` | publik (metrik sensitif hanya promotor terverifikasi) | `?token=` link privat | `Epk` |
| `PUT /v1/booking/artists/:artistId/epk` | manajemen | `EpkContent` | `Epk` |
| `POST /v1/booking/artists/:artistId/epk/share` | manajemen | `{ expires_in_days }` | `{ url, token, expires_at }` |
| `GET /v1/booking/artists/:artistId/rate-card` | publik/promotor | | `RateCard` (difilter sesuai visibilitas) |
| `PUT /v1/booking/artists/:artistId/rate-card` | manajemen | `{ visibility: "PUBLIC"\|"VERIFIED_PROMOTOR"\|"BY_REQUEST", valid_from?, valid_to?, items: RateItem[] }` | `RateCard` (audit log) |
| `GET /v1/booking/artists/:artistId/calendar` | manajemen | `from, to` | `{ data: CalendarSlot[] }` |
| `GET /v1/booking/artists/:artistId/availability` | publik | `from, to` | `{ data: { date, status: "AVAILABLE"\|"HOLD"\|"BUSY" }[] }` (tanpa detail privat) |
| `POST /v1/booking/artists/:artistId/calendar/blocks` | manajemen | `{ start_date, end_date, status: "BLOCKED"\|"TRAVEL", note? }` | `CalendarSlot` (409 bila bentrok) |
| `DELETE /v1/booking/calendar/:slotId` | manajemen | | `{ ok }` |
| `PUT /v1/booking/artists/:artistId/fee-splits` | manajemen | `{ items: { label, party_id?, pct }[] }` | `{ items }` (REQ-B2B-13) |
| `GET /v1/booking/discovery` | promotor | `city?, genre?, budget_max?, date?, format?, category?` | `{ data: DiscoveryResult[] }` |
| `POST /v1/booking/inquiries` | promotor (org PROMOTOR) **Idempotency-Key** | `{ artist_id, promotor_org_id, event_name, event_date, start_time, duration_min, city, venue, capacity, category, format, budget, notes?, hold?: bool }` | `Booking` (INQUIRY) |
| `GET /v1/booking/bookings` | pihak terkait | `side: "artist"\|"promotor", artist_id?, org_id?, status?` | `{ data: BookingSummary[] }` |
| `GET /v1/booking/bookings/:id` | pihak terkait/admin | | `Booking` |
| `POST /v1/booking/bookings/:id/offers` | manajemen/promotor **Idempotency-Key** | `{ fee, dp_pct (default 50), settlement_days_before (default 7), rider_notes?, message? }` | `Booking` (NEGOTIATING) |
| `POST /v1/booking/bookings/:id/messages` | pihak terkait | `{ body }` | `Message` |
| `POST /v1/booking/bookings/:id/accept` | pihak lawan dari pengirim offer terakhir | | `Booking` → AGREED → (otomatis) CONTRACT_SENT |
| `POST /v1/booking/bookings/:id/decline` | pihak terkait | `{ reason }` | `Booking` |
| `POST /v1/booking/bookings/:id/sign` | penandatangan **Idempotency-Key** | `{ signer_name }` | `Booking` (SIGNED bila semua pihak) — PSrE mock |
| `POST /v1/booking/bookings/:id/show-done` | kedua pihak | | `Booking` (COMPLETED bila keduanya) |
| `POST /v1/booking/bookings/:id/cancel` | pihak terkait | `{ reason, force_majeure?: bool }` | `Booking & { cancellation: CancellationOutcome }` |
| `POST /v1/booking/bookings/:id/ratings` | pihak COMPLETED | `{ scores: Record<string, 1..5>, comment? }` | `{ submitted: true, revealed: bool }` (double-blind) |
| `POST /v1/booking/bookings/:id/disputes` | pihak terkait | `{ reason }` | `Dispute` |
| `GET /v1/booking/contracts/:id` | pihak terkait | | `Contract` |
| `GET /v1/admin/disputes` / `POST /v1/admin/disputes/:id/resolve` | admin | `{ outcome: "RELEASE_TO_ARTIST"\|"REFUND_PROMOTOR", note }` | `Dispute` |

```ts
RateItem = { category: "KAMPUS"|"PENSI"|"FESTIVAL"|"KORPORAT"|"WEDDING"|"CAFE_CLUB"|"SHOWCASE",
             format: "FULL_BAND"|"AKUSTIK"|"DJ_SOLO", zone: "DALAM_KOTA"|"JAWA"|"LUAR_JAWA"|"LUAR_NEGERI",
             duration_min, fee, rider_estimate, accommodation_by_promotor: bool, transport_by_promotor: bool }
RateCard = { artist_id, visibility, valid_from, valid_to, from_fee, items: RateItem[] /* kosong bila tidak berhak */ }
EpkContent = { bio_short, bio_long, press_photos: string[], videos: string[], press_quotes: { quote, source }[],
               achievements: string[], rider: object /* Lampiran C */, members: { name, role }[],
               public_metrics: string[] /* metrik yang tampil publik */ }
Epk = EpkContent & { artist: ArtistSummary & { verified }, stats: { monthly_listeners, growth_90d_pct, top_cities: {city,listeners}[],
        age_groups, shows_12m, avg_rating, on_time_rate }, rate_card: { from_fee: number|null, visibility },
        contact: { name, email, phone } /* disamarkan "***" sampai BOOKED */ , updated_at }
CalendarSlot = { id, artist_id, start_date, end_date, status, booking_id, note }
DiscoveryResult = { artist: ArtistSummary, from_fee: number|null, audience_match: number /*0-100*/,
                    listeners_in_city: number|null, avg_rating: number|null, shows_12m, available: boolean|null }
BookingSummary = { id, status, status_label, artist: {id,name,image_url}, promotor_org: {id,name}, event_name, event_date,
                   city, venue, category, format, latest_fee, budget, updated_at }
Booking = BookingSummary & { start_time, duration_min, capacity, notes, hold_expires_at,
  offers: { id, by_party: "promotor"|"management", fee, dp_pct, settlement_days_before, rider_notes, message, created_at }[],
  messages: { id, by_party, author_name, body, created_at }[],
  timeline: { from_status, to_status, actor, note, created_at }[],
  contract: Contract | null, invoice: { service_fee, dp, settlement, total_promotor, artist_commission } | null,
  contact: { name, email, phone }, my_party: "promotor"|"management"|"admin",
  signatures: { party, signer_name, signed_at }[], show_done: { promotor: bool, management: bool },
  rating: { mine_submitted: bool, revealed: bool, received?: { scores, comment } }, dispute: Dispute | null }
Contract = { id, booking_id, template_version, body_markdown, sha256, status: "SENT"|"SIGNED"|"VOID", created_at, signed_at }
Dispute = { id, booking_id, by_party, reason, status: "OPEN"|"RESOLVED", outcome, note, created_at }
```

## 6. Finance (REQ-B2B-04, REQ-PAY-01..05)

| Method & Path | Aktor | Body / Query | Respons |
|---|---|---|---|
| `GET /v1/finance/invoices` | ✓ | `reference_id?` (bookingId/orderId) | `{ data: Invoice[] }` milik user/org-nya |
| `GET /v1/finance/invoices/:id` | pemilik | | `Invoice` |
| `POST /v1/finance/invoices/:id/simulate-pay` | pemilik (**dev sandbox**) **Idempotency-Key** | `{ method: "VA"\|"QRIS"\|"EWALLET"\|"CARD" }` | `Invoice` (memanggil webhook PG bertanda tangan HMAC) |
| `POST /v1/webhooks/pg/:provider` | PG (HMAC `x-pg-signature`) | `{ event_id, intent_id, status: "PAID"\|"FAILED", amount, paid_at }` | `{ ok }` idempoten per `event_id` |
| `GET /v1/finance/escrow/:referenceId` | pihak terkait | | `EscrowStatus` |
| `GET /v1/finance/wallets/:partyId` | anggota org/user | | `Wallet` |
| `POST /v1/finance/payouts` | OWNER/FINANCE **Idempotency-Key** | `{ party_id, amount, bank_account: { bank, number, holder } }` | `Payout` |
| `GET /v1/admin/finance/ledger` | admin | `account?` | `{ data: LedgerTxn[] }` |
| `GET /v1/admin/finance/reconciliation` | admin | | `{ balanced: bool, total_debit, total_credit, accounts: { account, balance }[], last_run_at }` |

```ts
Invoice = { id, purpose: "BOOKING_DP"|"BOOKING_SETTLEMENT"|"TICKET_ORDER", reference_id, amount, status: "PENDING"|"PAID"|"EXPIRED"|"FAILED",
            due_at, paid_at, payer_user_id, payer_org_id, description, va_number, qris_payload }
EscrowStatus = { reference_id, status: "AWAITING_DP"|"DP_RECEIVED"|"PAID_IN_FULL"|"HELD"|"RELEASED"|"REFUNDED"|"PARTIAL_REFUND",
                 held_amount, released_amount, refunded_amount, invoices: Invoice[] }
Wallet = { party_id, balances: { royalty, offair, ticket, merch, tip, total }, transactions: { id, source, amount, description, created_at }[] }
Payout = { id, party_id, amount, status: "REQUESTED"|"PROCESSING"|"COMPLETED"|"FAILED", created_at }
```

Internal: `POST /internal/invoices` `{ purpose, reference_id, amount, payer_user_id, payer_org_id?, description, due_at }` → `Invoice` (dipakai ticketing).

## 7. Ticketing (REQ-EVT-01, REQ-TIX-01..05)

| Method & Path | Aktor | Body / Query | Respons |
|---|---|---|---|
| `GET /v1/ticketing/events` | publik | `city?, artist_id?, from?, q?` | `{ data: EventSummary[] }` |
| `GET /v1/ticketing/events/:idOrSlug` | publik | | `EventDetail` |
| `GET /v1/ticketing/orgs/:orgId/events` | promotor | | `{ data: (EventSummary & { sold, revenue, checked_in })[] }` |
| `POST /v1/ticketing/events` | promotor | `{ org_id, booking_id?, title, description, city, venue_name, venue_address, starts_at, ends_at, poster_url?, artist_ids, rules?, ticket_types: { name, price, quota, max_per_account, sale_starts_at?, presale?: bool }[] }` | `EventDetail` (DRAFT) |
| `POST /v1/ticketing/events/:id/publish` | promotor | | `EventDetail` (PUBLISHED, event `ticketing.event.published`) |
| `POST /v1/ticketing/orders` | ✓ **Idempotency-Key** | `{ event_id, items: { ticket_type_id, quantity }[] }` | `{ order: Order, invoice: Invoice }` — kuota ditahan 10 menit, atomik (tanpa oversell) |
| `GET /v1/ticketing/orders/:id` | pemilik | | `Order` |
| `GET /v1/ticketing/tickets/mine` | ✓ | | `{ data: Ticket[] }` |
| `GET /v1/ticketing/tickets/:id/qr` | pemilik | | `{ payload: "GEMA1.<ticket_id>.<code>", expires_in }` (berputar 15 dtk) |
| `POST /v1/ticketing/checkin` | anggota org promotor | `{ event_id, payload, gate }` | `{ ok: bool, reason?: "INVALID"\|"DUPLICATE"\|"WRONG_EVENT"\|"EXPIRED_CODE", ticket? }` |
| `GET /v1/ticketing/events/:id/checkin-stats` | promotor | | `{ sold, checked_in, by_gate: { gate, count }[] }` |

```ts
EventSummary = { id, slug, title, poster_url, city, venue_name, starts_at, min_price, status, artists: { id, name }[] }
EventDetail = EventSummary & { description, venue_address, ends_at, rules, org_id, booking_id,
  ticket_types: { id, name, price, quota, remaining, max_per_account, sale_starts_at, presale }[] }
Order = { id, event_id, status: "RESERVED"|"PAID"|"EXPIRED"|"CANCELLED", total, reserved_until, invoice_id,
          items: { ticket_type_id, name, quantity, price }[] }
Ticket = { id, event: EventSummary, type_name, status: "VALID"|"CHECKED_IN"|"REFUNDED", holder_name, checked_in_at }
```

## 8. Notification (REQ-NTF-01)

`GET /v1/notifications?unread=` → `{ data: { id, category, title, body, link, read_at, created_at }[] }` · `GET /v1/notifications/unread-count` · `POST /v1/notifications/:id/read` · `POST /v1/notifications/read-all` · `GET|PUT /v1/notifications/preferences`.

## Akun demo (seed, NODE_ENV=development)

| Email | Peran | Catatan |
|---|---|---|
| `fan@gema.id` | fan | onboarded, kota Bandung |
| `artis@gema.id` | artist | OWNER org artis **Senja Kolektif** |
| `manajer@gema.id` | manager | OWNER **Nada Manajemen**, mengelola Senja Kolektif |
| `promotor@gema.id` | promotor | OWNER **Pensi Nusantara** (KYC terverifikasi) |
| `admin@gema.id` | admin | back office |

Login: `POST /v1/auth/otp` → pakai `dev_code` dari respons → `POST /v1/auth/token`.
