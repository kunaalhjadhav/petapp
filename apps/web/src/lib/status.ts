import type { Challenge, Contest } from './types';

/** Where a contest is, in words, for its page. */
export function contestStage(c: Contest, now = Date.now()): string {
  const t = (iso: string | null) => (iso ? Date.parse(iso) : 0);
  switch (c.status) {
    case 'CANCELLED':
      return 'Cancelled';
    case 'COMPLETED':
      return 'Finished: winners announced';
    case 'WINNER_DECLARATION':
    case 'EVALUATION':
      return 'Entries closed: results coming soon';
    case 'VOTING':
      return 'Voting is open';
    default:
      if (now < t(c.registrationOpensAt)) return 'Entries open soon';
      if (now <= t(c.registrationClosesAt)) return 'Entries are open';
      return 'Entries closed';
  }
}

export function challengeStage(c: Challenge, now = Date.now()): string {
  if (c.status === 'CANCELLED') return 'Cancelled';
  if (c.status === 'ENDED' || now > Date.parse(c.endsAt)) return 'Finished';
  if (now < Date.parse(c.startsAt)) return 'Starts soon';
  return 'Running now';
}
