-- Data demo: URL gambar pihak ketiga (picsum.photos, sering tidak terjangkau → sampul/foto/poster rusak) diganti
-- karya demo lokal /v1/catalog/demo-art/<seed>-<W>x<H>.jpg (service catalog). Tidak berefek pada data nyata.
UPDATE artists SET image_url = regexp_replace(image_url, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE image_url LIKE 'https://picsum.photos/seed/rave-%';
UPDATE artists SET cover_url = regexp_replace(cover_url, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE cover_url LIKE 'https://picsum.photos/seed/rave-%';
UPDATE releases SET cover_url = regexp_replace(cover_url, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE cover_url LIKE 'https://picsum.photos/seed/rave-%';
UPDATE shows SET cover_url = regexp_replace(cover_url, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE cover_url LIKE 'https://picsum.photos/seed/rave-%';
UPDATE categories SET image_url = regexp_replace(image_url, 'https://picsum\.photos/seed/(rave-[a-z0-9-]+)/([0-9]+)/([0-9]+)', '/v1/catalog/demo-art/\1-\2x\3.jpg', 'g') WHERE image_url LIKE 'https://picsum.photos/seed/rave-%';
