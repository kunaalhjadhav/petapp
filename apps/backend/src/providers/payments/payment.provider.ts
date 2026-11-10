import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type WebhookEvent =
  | { kind: 'captured'; eventId: string; orderId: string; paymentId: string; amountPaise: number }
  | { kind: 'failed'; eventId: string; orderId: string; paymentId: string; reason: string }
  | { kind: 'refund_processed'; eventId: string; refundId: string; paymentId: string; amountPaise: number }
  | { kind: 'refund_failed'; eventId: string; refundId: string; paymentId: string; amountPaise: number }
  | { kind: 'ignored'; eventId: string; type: string };

/** A refund as the gateway sees it. `pending` means accepted and in progress (banks can take days). */
export interface GatewayRefund {
  refundId: string;
  status: 'pending' | 'processed' | 'failed';
  amountPaise: number;
  /** Our reference, echoed back by the gateway (Razorpay: `receipt`). */
  receipt?: string;
}

/** A payment attempt on one of our orders, as the gateway sees it. */
export interface GatewayPayment {
  paymentId: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  amountPaise: number;
  amountRefundedPaise: number;
}

/** The gateway refused or couldn't be reached. `retryable` false means trying again won't help (e.g. already fully refunded). */
export class GatewayError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export interface PaymentProvider {
  readonly name: string;
  /** Public key the app's checkout needs (never the secret). */
  readonly publicKey: string;
  createOrder(amountPaise: number, currency: string, receipt: string, notes: Record<string, string>): Promise<{ orderId: string }>;
  /** The checkout callback's signature — proves the payment really happened for this order. */
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  /** Verifies and parses a webhook. Returns null if the signature is wrong. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent | null;
  /**
   * Refunds part or all of a captured payment. `receipt` is our refund id: it's sent as the idempotency key
   * and stored by the gateway, so a retry after a timeout can't refund twice. Throws GatewayError.
   */
  refund(providerPaymentId: string, amountPaise: number, receipt: string, notes: Record<string, string>): Promise<GatewayRefund>;
  /** Refunds already made on a payment (to find one we asked for before a timeout). */
  listRefunds(providerPaymentId: string): Promise<GatewayRefund[]>;
  /** Payment attempts on an order (reconciliation: did a capture happen that we never heard about?). */
  orderPayments(orderId: string): Promise<GatewayPayment[]>;
  /** Transfers from the gateway to PetApp's bank between two times (processed ones only). */
  listSettlements(from: Date, to: Date): Promise<GatewaySettlementInfo[]>;
}

export interface GatewaySettlementInfo {
  settlementId: string;
  /** What reached the bank. */
  amountPaise: number;
  /** The gateway's fees, GST included. */
  feesPaise: number;
  /** The GST inside the fees. */
  taxPaise: number;
  utr?: string;
  settledAt: Date;
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

interface RazorpayWebhook {
  event: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; error_description?: string } };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
  };
}

interface RazorpayRefund {
  id: string;
  amount: number;
  status: string;
  receipt?: string | null;
}

const refundStatus = (s: string): GatewayRefund['status'] => (s === 'processed' ? 'processed' : s === 'failed' ? 'failed' : 'pending');
const toRefund = (r: RazorpayRefund): GatewayRefund => ({ refundId: r.id, status: refundStatus(r.status), amountPaise: Number(r.amount), receipt: r.receipt ?? undefined });

