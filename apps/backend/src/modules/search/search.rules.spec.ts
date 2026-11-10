import { cleanQuery, distanceText, matchRank } from './search.rules';

describe('search rules', () => {
  it('cleans queries', () => {
    expect(cleanQuery('  #Golden   Retriever ')).toEqual({ text: 'Golden Retriever', hashtag: true, handle: false });
    expect(cleanQuery('@bruno.3fa')).toEqual({ text: 'bruno.3fa', hashtag: false, handle: true });
    expect(cleanQuery('a')).toBeNull();
    expect(cleanQuery('#')).toBeNull();
    expect(cleanQuery(null)).toBeNull();
    expect(cleanQuery('x'.repeat(80))!.text).toHaveLength(60);
  });

  it('ranks exact, prefix, word and contains matches', () => {
    expect(matchRank('Bruno', 'bruno')).toBe(0);
    expect(matchRank('Brunowski', 'bruno')).toBe(1);
    expect(matchRank('Big Bruno', 'bru')).toBe(2);
    expect(matchRank('Abrupt', 'bru')).toBe(3);
    expect(matchRank('Coco', 'bru')).toBe(4);
    expect(matchRank(null, 'x')).toBe(4);
  });

  it('words distances', () => {
    expect(distanceText(40)).toBe('100 m');
    expect(distanceText(840)).toBe('800 m');
    expect(distanceText(1240)).toBe('1.2 km');
    expect(distanceText(null)).toBeNull();
  });
});
