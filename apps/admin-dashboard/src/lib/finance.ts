// Finance screens: response shapes from /admin/finance/*, plain-language labels, and pure helpers.
// No server-only imports, so the helpers are unit-tested (finance.test.ts).

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'teal';
export type Labelled = Record<string, { label: string; tone: Tone }>;

// ── response shapes ──

export interface FinanceOverview {
  period: { from: string; to: string };
  now: {
    heldByGatewayPaise: number;
    customerFundsPaise: number;
    refundsDuePaise: number;
    owedToSellersPaise: number;
    owedToPartnersPaise: number;
    gstPayablePaise: number;
    tcsPayablePaise: number;
    tdsPayablePaise: number;
  };
  flows: {
    collectedPaise: number;
    payments: number;
    refundsOwedPaise: number;
    refundsPaidPaise: number;
    feeRevenuePaise: number;
    gstOnFeesPaise: number;
    tcsPaise: number;
    tdsPaise: number;
    platformDiscountsPaise: number;
    earnedByPayeesPaise: number;
  };
  refunds: Partial<Record<string, { count: number; amountPaise: number }>>;
  reconciliation: {
    lastRun: { id: string; status: string; startedAt: string; finishedAt: string | null } | null;
    openIssues: Partial<Record<'ERROR' | 'WARNING', number>>;
  };
}

export interface LedgerBalance {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE';
  ownerType: string | null;
  ownerId: string | null;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}

export interface TrialBalance {
  asOf: string | null;
  accounts: LedgerBalance[];
  totals: { debitPaise: number; creditPaise: number; balanced: boolean };
}

export interface LedgerTx {
  id: string;
  kind: string;
  memo: string;
  reference: string;
  sourceType: string | null;
  sourceId: string | null;
  occurredAt: string;
}

