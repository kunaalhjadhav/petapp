import { MIN_PART_BYTES, partCount, partLength, partSizeFor, uploadProgress } from './media.rules';

const MB = 1024 * 1024;

describe('resumable upload parts', () => {
  it('splits a file into parts of the chosen size, the last one shorter', () => {
    expect(partCount(20 * MB + 1, 8 * MB)).toBe(3);
    expect(partLength(20 * MB + 1, 8 * MB, 1)).toBe(8 * MB);
    expect(partLength(20 * MB + 1, 8 * MB, 3)).toBe(4 * MB + 1);
    expect(partCount(16 * MB, 8 * MB)).toBe(2);
    expect(partLength(16 * MB, 8 * MB, 2)).toBe(8 * MB);
    expect(() => partLength(16 * MB, 8 * MB, 3)).toThrow(RangeError);
  });

  it('keeps parts within storage limits', () => {
    expect(partSizeFor(100 * MB, 1 * MB)).toBe(MIN_PART_BYTES);
    expect(partSizeFor(100 * MB, 8 * MB)).toBe(8 * MB);
    expect(partCount(200_000 * MB, partSizeFor(200_000 * MB, 8 * MB))).toBeLessThanOrEqual(10_000);
  });

  it('works out what is still missing, counting only complete parts', () => {
    const size = 20 * MB + 1;
    const p = uploadProgress(size, 8 * MB, [
      { partNumber: 1, size: 8 * MB },
      { partNumber: 2, size: 3 * MB }, // cut off: sent again
      { partNumber: 3, size: 4 * MB + 1 },
      { partNumber: 9, size: 8 * MB }, // not a part of this file
    ]);
    expect(p).toEqual({ partCount: 3, uploaded: [1, 3], missing: [2], uploadedBytes: 12 * MB + 1 });
  });
});
