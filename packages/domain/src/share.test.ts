import { describe, expect, it } from 'vitest';
import { parseHashtags, renderShareText, shareIntentUrl } from './share';

describe('share', () => {
  it('template mengganti variabel & memangkas spasi', () => {
    expect(renderShareText('Lagi dengerin "{title}"  dari {artist} di {app}', { title: 'Senja', artist: 'Kolektif', app: 'RAVE' })).toBe('Lagi dengerin "Senja" dari Kolektif di RAVE');
    expect(renderShareText('{title}'.repeat(100), { title: 'abcdef', artist: '' }).length).toBeLessThanOrEqual(240);
  });
  it('tagar: tanpa #, unik, karakter aman, maks 5', () => {
    expect(parseHashtags('#RAVE, Musik Indie,RAVE, a-b, x,y,z,w')).toEqual(['RAVE', 'Musik', 'Indie', 'ab', 'x']);
    expect(parseHashtags('')).toEqual([]);
  });
  it('intent X & Facebook ter-encode; Instagram null', () => {
    const s = { url: 'https://rave.id/s/t/1', text: 'Dengar "A&B"', hashtags: ['RAVE'] };
    const x = new URL(shareIntentUrl('x', s)!);
    expect(x.searchParams.get('text')).toBe('Dengar "A&B"');
    expect(x.searchParams.get('url')).toBe(s.url);
    expect(x.searchParams.get('hashtags')).toBe('RAVE');
    expect(new URL(shareIntentUrl('facebook', s)!).searchParams.get('u')).toBe(s.url);
    expect(shareIntentUrl('instagram', s)).toBeNull();
  });
});
