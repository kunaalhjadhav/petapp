import { decodeCursor, decodeOffset, encodeCursor, encodeOffset, extractHashtags } from './text';

describe('extractHashtags', () => {
  it('finds tags, lower-cases and de-duplicates', () => {
    expect(extractHashtags('Beach day! #GoldenRetriever #beach #Beach')).toEqual(['goldenretriever', 'beach']);
  });
  it('supports Indian scripts, whose vowel signs are combining marks', () => {
    expect(extractHashtags('मेरा कुत्ता #कुत्ता #pet_life')).toEqual(['कुत्ता', 'pet_life']);
    expect(extractHashtags('#நாய் and #বিড়াল')).toEqual(['நாய்', 'বিড়াল']);
  });
  it('accepts tags after brackets and quotes', () => {
    expect(extractHashtags('(#walk) "#treats"')).toEqual(['walk', 'treats']);
  });
  it('ignores numbers, URL fragments and mid-word hashes', () => {
    expect(extractHashtags('Rank #1, see example.com/#anchor and C#sharp')).toEqual([]);
  });
  it('handles empty captions and caps at 30', () => {
    expect(extractHashtags(undefined)).toEqual([]);
    expect(extractHashtags(Array.from({ length: 40 }, (_, i) => `#t${i}`).join(' '))).toHaveLength(30);
  });
});

describe('cursors', () => {
  it('round-trips keyset cursors and rejects junk', () => {
    const d = new Date('2026-10-01T10:00:00.000Z');
    const id = '0b9f0c1e-1111-4222-8333-944455556666';
    expect(decodeCursor(encodeCursor(d, id))).toEqual({ date: d, id });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from("2026|'; DROP TABLE").toString('base64url'))).toBeNull();
  });
  it('round-trips offsets', () => {
    expect(decodeOffset(encodeOffset(40))).toBe(40);
    expect(decodeOffset('garbage')).toBe(0);
  });
});
