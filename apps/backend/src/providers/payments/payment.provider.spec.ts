import { createHmac } from 'crypto';
import { FakePaymentProvider, GatewayError, RazorpayProvider } from './payment.provider';

const hmac = (s: string, d: string) => createHmac('sha256', s).update(d).digest('hex');

describe('RazorpayProvider', () => {
  const rp = (fetchFn?: typeof fetch) => new RazorpayProvider('rzp_test_key', 'key-secret', 'hook-secret', fetchFn);

  it('verifies the checkout signature exactly as Razorpay documents it', () => {
    const sig = hmac('key-secret', 'order_ABC|pay_XYZ');
    expect(rp().verifyCheckout('order_ABC', 'pay_XYZ', sig)).toBe(true);
    expect(rp().verifyCheckout('order_ABC', 'pay_OTHER', sig)).toBe(false);
    expect(rp().verifyCheckout('order_ABC', 'pay_XYZ', 'not-hex')).toBe(false);
  });

  it('rejects webhooks with a bad signature and parses good ones', () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 19900 } } } });
    expect(rp().parseWebhook(Buffer.from(body), { 'x-razorpay-signature': hmac('wrong', body) })).toBeNull();
    expect(rp().parseWebhook(Buffer.from(body), { 'x-razorpay-signature': hmac('hook-secret', body), 'x-razorpay-event-id': 'evt_1' })).toEqual({
      kind: 'captured', eventId: 'evt_1', orderId: 'order_1', paymentId: 'pay_1', amountPaise: 19900,
    });
    const tampered = body.replace('19900', '100');
    expect(rp().parseWebhook(Buffer.from(tampered), { 'x-razorpay-signature': hmac('hook-secret', body) })).toBeNull();
  });

  it('parses failures and ignores other events', () => {
    const failed = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_2', error_description: 'Card declined' } } } });
    expect(rp().parseWebhook(Buffer.from(failed), { 'x-razorpay-signature': hmac('hook-secret', failed), 'x-razorpay-event-id': 'e2' })).toMatchObject({ kind: 'failed', reason: 'Card declined' });
    const other = JSON.stringify({ event: 'refund.created' });
    expect(rp().parseWebhook(Buffer.from(other), { 'x-razorpay-signature': hmac('hook-secret', other), 'x-razorpay-event-id': 'e3' })).toEqual({ kind: 'ignored', eventId: 'e3', type: 'refund.created' });
  });

  it('creates orders with basic auth and amount in paise', async () => {
    let sent: RequestInit | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify({ id: 'order_NEW' }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(rp(fetchFn).createOrder(19900, 'INR', 'contest:abc', { contestId: 'abc' })).resolves.toEqual({ orderId: 'order_NEW' });
    expect((sent!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('rzp_test_key:key-secret').toString('base64')}`);
    expect(JSON.parse(String(sent!.body))).toMatchObject({ amount: 19900, currency: 'INR' });
    const failing = (async () => new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(rp(failing).createOrder(100, 'INR', 'r', {})).rejects.toThrow(/Authentication failed/);
  });
});

describe('RazorpayProvider refunds', () => {
  const rp = (fetchFn: typeof fetch) => new RazorpayProvider('rzp_test_key', 'key-secret', 'hook-secret', fetchFn);

  it('refunds with our id as receipt and idempotency key, and maps the status', async () => {
    let url = '';
    let sent: RequestInit | undefined;
    const fetchFn = (async (u: string, init: RequestInit) => {
      url = u;
      sent = init;
      return new Response(JSON.stringify({ id: 'rfnd_1', amount: 5000, status: 'processed', receipt: 'our-id' }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(rp(fetchFn).refund('pay_9', 5000, 'our-id', { reason: 'RETURN' })).resolves.toEqual({ refundId: 'rfnd_1', status: 'processed', amountPaise: 5000, receipt: 'our-id' });
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_9/refund');
    expect((sent!.headers as Record<string, string>)['X-Refund-Idempotency']).toBe('our-id');
    expect(JSON.parse(String(sent!.body))).toMatchObject({ amount: 5000, receipt: 'our-id', speed: 'normal' });
  });

  it('marks gateway errors retryable or not', async () => {
    const respond = (status: number) => (async () => new Response(JSON.stringify({ error: { description: 'nope' } }), { status })) as unknown as typeof fetch;
    await expect(rp(respond(400)).refund('p', 1, 'r', {})).rejects.toMatchObject({ retryable: false });
    await expect(rp(respond(502)).refund('p', 1, 'r', {})).rejects.toMatchObject({ retryable: true });
    await expect(rp(respond(429)).refund('p', 1, 'r', {})).rejects.toMatchObject({ retryable: true });
    const down = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(rp(down).refund('p', 1, 'r', {})).rejects.toBeInstanceOf(GatewayError);
  });

  it('lists refunds and order payments', async () => {
    const fetchFn = (async (u: string) =>
      new Response(JSON.stringify(u.includes('/refunds') ? { items: [{ id: 'rfnd_2', amount: 100, status: 'pending', receipt: 'x' }] } : { items: [{ id: 'pay_3', status: 'captured', amount: 900, amount_refunded: 100 }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(rp(fetchFn).listRefunds('pay_3')).resolves.toEqual([{ refundId: 'rfnd_2', status: 'pending', amountPaise: 100, receipt: 'x' }]);
    await expect(rp(fetchFn).orderPayments('order_3')).resolves.toEqual([{ paymentId: 'pay_3', status: 'captured', amountPaise: 900, amountRefundedPaise: 100 }]);
  });

  it('parses signed refund webhooks', () => {
    const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_5', payment_id: 'pay_5', amount: 700, status: 'processed' } } } });
    expect(new RazorpayProvider('k', 's', 'hook-secret').parseWebhook(Buffer.from(body), { 'x-razorpay-signature': hmac('hook-secret', body), 'x-razorpay-event-id': 'e9' })).toEqual({
      kind: 'refund_processed', eventId: 'e9', refundId: 'rfnd_5', paymentId: 'pay_5', amountPaise: 700,
    });
  });
});

describe('FakePaymentProvider', () => {
  it('produces checkouts its own verifier accepts, and nothing else', async () => {
    const f = new FakePaymentProvider();
    const { orderId } = await f.createOrder();
    const { paymentId, signature } = FakePaymentProvider.checkout(orderId);
    expect(f.verifyCheckout(orderId, paymentId, signature)).toBe(true);
    expect(f.verifyCheckout(orderId, paymentId, hmac('guess', `${orderId}|${paymentId}`))).toBe(false);
  });

  it('refunds idempotently by receipt, and can simulate outages and refusals', async () => {
    const f = new FakePaymentProvider();
    const a = await f.refund('pay_x', 100, 'r1');
    expect(await f.refund('pay_x', 100, 'r1')).toEqual(a);
    expect(await f.listRefunds('pay_x')).toHaveLength(1);
    FakePaymentProvider.refundMode = 'outage';
    await expect(f.refund('pay_x', 100, 'r2')).rejects.toMatchObject({ retryable: true });
    FakePaymentProvider.refundMode = 'refuse';
    await expect(f.refund('pay_x', 100, 'r2')).rejects.toMatchObject({ retryable: false });
    FakePaymentProvider.refundMode = 'processed';
  });
});
