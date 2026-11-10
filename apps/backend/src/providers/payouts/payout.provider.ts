import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');

/** The payout provider refused or couldn't be reached. `retryable` false means trying again won't help. */
export class PayoutError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export interface Beneficiary {
  /** Our payee key, e.g. "VENDOR:<id>". */
  referenceId: string;
  name: string;
  /** vendor | employee | customer — RazorpayX contact types; payees are "vendor". */
  type: 'vendor' | 'customer';
  bank?: { holderName: string; ifsc: string; accountNumber: string };
  vpa?: string;
}

export interface Validation {
  validationId: string;
  status: 'pending' | 'completed' | 'failed';
  /** completed: whether the account can receive money. */
  accountActive?: boolean;
  /** completed: the name the bank has on the account. */
  registeredName?: string;
  failureReason?: string;
}

export interface ProviderPayout {
  payoutId: string;
  /** pending covers queued/pending/processing at the provider. */
  status: 'pending' | 'processed' | 'failed' | 'reversed';
  utr?: string;
  failureReason?: string;
  referenceId?: string;
}

export interface Settlement {
  settlementId: string;
  amountPaise: number;
  feesPaise: number;
  taxPaise: number;
  utr?: string;
  settledAt: Date;
}

export type PayoutWebhookEvent =
  | { kind: 'payout'; eventId: string; payout: ProviderPayout }
  | { kind: 'validation'; eventId: string; validation: Validation }
  | { kind: 'ignored'; eventId: string; type: string };

export interface PayoutProvider {
  readonly name: string;
  /** Registers where a payee is paid. Returns the provider's ids for the contact and the account. */
  addBeneficiary(b: Beneficiary): Promise<{ contactId: string; fundAccountId: string }>;
  /** Starts a validation of the account with the bank (a ₹1 transfer that reports the account holder's name). */
  validate(fundAccountId: string): Promise<Validation>;
  getValidation(validationId: string): Promise<Validation>;
  /** Sends money. `referenceId` is our payout id: it is also the idempotency key, so a retry never pays twice. */
  payout(p: { fundAccountId: string; amountPaise: number; mode: 'IMPS' | 'NEFT' | 'UPI'; referenceId: string; narration: string }): Promise<ProviderPayout>;
  getPayout(payoutId: string): Promise<ProviderPayout>;
  /** A payout we asked for, found by our reference (after a timeout we never got the provider's id). */
  findPayout(referenceId: string): Promise<ProviderPayout | null>;
  /** Signature-checked webhook; null when the signature is wrong. */
  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): PayoutWebhookEvent | null;
}

