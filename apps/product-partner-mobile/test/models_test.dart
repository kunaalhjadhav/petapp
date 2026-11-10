import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_seller/api/models.dart';
import 'package:petapp_seller/common/widgets.dart';
import 'package:petapp_seller/features/legal_markdown.dart';

import 'fixture.dart';

/// The seller app's models parse responses recorded from the real API (tool/record_fixtures.py).
void main() {
  VendorProfile profile(String n) => VendorProfile.fromJson(fixture(n) as Json);
  List<VendorOrder> orders(String n) => (fixture(n) as List).cast<Json>().map(VendorOrder.fromJson).toList();
  VendorOrder order(String n) => VendorOrder.fromJson(fixture(n) as Json);

  test('no store yet, then a checklist that shrinks as documents arrive', () {
    expect(fixture('vendor_profile_none'), isNull);
    final created = profile('vendor_profile_created');
    expect(created.status, 'DRAFT');
    expect(created.gstin, '27ABCDE1234F1Z5');
    expect(created.checklist, ['Upload an ID proof.', 'Upload your GST certificate.']);
    expect(created.editable, isTrue);
    expect(created.canSubmit, isFalse);
    expect(created.live, isFalse);
    final withId = profile('vendor_profile_with_document');
    expect(withId.checklist, ['Upload your GST certificate.']);
    expect(withId.documents.single.kind, 'ID_PROOF');
    expect(withId.documents.single.status, 'PENDING');
    expect(withId.documents.single.mimeType, 'application/pdf');
    final submitted = profile('vendor_profile_submitted');
    expect(submitted.status, 'SUBMITTED');
    expect(submitted.checklist, isEmpty);
    expect(submitted.editable, isFalse); // locked while the team reviews it
    expect(submitted.canSubmit, isFalse); // already submitted
  });

  test('an approved store is live, with both documents accepted and no agreed fee', () {
    final p = profile('vendor_profile_approved');
    expect(p.live, isTrue);
    expect(p.editable, isTrue);
    expect(p.documents.map((d) => d.status), ['ACCEPTED', 'ACCEPTED']);
    expect(p.commissionBps, isNull);
    expect(p.phone, startsWith('+91'));
    expect(Me.fromJson(fixture('vendor_me') as Json).roles, contains('PRODUCT_PARTNER'));
  });

  test('uploads use a signed PUT with the declared content type', () {
    final t = UploadTicket.fromJson(fixture('vendor_document_upload') as Json);
    expect(t.method, 'PUT');
    expect(t.headers, {'Content-Type': 'application/pdf'});
    expect(t.url, startsWith('http'));
    expect(t.mediaId, isNotEmpty);
  });

  test('products: variants with inventory status, photos in sizes, a category name on the list', () {
    final p = (fixture('vendor_products') as List).cast<Json>().map(Product.fromJson).single;
    expect(p.status, 'ACTIVE');
    expect(p.categoryName, startsWith('Treats'));
    expect(p.variants.map((v) => v.sku), ['CJ-100', 'CJ-250']);
    expect(p.variants.map((v) => v.inventoryStatus), ['IN_STOCK', 'LOW_STOCK']);
    // 30 after the restock, −2 −1 −1 sold, +1 back from the cancellation, +2 back from the return.
    expect(p.variants.first.stock, 29);
    expect(p.totalStock, 32);
    expect(p.stockFlag, 'LOW_STOCK');
    expect(p.variants.first.weightGrams, 120);
    expect(p.variants.last.weightGrams, isNull);
    expect(p.variants.first.discountPercent, 14); // ₹349 → ₹299
    expect(p.photos.single.sizes.map((s) => s.$1), [1080, 640, 320]);
    expect(p.photos.single.url(300), contains('/320.webp'));
    expect(p.photos.single.url(600), contains('/640.webp'));
    expect(p.photos.single.url(4000), contains('/1080.webp'));
    expect(p.imageIds, [p.photos.single.id]);
    final created = Product.fromJson(fixture('vendor_product_created') as Json);
    expect(created.status, 'DRAFT');
    expect(created.photos, isEmpty); // the create response carries ids only
    expect(created.categoryName, isNull);
    expect(Product.fromJson(fixture('vendor_product_live') as Json).status, 'ACTIVE');
    final s = StockLevel.fromJson(fixture('vendor_stock') as Json);
    expect(s.stock, 30);
  });

  test('a variant goes back to the server without its id or computed fields', () {
    final v = Product.fromJson(fixture('vendor_product_created') as Json).variants.firstWhere((v) => v.sku == 'CJ-100');
    expect(v.toJson(), {'sku': 'CJ-100', 'title': '100 g', 'mrpPaise': 34900, 'pricePaise': 29900, 'gstRateBps': 1800, 'stock': 40, 'weightGrams': 120, 'isActive': true});
  });

  test('orders to pack carry the buyer, the address for the label and the money split', () {
    final list = orders('vendor_orders_to_pack');
    expect(list, hasLength(3));
    expect(list.every((o) => o.canPack && o.canCancel && !o.canShip), isTrue);
    final couponed = list.last; // the oldest: 2 × ₹299 with the seller's 15% coupon
    expect(couponed.units, 2);
    expect(couponed.itemsPaise, 59800);
    expect(couponed.discountPaise, 8970);
    expect(couponed.totalPaise, 50830);
    expect(couponed.commissionPaise, 6100);
    expect(couponed.vendorEarningPaise, 44730);
    expect(couponed.totalPaise - couponed.commissionPaise, couponed.vendorEarningPaise);
    final plain = list.first; // 1 × ₹299 + ₹49 shipping
    expect(plain.shippingPaise, 4900);
    expect(plain.totalPaise, plain.itemsPaise + plain.shippingPaise);
    expect(plain.customerName, 'Ravi Buyer');
    expect(plain.shipTo!.name, 'Ravi Buyer');
    expect(plain.shipTo!.label, 'Home');
    expect(plain.shipTo!.phone, plain.customerPhone);
    expect(plain.shipTo!.lines, '21 MG Road\nCamp\nPune, Maharashtra 411001');
    expect(plain.orderCode, isNotEmpty);
    expect(plain.items.single.sku, 'CJ-100');
  });

  test('fulfilment moves step by step, with tracking', () {
    final packed = order('vendor_order_packed');
    expect(packed.status, 'PACKED');
    expect(packed.canShip, isTrue);
    expect(packed.canCancel, isTrue);
    expect(packed.packedAt, isNotNull);
    final shipped = order('vendor_order_shipped');
    expect(shipped.canDeliver, isTrue);
    expect(shipped.canCancel, isFalse);
    expect((shipped.courier, shipped.trackingNumber), ('Delhivery', 'DL5550001IN'));
    final delivered = order('vendor_order_delivered');
    expect(delivered.deliveredAt, isNotNull);
    expect(delivered.canDeliver || delivered.canShip || delivered.canPack || delivered.canCancel, isFalse);
    final cancelled = order('vendor_order_cancelled');
    expect((cancelled.status, cancelled.cancelledBy, cancelled.cancelReason), ('CANCELLED', 'VENDOR', 'Packet damaged in storage'));
  });

  test('returns: requested, approved (waiting for the parcel), then received and closed', () {
    final requested = orders('vendor_orders_returns').single;
    expect(requested.status, 'RETURN_REQUESTED');
    expect(requested.openReturn!.status, 'REQUESTED');
    expect(requested.openReturn!.reason, 'Dog is allergic to chicken');
    expect(requested.openReturn!.refundPaise, requested.totalPaise);
    final approved = order('vendor_return_approved');
    expect(approved.openReturn!.status, 'APPROVED');
    final received = order('vendor_return_received');
    expect(received.status, 'RETURNED');
    expect(received.openReturn, isNull);
    expect(received.returns.single.note, 'Sealed, unused');
    expect(orders('vendor_orders_all').map((o) => o.status), ['DELIVERED', 'CANCELLED', 'RETURNED']);
  });

  test('coupons: the seller’s percent coupon and a paused flat one', () {
    final c = Coupon.fromJson(fixture('vendor_coupon_created') as Json);
    expect((c.kind, c.value, c.maxDiscountPaise, c.minOrderPaise, c.perUserLimit, c.usageLimit), ('PERCENT', 1500, 15000, 0, 1, null));
    expect(c.stateAt(c.startsAt.add(const Duration(hours: 1))), 'RUNNING');
    expect(c.stateAt(c.startsAt.subtract(const Duration(minutes: 1))), 'SCHEDULED');
    expect(c.stateAt(c.endsAt), 'ENDED');
    final paused = Coupon.fromJson(fixture('vendor_coupon_paused') as Json);
    expect(paused.isActive, isFalse);
    expect(paused.stateAt(paused.startsAt.add(const Duration(hours: 1))), 'PAUSED');
    expect((paused.kind, paused.value, paused.minOrderPaise), ('FLAT', 5000, 50000));
    final list = (fixture('vendor_coupons') as List).cast<Json>().map(Coupon.fromJson).toList();
    expect(list, hasLength(2));
  });

  test('dashboard: work to do, sales windows and stock alerts', () {
    final busy = Dashboard.fromJson(fixture('vendor_dashboard_busy') as Json);
    expect((busy.toPack, busy.toShip, busy.inTransit, busy.returnsToReview), (3, 0, 0, 0));
    expect(busy.needsAction, 3);
    expect(busy.today.orders, 3);
    expect(busy.today.salesPaise, 34800 + 34800 + 50830);
    expect(busy.today.earningsPaise, 31212 + 31212 + 44730);
    expect(busy.productsByStatus, {'ACTIVE': 1});
    expect(busy.storeStatus, 'APPROVED');
    final quiet = Dashboard.fromJson(fixture('vendor_dashboard') as Json);
    expect(quiet.needsAction, 0);
    expect(quiet.lowStockThreshold, 5);
    final alert = quiet.stockAlerts.single;
    expect((alert.sku, alert.stock, alert.inventoryStatus, alert.variantTitle), ('CJ-250', 3, 'LOW_STOCK', '250 g'));
    // Only the delivered parcel still counts: the cancelled and returned ones dropped out.
    expect(quiet.today.orders, 1);
    expect(quiet.today.earningsPaise, 31212);
  });

  test('earnings from delivered orders, by month, with the payout note', () {
    final e = Earnings.fromJson(fixture('vendor_earnings') as Json);
    expect((e.deliveredOrders, e.salesPaise, e.commissionPaise, e.earnedPaise), (1, 34800, 3588, 31212));
    expect(e.salesPaise - e.commissionPaise, e.earnedPaise);
    expect((e.inProgressOrders, e.expectedPaise), (0, 0));
    expect(e.months.single.earnedPaise, 31212);
    expect(monthName(e.months.single.month), matches(RegExp(r'^[A-Z][a-z]+ \d{4}$')));
    expect(e.payoutNote, isNotEmpty);
  });

  test('money typed by a seller', () {
    expect(paiseFrom('299'), 29900);
    expect(paiseFrom('1,299.5'), 129950);
    expect(paiseFrom('₹ 49.99'), 4999);
    expect(paiseFrom('12.345'), isNull);
    expect(paiseFrom('abc'), isNull);
    expect(paiseFrom(''), isNull);
    expect(rupeesInput(29900), '299');
    expect(rupeesInput(12345), '123.45');
    expect(rupeesInput(105), '1.05');
    expect(rupees(120430), '₹1,204.30');
    expect(rupees(10715400), '₹1,07,154');
    expect(monthName('2026-10'), 'October 2026');
    expect(monthName('bad'), 'bad');
  });

  test('payout account: none yet, refused by the bank, then verified in the store’s legal name', () {
    final none = PayoutAccounts.fromJson(fixture('vendor_payout_account_none') as Json);
    expect(none.active, isNull);
    expect(none.pending, isNull);
    final refused = PayoutAccounts.fromJson(fixture('vendor_payout_account_failed') as Json);
    expect(refused.active, isNull);
    expect(refused.pending!.status, 'FAILED');
    expect(refused.pending!.failureReason, isNotEmpty);
    expect(refused.pending!.label, 'Bank •••• 0000');
    final ok = PayoutAccounts.fromJson(fixture('vendor_payout_account_verified') as Json).active!;
    expect(ok.status, 'VERIFIED');
    expect(ok.label, 'Bank •••• 6789');
    expect(ok.ifsc, 'HDFC0001234');
    expect(ok.verifiedName, 'WAG AND CO PVT LTD');
    expect(ok.nameMatches, isTrue);
    // A first account in the payee's own name has no safety hold.
    expect(ok.onHoldAt(ok.payableFrom!.add(const Duration(seconds: 1))), isFalse);
    expect(ok.onHoldAt(ok.payableFrom!.subtract(const Duration(hours: 1))), isTrue);
  });

  test('payouts: what is payable, then a paid payout with its bank reference', () {
    final due = PayoutSummary.fromJson(fixture('vendor_payouts_due') as Json);
    expect(due.accountLabel, isNull); // no account yet
    expect(due.balancePaise, greaterThan(0));
    expect(due.payouts, isEmpty);
    final paid = PayoutSummary.fromJson(fixture('vendor_payouts') as Json);
    expect(paid.balancePaise, 0);
    expect(paid.waitingPaise, 0);
    expect(paid.accountLabel, 'Bank •••• 6789');
    final p = paid.payouts.single;
    expect(p.status, 'PROCESSED');
    expect(p.purpose, 'EARNINGS');
    expect(p.amountPaise, due.balancePaise);
    expect(p.utr, startsWith('FAKEUTR'));
    expect(p.accountLabel, 'Bank •••• 6789');
  });

  test('statement: the sale with fee and taxes, and the payout, adding up', () {
    final s = Statement.fromJson(fixture('vendor_statement') as Json);
    expect(s.more, isFalse);
    expect(s.earnedPaise, s.paidOutPaise);
    expect(s.balancePaise, s.earnedPaise - s.paidOutPaise);
    final sale = s.items.firstWhere((l) => l.kind == 'PARCEL_DELIVERED');
    expect(sale.salePaise! - sale.feePaise - sale.tcsPaise - sale.tdsPaise, sale.amountPaise);
    expect(sale.feePaise, s.feesPaise);
    final payout = s.items.firstWhere((l) => l.kind == 'PAYOUT_APPROVED');
    expect(payout.salePaise, isNull);
    expect(payout.amountPaise, -s.paidOutPaise);
  });

  test('invoices and their download links', () {
    final inv = Invoice.fromJson((fixture('vendor_invoices') as List).first as Json);
    expect(inv.kind, 'CUSTOMER');
    expect(inv.number, matches(RegExp(r'^[A-Z]{3}I/\d{4}/\d{5}$')));
    expect(inv.issuerName, 'Wag and Co Pvt Ltd');
    expect(inv.recipientName, 'Ravi Kumar');
    final link = InvoiceLink.fromJson(fixture('vendor_invoice_link') as Json);
    expect(link.path, startsWith('/invoices/${inv.id}/file?expires='));
    expect(link.fileName, '${inv.number.replaceAll('/', '-')}.pdf');
    expect(link.expiresAt, isNotNull);
  });

  test('terms to accept: the current version, rendered from Markdown', () {
    final d = LegalDoc.fromJson(fixture('legal_doc') as Json);
    expect(d.version, greaterThan(0));
    expect(d.body, isNot(contains('{{')));
    final blocks = parseLegalMarkdown(d.body);
    expect(blocks.first.kind, 'heading');
    expect(blocks.any((b) => b.kind == 'list'), isTrue);
  });
}
