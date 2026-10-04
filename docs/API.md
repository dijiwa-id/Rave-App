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
Tambahan (aditif, catalog): `GET /v1/catalog/browse/:id` → `{ category, artists: ArtistSummary[], releases: ReleaseSummary[], tracks: Track[] }` (href kategori = `/app/genre/:id`) · `GET /v1/catalog/media/:file` (file hasil upload, publik) · `POST /v1/studio/releases/:id/tracks` (tambah lagu) · `PATCH|DELETE /v1/studio/tracks/:id` (`{ title?, audio_url?, duration_ms?, isrc?, explicit?, track_number? }`) · `GET /v1/studio/splits/pending` (split menunggu persetujuan untuk email user) · `POST /v1/admin/qc/releases/:id/takedown` `{ reason }`. `PUT /v1/studio/uploads/:id` mengembalikan `{ public_url, meta, warnings[] }` (artwork < 3000 px & master < 24-bit = peringatan; < 16-bit/44,1 kHz = 422). Respons QC queue menyertakan `qc_signals[]` (duplikasi ISRC/judul). Split tanpa `email` = pihak pengelola sendiri → otomatis disetujui; split ber-email menunggu `approve` oleh user dengan email itu.
Internal catalog: `GET /internal/tracks/:id/media` → `{ id, status, audio_url, duration_ms, artist_id, loudness_gain_db, title, release_id }` · `GET /internal/episodes/:id/media` → `{ id, is_premium, audio_url, duration_ms, show_id, title }` · `GET /internal/artists/:id`.

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
Catatan playback: body sesi boleh menyertakan `source: "editorial"|"search"|"profile"|"library"|"playlist"|"radio"|"other"` (atribusi sumber stream). `listeners` di `ArtistAnalytics` = pendengar unik 28 hari terakhir (bukan jumlah window `days`). Respons EPK internal juga memuat `streams_28d`. `city-listeners` mengembalikan angka mentah — pemanggil wajib `kSafe()` saat menampilkan. Stream ditandai fraud (`RATE_LIMIT` >120 qualified/jam, `LOOP_31S` 5 sesi beruntun berhenti < 35 dtk) tidak dihitung & tidak dipublikasikan.

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

**Catatan implementasi booking (v1):**
- Tambahan endpoint: `GET /v1/booking/artists/:artistId/fee-splits` (manajemen).
- `Booking` juga memuat `cancellation` (hasil matriks §7.3 bila dibatalkan) dan `payment: { dp_paid, settlement_paid }`.
- `Epk.stats.*` bernilai `null`/`[]` bila metrik tidak ada di `public_metrics` dan viewer bukan manajemen/promotor terverifikasi/link share. `top_cities` hanya segmen ≥ k=50.
- Share link: `url` = `/epk/<slug>?token=<token>`; FE memanggil `GET /v1/booking/artists/<slug>/epk?token=`.
- Discovery dengan `date` hanya mengembalikan artis yang available. Tanpa data playback, Audience Match memakai heuristik kota asal artis.
- `cancel` sebelum SIGNED → `DECLINED` (kontrak SENT di-VOID). Setelah SIGNED → `CANCELLED_BY_*`/`FORCE_MAJEURE` + event `booking.cancelled` berisi jumlah refund/forfeit.
- `show-done`: normalnya hanya saat `SHOW_DAY` (job memajukan BOOKED_AND_SECURED → SHOW_DAY pada hari-H). **Dev fast clock** (`GEMA_FAST_CLOCK=1`, default aktif bila NODE_ENV≠production): show-done boleh kapan saja setelah BOOKED_AND_SECURED, auto-complete 60 dtk, jendela dispute finance 30 dtk.
- Admin resolve dispute: `RELEASE_TO_ARTIST` → SETTLED + pencairan; `REFUND_PROMOTOR` → CANCELLED_BY_ARTIST + refund penuh (event `booking.dispute.resolved`).

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

