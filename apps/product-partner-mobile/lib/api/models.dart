// Seller app models. Hand-written fromJson, checked against real API responses
// in test/fixtures by test/models_test.dart and tool/contract_check.py.

typedef Json = Map<String, dynamic>;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
double _dbl(Object? v) => v is num ? v.toDouble() : 0;
Json _map(Object? v) => v is Map<String, dynamic> ? v : const <String, dynamic>{};
List<T> _list<T>(Object? v, T Function(Json) f) => v is List ? v.whereType<Map<String, dynamic>>().map(f).toList() : <T>[];

class Tokens {
  Tokens({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;
  factory Tokens.fromJson(Json j) => Tokens(accessToken: j['accessToken'] as String, refreshToken: j['refreshToken'] as String);
}

class Me {
  Me({required this.id, this.name, required this.roles});
  final String id;
  final String? name;
  final List<String> roles;
  factory Me.fromJson(Json j) => Me(id: j['id'] as String, name: j['name'] as String?, roles: (j['roles'] as List?)?.whereType<String>().toList() ?? const []);
}

class Category {
  Category({required this.id, required this.key, required this.name, this.parentId});
  final String id;
  final String key;
  final String name;
  final String? parentId;
  factory Category.fromJson(Json j) => Category(id: j['id'] as String, key: j['key'] as String, name: j['name'] as String, parentId: j['parentId'] as String?);
}

// ══════════════ store and verification ══════════════

class VendorDocument {
  VendorDocument({required this.id, required this.kind, required this.status, this.note, this.url, this.mimeType});
  final String id;
  final String kind; // ID_PROOF | ADDRESS_PROOF | BUSINESS_REGISTRATION | GST_CERTIFICATE | PROFESSIONAL_LICENSE | OTHER
  final String status; // PENDING | ACCEPTED | REJECTED
  final String? note;
  final String? url; // short-lived private link
  final String? mimeType;
  factory VendorDocument.fromJson(Json j) => VendorDocument(
        id: j['id'] as String,
        kind: j['kind'] as String,
        status: j['status'] as String,
        note: j['note'] as String?,
        url: j['url'] as String?,
        mimeType: j['mimeType'] as String?,
      );
}

class VendorProfile {
  VendorProfile({
    required this.id,
    required this.businessName,
    this.legalName,
    this.gstin,
    required this.phone,
    this.email,
    required this.addressLine,
    required this.city,
    required this.state,
    required this.pincode,
    required this.status,
    this.statusReason,
    this.commissionBps,
    required this.ratingAvg,
    required this.ratingCount,
    required this.documents,
    required this.checklist,
  });
  final String id;
  final String businessName;
  final String? legalName;
  final String? gstin;
  final String phone;
  final String? email;
  final String addressLine;
  final String city;
  final String state;
  final String pincode;
  final String status; // DRAFT | SUBMITTED | APPROVED | REJECTED | SUSPENDED
  final String? statusReason;

  /// An agreed fee for this store (basis points); null means each category's standard fee applies.
  final int? commissionBps;
  final double ratingAvg;
  final int ratingCount;
  final List<VendorDocument> documents;

  /// What's still missing before the store can be submitted, in the server's words.
  final List<String> checklist;

  /// Approved stores sell; everyone else sees the verification checklist.
  bool get live => status == 'APPROVED';

  /// Details can change at any time except while the team is reviewing them.
  bool get editable => status != 'SUBMITTED';
  bool get canSubmit => (status == 'DRAFT' || status == 'REJECTED') && checklist.isEmpty;

  factory VendorProfile.fromJson(Json j) => VendorProfile(
        id: j['id'] as String,
        businessName: j['businessName'] as String,
        legalName: j['legalName'] as String?,
        gstin: j['gstin'] as String?,
        phone: j['phone'] as String,
        email: j['email'] as String?,
        addressLine: j['addressLine'] as String,
        city: j['city'] as String,
        state: j['state'] as String,
        pincode: j['pincode'] as String,
        status: j['status'] as String,
        statusReason: j['statusReason'] as String?,
        commissionBps: _intOrNull(j['commissionBps']),
        ratingAvg: _dbl(j['ratingAvg']),
        ratingCount: _int(j['ratingCount']),
        documents: _list(j['documents'], VendorDocument.fromJson),
        checklist: (j['checklist'] as List?)?.whereType<String>().toList() ?? const [],
      );
}

class UploadTicket {
  UploadTicket({required this.mediaId, required this.url, required this.method, required this.headers});
  final String mediaId;
  final String url;
  final String method;
  final Map<String, String> headers;
  factory UploadTicket.fromJson(Json j) {
    final u = _map(j['upload']);
    return UploadTicket(
      mediaId: _map(j['media'])['id'] as String,
      url: u['url'] as String,
      method: (u['method'] as String?) ?? 'PUT',
      headers: _map(u['headers']).map((k, v) => MapEntry(k, '$v')),
    );
  }
}

/// A processed photo. [url] picks the smallest size at least [width] pixels wide.
class Photo {
  Photo({required this.id, required this.status, required this.sizes});
  final String id;
  final String status;
  final List<(int, String)> sizes; // (width, url), largest first
  String? url([int width = 320]) {
    if (sizes.isEmpty) return null;
    final fit = sizes.where((s) => s.$1 >= width).toList()..sort((a, b) => a.$1.compareTo(b.$1));
    return fit.isNotEmpty ? fit.first.$2 : sizes.first.$2;
  }

  factory Photo.fromJson(Json j) => Photo(
        id: j['id'] as String,
        status: j['status'] as String,
        sizes: [for (final i in (j['images'] as List?)?.whereType<Map<String, dynamic>>() ?? const <Json>[]) (_int(i['width']), i['url'] as String)]
          ..sort((a, b) => b.$1.compareTo(a.$1)),
      );
}

// ══════════════ catalogue ══════════════

class Variant {
  Variant({
    this.id,
    required this.sku,
    required this.title,
    required this.mrpPaise,
    required this.pricePaise,
    required this.gstRateBps,
    required this.stock,
    this.weightGrams,
    this.isActive = true,
    this.inventoryStatus,
  });
  final String? id; // null for a variant not saved yet
  final String sku;
  final String title;
  final int mrpPaise;

  /// Selling price, GST included.
  final int pricePaise;
  final int gstRateBps;
  final int stock;
  final int? weightGrams;
  final bool isActive;

  /// IN_STOCK | LOW_STOCK | OUT_OF_STOCK | DISCONTINUED (only on the seller's product list).
  final String? inventoryStatus;

  int get discountPercent => mrpPaise <= 0 || pricePaise >= mrpPaise ? 0 : ((mrpPaise - pricePaise) * 100 / mrpPaise).round();

  factory Variant.fromJson(Json j) => Variant(
        id: j['id'] as String?,
        sku: j['sku'] as String,
        title: j['title'] as String,
        mrpPaise: _int(j['mrpPaise']),
        pricePaise: _int(j['pricePaise']),
        gstRateBps: _int(j['gstRateBps']),
        stock: _int(j['stock']),
        weightGrams: _intOrNull(j['weightGrams']),
        isActive: j['isActive'] as bool? ?? true,
        inventoryStatus: j['inventoryStatus'] as String?,
      );

  /// What the server takes when saving a product (variants are matched by SKU).
  Json toJson() => {
        'sku': sku,
        'title': title,
        'mrpPaise': mrpPaise,
        'pricePaise': pricePaise,
        'gstRateBps': gstRateBps,
        'stock': stock,
        if (weightGrams != null) 'weightGrams': weightGrams,
        'isActive': isActive,
      };
}

class Product {
  Product({
    required this.id,
    required this.categoryId,
    this.categoryName,
    required this.title,
    required this.description,
    this.brand,
    required this.imageIds,
    required this.photos,
    required this.status,
    this.blockReason,
    required this.variants,
  });
  final String id;
  final String categoryId;
  final String? categoryName;
  final String title;
  final String description;
  final String? brand;
  final List<String> imageIds;

  /// Viewable photos (on the seller's product list), in [imageIds] order.
  final List<Photo> photos;
  final String status; // DRAFT | ACTIVE | INACTIVE | BLOCKED
  final String? blockReason;
  final List<Variant> variants;

  List<Variant> get activeVariants => variants.where((v) => v.isActive).toList();
  int get totalStock => activeVariants.fold(0, (s, v) => s + v.stock);

  /// The worst stock state among the variants on sale, for a badge on the list.
  String? get stockFlag {
    final s = activeVariants.map((v) => v.inventoryStatus).toSet();
    if (s.contains('OUT_OF_STOCK')) return 'OUT_OF_STOCK';
    if (s.contains('LOW_STOCK')) return 'LOW_STOCK';
    return null;
  }

  factory Product.fromJson(Json j) => Product(
        id: j['id'] as String,
        categoryId: j['categoryId'] as String,
        categoryName: (j['category'] as Map<String, dynamic>?)?['name'] as String?,
        title: j['title'] as String,
        description: j['description'] as String,
        brand: j['brand'] as String?,
        imageIds: (j['imageIds'] as List?)?.whereType<String>().toList() ?? const [],
        photos: _list(j['images'], Photo.fromJson),
        status: j['status'] as String,
        blockReason: j['blockReason'] as String?,
        variants: _list(j['variants'], Variant.fromJson),
      );
}

class StockLevel {
  StockLevel({required this.variantId, required this.stock});
  final String variantId;
  final int stock;
  factory StockLevel.fromJson(Json j) => StockLevel(variantId: j['variantId'] as String, stock: _int(j['stock']));
}

// ══════════════ orders ══════════════

class OrderItem {
  OrderItem({required this.id, required this.productTitle, required this.variantTitle, required this.sku, required this.qty, required this.unitPricePaise, required this.lineTotalPaise});
  final String id;
  final String productTitle;
  final String variantTitle;
  final String sku;
  final int qty;
  final int unitPricePaise;
  final int lineTotalPaise;
  factory OrderItem.fromJson(Json j) => OrderItem(
        id: j['id'] as String,
        productTitle: j['productTitle'] as String,
        variantTitle: j['variantTitle'] as String,
        sku: j['sku'] as String,
        qty: _int(j['qty']),
        unitPricePaise: _int(j['unitPricePaise']),
        lineTotalPaise: _int(j['lineTotalPaise']),
      );
}

class ReturnRequest {
  ReturnRequest({required this.id, required this.reason, required this.status, required this.refundPaise, this.note, this.createdAt});
  final String id;
  final String reason;
  final String status; // REQUESTED | APPROVED | REJECTED | RECEIVED
  final int refundPaise;
  final String? note;
  final DateTime? createdAt;
  factory ReturnRequest.fromJson(Json j) => ReturnRequest(
        id: j['id'] as String,
        reason: j['reason'] as String,
        status: j['status'] as String,
        refundPaise: _int(j['refundPaise']),
        note: j['note'] as String?,
        createdAt: _date(j['createdAt']),
      );
}

/// Where the parcel goes, as the buyer gave it at checkout (a snapshot: later address edits don't change it).
class ShipTo {
  ShipTo({required this.name, this.phone, this.label, required this.line1, this.line2, this.locality, required this.city, required this.state, required this.pincode});
  final String name; // the buyer, for the courier label
  final String? phone;
  final String? label; // "Home", "Work"
  final String line1;
  final String? line2;
  final String? locality;
  final String city;
  final String state;
  final String pincode;
  String get lines => [line1, line2, locality, '$city, $state $pincode'].whereType<String>().where((s) => s.trim().isNotEmpty).join('\n');
  factory ShipTo.fromJson(Json j) => ShipTo(
        name: (j['name'] as String?) ?? '',
        phone: j['phone'] as String?,
        label: j['label'] as String?,
        line1: (j['line1'] as String?) ?? '',
        line2: j['line2'] as String?,
        locality: j['locality'] as String?,
        city: (j['city'] as String?) ?? '',
        state: (j['state'] as String?) ?? '',
        pincode: (j['pincode'] as String?) ?? '',
      );
}

/// One seller's parcel of a customer's order.
class VendorOrder {
  VendorOrder({
    required this.id,
    required this.code,
    required this.orderCode,
    required this.status,
    required this.itemsPaise,
    required this.discountPaise,
    required this.shippingPaise,
    required this.totalPaise,
    required this.commissionPaise,
    required this.vendorEarningPaise,
    this.courier,
    this.trackingNumber,
    required this.createdAt,
    this.packedAt,
    this.shippedAt,
    this.deliveredAt,
    this.cancelledAt,
    this.cancelledBy,
    this.cancelReason,
    required this.items,
    required this.returns,
    this.customerName,
    this.customerPhone,
    this.shipTo,
  });
  final String id;
  final String code;
  final String orderCode;
  final String status; // CONFIRMED | PACKED | SHIPPED | DELIVERED | CANCELLED | RETURN_REQUESTED | RETURNED
  final int itemsPaise;
  final int discountPaise;
  final int shippingPaise;
  final int totalPaise;
  final int commissionPaise;
  final int vendorEarningPaise;
  final String? courier;
  final String? trackingNumber;
  final DateTime createdAt;
  final DateTime? packedAt;
  final DateTime? shippedAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final String? cancelledBy; // CUSTOMER | VENDOR | ADMIN | SYSTEM
  final String? cancelReason;
  final List<OrderItem> items;
  final List<ReturnRequest> returns;
  final String? customerName;
  final String? customerPhone;
  final ShipTo? shipTo;

  int get units => items.fold(0, (s, i) => s + i.qty);

  /// The return waiting on the seller (to decide, or to confirm it arrived back), if any.
  ReturnRequest? get openReturn => returns.where((r) => r.status == 'REQUESTED' || r.status == 'APPROVED').firstOrNull;

  bool get canPack => status == 'CONFIRMED';
  bool get canShip => status == 'PACKED';
  bool get canDeliver => status == 'SHIPPED';
  bool get canCancel => status == 'CONFIRMED' || status == 'PACKED';

  factory VendorOrder.fromJson(Json j) {
    final c = j['customer'] as Map<String, dynamic>?;
    final s = j['shipTo'] as Map<String, dynamic>?;
    return VendorOrder(
      id: j['id'] as String,
      code: j['code'] as String,
      orderCode: (j['orderCode'] as String?) ?? '',
      status: j['status'] as String,
      itemsPaise: _int(j['itemsPaise']),
      discountPaise: _int(j['discountPaise']),
      shippingPaise: _int(j['shippingPaise']),
      totalPaise: _int(j['totalPaise']),
      commissionPaise: _int(j['commissionPaise']),
      vendorEarningPaise: _int(j['vendorEarningPaise']),
      courier: j['courier'] as String?,
      trackingNumber: j['trackingNumber'] as String?,
      createdAt: _date(j['createdAt']) ?? DateTime.now(),
      packedAt: _date(j['packedAt']),
      shippedAt: _date(j['shippedAt']),
      deliveredAt: _date(j['deliveredAt']),
      cancelledAt: _date(j['cancelledAt']),
      cancelledBy: j['cancelledBy'] as String?,
      cancelReason: j['cancelReason'] as String?,
      items: _list(j['items'], OrderItem.fromJson),
      returns: _list(j['returns'], ReturnRequest.fromJson),
      customerName: c?['name'] as String?,
      customerPhone: c?['phone'] as String?,
      shipTo: s == null ? null : ShipTo.fromJson(s),
    );
  }
}

// ══════════════ coupons ══════════════

class Coupon {
  Coupon({
    required this.id,
    required this.code,
    this.description,
    required this.kind,
    required this.value,
    this.maxDiscountPaise,
    required this.minOrderPaise,
    required this.startsAt,
    required this.endsAt,
    this.usageLimit,
    required this.perUserLimit,
    required this.usedCount,
    required this.isActive,
  });
  final String id;
  final String code;
  final String? description;
  final String kind; // PERCENT | FLAT

  /// PERCENT: basis points (1500 = 15%). FLAT: paise.
  final int value;
  final int? maxDiscountPaise;
  final int minOrderPaise;
  final DateTime startsAt;
  final DateTime endsAt;
  final int? usageLimit;
  final int perUserLimit;
  final int usedCount;
  final bool isActive;

  /// RUNNING | SCHEDULED | ENDED | PAUSED | USED_UP
  String stateAt(DateTime now) {
    if (!isActive) return 'PAUSED';
    if (usageLimit != null && usedCount >= usageLimit!) return 'USED_UP';
    if (now.isBefore(startsAt)) return 'SCHEDULED';
    if (!now.isBefore(endsAt)) return 'ENDED';
    return 'RUNNING';
  }

  factory Coupon.fromJson(Json j) => Coupon(
        id: j['id'] as String,
        code: j['code'] as String,
        description: j['description'] as String?,
        kind: j['kind'] as String,
        value: _int(j['value']),
        maxDiscountPaise: _intOrNull(j['maxDiscountPaise']),
        minOrderPaise: _int(j['minOrderPaise']),
        startsAt: _date(j['startsAt']) ?? DateTime.now(),
        endsAt: _date(j['endsAt']) ?? DateTime.now(),
        usageLimit: _intOrNull(j['usageLimit']),
        perUserLimit: _int(j['perUserLimit']),
        usedCount: _int(j['usedCount']),
        isActive: j['isActive'] as bool? ?? false,
      );
}

// ══════════════ dashboard and money ══════════════

class SalesWindow {
  SalesWindow({required this.orders, required this.salesPaise, required this.earningsPaise});
  final int orders;
  final int salesPaise;
  final int earningsPaise;
  factory SalesWindow.fromJson(Json j) => SalesWindow(orders: _int(j['orders']), salesPaise: _int(j['salesPaise']), earningsPaise: _int(j['earningsPaise']));
}

class StockAlert {
  StockAlert({required this.variantId, required this.productId, required this.productTitle, required this.variantTitle, required this.sku, required this.stock, required this.inventoryStatus});
  final String variantId;
  final String productId;
  final String productTitle;
  final String variantTitle;
  final String sku;
  final int stock;
  final String inventoryStatus;
  factory StockAlert.fromJson(Json j) => StockAlert(
        variantId: j['variantId'] as String,
        productId: j['productId'] as String,
        productTitle: j['productTitle'] as String,
        variantTitle: j['variantTitle'] as String,
        sku: j['sku'] as String,
        stock: _int(j['stock']),
        inventoryStatus: j['inventoryStatus'] as String,
      );
}

class Dashboard {
  Dashboard({
    required this.storeName,
    required this.storeStatus,
    this.storeStatusReason,
    required this.toPack,
    required this.toShip,
    required this.inTransit,
    required this.returnsToReview,
    required this.today,
    required this.last7Days,
    required this.last30Days,
    required this.productsByStatus,
    required this.lowStockThreshold,
    required this.stockAlerts,
  });
  final String storeName;
  final String storeStatus;
  final String? storeStatusReason;
  final int toPack;
  final int toShip;
  final int inTransit;
  final int returnsToReview;
  final SalesWindow today;
  final SalesWindow last7Days;
  final SalesWindow last30Days;
  final Map<String, int> productsByStatus;
  final int lowStockThreshold;
  final List<StockAlert> stockAlerts;

  int get needsAction => toPack + toShip + returnsToReview;

  factory Dashboard.fromJson(Json j) {
    final store = _map(j['store']);
    final todo = _map(j['todo']);
    final sales = _map(j['sales']);
    return Dashboard(
      storeName: store['businessName'] as String,
      storeStatus: store['status'] as String,
      storeStatusReason: store['statusReason'] as String?,
      toPack: _int(todo['toPack']),
      toShip: _int(todo['toShip']),
      inTransit: _int(todo['inTransit']),
      returnsToReview: _int(todo['returnsToReview']),
      today: SalesWindow.fromJson(_map(sales['today'])),
      last7Days: SalesWindow.fromJson(_map(sales['last7Days'])),
      last30Days: SalesWindow.fromJson(_map(sales['last30Days'])),
      productsByStatus: _map(j['products']).map((k, v) => MapEntry(k, _int(v))),
      lowStockThreshold: _int(j['lowStockThreshold']),
      stockAlerts: _list(j['stockAlerts'], StockAlert.fromJson),
    );
  }
}

class MonthEarnings {
  MonthEarnings({required this.month, required this.orders, required this.earnedPaise, required this.commissionPaise});
  final String month; // YYYY-MM, India time
  final int orders;
  final int earnedPaise;
  final int commissionPaise;
  factory MonthEarnings.fromJson(Json j) =>
      MonthEarnings(month: j['month'] as String, orders: _int(j['orders']), earnedPaise: _int(j['earnedPaise']), commissionPaise: _int(j['commissionPaise']));
}

class Earnings {
  Earnings({
    required this.deliveredOrders,
    required this.salesPaise,
    required this.commissionPaise,
    required this.earnedPaise,
    required this.inProgressOrders,
    required this.expectedPaise,
    required this.months,
    required this.payoutNote,
  });
  final int deliveredOrders;
  final int salesPaise;
  final int commissionPaise;
  final int earnedPaise;
  final int inProgressOrders;
  final int expectedPaise;
  final List<MonthEarnings> months;
  final String payoutNote;
  factory Earnings.fromJson(Json j) {
    final d = _map(j['delivered']);
    final p = _map(j['inProgress']);
    return Earnings(
      deliveredOrders: _int(d['orders']),
      salesPaise: _int(d['salesPaise']),
      commissionPaise: _int(d['commissionPaise']),
      earnedPaise: _int(d['earnedPaise']),
      inProgressOrders: _int(p['orders']),
      expectedPaise: _int(p['expectedPaise']),
      months: _list(j['months'], MonthEarnings.fromJson),
      payoutNote: (j['payouts'] as String?) ?? '',
    );
  }
}

// ── payouts, statement and invoices (Phase 6d) ──

/// A bank account or UPI ID the seller is paid to. Full account numbers never leave the server.
class PayoutAccount {
  PayoutAccount({
    required this.id,
    required this.method,
    required this.holderName,
    this.ifsc,
    this.accountLast4,
    this.vpa,
    required this.status,
    this.verifiedName,
    this.nameMatches,
    this.failureReason,
    this.payableFrom,
  });
  final String id;
  final String method; // BANK | UPI
  final String holderName;
  final String? ifsc;
  final String? accountLast4;
  final String? vpa;
  final String status; // PENDING | VERIFIED | FAILED | DISABLED
  final String? verifiedName;
  final bool? nameMatches;
  final String? failureReason;
  final DateTime? payableFrom;

  /// "Bank •••• 6789" or the UPI ID.
  String get label => method == 'UPI' ? (vpa ?? 'UPI') : 'Bank •••• ${accountLast4 ?? '????'}';

  /// A new or replaced account waits out a safety hold before money is sent to it.
  bool onHoldAt(DateTime now) => payableFrom != null && payableFrom!.isAfter(now);

  factory PayoutAccount.fromJson(Json j) => PayoutAccount(
        id: j['id'] as String,
        method: j['method'] as String,
        holderName: j['holderName'] as String,
        ifsc: j['ifsc'] as String?,
        accountLast4: j['accountLast4'] as String?,
        vpa: j['vpa'] as String?,
        status: j['status'] as String,
        verifiedName: j['verifiedName'] as String?,
        nameMatches: j['nameMatches'] as bool?,
        failureReason: j['failureReason'] as String?,
        payableFrom: _date(j['payableFrom']),
      );
}

/// The account money goes to now, and a newer one being checked or refused by the bank.
class PayoutAccounts {
  PayoutAccounts({this.active, this.pending});
  final PayoutAccount? active;
  final PayoutAccount? pending;
  factory PayoutAccounts.fromJson(Json j) => PayoutAccounts(
        active: j['active'] is Map<String, dynamic> ? PayoutAccount.fromJson(j['active'] as Json) : null,
        pending: j['pending'] is Map<String, dynamic> ? PayoutAccount.fromJson(j['pending'] as Json) : null,
      );
}

/// One transfer to the seller's account.
class Payout {
  Payout({required this.id, required this.amountPaise, required this.purpose, required this.status, this.utr, this.failureReason, this.processedAt, this.createdAt, required this.accountLabel});
  final String id;
  final int amountPaise;
  final String purpose; // EARNINGS | PRIZE
  final String status; // QUEUED | PROCESSING | PROCESSED | FAILED | REVERSED
  final String? utr;
  final String? failureReason;
  final DateTime? processedAt;
  final DateTime? createdAt;
  final String accountLabel;
  factory Payout.fromJson(Json j) {
    final a = _map(j['account']);
    return Payout(
      id: j['id'] as String,
      amountPaise: _int(j['amountPaise']),
      purpose: j['purpose'] as String,
      status: j['status'] as String,
      utr: j['utr'] as String?,
      failureReason: j['failureReason'] as String?,
      processedAt: _date(j['processedAt']),
      createdAt: _date(j['createdAt']),
      accountLabel: a['method'] == 'UPI' ? '${a['vpa'] ?? 'UPI'}' : 'Bank •••• ${a['accountLast4'] ?? '????'}',
    );
  }
}

/// What PetApp owes the seller, what can be paid now, where it goes, and recent payouts.
class PayoutSummary {
  PayoutSummary({required this.balancePaise, required this.availablePaise, required this.holdDays, this.accountLabel, this.accountPayableFrom, required this.payouts});
  final int balancePaise;
  final int availablePaise;
  final int holdDays;
  final String? accountLabel;
  final DateTime? accountPayableFrom;
  final List<Payout> payouts;

  /// Earned but still inside the return window (or otherwise not yet payable).
  int get waitingPaise => balancePaise - availablePaise;

  factory PayoutSummary.fromJson(Json j) {
    final a = j['account'] is Map<String, dynamic> ? j['account'] as Json : null;
    return PayoutSummary(
      balancePaise: _int(j['balancePaise']),
      availablePaise: _int(j['availablePaise']),
      holdDays: _int(j['holdDays']),
      accountLabel: a == null ? null : (a['method'] == 'UPI' ? '${a['vpa'] ?? 'UPI'}' : 'Bank •••• ${a['accountLast4'] ?? '????'}'),
      accountPayableFrom: a == null ? null : _date(a['payableFrom']),
      payouts: _list(j['payouts'], Payout.fromJson),
    );
  }
}

/// A line on the seller's account: a sale (with PetApp's fee and taxes), a return, or a payout.
class StatementLine {
  StatementLine({required this.id, this.occurredAt, required this.kind, required this.memo, required this.amountPaise, this.salePaise, required this.feePaise, required this.tcsPaise, required this.tdsPaise});
  final String id;
  final DateTime? occurredAt;
  final String kind;
  final String memo;
  final int amountPaise;
  final int? salePaise; // null for payouts
  final int feePaise;
  final int tcsPaise;
  final int tdsPaise;
  factory StatementLine.fromJson(Json j) => StatementLine(
        id: j['id'] as String,
        occurredAt: _date(j['occurredAt']),
        kind: j['kind'] as String,
        memo: (j['memo'] as String?) ?? '',
        amountPaise: _int(j['amountPaise']),
        salePaise: _intOrNull(j['salePaise']),
        feePaise: _int(j['feePaise']),
        tcsPaise: _int(j['tcsPaise']),
        tdsPaise: _int(j['tdsPaise']),
      );
}

class Statement {
  Statement({required this.balancePaise, required this.earnedPaise, required this.paidOutPaise, required this.feesPaise, required this.tcsPaise, required this.tdsPaise, required this.items, required this.more});
  final int balancePaise;
  final int earnedPaise;
  final int paidOutPaise;
  final int feesPaise;
  final int tcsPaise;
  final int tdsPaise;
  final List<StatementLine> items;
  final bool more;
  factory Statement.fromJson(Json j) {
    final t = _map(j['totals']);
    final m = _map(j['meta']);
    return Statement(
      balancePaise: _int(j['balancePaise']),
      earnedPaise: _int(t['earnedPaise']),
      paidOutPaise: _int(t['paidOutPaise']),
      feesPaise: _int(t['feesPaise']),
      tcsPaise: _int(t['tcsPaise']),
      tdsPaise: _int(t['tdsPaise']),
      items: _list(j['items'], StatementLine.fromJson),
      more: _int(m['page']) < _int(m['totalPages']),
    );
  }
}

/// A tax invoice or credit note issued in the seller's name, or PetApp's commission invoice to the seller.
class Invoice {
  Invoice({required this.id, required this.kind, required this.title, required this.number, this.issuedAt, required this.totalPaise, required this.issuerName, required this.recipientName});
  final String id;
  final String kind; // CUSTOMER | CREDIT_NOTE | COMMISSION
  final String title; // TAX_INVOICE | BILL_OF_SUPPLY
  final String number;
  final DateTime? issuedAt;
  final int totalPaise;
  final String issuerName;
  final String recipientName;
  factory Invoice.fromJson(Json j) => Invoice(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        number: j['number'] as String,
        issuedAt: _date(j['issuedAt']),
        totalPaise: _int(j['totalPaise']),
        issuerName: '${_map(j['issuer'])['name'] ?? ''}',
        recipientName: '${_map(j['recipient'])['name'] ?? ''}',
      );
}

/// A short-lived download link for an invoice PDF, opened in the phone's browser. [path] is under /api/v1.
class InvoiceLink {
  InvoiceLink({required this.path, this.expiresAt, required this.fileName});
  final String path;
  final DateTime? expiresAt;
  final String fileName;
  factory InvoiceLink.fromJson(Json j) => InvoiceLink(path: j['path'] as String, expiresAt: _date(j['expiresAt']), fileName: (j['fileName'] as String?) ?? 'invoice.pdf');
}

/// The current version of a legal document (partner or seller terms), in Markdown.
class LegalDoc {
  LegalDoc({required this.slug, required this.title, required this.version, required this.body, this.effectiveAt});
  final String slug;
  final String title;
  final int version;
  final String body;
  final DateTime? effectiveAt;
  factory LegalDoc.fromJson(Json j) => LegalDoc(
        slug: j['slug'] as String,
        title: j['title'] as String? ?? '',
        version: _int(j['version']),
        body: j['body'] as String? ?? '',
        effectiveAt: _date(j['effectiveAt']),
      );
}

// ── chat and support (Phase 9a) ── the same in the partner and seller apps

/// A photo in a chat (private: links are short-lived and only given to people in the conversation).
class ChatPhoto {
  ChatPhoto({required this.id, required this.status, this.width, this.height, required this.images});
  final String id;
  final String status;
  final int? width;
  final int? height;
  final List<({int width, String url})> images;
  bool get isReady => status == 'READY';
  double get aspectRatio => (width != null && height != null && height! > 0) ? width! / height! : 1;
  /// Smallest copy at least [minWidth] wide.
  String? imageFor(double minWidth) {
    if (images.isEmpty) return null;
    final sorted = [...images]..sort((a, b) => a.width.compareTo(b.width));
    return sorted.firstWhere((i) => i.width >= minWidth, orElse: () => sorted.last).url;
  }

  factory ChatPhoto.fromJson(Json j) => ChatPhoto(
        id: j['id'] as String,
        status: j['status'] as String,
        width: _intOrNull(j['width']),
        height: _intOrNull(j['height']),
        images: [for (final i in (j['images'] as List?)?.whereType<Map<String, dynamic>>() ?? const <Map<String, dynamic>>[]) (width: _int(i['width']), url: i['url'] as String)],
      );
}

/// Who the conversation is with: a service partner, a seller, a customer, or PetApp Support.
class ChatCounterpart {
  ChatCounterpart({required this.type, required this.name, this.id, this.slug, this.city, this.avatarUrl});
  final String type; // PARTNER | SELLER | CUSTOMER | SUPPORT
  final String name;
  final String? id;
  final String? slug;
  final String? city;
  final String? avatarUrl;
  factory ChatCounterpart.fromJson(Json j) => ChatCounterpart(
        type: j['type'] as String,
        name: j['name'] as String? ?? '',
        id: j['id'] as String?,
        slug: j['slug'] as String?,
        city: j['city'] as String?,
        avatarUrl: j['avatarUrl'] as String?,
      );
}

/// A row in the Messages list.
class ChatConversation {
  ChatConversation({required this.id, required this.kind, required this.status, required this.counterpart, this.lastMessageText, this.lastMessageAt, required this.unread, required this.blocked});
  final String id;
  final String kind; // SERVICE | SHOP
  final String status;
  final ChatCounterpart counterpart;
  final String? lastMessageText;
  final DateTime? lastMessageAt;
  final int unread;
  final bool blocked;
  factory ChatConversation.fromJson(Json j) => ChatConversation(
        id: j['id'] as String,
        kind: j['kind'] as String,
        status: j['status'] as String,
        counterpart: ChatCounterpart.fromJson(_map(j['counterpart'])),
        lastMessageText: j['lastMessageText'] as String?,
        lastMessageAt: _date(j['lastMessageAt']),
        unread: _int(j['unread']),
        blocked: j['blocked'] == true,
      );
}

class ChatTicketRef {
  ChatTicketRef({required this.id, required this.code, required this.status, required this.subject});
  final String id;
  final String code;
  final String status;
  final String subject;
  factory ChatTicketRef.fromJson(Json j) => ChatTicketRef(id: j['id'] as String, code: j['code'] as String, status: j['status'] as String, subject: j['subject'] as String? ?? '');
}

/// The top of a conversation: who it's with, and whether you can write.
class ChatHeader {
  ChatHeader({required this.id, required this.kind, required this.status, required this.side, required this.counterpart, required this.canSend, this.cannotSendReason, required this.blockedByMe, required this.unread, this.otherReadAt, this.ticket});
  final String id;
  final String kind; // SERVICE | SHOP | SUPPORT
  final String status;
  final String side; // CUSTOMER | BUSINESS
  final ChatCounterpart counterpart;
  final bool canSend;
  final String? cannotSendReason;
  final bool blockedByMe;
  final int unread;
  final DateTime? otherReadAt;
  final ChatTicketRef? ticket;
  bool get isSupport => kind == 'SUPPORT';
  factory ChatHeader.fromJson(Json j) => ChatHeader(
        id: j['id'] as String,
        kind: j['kind'] as String,
        status: j['status'] as String,
        side: j['side'] as String,
        counterpart: ChatCounterpart.fromJson(_map(j['counterpart'])),
        canSend: j['canSend'] == true,
        cannotSendReason: j['cannotSendReason'] as String?,
        blockedByMe: j['blockedByMe'] == true,
        unread: _int(j['unread']),
        otherReadAt: _date(j['otherReadAt']),
        ticket: j['ticket'] is Map ? ChatTicketRef.fromJson(_map(j['ticket'])) : null,
      );
}

/// A card shared in a conversation: a booking, a product or an order.
class ChatRef {
  ChatRef({required this.type, required this.id, this.code, this.title, this.slug, this.petName, this.startsAt, this.status, this.pricePaise, this.totalPaise, this.units, this.imageUrl, this.available = true});
  final String type; // BOOKING | PRODUCT | ORDER
  final String id;
  final String? code;
  final String? title;
  final String? slug;
  final String? petName;
  final DateTime? startsAt;
  final String? status;
  final int? pricePaise;
  final int? totalPaise;
  final int? units;
  final String? imageUrl;
  final bool available;
  /// The thing no longer exists (the API sends only its type and id).
  bool get unavailable => code == null && title == null;
  factory ChatRef.fromJson(Json j) => ChatRef(
        type: j['type'] as String,
        id: j['id'] as String,
        code: j['code'] as String?,
        title: j['title'] as String?,
        slug: j['slug'] as String?,
        petName: j['petName'] as String?,
        startsAt: _date(j['startsAt']),
        status: j['status'] as String?,
        pricePaise: _intOrNull(j['pricePaise']),
        totalPaise: _intOrNull(j['totalPaise']),
        units: _intOrNull(j['units']),
        imageUrl: j['imageUrl'] as String?,
        available: j['available'] != false,
      );
}

class ChatMessage {
  ChatMessage({required this.id, required this.side, required this.mine, this.senderName, this.body, required this.removed, this.media, this.ref, this.clientId, required this.createdAt, this.sending = false, this.failed = false, this.localPath});
  final String id;
  final String side; // CUSTOMER | BUSINESS | STAFF | SYSTEM
  final bool mine;
  /// Staff first name, in support conversations.
  final String? senderName;
  final String? body;
  final bool removed;
  final ChatPhoto? media;
  final ChatRef? ref;
  final String? clientId;
  final DateTime createdAt;
  // On this phone only: a message still being sent, one that couldn't be, and a photo not yet uploaded.
  final bool sending;
  final bool failed;
  final String? localPath;
  bool get isSystem => side == 'SYSTEM';
  factory ChatMessage.fromJson(Json j) => ChatMessage(
        id: j['id'] as String,
        side: j['side'] as String,
        mine: j['mine'] == true,
        senderName: j['senderName'] as String?,
        body: j['body'] as String?,
        removed: j['removed'] == true,
        media: j['media'] is Map ? ChatPhoto.fromJson(_map(j['media'])) : null,
        ref: j['ref'] is Map ? ChatRef.fromJson(_map(j['ref'])) : null,
        clientId: j['clientId'] as String?,
        createdAt: _date(j['createdAt']) ?? DateTime.now(),
      );
  /// A live event carries no `mine`: the app knows which side it is on.
  ChatMessage forSide(String mySide) => ChatMessage(id: id, side: side, mine: side == mySide, senderName: senderName, body: body, removed: removed, media: media, ref: ref, clientId: clientId, createdAt: createdAt);
  ChatMessage copyWith({bool? sending, bool? failed}) => ChatMessage(id: id, side: side, mine: mine, senderName: senderName, body: body, removed: removed, media: media, ref: ref, clientId: clientId, createdAt: createdAt, sending: sending ?? this.sending, failed: failed ?? this.failed, localPath: localPath);
}

class ChatPage {
  ChatPage({required this.items, this.nextCursor, required this.more});
  final List<ChatMessage> items;
  final String? nextCursor;
  final bool more;
  factory ChatPage.fromJson(Json j) => ChatPage(items: _list(j['items'], ChatMessage.fromJson), nextCursor: j['nextCursor'] as String?, more: j['more'] == true);
}

/// Opening a conversation from a partner, product, booking or order page.
class ChatStart {
  ChatStart({required this.conversation, this.refType, this.refId});
  final ChatHeader conversation;
  /// What it was opened from, offered as a card to send.
  final String? refType;
  final String? refId;
  factory ChatStart.fromJson(Json j) {
    final c = _map(j['context']);
    return ChatStart(conversation: ChatHeader.fromJson(_map(j['conversation'])), refType: c['refType'] as String?, refId: c['refId'] as String?);
  }
}

class ChatUnread {
  ChatUnread({required this.customer, required this.partner, required this.seller, required this.support});
  final int customer;
  final int partner;
  final int seller;
  final int support;
  factory ChatUnread.fromJson(Json j) => ChatUnread(customer: _int(j['customer']), partner: _int(j['partner']), seller: _int(j['seller']), support: _int(j['support']));
}

class RealtimeTicket {
  RealtimeTicket({required this.ticket, required this.path});
  final String ticket;
  final String path;
  factory RealtimeTicket.fromJson(Json j) => RealtimeTicket(ticket: j['ticket'] as String, path: j['path'] as String);
}

class SupportTopic {
  SupportTopic({required this.id, required this.key, required this.name});
  final String id;
  final String key;
  final String name;
  factory SupportTopic.fromJson(Json j) => SupportTopic(id: j['id'] as String, key: j['key'] as String, name: j['name'] as String);
}

class HelpFaq {
  HelpFaq({required this.id, required this.question, required this.answer, this.categoryId});
  final String id;
  final String question;
  final String answer;
  final String? categoryId;
  factory HelpFaq.fromJson(Json j) => HelpFaq(id: j['id'] as String, question: j['question'] as String, answer: j['answer'] as String, categoryId: j['categoryId'] as String?);
}

class HelpCenter {
  HelpCenter({required this.topics, required this.faqs});
  final List<SupportTopic> topics;
  final List<HelpFaq> faqs;
  factory HelpCenter.fromJson(Json j) => HelpCenter(topics: _list(j['categories'], SupportTopic.fromJson), faqs: _list(j['faqs'], HelpFaq.fromJson));
}

class SupportTicket {
  SupportTicket({required this.id, required this.code, required this.subject, required this.status, required this.statusLabel, required this.category, required this.conversationId, this.refType, this.refId, required this.unread, this.lastMessageText, this.lastMessageAt, required this.canReply, required this.createdAt});
  final String id;
  final String code;
  final String subject;
  final String status; // OPEN | ASSIGNED | IN_PROGRESS | WAITING | RESOLVED | CLOSED
  final String statusLabel;
  final String category;
  final String conversationId;
  final String? refType;
  final String? refId;
  final int unread;
  final String? lastMessageText;
  final DateTime? lastMessageAt;
  final bool canReply;
  final DateTime createdAt;
  bool get open => status != 'RESOLVED' && status != 'CLOSED';
  factory SupportTicket.fromJson(Json j) => SupportTicket(
        id: j['id'] as String,
        code: j['code'] as String,
        subject: j['subject'] as String,
        status: j['status'] as String,
        statusLabel: j['statusLabel'] as String? ?? '',
        category: j['category'] as String? ?? '',
        conversationId: j['conversationId'] as String,
        refType: j['refType'] as String?,
        refId: j['refId'] as String?,
        unread: _int(j['unread']),
        lastMessageText: j['lastMessageText'] as String?,
        lastMessageAt: _date(j['lastMessageAt']),
        canReply: j['canReply'] == true,
        createdAt: _date(j['createdAt']) ?? DateTime.now(),
      );
}

// ── reviews (Phase 9b) ── the same in the partner and seller apps

/// The average, and how many reviews have each number of stars (5 first).
class RatingSummary {
  RatingSummary({required this.avg, required this.count, required this.stars});
  final double avg;
  final int count;
  final List<({int stars, int count})> stars;
  factory RatingSummary.fromJson(Json j) => RatingSummary(
        avg: (j['avg'] as num?)?.toDouble() ?? 0,
        count: _int(j['count']),
        stars: [for (final s in (j['stars'] as List?)?.whereType<Map<String, dynamic>>() ?? const <Map<String, dynamic>>[]) (stars: _int(s['stars']), count: _int(s['count']))],
      );
}

/// Your rating, and how many visible reviews still have no reply.
class ReviewsOverview {
  ReviewsOverview({required this.summary, required this.unanswered});
  final RatingSummary summary;
  final int unanswered;
  factory ReviewsOverview.fromJson(Json j) => ReviewsOverview(summary: RatingSummary.fromJson((j['summary'] as Json?) ?? const {}), unanswered: _int(j['unanswered']));
}

/// A customer's review of your business: a product they received (seller) or a visit (partner).
class BusinessReview {
  BusinessReview({
    required this.id,
    required this.rating,
    this.comment,
    required this.photos,
    this.reply,
    this.repliedAt,
    required this.by,
    this.at,
    required this.status,
    this.productTitle,
    this.orderCode,
    this.bookingCode,
    this.serviceName,
  });
  final String id;
  final int rating;
  final String? comment;
  final List<ChatPhoto> photos;
  final String? reply;
  final DateTime? repliedAt;

  /// First name and initial.
  final String by;
  final DateTime? at;

  /// VISIBLE | HIDDEN (hidden by PetApp: not shown, not counted, can't be replied to)
  final String status;
  final String? productTitle;
  final String? orderCode;
  final String? bookingCode;
  final String? serviceName;
  bool get hidden => status == 'HIDDEN';
  bool get canReply => reply == null && !hidden;

  /// "Rope toy · order S-AB12" or "Full groom · booking B-XY34".
  String get about => [productTitle ?? serviceName, if (orderCode != null) 'order $orderCode', if (bookingCode != null) 'booking $bookingCode'].whereType<String>().join(' · ');

  factory BusinessReview.fromJson(Json j) {
    final product = j['product'] as Json?;
    final order = j['order'] as Json?;
    final booking = j['booking'] as Json?;
    return BusinessReview(
      id: j['id'] as String,
      rating: _int(j['rating']),
      comment: j['comment'] as String?,
      photos: _list(j['photos'], ChatPhoto.fromJson),
      reply: j['reply'] as String?,
      repliedAt: _date(j['repliedAt']),
      by: (j['by'] as String?) ?? 'A customer',
      at: _date(j['at']),
      status: (j['status'] as String?) ?? 'VISIBLE',
      productTitle: product?['title'] as String?,
      orderCode: order?['code'] as String?,
      bookingCode: booking?['code'] as String?,
      serviceName: booking?['service'] as String?,
    );
  }
}
