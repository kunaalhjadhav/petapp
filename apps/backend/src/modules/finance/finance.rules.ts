// Pure money rules for the ledger: account catalogue, fee/tax splits, refund backoff. No I/O; unit-tested.

export type AccountType = 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE';

/** System accounts. Balances: assets and expenses are debit-positive; liabilities and revenue credit-positive. */
export const SYSTEM_ACCOUNTS = {
  GATEWAY_CLEARING: { name: 'Held by the payment gateway', type: 'ASSET' },
  CUSTOMER_FUNDS: { name: 'Paid by customers, not yet earned or refunded', type: 'LIABILITY' },
  REFUNDS_DUE: { name: 'Refunds owed to customers', type: 'LIABILITY' },
  FEE_REVENUE: { name: 'PetApp commission and fees (without GST)', type: 'REVENUE' },
  GST_PAYABLE: { name: 'GST on PetApp’s fees', type: 'LIABILITY' },
  TCS_PAYABLE: { name: 'GST TCS collected from sellers and partners', type: 'LIABILITY' },
  TDS_PAYABLE: { name: 'Income-tax TDS deducted from sellers and partners', type: 'LIABILITY' },
  PLATFORM_DISCOUNTS: { name: 'Coupons funded by PetApp', type: 'EXPENSE' },
  BANK: { name: 'PetApp’s bank account', type: 'ASSET' },
  PAYOUTS_IN_TRANSIT: { name: 'Payouts approved, not yet confirmed by the bank', type: 'LIABILITY' },
  GATEWAY_FEES: { name: 'Payment gateway fees (without GST)', type: 'EXPENSE' },
  GST_INPUT_CREDIT: { name: 'GST paid on gateway fees (input tax credit)', type: 'ASSET' },
  ENTRY_FEE_REVENUE: { name: 'Contest and challenge entry fees (without GST)', type: 'REVENUE' },
  PRIZE_EXPENSE: { name: 'Contest prizes', type: 'EXPENSE' },
  MEMBERSHIP_REVENUE: { name: 'Membership fees (without GST)', type: 'REVENUE' },
} as const satisfies Record<string, { name: string; type: AccountType }>;

export type SystemAccount = keyof typeof SYSTEM_ACCOUNTS;
/** Who PetApp pays: sellers, service partners, and users who won a cash prize. */
export type PayeeType = 'VENDOR' | 'PARTNER' | 'USER';
export const PAYEE_TYPES: PayeeType[] = ['VENDOR', 'PARTNER', 'USER'];

/** Ledger kinds that put money on a payee's balance at once (no holding period): payouts that bounced, prizes. */
export const IMMEDIATE_CREDIT_KINDS = ['PAYOUT_FAILED', 'PAYOUT_REVERSED', 'PRIZE_APPROVED'];

/** Code of a seller's or partner's payable account. */
export const payeeAccount = (type: PayeeType, id: string) => `${type}:${id}`;

/** Debit-positive account types; the rest are credit-positive. */
export const isDebitNormal = (t: AccountType) => t === 'ASSET' || t === 'EXPENSE';

/** Signed balance in the account's normal direction. */
export const normalBalance = (t: AccountType, debit: number, credit: number) => (isDebitNormal(t) ? debit - credit : credit - debit);

export const ofBps = (amountPaise: number, rateBps: number) => Math.round((amountPaise * rateBps) / 10_000);

/** GST contained in a GST-inclusive amount: 11800 at 18% → 1800. */
export const gstWithin = (amountPaise: number, rateBps: number) => amountPaise - Math.round((amountPaise * 10_000) / (10_000 + rateBps));

export interface EarningInput {
  /** What the customer's payment covers for this sale. */
  customerPaise: number;
  /** A PetApp-funded coupon on this sale (PetApp's cost; the payee still earns the full price). */
  platformDiscountPaise: number;
  /** PetApp's commission or booking fee, GST included. */
  feePaise: number;
  /** Value the TCS and TDS are worked out on (taxable value, without GST). */
  taxableBasePaise: number;
  gstOnFeesBps: number;
  /** 0 when the payee isn't GST-registered. */
  tcsBps: number;
  tdsBps: number;
}

