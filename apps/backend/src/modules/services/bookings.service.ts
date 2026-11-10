import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { PlatformService } from '../platform/platform.service';
import { FinanceService } from '../finance/finance.service';
import { InvoicesService } from '../finance/invoices.service';
import { QueueService } from '../../queue/queue.service';
import { MembershipsService } from '../memberships/memberships.service';
import { ReviewsService } from '../reviews/reviews.service';
import { assertReviewPhotos, recomputePartnerRating } from '../reviews/ratings';
import { needsAiCheck } from '../reviews/reviews.rules';
import { Paged } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import type { BookingStatus } from '../../generated/prisma/enums';
import {
  availableSlots,
  bookingCode,
  indiaMidnight,
  indiaWeekday,
  refundFor,
  split,
} from './services.rules';
import type { BookingDto, BookingsQuery, NearbyQuery, ReviewDto } from './services.dto';

const ACTIVE: BookingStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'];
const DAY_MS = 86_400_000;

/** Great-circle distance in km (home-visit radius check). */
function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "2026-10-12" for an instant, in India time. */
const indiaDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

@Injectable()
export class BookingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly platform: PlatformService,
    private readonly queue: QueueService,
    private readonly finance: FinanceService,
    private readonly invoices: InvoicesService,
    private readonly reviews: ReviewsService,
    private readonly memberships: MembershipsService,
  ) {}

  onModuleInit() {
    this.payments.registerSettler('SERVICE_BOOKING', async (tx, payment) => {
      const r = await this.settlePaid(tx, payment.id);
      const b = await tx.booking.findUnique({
        where: { paymentId: payment.id },
        select: { id: true },
      });
      if (r === 'confirmed' && b) this.queue.notify({ type: 'BOOKING_CONFIRMED', bookingId: b.id });
      return r === 'confirmed' ? 'ok' : 'refund';
    });
  }

  // ══════════════ discovery ══════════════

  /** Approved partners near a point, using PostGIS (geography distance in metres). */
  async nearby(q: NearbyQuery) {
    const radiusKm =
      q.radiusKm ?? (await this.platform.getSetting<number>('services.searchRadiusKm'));
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography`;
    const cat = q.categoryId
      ? Prisma.sql`AND s."categoryId" = ${q.categoryId}::uuid`
      : Prisma.empty;
    const mode = q.mode ? Prisma.sql`AND ${q.mode}::"ServiceMode" = ANY(s."modes")` : Prisma.empty;
    const order =
      q.sort === 'rating' ? Prisma.sql`p."ratingAvg" DESC, meters ASC` : Prisma.sql`meters ASC`;
    const where = Prisma.sql`p."status" = 'APPROVED' AND ST_DWithin(p."location", ${point}, ${radiusKm * 1000})`;
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; meters: number; fromPaise: number }>
    >`
      SELECT p."id", ST_Distance(p."location", ${point}) AS meters, MIN(s."pricePaise")::int AS "fromPaise"
      FROM "ServicePartner" p
      JOIN "PartnerService" s ON s."partnerId" = p."id" AND s."isActive" ${cat} ${mode}
      WHERE ${where}
      GROUP BY p."id"
      ORDER BY ${order}
      LIMIT ${q.limit} OFFSET ${q.skip}`;
    const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT p."id")::int AS n FROM "ServicePartner" p
      JOIN "PartnerService" s ON s."partnerId" = p."id" AND s."isActive" ${cat} ${mode}
      WHERE ${where}`;
    const partners = await this.prisma.servicePartner.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: {
        id: true,
        slug: true,
        businessName: true,
        area: true,
        city: true,
        ratingAvg: true,
        ratingCount: true,
        homeVisitRadiusKm: true,
      },
    });
    const byId = new Map(partners.map((p) => [p.id, p]));
    return Paged.of(
      rows.map((r) => ({
        ...byId.get(r.id)!,
        distanceKm: Math.round(r.meters / 100) / 10,
        fromPaise: r.fromPaise,
      })),
      n,
      q,
    );
  }

  async partnerPage(idOrSlug: string) {
    const p = await this.prisma.servicePartner.findFirst({
      where: {
        status: 'APPROVED',
        OR: [{ slug: idOrSlug }, ...(/^[0-9a-f-]{36}$/.test(idOrSlug) ? [{ id: idOrSlug }] : [])],
      },
      include: {
        services: {
          where: { isActive: true },
          include: { category: { select: { id: true, name: true } } },
          orderBy: { pricePaise: 'asc' },
        },
        hours: { orderBy: [{ weekday: 'asc' }, { opensMin: 'asc' }] },
      },
    });
    if (!p) throw new NotFoundException('Partner not found.');
    return {
      id: p.id,
      slug: p.slug,
      businessName: p.businessName,
      kind: p.kind,
      about: p.about,
      area: p.area,
      city: p.city,
      addressLine: p.addressLine,
      lat: p.lat,
      lng: p.lng,
      homeVisitRadiusKm: p.homeVisitRadiusKm,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      services: p.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        durationMin: s.durationMin,
        pricePaise: s.pricePaise,
        modes: s.modes,
        speciesIds: s.speciesIds,
      })),
      hours: p.hours.map((h) => ({
        weekday: h.weekday,
        opensMin: h.opensMin,
        closesMin: h.closesMin,
      })),
      ...(await this.reviewBlock(p.id)),
    };
  }

  private async reviewOfBooking(r: { id: string; rating: number; comment: string | null; photoIds: string[]; reply: string | null; repliedAt: Date | null; status: string; createdAt: Date }) {
    const [v] = await this.reviews.views([{ ...r, customer: { name: null } }]);
    return { id: r.id, rating: r.rating, comment: r.comment, reply: r.reply, repliedAt: r.repliedAt, status: r.status, photos: v.photos, at: r.createdAt };
  }

  /** The partner page's reviews: the star breakdown and the latest five. */
  private async reviewBlock(partnerId: string) {
    const { summary, recent } = await this.reviews.partnerBlock(partnerId);
    return { ratingSummary: summary, reviews: recent };
  }

  // ══════════════ availability ══════════════

  /** Unpaid bookings past the payment hold stop holding their slot. */
  private async expireStale(tx: Prisma.TransactionClient | PrismaService, partnerId?: string) {
    const holdMin = await this.platform.getSetting<number>('services.paymentHoldMinutes');
    await tx.booking.updateMany({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lt: new Date(Date.now() - holdMin * 60_000) },
        ...(partnerId ? { partnerId } : {}),
      },
      data: { status: 'EXPIRED' },
    });
  }

  /** `customerId`: a member with priority booking can book further ahead than everyone else (spec §40). */
  private async slotsFor(
    tx: Prisma.TransactionClient | PrismaService,
    serviceId: string,
    date: string,
    customerId?: string,
  ) {
    const s = await tx.partnerService.findFirst({
      where: { id: serviceId, isActive: true, partner: { status: 'APPROVED' } },
      include: { partner: { include: { hours: true } } },
    });
    if (!s) throw new NotFoundException('Service not found.');
    const [minLead, baseDays, priorityDays] = await Promise.all([
      this.platform.getSetting<number>('services.minLeadMinutes'),
      this.platform.getSetting<number>('services.maxDaysAhead'),
      this.memberships.priorityDays(customerId),
    ]);
    const maxDays = baseDays + priorityDays;
    const dayStart = indiaMidnight(date);
    const now = new Date();
    if (dayStart.getTime() > now.getTime() + maxDays * DAY_MS) return { service: s, slots: [] };
    const dayEnd = new Date(dayStart.getTime() + DAY_MS + 24 * 3_600_000); // services can run past midnight
    const [busy, off] = await Promise.all([
      tx.booking.findMany({
        where: {
          partnerId: s.partnerId,
          status: { in: ACTIVE },
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: { startsAt: true, endsAt: true, slotIndex: true },
      }),
      tx.partnerTimeOff.findMany({
        where: { partnerId: s.partnerId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      }),
    ]);
    const slots = availableSlots({
      date,
      hours: s.partner.hours.filter((h) => h.weekday === indiaWeekday(date)),
      durationMin: s.durationMin,
      bufferMin: s.bufferMin,
      stepMin: s.partner.slotStepMin,
      concurrency: s.partner.concurrency,
      now,
      minLeadMin: minLead,
      busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt, slotIndex: b.slotIndex })),
      timeOff: off.map((o) => ({ start: o.startsAt, end: o.endsAt })),
    });
    return { service: s, slots };
  }

  async slots(serviceId: string, date: string, customerId?: string) {
    await this.expireStale(this.prisma);
    const { service, slots } = await this.slotsFor(this.prisma, serviceId, date, customerId);
    return {
      serviceId,
      date,
      durationMin: service.durationMin,
      slots: slots.map((x) => ({ startsAt: x.startsAt, endsAt: x.serviceEndsAt })),
    };
  }

  // ══════════════ booking ══════════════

  async book(customerId: string, dto: BookingDto) {
    const pet = await this.prisma.pet.findFirst({
      where: { id: dto.petId, ownerId: customerId, deletedAt: null },
    });
    if (!pet) throw new NotFoundException('Pet not found.');
    const startsAt = new Date(dto.startsAt);

    // Release expired unpaid holds BEFORE computing free slots (otherwise a slot the app shows as free
    // is refused as "no longer available"). Done outside the booking transaction: it is idempotent
    // housekeeping, and holding its row locks inside the transaction made concurrent bookings deadlock.
    const owner = await this.prisma.partnerService.findUnique({ where: { id: dto.serviceId }, select: { partnerId: true } });
    if (owner) await this.expireStale(this.prisma, owner.partnerId);

    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const booking = await this.prisma.$transaction(async (tx) => {
          const { service: s, slots } = await this.slotsFor(tx, dto.serviceId, indiaDate(startsAt), customerId);
          if (s.partner.userId === customerId)
            throw new BadRequestException('You can’t book your own service.');
          if (s.speciesIds.length && !s.speciesIds.includes(pet.speciesId))
            throw new BadRequestException(`This service isn’t offered for ${pet.name}’s species.`);
          if (!s.modes.includes(dto.mode))
            throw new BadRequestException(
              dto.mode === 'AT_HOME'
                ? 'This service isn’t offered at home.'
                : 'This service is only offered at home.',
            );
          if (dto.mode === 'AT_HOME') {
            if (!dto.address) throw new BadRequestException('Add the address for the home visit.');
            const d = km(s.partner.lat, s.partner.lng, dto.address.lat, dto.address.lng);
            if (d > s.partner.homeVisitRadiusKm)
              throw new BadRequestException(
                `This service is unavailable at this location: that address is ${d.toFixed(1)} km away; ${s.partner.businessName} visits within ${s.partner.homeVisitRadiusKm} km.`,
              );
          }
          const slot = slots.find((x) => x.startsAt.getTime() === startsAt.getTime());
          if (!slot)
            throw new ConflictException(
              'That time isn’t available any more. Please pick another slot.',
            );

          const category = await tx.serviceCategory.findUniqueOrThrow({
            where: { id: s.categoryId },
          });
          const commissionBps = s.partner.commissionBps ?? category.commissionBps;
          const money = split(s.pricePaise, commissionBps);
          const b = await tx.booking.create({
            data: {
              code: bookingCode(randomBytes(6)),
              customerId,
              partnerId: s.partnerId,
              serviceId: s.id,
              petId: pet.id,
              slotIndex: slot.slotIndex,
              startsAt: slot.startsAt,
              endsAt: slot.blockedUntil,
              mode: dto.mode,
              address: dto.address ? { ...dto.address } : undefined,
              pricePaise: s.pricePaise,
              commissionBps,
              ...money,
              customerNote: dto.note,
            },
          });
          const payment = await this.payments.createOrder(
            tx,
            customerId,
            'SERVICE_BOOKING',
            b.id,
            s.pricePaise,
            { bookingId: b.id, code: b.code },
          );
          return tx.booking.update({
            where: { id: b.id },
            data: { paymentId: payment.id },
            include: { payment: true },
          });
        });
        return {
          ...(await this.view(booking.id, customerId)),
          payment: this.payments.checkoutParams(booking.payment!),
        };
      } catch (e) {
        // Two people racing for the same time: the exclusion constraint refuses the loser (23P01),
        // or Postgres aborts one transaction as a deadlock / write conflict (P2034, 40P01, 40001).
        // Retry: the next attempt recomputes slots and either picks a free staff slot or reports a clash.
        const raw = `${(e as { code?: string }).code ?? ''} ${(e as Error).message ?? ''}`;
        const clash = /Booking_no_overlap|23P01|exclusion constraint/.test(raw);
        const contention = /P2034|40P01|40001|deadlock|write conflict|could not serialize/i.test(raw);
        if ((clash || contention) && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 20 + Math.random() * 60)); // de-synchronise the retries
          continue;
        }
        if (clash || contention) throw new ConflictException('That time was just taken. Please pick another slot.');
        throw e;
      }
    }
    throw new ConflictException('That time was just taken. Please pick another slot.');
  }

  /** Called by the payments module once a booking payment is verified. Runs inside its transaction. */
  async settlePaid(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ): Promise<'confirmed' | 'refund'> {
    const b = await tx.booking.findUnique({ where: { paymentId } });
    if (!b) return 'refund';
    if (b.status === 'PENDING_PAYMENT') {
      await tx.booking.update({ where: { id: b.id }, data: { status: 'CONFIRMED' } });
      return 'confirmed';
    }
    if (b.status === 'EXPIRED') {
      // Paid after the hold ran out: keep the booking if the slot is still free, otherwise refund.
      await tx.$executeRaw`SAVEPOINT revive`;
      try {
        await tx.booking.update({ where: { id: b.id }, data: { status: 'CONFIRMED' } });
        await tx.$executeRaw`RELEASE SAVEPOINT revive`;
        return 'confirmed';
      } catch {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT revive`;
        await tx.booking.update({
          where: { id: b.id },
          data: {
            cancelledBy: 'SYSTEM',
            cancelReason: 'Paid after the slot was released',
            refundPaise: b.pricePaise,
          },
        });
        return 'refund';
      }
    }
    return 'refund';
  }

  async view(id: string, viewerId?: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, name: true, durationMin: true } },
        partner: {
          select: {
            id: true,
            userId: true,
            businessName: true,
            phone: true,
            addressLine: true,
            city: true,
            lat: true,
            lng: true,
          },
        },
        pet: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        review: true,
        payment: true,
      },
    });
    if (!b) throw new NotFoundException('Booking not found.');
    const isCustomer = viewerId === b.customerId;
    const isPartner = viewerId === b.partner.userId;
    if (viewerId && !isCustomer && !isPartner) throw new NotFoundException('Booking not found.');
    const confirmed = !['PENDING_PAYMENT', 'EXPIRED'].includes(b.status);
    return {
      id: b.id,
      code: b.code,
      status: b.status,
      startsAt: b.startsAt,
      endsAt: new Date(b.startsAt.getTime() + b.service.durationMin * 60_000),
      mode: b.mode,
      service: { id: b.service.id, name: b.service.name },
      pet: b.pet,
      pricePaise: b.pricePaise,
      partner: {
        id: b.partner.id,
        businessName: b.partner.businessName,
        addressLine: b.partner.addressLine,
        city: b.partner.city,
        lat: b.partner.lat,
        lng: b.partner.lng,
        phone: confirmed ? b.partner.phone : null,
      },
      // The partner sees the customer's contact and the visit address only once the booking is paid.
      customer:
        isPartner || !viewerId
          ? { id: b.customer.id, name: b.customer.name, phone: confirmed ? b.customer.phone : null }
          : undefined,
      address: confirmed || isCustomer ? b.address : null,
      customerNote: b.customerNote,
      earnings:
        isPartner || !viewerId
          ? { platformFeePaise: b.platformFeePaise, partnerEarningPaise: b.partnerEarningPaise }
          : undefined,
      cancelledBy: b.cancelledBy,
      cancelReason: b.cancelReason,
      refundPaise: b.refundPaise,
      // Both sides see the review, with its status: a hidden review still counts as "reviewed".
      review: b.review ? await this.reviewOfBooking(b.review) : null,
      payment:
        b.status === 'PENDING_PAYMENT' && b.payment && isCustomer
          ? this.payments.checkoutParams(b.payment)
          : null,
      createdAt: b.createdAt,
    };
  }

  async listMine(customerId: string, q: BookingsQuery) {
    await this.expireStale(this.prisma);
    const now = new Date();
    const where: Prisma.BookingWhereInput = {
      customerId,
      status:
        q.status ??
        (q.when === 'upcoming'
          ? { in: ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'] }
          : { not: 'EXPIRED' }),
      ...(q.when === 'upcoming'
        ? { startsAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } }
        : q.when === 'past'
          ? { startsAt: { lt: now } }
          : {}),
    };
    return this.page(where, q, q.when === 'upcoming' ? 'asc' : 'desc', customerId);
  }

  async listForPartner(userId: string, q: BookingsQuery) {
    const p = await this.prisma.servicePartner.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Create your business profile first.');
    await this.expireStale(this.prisma, p.id);
    const now = new Date();
    const where: Prisma.BookingWhereInput = {
      partnerId: p.id,
      status: q.status ?? { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] },
      ...(q.when === 'upcoming'
        ? { startsAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } }
        : q.when === 'past'
          ? { startsAt: { lt: now } }
          : {}),
    };
    return this.page(where, q, q.when === 'past' ? 'desc' : 'asc', userId);
  }

  async adminList(q: BookingsQuery & { partnerId?: string }) {
    const now = new Date();
    const when = q.when === 'upcoming' ? { startsAt: { gte: now } } : q.when === 'past' ? { startsAt: { lt: now } } : {};
    return this.page({ status: q.status, partnerId: q.partnerId, ...when }, q, q.when === 'upcoming' ? 'asc' : 'desc');
  }

  private async page(
    where: Prisma.BookingWhereInput,
    q: BookingsQuery,
    dir: 'asc' | 'desc',
    viewerId?: string,
  ) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { startsAt: dir },
        skip: q.skip,
        take: q.limit,
        select: { id: true },
      }),
      this.prisma.booking.count({ where }),
    ]);
    return Paged.of(await Promise.all(rows.map((r) => this.view(r.id, viewerId))), total, q);
  }

  // ══════════════ changes ══════════════

  async cancel(actorId: string, id: string, by: 'CUSTOMER' | 'PARTNER' | 'ADMIN', reason?: string) {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: { partner: true } });
    if (!b) throw new NotFoundException('Booking not found.');
    if (by === 'CUSTOMER' && b.customerId !== actorId)
      throw new NotFoundException('Booking not found.');
    if (by === 'PARTNER' && b.partner.userId !== actorId)
      throw new NotFoundException('Booking not found.');
    if (by === 'PARTNER' && !reason)
      throw new BadRequestException('Tell the customer why you’re cancelling.');
    if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(b.status))
      throw new BadRequestException('This booking can’t be cancelled now.');
    const now = new Date();
    const paid = b.status === 'CONFIRMED';
    const refund = paid
      ? refundFor(b.pricePaise, b.startsAt, now, by, {
          fullRefundHours: await this.platform.getSetting<number>('services.fullRefundHours'),
          lateRefundPct: await this.platform.getSetting<number>('services.lateCancelRefundPct'),
        })
      : 0;
    await this.prisma.$transaction(async (tx) => {
      // Only from the status the refund was worked out for: a payment, completion or another
      // cancellation landing in between makes this a conflict instead of a double outcome.
      const moved = await tx.booking.updateMany({
        where: { id, status: b.status },
        data: {
          status: 'CANCELLED',
          cancelledBy: by,
          cancelReason: reason,
          refundPaise: paid ? refund : null,
        },
      });
      if (!moved.count) throw new ConflictException('This booking just changed. Refresh and try again.');
      // The refund owed is recorded here and sent by the finance worker; what a late cancellation
      // keeps is the partner's (less PetApp's fee).
      if (paid && refund > 0)
        await this.finance.oweRefund(tx, {
          paymentId: b.paymentId,
          amountPaise: refund,
          reason: 'BOOKING_CANCELLED',
          reference: `Booking:${id}`,
        });
      if (paid) await this.finance.bookingEarned(tx, id);
      await this.audit.log(
        {
          actorId,
          action: 'booking.cancel',
          entityType: 'Booking',
          entityId: id,
          before: { status: b.status },
          after: { by, reason, refundPaise: refund },
        },
        tx,
      );
    });
    if (paid) this.queue.notify({ type: 'BOOKING_CANCELLED', bookingId: id });
    return { ...(await this.view(id)), refundPaise: refund };
  }

  async partnerUpdate(userId: string, id: string, to: 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW') {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: { partner: true } });
    if (!b || b.partner.userId !== userId) throw new NotFoundException('Booking not found.');
    const allowed: Record<string, BookingStatus[]> = {
      IN_PROGRESS: ['CONFIRMED'],
      COMPLETED: ['CONFIRMED', 'IN_PROGRESS'],
      NO_SHOW: ['CONFIRMED'],
    };
    if (!allowed[to].includes(b.status))
      throw new BadRequestException(
        `A ${b.status.toLowerCase().replace('_', ' ')} booking can’t be marked ${to.toLowerCase().replace('_', ' ')}.`,
      );
    const now = new Date();
    if (to !== 'IN_PROGRESS' && now < b.startsAt)
      throw new BadRequestException('You can mark this after the booking has started.');
    if (to === 'IN_PROGRESS' && now < new Date(b.startsAt.getTime() - 30 * 60_000))
      throw new BadRequestException('You can start a booking up to 30 minutes early.');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.booking.updateMany({
        where: { id, status: b.status },
        data: { status: to, completedAt: to === 'COMPLETED' ? now : undefined },
      });
      if (!moved.count) throw new ConflictException('This booking just changed. Refresh and try again.');
      if (to !== 'IN_PROGRESS') await this.finance.bookingEarned(tx, id);
      if (to === 'COMPLETED') await this.invoices.forBooking(tx, id);
      await this.audit.log(
        {
          actorId: userId,
          action: `booking.${to.toLowerCase()}`,
          entityType: 'Booking',
          entityId: id,
          before: { status: b.status },
        },
        tx,
      );
    });
    if (to === 'COMPLETED') this.queue.notify({ type: 'BOOKING_COMPLETED', bookingId: id });
    return this.view(id, userId);
  }

  // ══════════════ reviews ══════════════

  async review(customerId: string, bookingId: string, dto: ReviewDto) {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, customerId } });
    if (!b) throw new NotFoundException('Booking not found.');
    if (b.status !== 'COMPLETED')
      throw new BadRequestException('You can review a booking once it’s completed.');
    const photoIds = await assertReviewPhotos(this.prisma, customerId, dto.photoIds);
    let reviewId = '';
    try {
      await this.prisma.$transaction(async (tx) => {
        ({ id: reviewId } = await tx.serviceReview.create({
          data: {
            bookingId,
            partnerId: b.partnerId,
            customerId,
            rating: dto.rating,
            comment: dto.comment || null,
            photoIds,
          },
        }));
        await recomputePartnerRating(tx, b.partnerId);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('You’ve already reviewed this booking.');
      throw e;
    }
    if (needsAiCheck(dto.comment, photoIds)) this.queue.assess('SERVICE_REVIEW', reviewId);
    this.queue.notify({ type: 'REVIEW_RECEIVED', kind: 'SERVICE', reviewId });
    return this.view(bookingId, customerId);
  }
}
