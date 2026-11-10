// Pure rules for reminders and promotions (spec §36). No I/O; unit-tested.

const HOUR = 3_600_000;

/**
 * Whether a booked visit is due a reminder now: it starts within the reminder window, and it wasn't booked so
 * close to the start that a reminder would just repeat the confirmation (less than 3 hours before).
 */
export function bookingDue(b: { startsAt: Date; createdAt: Date }, now: Date, hoursBefore: number): boolean {
  if (hoursBefore <= 0) return false;
  if (b.startsAt <= now || b.startsAt.getTime() > now.getTime() + hoursBefore * HOUR) return false;
  return b.startsAt.getTime() - b.createdAt.getTime() >= 3 * HOUR;
}

/** App links a promotion may open: a path inside the app, like /contest/summer-smiles or /shop. */
export const PROMO_LINK = /^\/[a-z0-9][a-z0-9\-_/]{0,150}$/;
export const PROMO_AUDIENCES = ['ALL', 'MEMBERS', 'CITY'] as const;

/** What's wrong with a promotion before it's queued, or null. */
export function promotionProblem(p: { title: string; body: string; link?: string | null; audience: string; city?: string | null; sendAt?: Date | null }, now: Date): string | null {
  if (p.title.trim().length < 3) return 'Give it a title of at least 3 characters.';
  if (p.body.trim().length < 5) return 'Write a message of at least 5 characters.';
  if (p.link && !PROMO_LINK.test(p.link)) return 'The link must be a page in the app, like /contest/summer-smiles or /shop.';
  if (p.audience === 'CITY' && !p.city?.trim()) return 'Choose the city it goes to.';
  if (p.sendAt && p.sendAt.getTime() > now.getTime() + 30 * 24 * HOUR) return 'Schedule it at most 30 days ahead.';
  return null;
}
