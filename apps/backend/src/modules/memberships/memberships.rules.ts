// Pure membership rules (spec §40): which membership is current, what it gives, and whether one can be bought.
// No I/O; unit-tested.

const DAY_MS = 86_400_000;

export interface PlanBenefits {
  exclusiveContests: boolean;
  premiumChallenges: boolean;
  memberDiscounts: boolean;
  priorityDays: number;
  badge: boolean;
}
export interface PlanLike extends PlanBenefits {
  id: string;
  key: string;
  name: string;
  rank: number;
  pricePaise: number;
  periodDays: number;
  isActive: boolean;
}
export interface MembershipLike {
  id: string;
  planId: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

export const NO_BENEFITS: PlanBenefits = { exclusiveContests: false, premiumChallenges: false, memberDiscounts: false, priorityDays: 0, badge: false };

/** Running now: active, started, not ended. */
export const isCurrent = (m: MembershipLike, now: Date) =>
  m.status === 'ACTIVE' && !!m.startsAt && !!m.endsAt && m.startsAt <= now && m.endsAt > now;

/** The membership in force now; with overlaps (a staff grant), the one ending last. */
export function currentOf<T extends MembershipLike>(list: T[], now: Date): T | null {
  return list.filter((m) => isCurrent(m, now)).sort((a, b) => b.endsAt!.getTime() - a.endsAt!.getTime())[0] ?? null;
}

/** Paid-for periods of a plan still to come (renewals). */
export function upcomingOf<T extends MembershipLike>(list: T[], now: Date): T[] {
  return list.filter((m) => m.status === 'ACTIVE' && !!m.startsAt && m.startsAt > now).sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());
}

/** Benefits of every running membership together (the best of each). */
export function benefitsOf(plans: PlanBenefits[]): PlanBenefits {
  return plans.reduce<PlanBenefits>((a, p) => ({
    exclusiveContests: a.exclusiveContests || p.exclusiveContests,
    premiumChallenges: a.premiumChallenges || p.premiumChallenges,
    memberDiscounts: a.memberDiscounts || p.memberDiscounts,
    priorityDays: Math.max(a.priorityDays, p.priorityDays),
    badge: a.badge || p.badge,
  }), NO_BENEFITS);
}

/** Benefits in words, in a fixed order, for plan cards. */
export function benefitLines(p: PlanBenefits): string[] {
  return [
    p.exclusiveContests ? 'Members-only contests' : null,
    p.premiumChallenges ? 'Premium challenges' : null,
    p.memberDiscounts ? 'Member discounts in the shop' : null,
    p.priorityDays > 0 ? `Book services up to ${p.priorityDays} days earlier than everyone else` : null,
    p.badge ? 'Member badge on your profile' : null,
  ].filter((x): x is string => x !== null);
}

/**
 * When a newly bought period starts and ends, or why it can't be bought. Someone can renew their current plan in
 * advance (up to maxPeriodsAhead periods paid ahead); switching to another plan waits until the current one ends.
 */
export function purchaseWindow(
  plan: Pick<PlanLike, 'id' | 'name' | 'periodDays' | 'pricePaise' | 'isActive'>,
  mine: MembershipLike[],
  now: Date,
  maxPeriodsAhead: number,
  currentPlanName?: string,
): { startsAt: Date; endsAt: Date } | { problem: string } {
  if (!plan.isActive) return { problem: 'This plan isn’t available.' };
  if (plan.pricePaise <= 0) return { problem: 'This plan is free; there’s nothing to buy.' };
  const live = mine.filter((m) => m.status === 'ACTIVE' && m.endsAt && m.endsAt > now);
  const other = live.find((m) => m.planId !== plan.id);
  if (other) {
    const until = other.endsAt!.toISOString().slice(0, 10);
    return { problem: `Your ${currentPlanName ?? 'current'} membership runs until ${until}. You can switch plans when it ends.` };
  }
  const last = live.reduce<Date | null>((a, m) => (!a || m.endsAt! > a ? m.endsAt! : a), null);
  const startsAt = last ?? now;
  const ahead = live.filter((m) => m.startsAt && m.startsAt > now).length;
  if (ahead >= maxPeriodsAhead) return { problem: `You’ve already paid ${maxPeriodsAhead === 1 ? 'one period' : `${maxPeriodsAhead} periods`} ahead.` };
  return { startsAt, endsAt: new Date(startsAt.getTime() + plan.periodDays * DAY_MS) };
}

/** Plan keys: capitals, digits and underscores. */
export const PLAN_KEY = /^[A-Z][A-Z0-9_]{1,29}$/;
