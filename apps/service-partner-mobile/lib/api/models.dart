// Partner app models. Hand-written fromJson, checked against real API responses
// in test/fixtures by test/models_test.dart and tool/contract_check.py.

typedef Json = Map<String, dynamic>;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
double _dbl(Object? v) => v is num ? v.toDouble() : 0;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
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
  Category({required this.id, required this.key, required this.name});
  final String id;
  final String key;
  final String name;
  factory Category.fromJson(Json j) => Category(id: j['id'] as String, key: j['key'] as String, name: j['name'] as String);
}

class PartnerDocument {
  PartnerDocument({required this.id, required this.kind, required this.status, this.note, this.url, this.mimeType});
  final String id;
  final String kind; // ID_PROOF | ADDRESS_PROOF | BUSINESS_REGISTRATION | GST_CERTIFICATE | PROFESSIONAL_LICENSE | OTHER
  final String status; // PENDING | ACCEPTED | REJECTED
  final String? note;
  final String? url; // short-lived private link
  final String? mimeType;
  factory PartnerDocument.fromJson(Json j) => PartnerDocument(
        id: j['id'] as String,
        kind: j['kind'] as String,
        status: j['status'] as String,
        note: j['note'] as String?,
        url: j['url'] as String?,
        mimeType: j['mimeType'] as String?,
      );
}

class PartnerServiceItem {
  PartnerServiceItem({
    required this.id,
    required this.categoryId,
    required this.categoryName,
    required this.categoryCommissionBps,
    required this.name,
    this.description,
    required this.durationMin,
    required this.bufferMin,
    required this.pricePaise,
    required this.modes,
    required this.isActive,
  });
  final String id;
  final String categoryId;
  final String categoryName;

  /// The category's standard PetApp fee (basis points), used unless the partner has an agreed rate.
  final int categoryCommissionBps;
  final String name;
  final String? description;
  final int durationMin;
  final int bufferMin;
  final int pricePaise;
  final List<String> modes; // AT_CENTER | AT_HOME
  final bool isActive;
  factory PartnerServiceItem.fromJson(Json j) => PartnerServiceItem(
        id: j['id'] as String,
        categoryId: j['categoryId'] as String,
        categoryName: ((j['category'] as Json?)?['name'] as String?) ?? '',
        categoryCommissionBps: _int((j['category'] as Json?)?['commissionBps']),
        name: j['name'] as String,
        description: j['description'] as String?,
        durationMin: _int(j['durationMin']),
        bufferMin: _int(j['bufferMin']),
        pricePaise: _int(j['pricePaise']),
        modes: (j['modes'] as List?)?.whereType<String>().toList() ?? const [],
        isActive: j['isActive'] != false,
      );
}

class OpeningHours {
  OpeningHours({required this.weekday, required this.opensMin, required this.closesMin});
  final int weekday; // 0 = Sunday
  final int opensMin;
  final int closesMin;
  factory OpeningHours.fromJson(Json j) => OpeningHours(weekday: _int(j['weekday']), opensMin: _int(j['opensMin']), closesMin: _int(j['closesMin']));
  Json toJson() => {'weekday': weekday, 'opensMin': opensMin, 'closesMin': closesMin};
}

class TimeOff {
  TimeOff({required this.id, required this.startsAt, required this.endsAt, this.reason});
  final String id;
  final DateTime startsAt;
  final DateTime endsAt;
  final String? reason;
  factory TimeOff.fromJson(Json j) =>
      TimeOff(id: j['id'] as String, startsAt: _date(j['startsAt'])!, endsAt: _date(j['endsAt'])!, reason: j['reason'] as String?);
}

