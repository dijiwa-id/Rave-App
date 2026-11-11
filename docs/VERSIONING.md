# Versioning & rilis RAVE

## Aturan

- **Satu versi untuk seluruh platform** ([SemVer 2.0](https://semver.org/lang/id/)): web, gateway, dan 11 service dirilis bersama.
  Sumber kebenaran: `version` di `package.json` root. Semua workspace disamakan otomatis oleh `npm run release`.
- **Tag git** `vX.Y.Z` (beranotasi) menandai rilis. Prarilis: `vX.Y.Z-rc.N`.
- **Commit** memakai [Conventional Commits](https://www.conventionalcommits.org/id/v1.0.0/) (sudah dipakai di repo ini):
  `feat(booking): ...`, `fix(web): ...`, `perf:`, `refactor:`, `docs:`, `build:`, `ci:`, `chore:`.
  Perubahan tidak kompatibel: `feat(api)!: ...` atau baris `BREAKING CHANGE:` di badan commit.

| Bump | Kapan | Contoh |
| --- | --- | --- |
| MAJOR | Kontrak API `/v1` berubah tidak kompatibel, migrasi data yang butuh langkah manual | `1.4.2 → 2.0.0` |
| MINOR | Fitur baru, endpoint baru, migrasi aditif | `1.4.2 → 1.5.0` |
| PATCH | Perbaikan bug, keamanan, performa | `1.4.2 → 1.4.3` |

Selama `0.x`, breaking change menaikkan MINOR (`release auto` menangani ini).

## Membuat rilis

```bash
npm run release:dry                 # pratinjau: versi berikut + isi CHANGELOG, tanpa mengubah apa pun
npm run release -- auto             # bump dari commit (feat → minor, fix → patch, ! → major)
npm run release -- patch            # atau minor | major | 1.0.0
npm run release -- prerelease --preid rc   # 1.0.0-rc.0, 1.0.0-rc.1, ...
git push --follow-tags              # memicu .github/workflows/release.yml
```

`npm run release` mensyaratkan working tree bersih, lalu: menghitung versi → menulis bagian baru `CHANGELOG.md`
(catatan manual di bawah `## [Unreleased]` ikut dipindahkan ke rilis) → `npm version` untuk semua workspace + lockfile
→ commit `chore(release): vX.Y.Z` → tag `vX.Y.Z`. Push dilakukan manual setelah ditinjau.

## Apa yang terjadi saat tag di-push

Workflow **Release** (`.github/workflows/release.yml`):

1. Menolak tag yang tidak sama dengan `package.json` (mencegah tag manual yang salah).
2. Membangun 13 image dan mendorong ke GHCR:
   `ghcr.io/<owner>/rave-<komponen>:X.Y.Z`, `:X.Y`, `:sha-<commit>`, dan `:latest` (hanya versi stabil, bukan `-rc`).
3. Membuat GitHub Release dengan catatan dari `CHANGELOG.md`.

## Versi di runtime

| Tempat | Isi |
| --- | --- |
| Build arg image | `APP_VERSION`, `GIT_SHA`, `BUILD_DATE` → env + label OCI `org.opencontainers.image.version/revision/created` |
| `GET /healthz` & `/readyz` tiap service | `version` (dan `commit` di `/healthz`) |
| `GET /v1/version` (gateway, publik) | `{ version, commit, built_at }` |
| `GET /v1/status` (gateway) | versi per service + `version_drift` (service yang versinya berbeda dari gateway) |
| `/version.json` (nginx web) | versi aset web yang sedang dilayani |
| Back Office → Dasbor → Kesehatan | `Web vX · API vY`, peringatan merah bila versi tidak seragam |
| Web (kode) | `__APP_VERSION__` / `__GIT_SHA__` (`apps/web/src/lib/version.ts`) |

Di dev (tanpa build arg) versi dibaca dari `package.json`, commit = `dev`.

## Migrasi database & kompatibilitas

- Migrasi bersifat **maju saja** (`services/*/migrations/NNN_*.sql`, dijalankan otomatis saat service start, dikunci
  advisory lock sehingga aman untuk banyak replika). Jangan mengubah file migrasi yang sudah dirilis — buat file baru.
- Agar rollback image aman, pakai pola **expand → contract**: rilis N menambah kolom/tabel (versi lama tetap jalan),
  rilis N+1 baru menghapus yang lama. Migrasi yang tidak kompatibel mundur = MAJOR dan wajib dicatat di CHANGELOG.
