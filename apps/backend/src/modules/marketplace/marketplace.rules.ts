// Pure marketplace money rules. Integer paise, basis points. Unit tested without a database.

/** GST contained in a GST-inclusive amount: ₹118 at 18% contains ₹18. */
export function gstIncluded(amountPaise: number, rateBps: number): number {
  return Math.round((amountPaise * rateBps) / (10_000 + rateBps));
}

/** Splits `total` across `weights` exactly (largest remainder). Zero weights get zero. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      out[i]++;
      left--;
    }
  }
  return out;
}

export interface ShippingRule {
  flatPaise: number;
  freeAbovePaise: number;
}

/** Per vendor parcel: free at or above the threshold (after discount), else flat. */
export const shippingFor = (netItemsPaise: number, r: ShippingRule) => (netItemsPaise >= r.freeAbovePaise ? 0 : r.flatPaise);

export interface CouponRule {
  code: string;
  kind: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  vendorId: string | null;
}

export interface QuoteLine {
  variantId: string;
  vendorId: string;
  qty: number;
  unitPricePaise: number;
  gstRateBps: number;
  commissionBps: number;
}

export interface VendorQuote {
  vendorId: string;
  lines: Array<QuoteLine & { lineTotalPaise: number; discountPaise: number; gstPaise: number; commissionPaise: number }>;
  itemsPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  commissionPaise: number;
  /** What the vendor is owed: net items (after any vendor-funded discount) − commission + shipping they deliver. */
  vendorEarningPaise: number;
  /** What PetApp keeps: commission − any platform-funded discount (may be negative: that's marketing spend). */
  platformNetPaise: number;
}

export interface Quote {
  vendors: VendorQuote[];
  itemsPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  coupon: { code: string; discountPaise: number; fundedBy: 'PLATFORM' | 'VENDOR' } | null;
  couponProblem: string | null;
}

/** Discount a coupon gives on the eligible amount, or a reason it doesn't apply. */
export function couponDiscount(c: CouponRule, eligiblePaise: number): { discountPaise: number; problem: string | null } {
  if (eligiblePaise <= 0) return { discountPaise: 0, problem: 'This coupon doesn’t apply to anything in your cart.' };
  if (eligiblePaise < c.minOrderPaise) {
    return { discountPaise: 0, problem: `Add ₹${((c.minOrderPaise - eligiblePaise) / 100).toFixed(2).replace(/\.00$/, '')} more to use ${c.code}.` };
  }
  let d = c.kind === 'PERCENT' ? Math.floor((eligiblePaise * c.value) / 10_000) : c.value;
  if (c.maxDiscountPaise !== null) d = Math.min(d, c.maxDiscountPaise);
  return { discountPaise: Math.min(d, eligiblePaise), problem: null };
}

/**
 * Prices a cart: per-vendor sub-orders, coupon discount allocated exactly across eligible lines,
 * shipping per vendor, commission on the net price of each line.
 * Invariant (tested): for every vendor, totalPaise = vendorEarningPaise + platformNetPaise.
 */
export function quote(lines: QuoteLine[], coupon: CouponRule | null, ship: ShippingRule): Quote {
  const priced = lines.map((l) => ({ ...l, lineTotalPaise: l.unitPricePaise * l.qty }));
  const eligible = priced.map((l) => (coupon && (coupon.vendorId === null || coupon.vendorId === l.vendorId) ? l.lineTotalPaise : 0));
  let couponProblem: string | null = null;
  let discount = 0;
  if (coupon) {
    const r = couponDiscount(coupon, eligible.reduce((a, b) => a + b, 0));
    discount = r.discountPaise;
    couponProblem = r.problem;
  }
  const lineDiscounts = allocate(discount, eligible);
  const vendorFunded = coupon?.vendorId != null;

  const byVendor = new Map<string, VendorQuote['lines']>();
  priced.forEach((l, i) => {
    const net = l.lineTotalPaise - (vendorFunded ? lineDiscounts[i] : 0);
    const out = {
      ...l,
      discountPaise: lineDiscounts[i],
      gstPaise: gstIncluded(l.lineTotalPaise - lineDiscounts[i], l.gstRateBps),
      // Platform-funded discounts are PetApp's cost: the vendor's commission base stays the full price.
      commissionPaise: Math.round((net * l.commissionBps) / 10_000),
    };
    byVendor.set(l.vendorId, [...(byVendor.get(l.vendorId) ?? []), out]);
  });

  const vendors: VendorQuote[] = [...byVendor.entries()].map(([vendorId, ls]) => {
    const itemsPaise = ls.reduce((a, l) => a + l.lineTotalPaise, 0);
    const discountPaise = ls.reduce((a, l) => a + l.discountPaise, 0);
    const commissionPaise = ls.reduce((a, l) => a + l.commissionPaise, 0);
    const shippingPaise = shippingFor(itemsPaise - discountPaise, ship);
    const vendorDiscount = vendorFunded ? discountPaise : 0;
    const vendorEarningPaise = itemsPaise - vendorDiscount - commissionPaise + shippingPaise;
    const platformNetPaise = commissionPaise - (vendorFunded ? 0 : discountPaise);
    return { vendorId, lines: ls, itemsPaise, discountPaise, shippingPaise, totalPaise: itemsPaise - discountPaise + shippingPaise, commissionPaise, vendorEarningPaise, platformNetPaise };
  });

  const sum = (k: 'itemsPaise' | 'discountPaise' | 'shippingPaise' | 'totalPaise') => vendors.reduce((a, v) => a + v[k], 0);
  return {
    vendors,
    itemsPaise: sum('itemsPaise'),
    discountPaise: sum('discountPaise'),
    shippingPaise: sum('shippingPaise'),
    totalPaise: sum('totalPaise'),
    coupon: coupon && discount > 0 ? { code: coupon.code, discountPaise: discount, fundedBy: vendorFunded ? 'VENDOR' : 'PLATFORM' } : null,
    couponProblem,
  };
}

/** Returns are accepted within `days` of delivery. */
export const returnWindowOpen = (deliveredAt: Date | null, now: Date, days: number) =>
  deliveredAt !== null && now.getTime() - deliveredAt.getTime() <= days * 86_400_000;

/** Readable order codes without look-alike characters: "PO-7KX9M2QH". */
export function orderCode(prefix: string, bytes: Uint8Array): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `${prefix}-${Array.from(bytes.slice(0, 8), (b) => alphabet[b % 32]).join('')}`;
}

export type InventoryStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'DISCONTINUED';

/** A variant's inventory status, as sellers see it. Discontinued = deactivated by the seller. */
export function inventoryStatus(v: { stock: number; isActive: boolean }, lowStockThreshold: number): InventoryStatus {
  if (!v.isActive) return 'DISCONTINUED';
  if (v.stock <= 0) return 'OUT_OF_STOCK';
  return v.stock <= lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK';
}