class PartnerProfile {
  PartnerProfile({
    required this.id,
    required this.businessName,
    required this.kind,
    this.about,
    required this.phone,
    this.email,
    required this.addressLine,
    this.area,
    required this.city,
    required this.state,
    required this.pincode,
    required this.lat,
    required this.lng,
    required this.homeVisitRadiusKm,
    required this.concurrency,
    required this.slotStepMin,
    this.gstin,
    required this.status,
    this.statusReason,
    this.commissionBps,
    required this.ratingAvg,
    required this.ratingCount,
    required this.checklist,
    required this.documents,
    required this.services,
    required this.hours,
    required this.timeOff,
  });
  final String id;
  final String businessName;
  final String kind; // INDIVIDUAL | BUSINESS
  final String? about;
  final String phone;
  final String? email;
  final String addressLine;
  final String? area;
  final String city;
  final String state;
  final String pincode;
  final double lat;
  final double lng;
  final int homeVisitRadiusKm;
  final int concurrency;
  final int slotStepMin;
  final String? gstin;
  final String status; // DRAFT | SUBMITTED | APPROVED | REJECTED | SUSPENDED
  final String? statusReason;
  /// An agreed rate for this partner (basis points); null means each category's standard rate applies.
  final int? commissionBps;
  final double ratingAvg;
  final int ratingCount;

  /// What's still missing before the profile can be submitted (empty = ready).
  final List<String> checklist;
  final List<PartnerDocument> documents;
  final List<PartnerServiceItem> services;
  final List<OpeningHours> hours;
  final List<TimeOff> timeOff;

  bool get editable => status == 'DRAFT' || status == 'REJECTED';

  /// The PetApp fee on a service, exactly as the API computes it: agreed rate, else the category's.
  int feeBpsFor(PartnerServiceItem s) => commissionBps ?? s.categoryCommissionBps;
  bool get live => status == 'APPROVED';

  factory PartnerProfile.fromJson(Json j) => PartnerProfile(
        id: j['id'] as String,
        businessName: j['businessName'] as String,
        kind: j['kind'] as String,
        about: j['about'] as String?,
        phone: j['phone'] as String,
        email: j['email'] as String?,
        addressLine: j['addressLine'] as String,
        area: j['area'] as String?,
        city: j['city'] as String,
        state: j['state'] as String,
        pincode: j['pincode'] as String,
        lat: _dbl(j['lat']),
        lng: _dbl(j['lng']),
        homeVisitRadiusKm: _int(j['homeVisitRadiusKm']),
        concurrency: _int(j['concurrency']),
        slotStepMin: _int(j['slotStepMin']),
        gstin: j['gstin'] as String?,
        status: j['status'] as String,
        statusReason: j['statusReason'] as String?,
        commissionBps: j['commissionBps'] is num ? (j['commissionBps'] as num).toInt() : null,
        ratingAvg: _dbl(j['ratingAvg']),
        ratingCount: _int(j['ratingCount']),
        checklist: (j['checklist'] as List?)?.whereType<String>().toList() ?? const [],
        documents: _list(j['documents'], PartnerDocument.fromJson),
        services: _list(j['services'], PartnerServiceItem.fromJson),
        hours: _list(j['hours'], OpeningHours.fromJson),
        timeOff: _list(j['timeOff'], TimeOff.fromJson),
      );
}

class Booking {
  Booking({
    required this.id,
    required this.code,
    required this.status,
    required this.startsAt,
    required this.endsAt,
    required this.mode,
    required this.serviceName,
    required this.petName,
    required this.customerName,
    this.customerPhone,
    this.customerNote,
    this.address,
    required this.pricePaise,
    required this.earningPaise,
    required this.feePaise,
    this.cancelReason,
    this.cancelledBy,
    this.refundPaise,
  });
  final String id;
  final String code;
  final String status; // PENDING_PAYMENT | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED | NO_SHOW | EXPIRED
  final DateTime startsAt;
  final DateTime endsAt;
  final String mode;
  final String serviceName;
  final String petName;
  final String customerName;
  final String? customerPhone;
  final String? customerNote;

  /// Home visits: the address, as one line.
  final String? address;
  final int pricePaise;
  final int earningPaise;
  final int feePaise;
  final String? cancelReason;
  final String? cancelledBy;
  final int? refundPaise;

  bool get canStart => status == 'CONFIRMED';
  bool get canFinish => status == 'IN_PROGRESS' || status == 'CONFIRMED';
  bool get isOpen => status == 'CONFIRMED' || status == 'IN_PROGRESS';