/** Razorpay: Orders API + checkout signature + webhooks (https://razorpay.com/docs/payments/). */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get publicKey() {
    return this.keyId;
  }

  private get auth() {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  /** Calls the API; 5xx, 429 and network errors are retryable, other 4xx are not. */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`https://api.razorpay.com/v1${path}`, {
        signal: AbortSignal.timeout(30_000), // well inside the refund worker's 10-minute in-flight window
        method,
        headers: { Authorization: this.auth, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new GatewayError(`Razorpay unreachable: ${(e as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new GatewayError(`Razorpay ${method} ${path} failed (${res.status}): ${json.error?.description ?? 'unknown error'}`, res.status >= 500 || res.status === 429);
    return json;
  }

  /** POST /payments/:id/refund. X-Refund-Idempotency makes a repeated request return the same refund. */
  async refund(providerPaymentId: string, amountPaise: number, receipt: string, notes: Record<string, string>) {
    const r = await this.call<RazorpayRefund>('POST', `/payments/${encodeURIComponent(providerPaymentId)}/refund`, { amount: amountPaise, speed: 'normal', receipt: receipt.slice(0, 40), notes }, { 'X-Refund-Idempotency': receipt });
    return toRefund(r);
  }

  async listRefunds(providerPaymentId: string) {
    const r = await this.call<{ items?: RazorpayRefund[] }>('GET', `/payments/${encodeURIComponent(providerPaymentId)}/refunds?count=100`);
    return (r.items ?? []).map(toRefund);
  }

  async listSettlements(from: Date, to: Date) {
    const out: GatewaySettlementInfo[] = [];
    for (let skip = 0; skip < 10_000; skip += 100) {
      const r = await this.call<{ items?: Array<{ id: string; amount: number; fees: number; tax: number; utr?: string | null; status: string; created_at: number }> }>(
        'GET', `/settlements?from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(to.getTime() / 1000)}&count=100&skip=${skip}`);
      const items = r.items ?? [];
      for (const x of items) {
        if (x.status === 'processed') out.push({ settlementId: x.id, amountPaise: Number(x.amount), feesPaise: Number(x.fees), taxPaise: Number(x.tax), utr: x.utr ?? undefined, settledAt: new Date(x.created_at * 1000) });
      }
      if (items.length < 100) break;
    }
    return out;
  }

  async orderPayments(orderId: string) {
    const r = await this.call<{ items?: Array<{ id: string; status: string; amount: number; amount_refunded?: number }> }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    return (r.items ?? []).map((p) => ({ paymentId: p.id, status: p.status, amountPaise: Number(p.amount), amountRefundedPaise: Number(p.amount_refunded ?? 0) }));
  }

  async createOrder(amountPaise: number, currency: string, receipt: string, notes: Record<string, string>) {
    const res = await this.fetchFn('https://api.razorpay.com/v1/orders', {
      signal: AbortSignal.timeout(30_000),
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency, receipt: receipt.slice(0, 40), notes }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
    if (!res.ok || !body.id) throw new Error(`Razorpay order failed (${res.status}): ${body.error?.description ?? 'unknown error'}`);
    return { orderId: body.id };
  }

  /** Razorpay: signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret), hex. */
  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    return sameHex(hmacHex(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  /** Razorpay: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook_secret), hex. */
  parseWebhook(raw: Buffer, h: Record<string, string | string[] | undefined>): WebhookEvent | null {
    const sig = header(h, 'x-razorpay-signature');
    if (!sig || !sameHex(hmacHex(this.webhookSecret, raw), sig)) return null;
    const body = JSON.parse(raw.toString('utf8')) as RazorpayWebhook;
    const eventId = header(h, 'x-razorpay-event-id') ?? hmacHex('event', raw).slice(0, 32);
    const p = body.payload?.payment?.entity;
    if ((body.event === 'payment.captured' || body.event === 'order.paid') && p?.order_id && p.id) {
      return { kind: 'captured', eventId, orderId: p.order_id, paymentId: p.id, amountPaise: Number(p.amount ?? 0) };
    }
    if (body.event === 'payment.failed' && p?.order_id && p.id) {
      return { kind: 'failed', eventId, orderId: p.order_id, paymentId: p.id, reason: p.error_description ?? 'Payment failed' };
    }
    const r = body.payload?.refund?.entity;
    if ((body.event === 'refund.processed' || body.event === 'refund.failed') && r?.id && r.payment_id) {
      const base = { eventId, refundId: r.id, paymentId: r.payment_id, amountPaise: Number(r.amount ?? 0) };
      return body.event === 'refund.processed' ? { kind: 'refund_processed', ...base } : { kind: 'refund_failed', ...base };
    }
    return { kind: 'ignored', eventId, type: body.event };
  }
}

/**
 * Development and tests: same contract and signature scheme as Razorpay, no network.
 * Env validation refuses it in staging/production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly publicKey = 'fake_key';
  static readonly SECRET = 'fake-payment-secret-for-development-only';

  /**
   * How refunds behave, for tests and local runs: settle at once (default), stay pending until a webhook,
   * or fail as a gateway outage would (retryable) or as a refusal (not retryable).
   */
  static refundMode: 'processed' | 'pending' | 'outage' | 'refuse' = 'processed';
  /** Refunds made so far, per payment (this process only). */
  static readonly refunds = new Map<string, GatewayRefund[]>();
  /** Captures made through `checkout` (this process only), per order. */
  static readonly payments = new Map<string, GatewayPayment[]>();

  async refund(providerPaymentId: string, amountPaise: number, receipt: string): Promise<GatewayRefund> {
    const mode = FakePaymentProvider.refundMode;
    if (mode === 'outage') throw new GatewayError('fake gateway: temporarily unavailable', true);
    if (mode === 'refuse') throw new GatewayError('fake gateway: the refund amount exceeds what can be refunded', false);
    const list = FakePaymentProvider.refunds.get(providerPaymentId) ?? [];
    const again = list.find((r) => r.receipt === receipt);
    if (again) return again; // idempotent, like X-Refund-Idempotency
    const r: GatewayRefund = { refundId: `fake_rfnd_${randomUUID().replace(/-/g, '').slice(0, 14)}`, status: mode, amountPaise, receipt };
    FakePaymentProvider.refunds.set(providerPaymentId, [...list, r]);
    return r;
  }

  async listRefunds(providerPaymentId: string) {
    return FakePaymentProvider.refunds.get(providerPaymentId) ?? [];
  }

  /** Tests: the fake gateway finishes (or fails) a pending refund, as a bank would later. */
  static settle(refundId: string, status: 'processed' | 'failed') {
    for (const list of FakePaymentProvider.refunds.values()) for (const r of list) if (r.refundId === refundId) r.status = status;
  }

  /** Settlements the fake gateway "made" (tests add them). */
  static readonly settlements: GatewaySettlementInfo[] = [];

  async listSettlements(from: Date, to: Date) {
    return FakePaymentProvider.settlements.filter((x) => x.settledAt >= from && x.settledAt <= to);
  }

  async orderPayments(orderId: string) {
    return (FakePaymentProvider.payments.get(orderId) ?? []).map((p) => ({
      ...p,
      amountRefundedPaise: (FakePaymentProvider.refunds.get(p.paymentId) ?? []).filter((r) => r.status === 'processed').reduce((a, r) => a + r.amountPaise, 0),
    }));
  }

  async createOrder() {
    return { orderId: `fake_order_${randomUUID().replace(/-/g, '')}` };
  }

  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    return sameHex(hmacHex(FakePaymentProvider.SECRET, `${orderId}|${paymentId}`), signature);
  }

  parseWebhook(raw: Buffer, h: Record<string, string | string[] | undefined>) {
    return new RazorpayProvider('fake_key', FakePaymentProvider.SECRET, FakePaymentProvider.SECRET).parseWebhook(raw, h);
  }

  /** What a real checkout would hand back to the app. */
  static checkout(orderId: string, amountPaise = 0) {
    const paymentId = `fake_pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    FakePaymentProvider.payments.set(orderId, [...(FakePaymentProvider.payments.get(orderId) ?? []), { paymentId, status: 'captured', amountPaise, amountRefundedPaise: 0 }]);
    return { paymentId, signature: hmacHex(FakePaymentProvider.SECRET, `${orderId}|${paymentId}`) };
  }

  static signWebhook(raw: string) {
    return hmacHex(FakePaymentProvider.SECRET, raw);
  }
}
