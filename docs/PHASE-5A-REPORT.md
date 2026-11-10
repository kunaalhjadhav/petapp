# Phase 5a — Product marketplace API: report

## 1. Implemented

| Area | What it does |
|---|---|
| **Vendor onboarding** | Store profile (business and legal name, optional GSTIN, phone, pickup and returns address) and private KYC documents (signed links, as for service partners). A checklist covers the ID proof, plus a GST certificate when a GSTIN is given. Vendors submit; admins approve, reject, suspend or reinstate, with a reason the vendor sees. Approval requires an accepted ID (and GST certificate when relevant) and grants the **Product partner** role. Vendors are notified |
| **Categories** | Admin-managed, one level of nesting (Food › Dog food), each with a standard commission. Browsing a parent includes its children |
| **Products** | Vendors create products with variants (SKU, MRP, GST-inclusive price, GST rate, stock). The price can't exceed the MRP, SKUs are unique per product, and only the vendor's own finished photo uploads can be used as images. A product needs a photo and an active variant to go live. Variants are deactivated, never deleted, so past orders stay intact. Admins can block a product with a reason, which removes it from the shop and from carts |
| **Shop** | Search (title and brand), filter by category, species and vendor, sort by price or newest, and product pages with "only N left" when stock is low |
| **Cart and checkout** | Quantity limits and live stock checks. The cart is re-priced on every view, with a clear problem per line ("Only 2 left", "No longer available"). Checkout preview with coupon, then place order |
| **Coupons** | Percent with a cap, or flat; minimum order; time window; total and per-user limits. **Platform-funded** coupons are PetApp's cost and vendors earn on the full price. **Vendor-funded** coupons apply only to that vendor's items and come out of their earnings. Messages are clear, e.g. "Add ₹149 more to use PETS10" or "You've already used this coupon" |
| **Orders** | One checkout, one payment, one **parcel per vendor**. Each line records the GST it contains and the commission rate. Shipping is per parcel and free above ₹499 (configurable). Every amount comes from the tested pricing rules |
| **Stock** | Reserved atomically at order time, so racing buyers can't oversell. Unpaid orders release stock and coupon uses after 30 minutes. A late payment revives the order if the stock is still free, otherwise it is refunded in full |
| **Fulfilment** | Confirmed → packed → shipped (courier and tracking required) → delivered, in that order only. The customer can cancel before packing; the vendor can cancel before shipping. Either way, that parcel is refunded in full and restocked. The order completes when every parcel is finished |
| **Returns** | Within 7 days of delivery (configurable). The vendor approves (or rejects with a reason), then marks it received. Stock is restored and the refund (item value after discount; shipping not refunded) is queued |
| **Refunds** | A `Refund` record, created once per cancellation, return or unfulfillable order, waiting for Phase 6 to execute through the gateway |
| **Notifications** | Customer: order placed (with the parcel count), shipped (with courier and tracking), delivered, cancelled (with the refund), and return decisions. Vendor: new order, customer cancellation, return requested. Store approval status |
| **Vendor earnings** | Delivered orders (sales, commission, earned), in-progress expected earnings, and months in India time |
| **Admin** | Vendor queue and review, commission override, categories, product search and blocking, orders across vendors, coupons. Every change is audited |

The marketplace is behind the **Marketplace** feature switch, which is off by default. New permissions are `marketplace.read` (Admin, Moderator) and `marketplace.manage` (Admin). New settings are the shipping fee, free-shipping threshold, return window, payment hold and maximum quantity per item.

## 2. Migration

`20261007090000_marketplace` adds 13 tables and 6 enums, plus 4 new notification types. It is purely additive. The migration-history check now rebuilds enums from their `CREATE TYPE` and later `ADD VALUE` statements. Its only unexplained difference is the PostGIS column that the 4a migration hand-wrote, which was verified to be exactly that.

## 3. Tests

| Suite | Result |
|---|---|
| API unit | **102 passed**. New: 10 marketplace rule tests, including **2,000 random carts** where every parcel's total equals vendor earnings plus platform net and discounts add up exactly; GST extraction; exact allocation; coupon caps and minimums; vendor- vs platform-funded coupons; shipping after discount; the return window; readable order codes |
| API end-to-end | **95 passed in 7 suites**. New: **8 marketplace tests**, which passed 3 runs in a row |
| Customer and partner app contracts | Both still match the updated API (227 operations) |

**What the new end-to-end tests cover:**

- **Vendor onboarding:** the GST-certificate rule, approval only with accepted documents, the role granted, and the notification.
- **Products:**
  - price above MRP and duplicate SKUs refused;
  - a photo is needed to go live, and another vendor's image can't be used;
  - parent categories include their children;
  - search, sort, and low-stock hints.
- **Checkout:**
  - every stored amount matches the pricing rules exactly;
  - a platform coupon is applied;
  - two parcels are created and stock is reserved;
  - the payment confirms the order and the customer and vendor are notified;
  - the coupon's per-user limit holds.
- **Race:** three buyers for the last two units — exactly one order is created, and stock ends at 0.
- **Fulfilment:**
  - steps must happen in order, and only the right vendor can act;
  - a shipping notification includes the courier and tracking number;
  - a customer cancellation refunds that parcel and restocks it;
  - the order completes;
  - vendor earnings match the database.
- **Returns:**
  - not before delivery;
  - a rejection needs a reason, and approval comes before receipt;
  - receipt restocks and queues the refund;
  - refused after 7 days.
- **Unpaid orders:**
  - the hold expires and stock and coupon use are released;
  - a late payment revives the order;
  - a late payment after the stock has gone is refunded in full.
- **Blocking and the feature switch:** a blocked product leaves the shop and shows as a problem in carts; the vendor can't re-list it; the feature switch hides the shop.

## 4. Bugs found and fixed during this phase

1. **The admin vendor queue's status filter would have been rejected** by the strict validation pipe, because the query parameter wasn't declared in a validated class. Caught in review and fixed before testing.
2. **Reviving a late-paid order didn't re-count its coupon use.** Expiry released the use, but revival didn't take it back. Caught in review, fixed, and asserted in the end-to-end test.
3. Two flaws in my own tests (an `async` request helper, and a notification wait that could match an older notification) were found and fixed.

## 5. Known limitations

- **No screens yet.** The dashboard and customer-app screens are Phase 5b; the vendor portal is 5c.
- **Refunds are queued, not executed.** Gateway refunds, invoices with the recorded GST, TCS on marketplace sales, and vendor payouts are Phase 6.
- **Vendors mark delivery themselves.** Courier integrations (live tracking, automatic delivered status) aren't included.
- **Search is a simple text match** on title and brand; ranking and relevance tuning come later. Product ratings and reviews aren't included yet.
- **Whole-parcel returns only.** Partial returns (some items from a parcel) are a follow-up.
