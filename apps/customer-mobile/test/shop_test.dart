import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';

import 'fixture.dart';

/// Shop models parse responses recorded from the real API (tool/record_shop_fixtures.py).
void main() {
  Cart cart(String n) => Cart.fromJson(fixture(n) as Json);
  ShopOrder order(String n) => ShopOrder.fromJson(fixture(n) as Json);

  test('product cards and the product page', () {
    final card = (fixture('shop_products') as List).cast<Json>().map(ProductCard.fromJson).single;
    expect(card.fromPaise, 169900);
    expect(card.offPct, 10); // 1,699 vs 1,899 MRP
    expect(card.image, isNotNull);
    final p = ProductDetail.fromJson(fixture('shop_product') as Json);
    expect(p.variants.map((v) => v.title), ['3 kg', '7 kg']);
    expect(p.variants.first.lowStock, 4);
    expect(p.images.single.isReady, isTrue);
    expect(p.vendorCity, 'Pune');
  });

  test('cart, coupon and problems', () {
    final c = cart('shop_cart');
    expect(c.units, 3);
    expect(c.itemsPaise, 2 * 169900 + 349900);
    expect(c.canCheckout, isTrue);
    final pv = cart('shop_preview');
    expect(pv.discountPaise, 30000); // 10% capped at ₹300
    expect(pv.totalPaise, pv.itemsPaise - pv.discountPaise + pv.shippingPaise);
    expect(pv.couponCode, isNotNull);
    expect(cart('shop_preview_bad_coupon').couponProblem, 'That coupon code isn’t valid.');
    final bad = cart('shop_cart_problem');
    expect(bad.canCheckout, isFalse);
    expect(bad.items.single.problem, 'Only 1 left. Lower the quantity to continue.');
  });

  test('orders: tracking, returns, cancellations and refunds', () {
    final placed = order('shop_placed');
    expect(placed.status, 'PENDING_PAYMENT');
    expect(placed.payment, isNotNull);
    final shipped = order('shop_order_shipped').parcels.single;
    expect(shipped.status, 'SHIPPED');
    expect(shipped.trackingNumber, 'DL123456789IN');
    expect(shipped.canCancel, isFalse);
    final ret = order('shop_order_return').parcels.single;
    expect(ret.status, 'RETURN_REQUESTED');
    expect(ret.returnStatus, 'REQUESTED');
    expect(ret.returnRefundPaise, 2 * 169900 + 349900 - 30000); // items after discount; shipping not refunded
    final cancelled = order('shop_order_cancelled');
    expect(cancelled.parcels.single.status, 'CANCELLED');
    expect(cancelled.refunds.single.amountPaise, cancelled.parcels.single.totalPaise);
    expect(cancelled.refunds.single.status, 'PENDING');
    final list = (fixture('shop_orders') as List).cast<Json>().map(ShopOrderSummary.fromJson).toList();
    expect(list, hasLength(2));
    expect(Address.fromJson((fixture('shop_addresses') as List).first as Json).oneLine, '4 Lake View, Koregaon Park, Pune 411001');
  });
}
