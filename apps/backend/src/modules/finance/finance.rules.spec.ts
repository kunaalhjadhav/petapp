import { gstIncluded } from '../marketplace/marketplace.rules';
import { gstWithin, isReceiptFor, normalBalance, ofBps, paymentStatusAfterRefunds, refundBackoffMs, refundReceipt, splitEarning } from './finance.rules';

describe('finance rules', () => {
  it('finds the GST inside a GST-inclusive amount, the same way prices do', () => {
    expect(gstWithin(11800, 1800)).toBe(1800);
    expect(gstWithin(3588, 1800)).toBe(547); // 3588 / 1.18 = 3040.68 → 3041 net
    for (const [a, r] of [[3588, 1800], [999, 500], [12345, 1200], [1, 1800], [0, 2800]]) expect(gstWithin(a, r)).toBe(gstIncluded(a, r));
  });

  it('splits a sale between PetApp, the tax authorities and the payee, to the paisa', () => {
    // A ₹348 parcel (₹299 item + ₹49 shipping), 12% commission ₹35.88, registered seller with a PAN.
    const s = splitEarning({ customerPaise: 34800, platformDiscountPaise: 0, feePaise: 3588, taxableBasePaise: 25339, gstOnFeesBps: 1800, tcsBps: 50, tdsBps: 10 });
    expect(s).toEqual({ feeRevenuePaise: 3041, feeGstPaise: 547, tcsPaise: 127, tdsPaise: 25, payeeGrossPaise: 31212, payeeNetPaise: 31060 });
    expect(s.feeRevenuePaise + s.feeGstPaise + s.tcsPaise + s.tdsPaise + s.payeeNetPaise).toBe(34800);
  });

  it('a PetApp-funded coupon is PetApp’s cost: the seller still earns on the full price', () => {
    const s = splitEarning({ customerPaise: 9000, platformDiscountPaise: 1000, feePaise: 1000, taxableBasePaise: 0, gstOnFeesBps: 1800, tcsBps: 0, tdsBps: 0 });
    expect(s.payeeNetPaise).toBe(9000);
    expect(s.feeRevenuePaise + s.feeGstPaise + s.payeeNetPaise).toBe(9000 + 1000);
  });

  it('holds the invariant across many random sales', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let i = 0; i < 500; i++) {
      const customer = 100 + rnd(500_000);
      const discount = rnd(2) ? rnd(5_000) : 0;
      const fee = rnd(Math.floor((customer + discount) * 0.3));
      const base = rnd(customer);
      const x = { customerPaise: customer, platformDiscountPaise: discount, feePaise: fee, taxableBasePaise: base, gstOnFeesBps: 1800, tcsBps: rnd(2) ? 50 : 0, tdsBps: rnd(2) ? 10 : 500 };
      const s = splitEarning(x);
      expect(s.feeRevenuePaise + s.feeGstPaise + s.tcsPaise + s.tdsPaise + s.payeeNetPaise).toBe(customer + discount);
      expect(Math.min(s.feeRevenuePaise, s.feeGstPaise, s.tcsPaise, s.tdsPaise, s.payeeNetPaise)).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses impossible splits instead of posting nonsense', () => {
    expect(() => splitEarning({ customerPaise: 100, platformDiscountPaise: 0, feePaise: 200, taxableBasePaise: 0, gstOnFeesBps: 1800, tcsBps: 0, tdsBps: 0 })).toThrow(/fee/);
    expect(() => splitEarning({ customerPaise: 100.5, platformDiscountPaise: 0, feePaise: 0, taxableBasePaise: 0, gstOnFeesBps: 0, tcsBps: 0, tdsBps: 0 })).toThrow(/integer/);
    expect(() => splitEarning({ customerPaise: 100, platformDiscountPaise: 0, feePaise: 90, taxableBasePaise: 100_000, gstOnFeesBps: 0, tcsBps: 0, tdsBps: 500 })).toThrow(/taxes/);
  });

  it('rounds basis points to the nearest paisa', () => {
    expect(ofBps(25339, 50)).toBe(127);
    expect(ofBps(25339, 10)).toBe(25);
    expect(ofBps(25339, 500)).toBe(1267);
  });

  it('backs off refunds exponentially, capped at six hours', () => {
    expect([1, 2, 3, 4].map((n) => refundBackoffMs(n, 2) / 60_000)).toEqual([2, 4, 8, 16]);
    expect(refundBackoffMs(20, 2)).toBe(360 * 60_000);
  });

  it('derives the payment status from its refunds', () => {
    expect(paymentStatusAfterRefunds(1000, 0, 0)).toBe('CAPTURED');
    expect(paymentStatusAfterRefunds(1000, 400, 0)).toBe('CAPTURED');
    expect(paymentStatusAfterRefunds(1000, 400, 400)).toBe('PARTIALLY_REFUNDED');
    expect(paymentStatusAfterRefunds(1000, 1000, 400)).toBe('REFUND_PENDING');
    expect(paymentStatusAfterRefunds(1000, 1000, 1000)).toBe('REFUNDED');
  });

  it('shows balances in each account’s normal direction', () => {
    expect(normalBalance('ASSET', 500, 200)).toBe(300);
    expect(normalBalance('LIABILITY', 200, 500)).toBe(300);
    expect(normalBalance('EXPENSE', 50, 0)).toBe(50);
    expect(normalBalance('REVENUE', 0, 70)).toBe(70);
  });

  it('gives each refund attempt its own gateway receipt, traceable to the refund', () => {
    const id = '3f2b8c1e-4d5a-4b6c-8e7f-0123456789ab';
    expect(refundReceipt(id, 1)).toBe('3f2b8c1e4d5a4b6c8e7f0123456789ab-1');
    expect(refundReceipt(id, 999).length).toBeLessThanOrEqual(40); // Razorpay's receipt limit
    expect(isReceiptFor(refundReceipt(id, 7), id)).toBe(true);
    expect(isReceiptFor('3f2b8c1e4d5a4b6c8e7f0123456789abc-1', id)).toBe(false);
    expect(isReceiptFor(undefined, id)).toBe(false);
  });
});