**Catatan implementasi finance (v1):**
- `Invoice` juga memuat `escrow_amount`, `fee_amount` (service fee platform; DP = DP fee + service fee promotor), `depends_on` (pelunasan menunggu DP → simulate-pay 422 bila DP belum lunas).
- `EscrowStatus` juga memuat `fee`, `release_at` (jadwal pencairan setelah jendela dispute). Status `HELD` = dibekukan (dispute/force majeure).
- `Wallet` juga memuat `payouts[]` dan `bank_account { bank, number_masked, holder }`. Party = org id atau user id; payout min Rp 50.000, sumber didebit berurutan offair → royalty → ticket → merch → tip.
- Webhook PG: header `x-pg-signature: t=<unix>,v1=<hex HMAC-SHA256(PG_WEBHOOK_SECRET, "<t>.<raw body>")>`, toleransi 300 dtk; idempoten per `event_id`. `simulate-pay` hanya di non-produksi.
- `POST /internal/invoices` menerima `metadata: { event_id, promotor_org_id?, service_fee? }` → saat PAID dicatat ke `liability:escrow:event:<event_id>` (+ `revenue:service_fee:ticket`); escrow event `reference_id = "event:<event_id>"`. Unik per `(purpose, reference_id)` → panggilan ulang mengembalikan invoice yang sama.
- Pencairan: komisi artis 7% → `revenue:commission:offair`; sisa dialokasikan per split (largest remainder), PPh dipotong per baris → `liability:tax_withholding:pph`, neto → `liability:payable:<party>:offair`.


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

## 9. Platform — Super Admin (REQ-ADM-01, BRD §12.3 "Konfigurasi Kebijakan", §9 durabilitas)

Service `platform` (port **4009**, schema `platform`). Gateway: `/v1/platform` dan `/v1/admin/platform` → platform.
Peran: klaim JWT `roles` memuat `superadmin` (dan `admin`) untuk Super Admin; `admin_role` ∈ `SUPER_ADMIN|OPS|CONTENT_QC|FINANCE|LEGAL|SUPPORT|EDITORIAL`.
**R** = admin mana pun boleh membaca; **W** = hanya Super Admin (`requireSuperAdmin`). Semua W tercatat di audit log.

Registri pengaturan = `packages/domain/src/settings.ts` (`SETTINGS`, `coerceSetting`). Perubahan dipublikasikan sebagai event `platform.settings.updated { changes, version, byUserId }`; setiap service menerapkannya otomatis (`settings.get()` dari service-kit). Gateway mem-polling `/internal/settings`.

| Method & Path | Akses | Body / Query | Respons |
|---|---|---|---|
| `GET /v1/platform/config` | publik | | `{ version, settings: { <kunci public>: nilai } }` (banner, maintenance, modul, preview, upload maks) |
| `GET /v1/admin/platform/settings` | R | | `{ version, values: Record<key, value>, meta: Record<key, { updated_by, updated_at }> }` (registri diambil klien dari `@gema/domain/settings`) |
| `PUT /v1/admin/platform/settings` | W | `{ changes: Record<key, value>, reason: string (min 5) }` | sama seperti GET; `400` bila validasi registri gagal (`errors[{path:key,message}]`) |
| `POST /v1/admin/platform/settings/reset` | W | `{ keys: string[], reason }` | kembali ke default |
| `GET /v1/admin/platform/settings/history` | R | `key?` | `{ data: { id, key, old_value, new_value, reason, by_user_id, by_name, created_at }[] }` |
| `GET /v1/admin/platform/overview` | R | | `PlatformOverview` |
| `GET /v1/admin/platform/storage` | R | | `StorageOverview` |
| `GET /v1/admin/platform/storage/buckets/:bucket/files` | R | `q?, sort=date\|size\|name, order=desc\|asc, cursor?, limit?` | `{ data: StoredFile[], next_cursor, total_files, total_bytes }` |
| `GET /v1/admin/platform/storage/buckets/:bucket/files/:key/download` | R | | biner (attachment) |
| `DELETE /v1/admin/platform/storage/buckets/:bucket/files/:key` | W | `?force=true` untuk file yang masih direferensikan | `{ deleted: true }` / `409` bila direferensikan |
| `POST /v1/admin/platform/storage/buckets/uploads/orphans/scan` | R | | `{ orphans: StoredFile[], bytes }` (file tak direferensikan katalog) |
| `POST /v1/admin/platform/storage/buckets/uploads/orphans/cleanup` | W **Idempotency-Key** | `{ keys?: string[] }` (kosong = semua orphan) | `{ deleted, bytes_freed }` |
| `POST /v1/admin/platform/storage/maintenance` | W | `{ action: "prune_bus"\|"prune_idempotency"\|"vacuum_analyze"\|"snapshot", schema? }` | `{ action, result: object, duration_ms }` |
| `GET /v1/admin/platform/backups` | R | | `{ data: Backup[], schedule: { enabled, interval_hours, keep, next_run_at } }` |
| `POST /v1/admin/platform/backups` | W **Idempotency-Key** | `{ note? }` | `Backup` (status RUNNING → COMPLETED/FAILED, async) |
| `GET /v1/admin/platform/backups/:id/download` | W | | `application/gzip` |
| `DELETE /v1/admin/platform/backups/:id` | W | | `{ deleted: true }` |
| `GET /v1/admin/platform/bus` | R | | `{ topics: { topic, events, last_at }[], consumers: { group, topic, last_seq, head_seq, lag }[], dead_letters: DeadLetter[] }` |
| `POST /v1/admin/platform/bus/dead-letters/retry` | W | `{ group, event_id }` atau `{ all: true }` | `{ requested: n }` (diproses ulang oleh service pemilik group) |
| `DELETE /v1/admin/platform/bus/dead-letters` | W | `{ group, event_id }` | `{ deleted: n }` |

