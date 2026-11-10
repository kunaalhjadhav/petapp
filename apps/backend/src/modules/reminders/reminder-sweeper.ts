import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PlatformService } from '../platform/platform.service';
import { QueueService } from '../../queue/queue.service';
import { bookingDue } from './reminders.rules';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Reminders (spec §36), run by the worker every 15 minutes: booked visits coming up, contest submissions and
 * voting closing, and memberships about to end. Each reminder goes out once; people who turned reminders off
 * don't get them (the notification worker checks).
 */
@Injectable()
export class ReminderSweeper {
  private readonly logger = new Logger(ReminderSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
  ) {}

  async sweep(now = new Date()) {
    const [bookings, contests, memberships] = await Promise.all([this.bookings(now), this.contests(now), this.membershipsEnding(now)]);
    if (bookings + contests + memberships) this.logger.log(`reminders: ${bookings} bookings, ${contests} contest entries, ${memberships} memberships`);
    return { bookings, contests, memberships };
  }

  /** A visit coming up. The booking is marked first, so a second sweep (or a second worker) can't remind again. */
  private async bookings(now: Date): Promise<number> {
    const hours = await this.platform.getSetting<number>('reminders.bookingHoursBefore');
    if (!hours || hours <= 0) return 0;
    const due = await this.prisma.booking.findMany({
      where: { status: 'CONFIRMED', remindedAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + hours * HOUR) } },
      select: { id: true, startsAt: true, createdAt: true },
      take: 500,
    });
    let sent = 0;
    for (const b of due) {
      const { count } = await this.prisma.booking.updateMany({ where: { id: b.id, remindedAt: null }, data: { remindedAt: now } });
      if (!count || !bookingDue(b, now, hours)) continue; // marked either way: a last-minute booking isn't reminded later
      this.queue.notify({ type: 'BOOKING_REMINDER', bookingId: b.id });
      sent++;
    }
    return sent;
  }

  /** Entrants who haven't submitted before submissions close; entrants in the running before voting closes. */
  private async contests(now: Date): Promise<number> {
    const hours = await this.platform.getSetting<number>('reminders.contestHoursBefore');
    if (!hours || hours <= 0) return 0;
    const until = new Date(now.getTime() + hours * HOUR);
    const [submit, voting] = await Promise.all([
      this.prisma.contestParticipant.findMany({
        where: { status: 'REGISTERED', contest: { status: 'LIVE', submissionClosesAt: { gt: now, lte: until }, tasks: { some: {} } } },
        select: { id: true }, take: 2000,
      }),
      this.prisma.contestParticipant.findMany({
        where: { status: { in: ['SUBMITTED', 'QUALIFIED', 'FINALIST'] }, contest: { status: 'VOTING', publicWeight: { gt: 0 }, votingClosesAt: { gt: now, lte: until } } },
        select: { id: true }, take: 2000,
      }),
    ]);
    let sent = 0;
    for (const [stage, rows] of [['SUBMIT', submit], ['VOTING', voting]] as const) {
      for (const p of rows) {
        if (!(await this.once(`remind:${stage}:${p.id}`, 14 * DAY))) continue;
        this.queue.notify({ type: 'CONTEST_REMINDER', participantId: p.id, stage });
        sent++;
      }
    }
    return sent;
  }

  /** Paid memberships ending within 3 days with no renewal after them. */
  private async membershipsEnding(now: Date): Promise<number> {
    const ending = await this.prisma.membership.findMany({
      where: { status: 'ACTIVE', source: 'PURCHASE', startsAt: { lte: now }, endsAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY) } },
      select: { id: true, userId: true, endsAt: true },
      take: 1000,
    });
    let sent = 0;
    for (const m of ending) {
      const renewed = await this.prisma.membership.count({ where: { userId: m.userId, status: 'ACTIVE', id: { not: m.id }, endsAt: { gt: m.endsAt! } } });
      if (renewed || !(await this.once(`remind:membership:${m.id}`, 7 * DAY))) continue;
      this.queue.notify({ type: 'MEMBERSHIP_UPDATE', membershipId: m.id, event: 'ENDING' });
      sent++;
    }
    return sent;
  }

  /** Memberships past their end are marked expired; the person hears, unless another membership carries on. */
  async expireMemberships(now = new Date()): Promise<number> {
    const done = await this.prisma.membership.findMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, select: { id: true, userId: true }, take: 1000 });
    let n = 0;
    for (const m of done) {
      const { count } = await this.prisma.membership.updateMany({ where: { id: m.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      if (!count) continue;
      n++;
      const carriesOn = await this.prisma.membership.count({ where: { userId: m.userId, status: 'ACTIVE', endsAt: { gt: now } } });
      if (!carriesOn) this.queue.notify({ type: 'MEMBERSHIP_UPDATE', membershipId: m.id, event: 'EXPIRED' });
    }
    // Checkouts nobody paid for within a day are dropped (their payment orders simply lapse).
    await this.prisma.membership.updateMany({ where: { status: 'PENDING_PAYMENT', createdAt: { lt: new Date(now.getTime() - DAY) } }, data: { status: 'EXPIRED', note: 'Not paid' } });
    return n;
  }

  private async once(key: string, ttlMs: number) {
    return (await this.redis.client.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
  }
}
