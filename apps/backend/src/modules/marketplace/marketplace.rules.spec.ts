import { allocate, couponDiscount, gstIncluded, inventoryStatus, orderCode, quote, returnWindowOpen, shippingFor, type CouponRule, type QuoteLine } from './marketplace.rules';

const ship = { flatPaise: 49_00, freeAbovePaise: 499_00 };
const line = (vendorId: string, unit: number, qty = 1, commissionBps = 1000, gst = 1800): QuoteLine => ({ variantId: `${vendorId}-${unit}`, vendorId, qty, unitPricePaise: unit, gstRateBps: gst, commissionBps });
const coupon = (c: Partial<CouponRule>): CouponRule => ({ code: 'PETS10', kind: 'PERCENT', value: 1000, maxDiscountPaise: null, minOrderPaise: 0, vendorId: null, ...c });

describe('gst and allocation', () => {
  it('extracts GST from inclusive prices', () => {
    expect(gstIncluded(118_00, 1800)).toBe(18_00);
    expect(gstIncluded(105_00, 500)).toBe(5_00);
    expect(gstIncluded(100_00, 0)).toBe(0);
  });
  it('allocates exactly, never inventing or losing a paisa', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [0, 5, 5])).toEqual([0, 5, 5]);
    expect(allocate(0, [3, 4])).toEqual([0, 0]);
    for (let n = 1; n < 200; n++) {
      const w = [n % 7, (n * 3) % 11 + 1, (n * 5) % 13];
      expect(allocate(n * 37, w).reduce((a, b) => a + b, 0)).toBe(n * 37);
    }
  });
});

describe('coupons', () => {
  it('percent with a cap, flat clipped to the order, minimum order', () => {
    expect(couponDiscount(coupon({ value: 2000, maxDiscountPaise: 100_00 }), 1000_00).discountPaise).toBe(100_00);
    expect(couponDiscount(coupon({ kind: 'FLAT', value: 500_00 }), 300_00).discountPaise).toBe(300_00);
    expect(couponDiscount(coupon({ minOrderPaise: 599_00 }), 450_00)).toEqual({ discountPaise: 0, problem: 'Add ₹149 more to use PETS10.' });
  });
});

describe('quote', () => {
  it('splits by vendor, ships per vendor, and charges commission per line', () => {
    const q = quote([line('A', 300_00, 2), line('B', 120_00)], null, ship);
    expect(q.vendors.map((v) => [v.vendorId, v.itemsPaise, v.shippingPaise, v.totalPaise, v.commissionPaise])).toEqual([
      ['A', 600_00, 0, 600_00, 60_00],
      ['B', 120_00, 49_00, 169_00, 12_00],
    ]);
    expect(q.totalPaise).toBe(769_00);
  });

  it('a platform coupon is PetApp’s cost: vendors earn on the full price', () => {
    const q = quote([line('A', 600_00), line('B', 400_00)], coupon({ value: 1000 }), ship);
    expect(q.coupon).toEqual({ code: 'PETS10', discountPaise: 100_00, fundedBy: 'PLATFORM' });
    const a = q.vendors.find((v) => v.vendorId === 'A')!;
    expect(a).toMatchObject({ discountPaise: 60_00, commissionPaise: 60_00, vendorEarningPaise: 540_00, platformNetPaise: 0 });
  });

  it('a vendor coupon applies only to that vendor and comes out of their earnings', () => {
    const q = quote([line('A', 600_00), line('B', 400_00)], coupon({ value: 1000, vendorId: 'B' }), ship);
    const [a, b] = ['A', 'B'].map((id) => q.vendors.find((v) => v.vendorId === id)!);
    expect(a.discountPaise).toBe(0);
    expect(b).toMatchObject({ discountPaise: 40_00, commissionPaise: 36_00, shippingPaise: 49_00, vendorEarningPaise: 400_00 - 40_00 - 36_00 + 49_00 });
    expect(q.coupon?.fundedBy).toBe('VENDOR');
  });

  it('every rupee is accounted for: total = vendor earnings + platform net, on 2,000 random carts', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const lines = Array.from({ length: 1 + rnd(6) }, () => line(['A', 'B', 'C'][rnd(3)], 1_00 + rnd(200_000), 1 + rnd(4), rnd(2500), [0, 500, 1200, 1800, 2800][rnd(5)]));
      const c = rnd(3) === 0 ? null : coupon({ kind: rnd(2) ? 'PERCENT' : 'FLAT', value: rnd(2) ? 1 + rnd(5000) : 1 + rnd(100_000), maxDiscountPaise: rnd(2) ? null : rnd(50_000), vendorId: rnd(2) ? null : 'A' });
      const q = quote(lines, c, ship);
      for (const v of q.vendors) {
        expect(v.totalPaise).toBe(v.vendorEarningPaise + v.platformNetPaise);
        expect(v.lines.reduce((a, l) => a + l.discountPaise, 0)).toBe(v.discountPaise);
        expect(v.totalPaise).toBeGreaterThanOrEqual(0);
      }
      expect(q.totalPaise).toBe(q.itemsPaise - q.discountPaise + q.shippingPaise);
      expect(q.discountPaise).toBe(q.coupon?.discountPaise ?? 0);
    }
  });

  it('shipping is decided after the discount', () => {
    expect(shippingFor(499_00, ship)).toBe(0);
    expect(shippingFor(498_99, ship)).toBe(49_00);
    const q = quote([line('A', 520_00)], coupon({ kind: 'FLAT', value: 50_00 }), ship);
    expect(q.vendors[0]).toMatchObject({ discountPaise: 50_00, shippingPaise: 49_00, totalPaise: 519_00 });
  });
});

describe('returns and codes', () => {
  it('opens returns for 7 days after delivery', () => {
    const d = new Date('2026-10-01T10:00:00Z');
    expect(returnWindowOpen(d, new Date('2026-10-08T10:00:00Z'), 7)).toBe(true);
    expect(returnWindowOpen(d, new Date('2026-10-08T10:00:01Z'), 7)).toBe(false);
    expect(returnWindowOpen(null, d, 7)).toBe(false);
  });
  it('makes readable codes', () => {
    // byte % 32 indexes '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' (no 0/O, 1/I look-alikes)
    expect(orderCode('PO', new Uint8Array([0, 1, 2, 3, 31, 32, 33, 255]))).toBe('PO-2345Z23Z');
  });
});

describe('inventoryStatus', () => {
  it('reads stock against the configured threshold; deactivated variants are discontinued', () => {
    expect(inventoryStatus({ stock: 50, isActive: true }, 5)).toBe('IN_STOCK');
    expect(inventoryStatus({ stock: 5, isActive: true }, 5)).toBe('LOW_STOCK');
    expect(inventoryStatus({ stock: 6, isActive: true }, 5)).toBe('IN_STOCK');
    expect(inventoryStatus({ stock: 0, isActive: true }, 5)).toBe('OUT_OF_STOCK');
    expect(inventoryStatus({ stock: 40, isActive: false }, 5)).toBe('DISCONTINUED');
    expect(inventoryStatus({ stock: 9, isActive: true }, 10)).toBe('LOW_STOCK'); // threshold is a setting
  });
});