```ts
PlatformOverview = {
  generated_at,
  services: { name, ok, latency_ms, uptime_s, memory_mb, settings_loaded_at, metrics: Record<string, number|string> }[],
  kpis: { users_total, users_7d, artists, orgs, tracks_live, releases_in_review, streams_today, streams_28d,
          bookings_active, bookings_settled, gmv_offair, escrow_held, tickets_sold, ticket_gmv, kyc_pending, disputes_open },
  bus: { events_total, max_lag, dead_letters },
  storage: { disk_used_pct, disk_free_bytes, db_bytes, uploads_bytes, backups_bytes, last_backup_at, warning: boolean },
  alerts: { level: "info"|"warning"|"critical", message, href }[],
  settings_version, maintenance: boolean }
StorageOverview = {
  disk: { path, total_bytes, used_bytes, free_bytes, used_pct, warn_pct },
  buckets: { name: "uploads"|"backups", description, path, files, bytes, quota_bytes, used_pct, by_type: { type, files, bytes }[] }[],
  database: { total_bytes, schemas: { schema, service, bytes, tables, rows_est }[], largest_tables: { schema, table, bytes, rows_est }[] },
  bus: { events, bytes, oldest_at, prunable },
  retention: { bus_days, idempotency_days },
  trend: { at, disk_used_bytes, db_bytes, uploads_bytes, backups_bytes }[] }
StoredFile = { bucket, key, size, content_type, modified_at, url: string|null, referenced: boolean|null }
Backup = { id, filename, status: "RUNNING"|"COMPLETED"|"FAILED", size_bytes, sha256, trigger: "manual"|"schedule", note, error, started_at, finished_at, created_by }
DeadLetter = { group, event_id, topic, error, attempts, failed_at, retry_requested_at }
```

Internal: `GET /internal/settings` (platform, token service) → `{ version, values }`; `GET /internal/stats` (semua service, otomatis dari service-kit) → `{ service, uptime_s, memory_mb, settings_loaded_at, metrics }`; `GET /internal/media/references` (catalog) → `{ files: string[] }` nama file di bucket uploads yang masih dipakai.

IAM tambahan (Super Admin):

| Method & Path | Akses | Body | Respons |
|---|---|---|---|
| `GET /v1/admin/iam/admins` | R | | `{ data: (Me & { admin_role, suspended_at })[] }` |
| `PATCH /v1/admin/iam/users/:id` | W | `{ admin_role?: AdminRole\|null, suspended?: boolean, reason }` | `Me & { admin_role, suspended_at }` (tidak bisa mencabut SUPER_ADMIN terakhir / menangguhkan diri sendiri) |

Pengguna yang ditangguhkan: OTP & refresh ditolak `403`. `Me` kini memuat `admin_role`.

Penegakan di gateway: `maintenance.enabled` → semua non-GET selain `/v1/auth`, `/v1/admin`, `/v1/platform` (dan token admin) dijawab `503 { type: "https://gema.id/problems/maintenance", detail: maintenance.message }`; `modules.booking=false` / `modules.ticketing=false` / `modules.waitlist=false` → non-GET ke prefix terkait `503 { type: ".../module-disabled" }`; rate limit membaca `security.rate_limit_*`.