  factory Booking.fromJson(Json j) {
    final c = (j['customer'] as Json?) ?? const {};
    final e = (j['earnings'] as Json?) ?? const {};
    final a = j['address'];
    return Booking(
      id: j['id'] as String,
      code: j['code'] as String,
      status: j['status'] as String,
      startsAt: _date(j['startsAt'])!,
      endsAt: _date(j['endsAt'])!,
      mode: j['mode'] as String,
      serviceName: ((j['service'] as Json?)?['name'] as String?) ?? '',
      petName: ((j['pet'] as Json?)?['name'] as String?) ?? '',
      customerName: (c['name'] as String?) ?? 'Customer',
      customerPhone: c['phone'] as String?,
      customerNote: j['customerNote'] as String?,
      address: a is Map ? a.values.whereType<String>().where((s) => s.trim().isNotEmpty).join(', ') : a as String?,
      pricePaise: _int(j['pricePaise']),
      earningPaise: _int(e['partnerEarningPaise']),
      feePaise: _int(e['platformFeePaise']),
      cancelReason: j['cancelReason'] as String?,
      cancelledBy: j['cancelledBy'] as String?,
      refundPaise: j['refundPaise'] is num ? (j['refundPaise'] as num).toInt() : null,
    );
  }
}

class MonthEarnings {
  MonthEarnings({required this.month, required this.visits, required this.grossPaise, required this.platformFeesPaise, required this.earnedPaise});
  final String month; // YYYY-MM, India time
  final int visits;
  final int grossPaise;
  final int platformFeesPaise;
  final int earnedPaise;
  factory MonthEarnings.fromJson(Json j) => MonthEarnings(
        month: j['month'] as String,
        visits: _int(j['visits']),
        grossPaise: _int(j['grossPaise']),
        platformFeesPaise: _int(j['platformFeesPaise']),
        earnedPaise: _int(j['earnedPaise']),
      );
}

class Earnings {
  Earnings({required this.completed, required this.upcomingVisits, required this.upcomingPaise, required this.noShows, required this.months, required this.payouts});
  final MonthEarnings completed; // all-time totals (month = '')
  final int upcomingVisits;
  final int upcomingPaise;
  final int noShows;
  final List<MonthEarnings> months;
  final String payouts;
  factory Earnings.fromJson(Json j) {
    final c = (j['completed'] as Json?) ?? const {};
    final u = (j['upcoming'] as Json?) ?? const {};
    return Earnings(
      completed: MonthEarnings(month: '', visits: _int(c['visits']), grossPaise: _int(c['grossPaise']), platformFeesPaise: _int(c['platformFeesPaise']), earnedPaise: _int(c['earnedPaise'])),
      upcomingVisits: _int(u['visits']),
      upcomingPaise: _int(u['expectedPaise']),
      noShows: _int(j['noShows']),
      months: _list(j['months'], MonthEarnings.fromJson),
      payouts: (j['payouts'] as String?) ?? '',
    );
  }
}

class UploadTicket {
  UploadTicket({required this.mediaId, required this.url, required this.method, required this.headers});
  final String mediaId;
  final String url;
  final String method;
  final Map<String, String> headers;
  factory UploadTicket.fromJson(Json j) {
    final u = j['upload'] as Json;
    return UploadTicket(
      mediaId: (j['media'] as Json)['id'] as String,
      url: u['url'] as String,
      method: u['method'] as String,
      headers: ((u['headers'] as Json?) ?? const {}).map((k, v) => MapEntry(k, v.toString())),
    );
  }
}

// ── payouts, statement and invoices (Phase 6d) ──

/// A bank account or UPI ID the partner is paid to. Full account numbers never leave the server.
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

/// One transfer to the partner's account.
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

/// What PetApp owes the partner, what can be paid now, where it goes, and recent payouts.
class PayoutSummary {
  PayoutSummary({required this.balancePaise, required this.availablePaise, required this.holdDays, this.accountLabel, this.accountPayableFrom, required this.payouts});
  final int balancePaise;
  final int availablePaise;
  final int holdDays;
  final String? accountLabel;
  final DateTime? accountPayableFrom;
  final List<Payout> payouts;

  /// Earned but still inside the holding period (or otherwise not yet payable).
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

/// A line on the partner's account: a visit (with PetApp's fee and taxes), a refund adjustment, or a payout.
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

/// An invoice issued in the partner's name for a visit, or PetApp's commission invoice to the partner.
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
