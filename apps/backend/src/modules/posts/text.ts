/**
 * Hashtags in a caption, case-insensitive, at most 30 per post.
 * Tag characters are letters, combining marks (needed for Indic scripts: the vowel signs in
 * "कुत्ता" are marks, not letters), numbers and underscore. A tag must start the caption or
 * follow whitespace or an opening bracket/quote, so "example.com/#anchor" and "C#" don't count.
 */
export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const tags = new Set<string>();
  for (const m of caption.matchAll(/(^|[\s([{"'“‘])#([\p{L}\p{M}\p{N}_]{1,50})/gu)) {
    const tag = m[2].toLowerCase();
    if (!/^\d+$/.test(tag)) tags.add(tag); // "#1" is not a hashtag
    if (tags.size === 30) break;
  }
  return [...tags];
}

/** Cursor for keyset pagination: base64url("<iso date>|<uuid>"). */
export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor?: string): { date: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/.test(id) ? null : { date, id };
  } catch {
    return null;
  }
}

/** Offset cursor for ranked lists (scores change between requests, so keyset doesn't fit). */
export const encodeOffset = (n: number) => Buffer.from(`o:${n}`).toString('base64url');
export function decodeOffset(cursor?: string): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString());
  return m ? Number(m[1]) : 0;
}
