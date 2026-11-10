import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../providers/payments/payment.provider';
import { LedgerService } from './ledger.service';

/**
 * Books the gateway's transfers to PetApp's bank: the money moves from "held by the gateway" to the bank,
 * less the gateway's fees (an expense) and the GST on them (claimable as input tax credit).
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Fetches settlements from the last `days` days and books any not seen before. Returns how many were new. */
  async sync(days = 7): Promise<number> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const list = await this.provider.listSettlements(from, to);
    let added = 0;
    for (const s of list) {
      // One bad settlement must not block the ones after it: it's logged and left for reconciliation.
      const valid = [s.amountPaise, s.feesPaise, s.taxPaise].every((x) => Number.isInteger(x) && x >= 0) && s.feesPaise >= s.taxPaise && s.amountPaise + s.feesPaise > 0;
      if (!valid) {
        this.logger.error(`settlement ${s.settlementId} has unexpected amounts (amount ${s.amountPaise}, fees ${s.feesPaise}, tax ${s.taxPaise}); not booked`);
        continue;
      }
      const booked = await this.prisma.$transaction(async (tx) => {
        const row = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "GatewaySettlement" (id, provider, "providerSettlementId", "amountPaise", "feesPaise", "taxPaise", utr, "settledAt")
          VALUES (gen_random_uuid(), ${this.provider.name}, ${s.settlementId}, ${s.amountPaise}, ${s.feesPaise}, ${s.taxPaise}, ${s.utr ?? null}, ${s.settledAt})
          ON CONFLICT (provider, "providerSettlementId") DO NOTHING RETURNING id`;
        if (!row.length) return false;
        await this.ledger.post(tx, {
          kind: 'GATEWAY_SETTLEMENT',
          reference: `settlement:${this.provider.name}:${s.settlementId}`,
          memo: `Gateway settlement to bank${s.utr ? ` (UTR ${s.utr})` : ''}`,
          sourceType: 'GatewaySettlement',
          sourceId: row[0].id,
          occurredAt: s.settledAt,
          lines: [
            { account: 'BANK', debit: s.amountPaise },
            { account: 'GATEWAY_FEES', debit: s.feesPaise - s.taxPaise },
            { account: 'GST_INPUT_CREDIT', debit: s.taxPaise },
            { account: 'GATEWAY_CLEARING', credit: s.amountPaise + s.feesPaise },
          ],
        });
        return true;
      }).catch((e) => {
        this.logger.error(`settlement ${s.settlementId} couldn’t be booked: ${(e as Error).message}`);
        return false;
      });
      if (booked) added++;
    }
    if (added) this.logger.log(`booked ${added} gateway settlement(s)`);
    return added;
  }

  list(take = 50) {
    return this.prisma.gatewaySettlement.findMany({ orderBy: { settledAt: 'desc' }, take });
  }
}