export interface EarningSplit {
  feeRevenuePaise: number;
  feeGstPaise: number;
  tcsPaise: number;
  tdsPaise: number;
  /** Credited to the payee's account: what they'll be paid out. */
  payeeNetPaise: number;
  /** Before TCS and TDS: customer + PetApp's coupon − fee. */
  payeeGrossPaise: number;
}

/**
 * Splits a sale between PetApp (fee, with the GST inside it), the tax authorities (TCS, TDS) and the payee.
 * Invariant (tested): customer + platformDiscount = feeRevenue + feeGst + tcs + tds + payeeNet.
 */
export function splitEarning(x: EarningInput): EarningSplit {
  for (const [k, v] of Object.entries(x)) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`splitEarning: ${k} must be a non-negative integer (got ${v})`);
  }
  const payeeGrossPaise = x.customerPaise + x.platformDiscountPaise - x.feePaise;
  if (payeeGrossPaise < 0) throw new Error(`splitEarning: the fee (${x.feePaise}) is more than the sale (${x.customerPaise + x.platformDiscountPaise})`);
  const feeGstPaise = gstWithin(x.feePaise, x.gstOnFeesBps);
  const tcsPaise = ofBps(x.taxableBasePaise, x.tcsBps);
  const tdsPaise = ofBps(x.taxableBasePaise, x.tdsBps);
  const payeeNetPaise = payeeGrossPaise - tcsPaise - tdsPaise;
  if (payeeNetPaise < 0) throw new Error('splitEarning: taxes exceed what the payee earns');
  return { feeRevenuePaise: x.feePaise - feeGstPaise, feeGstPaise, tcsPaise, tdsPaise, payeeNetPaise, payeeGrossPaise };
}

/** Wait before refund attempt n+1 after n failures: base·2^(n−1) minutes, capped at 6 hours. */
export function refundBackoffMs(failedAttempts: number, baseMinutes: number): number {
  const minutes = baseMinutes * 2 ** Math.max(0, failedAttempts - 1);
  return Math.min(minutes, 360) * 60_000;
}

/**
 * The receipt and idempotency key for one gateway attempt at a refund: our refund id (without dashes) plus the
 * attempt number, at most 40 characters. A new attempt gets a new key, so a refund the gateway failed can be
 * tried again; looking up earlier attempts by the id prefix first means one that did go through is never repeated.
 */
export const refundReceipt = (refundId: string, attempt: number) => `${refundId.replace(/-/g, '')}-${attempt}`;
export const isReceiptFor = (receipt: string | undefined, refundId: string) => !!receipt && receipt.startsWith(`${refundId.replace(/-/g, '')}-`);

/** Payment status implied by its refunds. Only refunds that reached the customer (gateway or manual) count as returned. */
export function paymentStatusAfterRefunds(amountPaise: number, owedPaise: number, processedPaise: number): 'CAPTURED' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED' {
  if (processedPaise >= amountPaise) return 'REFUNDED';
  if (owedPaise >= amountPaise) return 'REFUND_PENDING';
  if (processedPaise > 0) return 'PARTIALLY_REFUNDED';
  return 'CAPTURED';
}

/** PAN format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). */
export const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;

/** IMPS for amounts up to ₹5 lakh, NEFT above; UPI accounts get UPI. */
export function payoutMode(method: 'BANK' | 'UPI', amountPaise: number): 'IMPS' | 'NEFT' | 'UPI' {
  if (method === 'UPI') return 'UPI';
  return amountPaise <= 5_00_000_00 ? 'IMPS' : 'NEFT';
}

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
export const VPA_PATTERN = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;

/** "Rahul  Kumar." and "RAHUL KUMAR" are the same name for matching against the bank's records. */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (x: string) => x.toUpperCase().replace(/\b(MR|MRS|MS|DR|SHRI|SMT|M\/S)\b\.?/g, '').replace(/[^A-Z0-9]/g, '');
  return !!a && !!b && n(a) !== '' && n(a) === n(b);
}

/** Tax on a prize: TDS (sections 194B/194BA) when a single prize is above the threshold. */
export function prizeTds(grossPaise: number, rateBps: number, thresholdPaise: number): number {
  return grossPaise > thresholdPaise ? ofBps(grossPaise, rateBps) : 0;
}
