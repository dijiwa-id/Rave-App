-- Data demo: URL gambar pihak ketiga (picsum.photos, sering tidak terjangkau → sampul/foto/poster rusak) diganti
-- karya demo lokal /v1/catalog/demo-art/<seed>-<W>x<H>.jpg (service catalog). Tidak berefek pada data nyata.
UPDATE streams SET artist_image = regexp_replace(artist_image, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE artist_image LIKE 'https://picsum.photos/seed/rave-%';
