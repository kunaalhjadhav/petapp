import type { PrismaClient } from '../../generated/prisma/client';

/**
 * Starting plans (spec §40): Free, Plus and Premium. Only created when missing; prices, periods and benefits are
 * edited in the dashboard (Memberships → Plans). Nothing is members-only, and plans can't be bought, until
 * ENABLE_MEMBERSHIPS is on and an admin marks contests, challenges or coupons as members-only.
 */
export const DEFAULT_PLANS = [
  { key: 'FREE', name: 'Free', rank: 0, pricePaise: 0, periodDays: 30, description: 'Everything in PetApp that isn’t members-only.', exclusiveContests: false, premiumChallenges: false, memberDiscounts: false, priorityDays: 0, badge: false },
  { key: 'PLUS', name: 'Plus', rank: 10, pricePaise: 14900, periodDays: 30, description: 'Members-only contests and challenges, and member discounts.', exclusiveContests: true, premiumChallenges: true, memberDiscounts: true, priorityDays: 0, badge: true },
  { key: 'PREMIUM', name: 'Premium', rank: 20, pricePaise: 39900, periodDays: 30, description: 'Everything in Plus, and book services before everyone else.', exclusiveContests: true, premiumChallenges: true, memberDiscounts: true, priorityDays: 30, badge: true },
];

export async function seedMembershipPlans(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const p of DEFAULT_PLANS) {
    const exists = await prisma.membershipPlan.findUnique({ where: { key: p.key }, select: { id: true } });
    if (exists) continue;
    await prisma.membershipPlan.create({ data: p });
    created++;
  }
  return created;
}
