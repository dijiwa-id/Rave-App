-- Data demo: URL gambar pihak ketiga (picsum.photos, sering tidak terjangkau → sampul/foto/poster rusak) diganti
-- karya demo lokal /v1/catalog/demo-art/<seed>-<W>x<H>.jpg (service catalog). Tidak berefek pada data nyata.
UPDATE playlists SET cover_url = regexp_replace(cover_url, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE cover_url LIKE 'https://picsum.photos/seed/rave-%';
