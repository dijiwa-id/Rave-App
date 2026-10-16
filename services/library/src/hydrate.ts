import { callService } from '@gema/service-kit';

export interface Track {
  id: string;
  title: string;
  duration_ms: number;
  explicit: boolean;
  isrc: string | null;
  track_number: number;
  play_count: number;
  has_lyrics: boolean;
  artist: { id: string; name: string; slug: string };
  release: { id: string; title: string; cover_url: string | null };
  unavailable?: boolean;
}

const cache = new Map<string, { t: Track; at: number }>();
const TTL = 60_000;
const MAX_ENTRIES = 20_000;

/** Batasi memori cache: buang entri kedaluwarsa; bila masih penuh, kosongkan. */
function prune(now: number) {
  if (cache.size < MAX_ENTRIES) return;
  for (const [k, v] of cache) if (now - v.at >= TTL) cache.delete(k);
  if (cache.size >= MAX_ENTRIES) cache.clear();
}

/** Stub bila katalog tak terjangkau / lagu ditarik, supaya item tetap tampil (graceful degradation). */
function stub(id: string): Track {
  return {
    id,
    title: 'Lagu tidak tersedia',
    duration_ms: 0,
    explicit: false,
    isrc: null,
    track_number: 0,
    play_count: 0,
    has_lyrics: false,
    artist: { id: '', name: '—', slug: '' },
    release: { id: '', title: '', cover_url: null },
    unavailable: true,
  };
}

/** Hidrasi metadata lagu dari catalog-service (batch ≤ 100 per panggilan, cache 60 dtk). */
export async function hydrateTracks(ids: string[], log?: { warn: (o: object, m: string) => void }): Promise<Map<string, Track>> {
  const out = new Map<string, Track>();
  const now = Date.now();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const c = cache.get(id);
    if (c && now - c.at < TTL) out.set(id, c.t);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const r = await callService<{ data: Track[] }>('library', 'catalog', `/v1/catalog/tracks?ids=${chunk.join(',')}`);
      prune(now);
      for (const t of r.data ?? []) {
        out.set(t.id, t);
        cache.set(t.id, { t, at: now });
      }
    } catch (e: any) {
      log?.warn({ err: e?.message }, 'hidrasi catalog gagal — memakai stub');
    }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, stub(id));
  return out;
}