const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};
const header = (h: Record<string, string | string[] | undefined>, k: string) => {
  const v = h[k.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

interface RxPayout {
  id: string;
  status: string;
  utr?: string | null;
  reference_id?: string | null;
  status_details?: { description?: string | null } | null;
  failure_reason?: string | null;
}
interface RxValidation {
  id: string;
  status: string;
  results?: { account_status?: string | null; registered_name?: string | null } | null;
}

const payoutStatus = (s: string): ProviderPayout['status'] =>
  s === 'processed' ? 'processed' : s === 'reversed' ? 'reversed' : ['failed', 'rejected', 'cancelled'].includes(s) ? 'failed' : 'pending';
const toPayout = (p: RxPayout): ProviderPayout => ({
  payoutId: p.id,
  status: payoutStatus(p.status),
  utr: p.utr ?? undefined,
  referenceId: p.reference_id ?? undefined,
  failureReason: p.status_details?.description ?? p.failure_reason ?? undefined,
});
const toValidation = (v: RxValidation): Validation => ({
  validationId: v.id,
  status: v.status === 'completed' ? 'completed' : v.status === 'failed' ? 'failed' : 'pending',
  accountActive: v.results?.account_status ? v.results.account_status === 'active' : undefined,
  registeredName: v.results?.registered_name ?? undefined,
});

/** RazorpayX: contacts, fund accounts, account validation and payouts (https://razorpay.com/docs/x/). */
export class RazorpayXProvider implements PayoutProvider {
  readonly name = 'razorpayx';
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    /** The RazorpayX account money is sent from. */
    private readonly accountNumber: string,
    private readonly webhookSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`https://api.razorpay.com/v1${path}`, {
        method,
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new PayoutError(`RazorpayX unreachable: ${(e as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    // The path without its query: our account number travels in some queries and must not reach logs.
    if (!res.ok) throw new PayoutError(`RazorpayX ${method} ${path.split('?')[0]} failed (${res.status}): ${json.error?.description ?? 'unknown error'}`, res.status >= 500 || res.status === 429);
    return json;
  }

  async addBeneficiary(b: Beneficiary) {
    const contact = await this.call<{ id: string }>('POST', '/contacts', { name: b.name.slice(0, 50), type: b.type, reference_id: b.referenceId.slice(0, 40) });
    const fa = await this.call<{ id: string }>(
      'POST',
      '/fund_accounts',
      b.vpa
        ? { contact_id: contact.id, account_type: 'vpa', vpa: { address: b.vpa } }
        : { contact_id: contact.id, account_type: 'bank_account', bank_account: { name: b.bank!.holderName, ifsc: b.bank!.ifsc, account_number: b.bank!.accountNumber } },
    );
    return { contactId: contact.id, fundAccountId: fa.id };
  }

  async validate(fundAccountId: string) {
    return toValidation(await this.call<RxValidation>('POST', '/fund_accounts/validations', { account_number: this.accountNumber, fund_account: { id: fundAccountId }, amount: 100, currency: 'INR' }));
  }

  async getValidation(validationId: string) {
    return toValidation(await this.call<RxValidation>('GET', `/fund_accounts/validations/${encodeURIComponent(validationId)}`));
  }

  async payout(p: { fundAccountId: string; amountPaise: number; mode: 'IMPS' | 'NEFT' | 'UPI'; referenceId: string; narration: string }) {
    const r = await this.call<RxPayout>(
      'POST',
      '/payouts',
      { account_number: this.accountNumber, fund_account_id: p.fundAccountId, amount: p.amountPaise, currency: 'INR', mode: p.mode, purpose: 'payout', queue_if_low_balance: true, reference_id: p.referenceId.slice(0, 40), narration: p.narration.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 30) },
      { 'X-Payout-Idempotency': p.referenceId },
    );
    return toPayout(r);
  }

  async getPayout(payoutId: string) {
    return toPayout(await this.call<RxPayout>('GET', `/payouts/${encodeURIComponent(payoutId)}`));
  }

  async findPayout(referenceId: string) {
    const r = await this.call<{ items?: RxPayout[] }>('GET', `/payouts?account_number=${encodeURIComponent(this.accountNumber)}&reference_id=${encodeURIComponent(referenceId)}`);
    const hit = (r.items ?? []).find((x) => x.reference_id === referenceId);
    return hit ? toPayout(hit) : null;
  }

  /** X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret), hex — same scheme as Razorpay payments. */
  parseWebhook(raw: Buffer, h: Record<string, string | string[] | undefined>): PayoutWebhookEvent | null {
    const sig = header(h, 'x-razorpay-signature');
    if (!sig || !sameHex(hmacHex(this.webhookSecret, raw), sig)) return null;
    const body = JSON.parse(raw.toString('utf8')) as { event: string; payload?: { payout?: { entity?: RxPayout }; 'fund_account.validation'?: { entity?: RxValidation } } };
    const eventId = header(h, 'x-razorpay-event-id') ?? hmacHex('event', raw).slice(0, 32);
    const p = body.payload?.payout?.entity;
    if (body.event.startsWith('payout.') && p?.id) return { kind: 'payout', eventId, payout: toPayout(p) };
    const v = body.payload?.['fund_account.validation']?.entity;
    if (body.event.startsWith('fund_account.validation') && v?.id) return { kind: 'validation', eventId, validation: toValidation(v) };
    return { kind: 'ignored', eventId, type: body.event };
  }
}

/**
 * Development and tests: the same contract with no network. Accounts ending in 0000 are "invalid" at the
 * bank; payouts follow `payoutMode`. Env validation refuses it in staging/production.
 */
export class FakePayoutProvider implements PayoutProvider {
  readonly name = 'fake';
  static readonly SECRET = 'fake-payout-secret-for-development-only';
  static payoutMode: 'processed' | 'pending' | 'outage' | 'refuse' = 'processed';
  static validationMode: 'instant' | 'pending' = 'instant';
  static readonly payouts = new Map<string, ProviderPayout & { amountPaise: number }>();
  private static readonly accounts = new Map<string, { name: string; active: boolean }>();
  private static readonly validations = new Map<string, { v: Validation; fundAccountId: string }>();

  async addBeneficiary(b: Beneficiary) {
    const fundAccountId = `fake_fa_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    FakePayoutProvider.accounts.set(fundAccountId, { name: (b.bank?.holderName ?? b.name).toUpperCase(), active: !(b.bank?.accountNumber ?? '').endsWith('0000') && !(b.vpa ?? '').startsWith('invalid') });
    return { contactId: `fake_cont_${randomUUID().replace(/-/g, '').slice(0, 14)}`, fundAccountId };
  }

  private static result(fundAccountId: string, validationId: string): Validation {
    const a = FakePayoutProvider.accounts.get(fundAccountId);
    return { validationId, status: 'completed', accountActive: !!a?.active, registeredName: a?.active ? a.name : undefined };
  }

  async validate(fundAccountId: string) {
    const validationId = `fake_fav_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const v: Validation = FakePayoutProvider.validationMode === 'pending' ? { validationId, status: 'pending' } : FakePayoutProvider.result(fundAccountId, validationId);
    FakePayoutProvider.validations.set(validationId, { v, fundAccountId });
    return v;
  }

  async getValidation(validationId: string) {
    const x = FakePayoutProvider.validations.get(validationId);
    if (!x) throw new PayoutError('unknown validation', false);
    return x.v.status === 'pending' ? FakePayoutProvider.result(x.fundAccountId, validationId) : x.v;
  }

  async payout(p: { fundAccountId: string; amountPaise: number; referenceId: string }) {
    const again = [...FakePayoutProvider.payouts.values()].find((x) => x.referenceId === p.referenceId);
    if (again) return again; // idempotent, like X-Payout-Idempotency
    const mode = FakePayoutProvider.payoutMode;
    if (mode === 'outage') throw new PayoutError('fake payouts: temporarily unavailable', true);
    if (mode === 'refuse') throw new PayoutError('fake payouts: insufficient balance', false);
    const out = { payoutId: `fake_pout_${randomUUID().replace(/-/g, '').slice(0, 14)}`, status: mode, referenceId: p.referenceId, amountPaise: p.amountPaise, utr: mode === 'processed' ? `FAKEUTR${Date.now()}` : undefined };
    FakePayoutProvider.payouts.set(out.payoutId, out);
    return out;
  }

  async getPayout(payoutId: string) {
    const p = FakePayoutProvider.payouts.get(payoutId);
    if (!p) throw new PayoutError('unknown payout', false);
    return p;
  }

  async findPayout(referenceId: string) {
    return [...FakePayoutProvider.payouts.values()].find((x) => x.referenceId === referenceId) ?? null;
  }

  /** Tests: the bank completes, fails or reverses a payout later. */
  static settle(payoutId: string, status: ProviderPayout['status'], failureReason?: string) {
    const p = FakePayoutProvider.payouts.get(payoutId);
    if (p) Object.assign(p, { status, failureReason, utr: status === 'processed' ? `FAKEUTR${Date.now()}` : p.utr });
  }

  parseWebhook(raw: Buffer, h: Record<string, string | string[] | undefined>) {
    return new RazorpayXProvider('k', 's', 'acc', FakePayoutProvider.SECRET).parseWebhook(raw, h);
  }

  static signWebhook(raw: string) {
    return hmacHex(FakePayoutProvider.SECRET, raw);
  }
}
