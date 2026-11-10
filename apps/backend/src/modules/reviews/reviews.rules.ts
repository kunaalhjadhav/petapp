// Reviews and ratings (spec §38): the rules, kept free of the database so they can be unit-tested.

/** Photos on one review. */
export const REVIEW_PHOTO_MAX = 4;
/** Screenshots or photos attached to one report. */
export const REPORT_EVIDENCE_MAX = 3;

/** A parcel the customer received: delivered, or delivered and then sent back. Only these prove a purchase. */
export const RECEIVED_PARCEL = ['DELIVERED', 'RETURN_REQUESTED', 'RETURNED'] as const;

export function parcelReceived(status: string, deliveredAt: Date | null): boolean {
  return !!deliveredAt && (RECEIVED_PARCEL as readonly string[]).includes(status);
}

/** Averages are shown with one decimal; no reviews is 0. */
export function roundRating(avg: number | null | undefined): number {
  return avg ? Math.round(avg * 10) / 10 : 0;
}

export interface RatingSummary {
  avg: number;
  count: number;
  /** Always five rows, 5 stars first. */
  stars: Array<{ stars: number; count: number }>;
}

export function ratingSummary(rows: Array<{ rating: number; count: number }>): RatingSummary {
  const stars = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: rows.filter((r) => r.rating === n).reduce((a, r) => a + r.count, 0) }));
  const count = stars.reduce((a, s) => a + s.count, 0);
  const total = stars.reduce((a, s) => a + s.stars * s.count, 0);
  return { avg: roundRating(count ? total / count : 0), count, stars };
}

export type ReviewSort = 'recent' | 'highest' | 'lowest';

export function reviewOrder(sort: ReviewSort | undefined): Array<Record<string, 'asc' | 'desc'>> {
  if (sort === 'highest') return [{ rating: 'desc' }, { createdAt: 'desc' }];
  if (sort === 'lowest') return [{ rating: 'asc' }, { createdAt: 'desc' }];
  return [{ createdAt: 'desc' }];
}

/** Text is optional, but a review that says nothing and shows nothing still counts as a rating. */
export function needsAiCheck(comment: string | null | undefined, photoIds: string[]): boolean {
  return !!comment?.trim() || photoIds.length > 0;
}

/** "Riya Sharma" → "Riya S." — reviews are public, so only a first name and initial are shown. */
export function reviewerName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'PetApp user';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
