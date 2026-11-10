import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanceService } from './finance.service';

/** Cash prizes: finance approves each awarded prize, which puts it (less TDS) on the winner's balance for payout. */
@Injectable()
export class PrizesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
  ) {}

  /** Awarded cash prizes by payout status: PENDING (to approve), APPROVED (owed), PAID. */
  async list(status: 'PENDING' | 'APPROVED' | 'PAID' = 'PENDING') {
    const rows = await this.prisma.contestPrize.findMany({
      where: { payoutStatus: status, kind: 'CASH', amountPaise: { gt: 0 }, participantId: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { contest: { select: { id: true, title: true, status: true } }, participant: { select: { id: true, userId: true, user: { select: { name: true, phone: true } }, pet: { select: { name: true } } } } },
    });
    const verified = new Set((await this.prisma.payoutAccount.findMany({ where: { ownerType: 'USER', ownerId: { in: rows.map((r) => r.participant!.userId) }, status: 'VERIFIED' }, select: { ownerId: true } })).map((a) => a.ownerId));
    return rows.map((r) => ({
      id: r.id, title: r.title, rank: r.rank, amountPaise: r.amountPaise, payoutStatus: r.payoutStatus, contest: r.contest,
      winner: { userId: r.participant!.userId, name: r.participant!.user.name, phone: r.participant!.user.phone, petName: r.participant!.pet.name },
      winnerHasPayoutAccount: verified.has(r.participant!.userId),
    }));
  }

  async approve(actorId: string, prizeId: string) {
    const out = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ContestPrize" WHERE id = ${prizeId}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Prize not found.');
      const p = await tx.contestPrize.findUniqueOrThrow({ where: { id: prizeId }, include: { contest: true, participant: { include: { user: { select: { name: true } } } } } });
      if (p.kind !== 'CASH' || !p.amountPaise) throw new BadRequestException('Only cash prizes are paid out.');
      if (!p.participant) throw new BadRequestException('This prize hasn’t been awarded yet.');
      if (p.payoutStatus !== 'PENDING') throw new BadRequestException(`This prize is ${p.payoutStatus.toLowerCase()}.`);
      if (!['WINNER_DECLARATION', 'COMPLETED'].includes(p.contest.status)) throw new BadRequestException('Prizes are approved once winners are declared.');
      const split = await this.finance.prizeApproved(tx, { id: p.id, amountPaise: p.amountPaise, title: p.title }, { userId: p.participant.userId, name: p.participant.user.name ?? 'Winner' }, p.contest.title);
      await tx.contestPrize.update({ where: { id: p.id }, data: { payoutStatus: 'APPROVED' } });
      await this.audit.log({ actorId, action: 'prize.approve', entityType: 'ContestPrize', entityId: p.id, after: split }, tx);
      return split;
    });
    return { id: prizeId, payoutStatus: 'APPROVED', ...out };
  }
}
