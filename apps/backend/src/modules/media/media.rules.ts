import type { MediaKind } from '../../generated/prisma/enums';

/** Accepted upload types. Content is re-checked by the worker; the declared type is not trusted. */
export const ALLOWED_MIME: Record<MediaKind, string[]> = {
  // HEIC is not accepted: the standard image library can't decode it. Phones' photo pickers export JPEG.
  IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
  VIDEO: ['video/mp4', 'video/quicktime', 'video/webm'],
  // Private verification documents. Checked by file signature on completion; never processed or public.
  DOCUMENT: ['application/pdf', 'image/jpeg', 'image/png'],
};

/** Leading bytes that identify each document type (the declared type is not trusted). */
export function documentSignatureMatches(mime: string, head: Buffer): boolean {
  if (mime === 'application/pdf') return head.subarray(0, 5).toString('latin1') === '%PDF-';
  if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

export const IMAGE_WIDTHS = [1080, 640, 320] as const;

export const originalKey = (ownerId: string, mediaId: string) => `uploads/${ownerId}/${mediaId}`;
/** Processed copies. Private ones (chat and support photos) are never under the public media/ prefix. */
export const variantPrefix = (mediaId: string, isPrivate = false) => `${isPrivate ? 'private' : 'media'}/${mediaId}/`;

export interface MediaVariants {
  images?: Array<{ width: number; key: string }>;
  hls?: string;
  poster?: string;
}

// ── resumable uploads (Phase 9e) ──

/** Storage's limits for multipart uploads: parts of at least 5 MiB (except the last), at most 10,000 parts. */
export const MIN_PART_BYTES = 5 * 1024 * 1024;
export const MAX_PARTS = 10_000;

/** The part size to use: the setting, raised if needed so the file fits in 10,000 parts. */
export function partSizeFor(sizeBytes: number, preferredBytes: number): number {
  let size = Math.max(MIN_PART_BYTES, preferredBytes);
  while (Math.ceil(sizeBytes / size) > MAX_PARTS) size *= 2;
  return size;
}

export const partCount = (sizeBytes: number, partSize: number) => Math.max(1, Math.ceil(sizeBytes / partSize));

/** The exact length of part n (1-based): full parts, then whatever is left. */
export function partLength(sizeBytes: number, partSize: number, n: number): number {
  const count = partCount(sizeBytes, partSize);
  if (n < 1 || n > count) throw new RangeError(`part ${n} of ${count}`);
  return n < count ? partSize : sizeBytes - partSize * (count - 1);
}

/** Of the parts storage has, those that are complete (the right length); and which are still missing. */
export function uploadProgress(sizeBytes: number, partSize: number, have: Array<{ partNumber: number; size: number }>) {
  const count = partCount(sizeBytes, partSize);
  const ok = new Set(have.filter((p) => p.partNumber >= 1 && p.partNumber <= count && p.size === partLength(sizeBytes, partSize, p.partNumber)).map((p) => p.partNumber));
  const missing: number[] = [];
  let bytes = 0;
  for (let n = 1; n <= count; n++) {
    if (ok.has(n)) bytes += partLength(sizeBytes, partSize, n);
    else missing.push(n);
  }
  return { partCount: count, uploaded: [...ok].sort((a, b) => a - b), missing, uploadedBytes: bytes };
}
