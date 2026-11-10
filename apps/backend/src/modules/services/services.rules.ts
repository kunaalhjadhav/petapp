// Pure marketplace rules: availability, money and refunds. Unit tested; no database here.

const IST_MS = 330 * 60_000;
const MIN_MS = 60_000;

/** "2026-10-12" (an India calendar date) → the UTC instant of its midnight in India. */
export function indiaMidnight(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_MS);
}

/** 0 = Sunday … 6 = Saturday, for an India calendar date. */
export function indiaWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface Interval {
  start: Date;
  end: Date;
}
export interface BusyInterval extends Interval {
  slotIndex: number;
}

export interface SlotInput {
  date: string;
  hours: Array<{ opensMin: number; closesMin: number }>;
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  concurrency: number;
  busy: BusyInterval[];
  timeOff: Interval[];
  now: Date;
  /** Bookings must start at least this far ahead. */
  minLeadMin: number;
}

export interface Slot {
  startsAt: Date;
  /** Service end (what the customer sees). */
  serviceEndsAt: Date;
  /** Includes the buffer (what blocks the calendar). */
  blockedUntil: Date;
  slotIndex: number;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Start times that fit inside opening hours, avoid time off, and have a free staff slot. */
export function availableSlots(i: SlotInput): Slot[] {
  const midnight = indiaMidnight(i.date).getTime();
  const earliest = i.now.getTime() + i.minLeadMin * MIN_MS;
  const out: Slot[] = [];
  for (const h of [...i.hours].sort((a, b) => a.opensMin - b.opensMin)) {
    for (let t = h.opensMin; t + i.durationMin <= h.closesMin; t += i.stepMin) {
      const start = new Date(midnight + t * MIN_MS);
      if (start.getTime() < earliest) continue;
      const blocked = {
        start,
        end: new Date(start.getTime() + (i.durationMin + i.bufferMin) * MIN_MS),
      };
      if (i.timeOff.some((o) => overlaps(o, blocked))) continue;
      let free = -1;
      for (let s = 0; s < i.concurrency && free < 0; s++) {
        if (!i.busy.some((b) => b.slotIndex === s && overlaps(b, blocked))) free = s;
      }
      if (free >= 0)
        out.push({
          startsAt: start,
          serviceEndsAt: new Date(start.getTime() + i.durationMin * MIN_MS),
          blockedUntil: blocked.end,
          slotIndex: free,
        });
    }
  }
  return out;
}

/** Platform commission and the partner's share, in paise. */
export function split(pricePaise: number, commissionBps: number) {
  const platformFeePaise = Math.round((pricePaise * commissionBps) / 10_000);
  return { platformFeePaise, partnerEarningPaise: pricePaise - platformFeePaise };
}

export interface RefundPolicy {
  fullRefundHours: number;
  lateRefundPct: number;
}

/**
 * How much of the price goes back:
 * partner/admin cancels → everything; customer cancels ≥ fullRefundHours ahead → everything;
 * later than that → lateRefundPct; after the start → nothing.
 */
export function refundFor(
  pricePaise: number,
  startsAt: Date,
  now: Date,
  by: 'CUSTOMER' | 'PARTNER' | 'ADMIN' | 'SYSTEM',
  p: RefundPolicy,
): number {
  if (by !== 'CUSTOMER') return pricePaise;
  const hoursAhead = (startsAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursAhead >= p.fullRefundHours) return pricePaise;
  if (hoursAhead > 0) return Math.floor((pricePaise * p.lateRefundPct) / 100);
  return 0;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
/** Short code people can read out on the phone: "PB-7KQ2MX". */
export function bookingCode(random: Uint8Array): string {
  return (
    'PB-' + Array.from(random.slice(0, 6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  );
}