export interface AccountEntries {
  account: Omit<LedgerBalance, 'debitPaise' | 'creditPaise'>;
  items: Array<{ id: string; debitPaise: number; creditPaise: number; transaction: LedgerTx }>;
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface LedgerTxDetail extends LedgerTx {
  createdAt: string;
  entries: Array<{
    id: string;
    account: { code: string; name: string; type: LedgerBalance['type'] };
    debitPaise: number;
    creditPaise: number;
  }>;
}

export type RefundStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'SETTLED_MANUALLY';

export interface RefundRow {
  id: string;
  amountPaise: number;
  reason: string;
  reference: string;
  status: RefundStatus;
  createdAt: string;
  processedAt: string | null;
  providerRefundId: string | null;
  attempts: number;
  retries: number;
  lastError: string | null;
  manualReference: string | null;
  nextAttemptAt: string | null;
  payment: {
    id: string;
    purpose: string;
    amountPaise: number;
    status: string;
    providerPaymentId: string | null;
    user: { id: string; name: string | null; phone: string | null };
  };
}

export interface ReconRun {
  id: string;
  status: 'RUNNING' | 'OK' | 'ISSUES' | 'FAILED';
  trigger: 'SCHEDULE' | 'MANUAL';
  summary: Record<string, number> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  _count?: { issues: number };
}

export interface ReconIssue {
  id: string;
  runId: string;
  kind: string;
  severity: 'ERROR' | 'WARNING';
  reference: string;
  detail: string;
  repaired: boolean;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

export type PayeeType = 'VENDOR' | 'PARTNER' | 'USER';

export interface PayoutPreview {
  payees: Array<{
    type: PayeeType;
    id: string;
    name: string;
    amountPaise: number;
    accountId: string;
  }>;
  count: number;
  totalPaise: number;
}

export type BatchStatus = 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
export type PayoutStatus =
  'DRAFT' | 'QUEUED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'REVERSED' | 'CANCELLED';

export interface BatchRow {
  id: string;
  code: string;
  status: BatchStatus;
  note: string | null;
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  totalPaise: number;
  _count: { payouts: number };
  createdBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
}

export interface BatchDetail extends Omit<BatchRow, 'totalPaise' | '_count'> {
  payouts: Array<{
    id: string;
    payeeType: PayeeType;
    payeeId: string;
    payeeName: string;
    amountPaise: number;
    purpose: 'EARNINGS' | 'PRIZE';
    status: PayoutStatus;
    utr: string | null;
    attempts: number;
    lastError: string | null;
    failureReason: string | null;
    processedAt: string | null;
    account: {
      method: 'BANK' | 'UPI';
      ifsc: string | null;
      accountLast4: string | null;
      vpa: string | null;
      verifiedName: string | null;
      holderName: string;
    };
  }>;
  totals: {
    count: number;
    totalPaise: number;
    paidPaise: number;
    failedPaise: number;
    inFlightPaise: number;
  };
}

export interface PayoutAccountRow {
  id: string;
  method: 'BANK' | 'UPI';
  holderName: string;
  ifsc: string | null;
  accountLast4: string | null;
  vpa: string | null;
  status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'DISABLED';
  verifiedName: string | null;
  nameMatches: boolean | null;
  failureReason: string | null;
  verifiedAt: string | null;
  payableFrom: string | null;
  createdAt: string;
  ownerType: PayeeType;
  ownerId: string;
  ownerName: string | null;
}

export interface PrizeRow {
  id: string;
  title: string;
  rank: number | null;
  amountPaise: number;
  payoutStatus: 'PENDING' | 'APPROVED' | 'PAID';
  contest: { id: string; title: string; status: string };
  winner: { userId: string; name: string | null; phone: string | null; petName: string };
  winnerHasPayoutAccount: boolean;
}

export interface SettlementRow {
  id: string;
  provider: string;
  providerSettlementId: string;
  amountPaise: number;
  feesPaise: number;
  taxPaise: number;
  utr: string | null;
  settledAt: string;
}

export interface Party {
  name?: string;
  gstin?: string | null;
  pan?: string | null;
  state?: string | null;
  address?: string | null;
}

export interface InvoiceRow {
  id: string;
  kind: 'CUSTOMER' | 'COMMISSION' | 'CREDIT_NOTE';
  title: 'TAX_INVOICE' | 'BILL_OF_SUPPLY' | string;
  number: string;
  issuedAt: string;
  totalPaise: number;
  sourceKey: string;
  recipient: Party;
  issuer: Party;
  payeeKey: string | null;
}

export interface TaxReport {
  month: string;
  payees: Array<{
    payeeType: PayeeType;
    payeeId: string;
    name: string;
    gstin: string | null;
    pan: string | null;
    taxableValuePaise: number;
    tcsPaise: number;
    tdsPaise: number;
    feesPaise: number;
    gstOnFeesPaise: number;
    netPaidToPayeePaise: number;
    transactions: number;
  }>;
  totals: {
    taxableValuePaise: number;
    tcsPaise: number;
    tdsPaise: number;
    feesPaise: number;
    gstOnFeesPaise: number;
  };
  note: string;
}

export interface CommissionRun {
  month: string;
  issued: Array<{ id: string; number: string; payeeKey: string; totalPaise: number }>;
  skipped: unknown;
}

// ── labels ──

export const REFUND_STATUS: Labelled = {
  PENDING: { label: 'Waiting to send', tone: 'warn' },
  PROCESSING: { label: 'With the gateway', tone: 'teal' },
  PROCESSED: { label: 'Refunded', tone: 'good' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SETTLED_MANUALLY: { label: 'Paid another way', tone: 'neutral' },
};

export const REFUND_REASON: Record<string, string> = {
  SUB_ORDER_CANCELLED: 'Parcel cancelled',
  RETURN: 'Return',
  ORDER_UNFULFILLABLE: 'Couldn’t be fulfilled',
  BOOKING_CANCELLED: 'Booking cancelled',
  CONTEST_CANCELLED: 'Contest cancelled',
  CHALLENGE_CANCELLED: 'Challenge cancelled',
  PAYMENT_UNHONOURED: 'Paid after it closed',
};

export const PAYMENT_PURPOSE: Record<string, string> = {
  PRODUCT_ORDER: 'Shop order',
  SERVICE_BOOKING: 'Booking',
  CONTEST_REGISTRATION: 'Contest entry',
  CHALLENGE_JOIN: 'Challenge entry',
  MEMBERSHIP: 'Membership',
};

export const RUN_STATUS: Labelled = {
  RUNNING: { label: 'Running', tone: 'teal' },
  OK: { label: 'All matched', tone: 'good' },
  ISSUES: { label: 'Found issues', tone: 'warn' },
  FAILED: { label: 'Didn’t finish', tone: 'danger' },
};

export const SEVERITY: Labelled = {
  ERROR: { label: 'Money at risk', tone: 'danger' },
  WARNING: { label: 'Needs a look', tone: 'warn' },
};

export const ISSUE_KIND: Record<string, string> = {
  MISSED_CAPTURE: 'Payment the gateway took but we never confirmed',
  DUPLICATE_CAPTURE: 'Customer paid twice',
  GATEWAY_AMOUNT_MISMATCH: 'Amount differs from the gateway',
  AMOUNT_MISMATCH: 'Amount differs from the gateway',
  GATEWAY_STATUS: 'Status differs from the gateway',
  MISSING_POSTING: 'Missing ledger posting',
  UNBALANCED: 'Ledger doesn’t balance',
  REFUND_STUCK: 'Refund stuck',
  REFUND_FAILED: 'Refund failed',
  GATEWAY_UNREACHABLE: 'Couldn’t reach the gateway',
  OVER_REFUNDED: 'Refunded more than was paid',
  CONTROL_MISMATCH: 'Control total differs',
};

export const BATCH_STATUS: Labelled = {
  DRAFT: { label: 'Waiting for approval', tone: 'warn' },
  PROCESSING: { label: 'Sending', tone: 'teal' },
  COMPLETED: { label: 'Done', tone: 'good' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const PAYOUT_STATUS: Labelled = {
  DRAFT: { label: 'In draft', tone: 'neutral' },
  QUEUED: { label: 'Queued', tone: 'teal' },
  PROCESSING: { label: 'With the bank', tone: 'teal' },
  PROCESSED: { label: 'Paid', tone: 'good' },
  FAILED: { label: 'Not paid', tone: 'danger' },
  REVERSED: { label: 'Returned by bank', tone: 'danger' },
  CANCELLED: { label: 'Dropped', tone: 'neutral' },
};

export const ACCOUNT_STATUS: Labelled = {
  PENDING: { label: 'Being checked', tone: 'warn' },
  VERIFIED: { label: 'Verified', tone: 'good' },
  FAILED: { label: 'Bank refused', tone: 'danger' },
  DISABLED: { label: 'Switched off', tone: 'neutral' },
};

export const PRIZE_STATUS: Labelled = {
  PENDING: { label: 'Waiting for approval', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'teal' },
  PAID: { label: 'Paid', tone: 'good' },
};

export const PAYEE_TYPE: Record<PayeeType, string> = {
  VENDOR: 'Seller',
  PARTNER: 'Service partner',
  USER: 'Prize winner',
};

export const INVOICE_KIND: Record<InvoiceRow['kind'], string> = {
  CUSTOMER: 'To customer',
  COMMISSION: 'PetApp commission',
  CREDIT_NOTE: 'Credit note',
};

export const ACCOUNT_TYPE: Record<LedgerBalance['type'], string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
};

/** Ledger posting kinds in plain words. */
export const TX_KIND: Record<string, string> = {
  PAYMENT_CAPTURED: 'Payment received',
  REFUND_OWED: 'Refund owed',
  REFUND_PAID: 'Refund paid',
  REFUND_PAID_MANUALLY: 'Refund paid another way',
  PARCEL_DELIVERED: 'Parcel delivered',
  PARCEL_RETURNED: 'Parcel returned',
  BOOKING_EARNED: 'Visit completed',
  ENTRY_FEES_EARNED: 'Entry fees earned',
  MEMBERSHIP_EARNED: 'Membership fee earned',
  PRIZE_APPROVED: 'Prize approved',
  PAYOUT_APPROVED: 'Payout approved',
  PAYOUT_PAID: 'Payout paid',
  PAYOUT_FAILED: 'Payout not paid',
  PAYOUT_REVERSED: 'Payout returned',
  GATEWAY_SETTLEMENT: 'Gateway settlement',
};

export const label = (map: Record<string, string>, key: string | null | undefined): string =>
  key ? (map[key] ?? humanizeKey(key)) : '—';

function humanizeKey(key: string): string {
  const s = key.replace(/[_.]+/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── helpers ──

const IST_MS = 330 * 60_000;

/** Today's date in India as YYYY-MM-DD. */
export const istToday = (now = Date.now()): string =>
  new Date(now + IST_MS).toISOString().slice(0, 10);

/** The last finished month in India as YYYY-MM (commission invoices are issued for it). */
export function lastMonth(now = Date.now()): string {
  const [y, m] = istToday(now).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The current month in India as YYYY-MM. */
export const thisMonth = (now = Date.now()): string => istToday(now).slice(0, 7);

/** "2026-09" → "September 2026". */
export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export const isDay = (s: string | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isMonth = (s: string | undefined): s is string =>
  !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** Where a refund, issue or posting points in the dashboard, if anywhere. "SubOrder:<id>" → orders search. */
export function referenceHref(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = /^([A-Za-z]+):([0-9a-f-]{36})/.exec(ref);
  if (!m) return null;
  const [, type, id] = m;
  switch (type) {
    case 'PayoutBatch':
      return `/finance/payouts/${id}`;
    case 'Contest':
      return `/contests/${id}`;
    case 'Challenge':
      return `/challenges/${id}`;
    case 'User':
      return `/users/${id}`;
    case 'VENDOR':
    case 'Vendor':
      return `/shop/vendors/${id}`;
    case 'PARTNER':
    case 'ServicePartner':
      return `/partners/${id}`;
    default:
      return null;
  }
}

/** The payment id in a reconciliation issue's reference, for "recover". */
export const paymentIdOf = (ref: string): string | null =>
  /^Payment:([0-9a-f-]{36})$/.exec(ref)?.[1] ?? null;

/** A ledger account code goes in a URL path segment ("VENDOR:<uuid>" has a colon). */
export const accountHref = (code: string): string => `/finance/ledger/${encodeURIComponent(code)}`;

/** "BANK •••• 6789 · HDFC0001234" or the UPI id. */
export function describeAccount(a: {
  method: 'BANK' | 'UPI';
  accountLast4: string | null;
  ifsc: string | null;
  vpa: string | null;
}): string {
  if (a.method === 'UPI') return a.vpa ?? 'UPI';
  return [`Bank •••• ${a.accountLast4 ?? '????'}`, a.ifsc].filter(Boolean).join(' · ');
}

/** CSV with every field quoted, safe against formula injection in spreadsheets. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '""';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Paise as a plain rupee number for spreadsheets: 12345 → "123.45", -5 → "-0.05". */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const a = Math.abs(paise);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
