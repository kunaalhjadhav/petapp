import { createHmac } from 'crypto';
import { FakePayoutProvider, PayoutError, RazorpayXProvider } from './payout.provider';

const hmac = (s: string, d: string) => createHmac('sha256', s).update(d).digest('hex');

describe('RazorpayXProvider', () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (responses: Record<string, unknown>, status = 200) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(responses).find((k) => url.includes(k))!;
      return new Response(JSON.stringify(responses[key]), { status });
    }) as unknown as typeof fetch;
  beforeEach(() => (calls.length = 0));

  it('registers a bank account as a contact plus fund account, and validates it from our account', async () => {
    const x = new RazorpayXProvider('k', 's', '2323230000000000', 'w', fetchFn({ '/contacts': { id: 'cont_1' }, '/fund_accounts/validations': { id: 'fav_1', status: 'completed', results: { account_status: 'active', registered_name: 'MEERA SHARMA' } }, '/fund_accounts': { id: 'fa_1' } }));
    expect(await x.addBeneficiary({ referenceId: 'VENDOR:1', name: 'Wag & Co', type: 'vendor', bank: { holderName: 'Meera Sharma', ifsc: 'HDFC0001234', accountNumber: '50100123456789' } })).toEqual({ contactId: 'cont_1', fundAccountId: 'fa_1' });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ contact_id: 'cont_1', account_type: 'bank_account', bank_account: { name: 'Meera Sharma', ifsc: 'HDFC0001234', account_number: '50100123456789' } });
    expect(await x.validate('fa_1')).toEqual({ validationId: 'fav_1', status: 'completed', accountActive: true, registeredName: 'MEERA SHARMA' });
    expect(JSON.parse(String(calls[2].init.body))).toMatchObject({ account_number: '2323230000000000', fund_account: { id: 'fa_1' }, amount: 100 });
  });

  it('pays out with our id as reference and idempotency key, and maps statuses', async () => {
    const x = new RazorpayXProvider('k', 's', 'acc', 'w', fetchFn({ '/payouts': { id: 'pout_1', status: 'processing', reference_id: 'our-id' } }));
    expect(await x.payout({ fundAccountId: 'fa_1', amountPaise: 31060, mode: 'IMPS', referenceId: 'our-id', narration: 'PetApp payout PB-1' })).toMatchObject({ payoutId: 'pout_1', status: 'pending', referenceId: 'our-id' });
    expect((calls[0].init.headers as Record<string, string>)['X-Payout-Idempotency']).toBe('our-id');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ amount: 31060, mode: 'IMPS', reference_id: 'our-id', purpose: 'payout', narration: 'PetApp payout PB1' });
    for (const [s, want] of [['processed', 'processed'], ['reversed', 'reversed'], ['rejected', 'failed'], ['queued', 'pending']] as const) {
      const y = new RazorpayXProvider('k', 's', 'acc', 'w', fetchFn({ '/payouts/': { id: 'p', status: s } }));
      expect((await y.getPayout('p')).status).toBe(want);
    }
  });

  it('marks errors retryable or not', async () => {
    await expect(new RazorpayXProvider('k', 's', 'a', 'w', fetchFn({ '/payouts': { error: { description: 'Insufficient balance' } } }, 400)).getPayout('x')).rejects.toMatchObject({ retryable: false });
    await expect(new RazorpayXProvider('k', 's', 'a', 'w', fetchFn({ '/payouts': {} }, 503)).getPayout('x')).rejects.toBeInstanceOf(PayoutError);
  });

  it('parses signed payout and validation webhooks', () => {
    const x = new RazorpayXProvider('k', 's', 'a', 'hook');
    const body = JSON.stringify({ event: 'payout.processed', payload: { payout: { entity: { id: 'pout_9', status: 'processed', utr: 'UTR9', reference_id: 'ref' } } } });
    expect(x.parseWebhook(Buffer.from(body), { 'x-razorpay-signature': hmac('hook', body), 'x-razorpay-event-id': 'e1' })).toEqual({ kind: 'payout', eventId: 'e1', payout: { payoutId: 'pout_9', status: 'processed', utr: 'UTR9', referenceId: 'ref', failureReason: undefined } });
    expect(x.parseWebhook(Buffer.from(body), { 'x-razorpay-signature': hmac('nope', body) })).toBeNull();
    const v = JSON.stringify({ event: 'fund_account.validation.completed', payload: { 'fund_account.validation': { entity: { id: 'fav_2', status: 'completed', results: { account_status: 'invalid' } } } } });
    expect(x.parseWebhook(Buffer.from(v), { 'x-razorpay-signature': hmac('hook', v), 'x-razorpay-event-id': 'e2' })).toMatchObject({ kind: 'validation', validation: { validationId: 'fav_2', accountActive: false } });
  });
});

describe('FakePayoutProvider', () => {
  it('rejects accounts ending in 0000 and pays idempotently', async () => {
    const f = new FakePayoutProvider();
    const bad = await f.addBeneficiary({ referenceId: 'r', name: 'n', type: 'vendor', bank: { holderName: 'A B', ifsc: 'HDFC0001234', accountNumber: '123450000' } });
    expect((await f.validate(bad.fundAccountId)).accountActive).toBe(false);
    const good = await f.addBeneficiary({ referenceId: 'r', name: 'n', type: 'vendor', bank: { holderName: 'A B', ifsc: 'HDFC0001234', accountNumber: '123451234' } });
    expect(await f.validate(good.fundAccountId)).toMatchObject({ accountActive: true, registeredName: 'A B' });
    const p1 = await f.payout({ fundAccountId: good.fundAccountId, amountPaise: 100, referenceId: 'once' });
    expect(await f.payout({ fundAccountId: good.fundAccountId, amountPaise: 100, referenceId: 'once' })).toEqual(p1);
  });
});
