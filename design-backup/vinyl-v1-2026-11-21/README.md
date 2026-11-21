# Backup desain vinyl v1 (sebelum refine vintage/hyperrealistic, 2026-11-21)

Salinan persis file pada commit `149a760` (file ini belum diubah saat dicadangkan).

## Rollback (dari root repo)

```bash
(cd design-backup/vinyl-v1-2026-11-21 && find . -type f ! -name README.md -exec cp --parents {} ../../ \;) && git status
# atau lewat git:
git checkout 149a760 -- apps/web/src/components/ui/index.tsx apps/web/src/index.css apps/web/src/layouts/shell/NowPlayingPanel.tsx apps/web/src/pages/fan/Lyrics.tsx apps/web/src/pages/public/Turntable.tsx apps/web/src/pages/public/Vinyl.tsx 
```

Lalu hapus aset tekstur baru bila tak dipakai lagi (mis. `textures/vinyl-*.webp`).

## File
- `apps/web/src/components/ui/index.tsx`
- `apps/web/src/index.css`
- `apps/web/src/layouts/shell/NowPlayingPanel.tsx`
- `apps/web/src/pages/fan/Lyrics.tsx`
- `apps/web/src/pages/public/Turntable.tsx`
- `apps/web/src/pages/public/Vinyl.tsx`
