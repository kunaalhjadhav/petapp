import 'api_client.dart';
import 'models.dart';

/// Every endpoint the seller app calls. Checked against the API spec by tool/contract_check.py,
/// so keep each call as `_c.<method>('<path>' …)`.
class VendorApi {
  VendorApi(this._c);
  final ApiClient _c;

  // ── sign-in ──
  Future<void> requestOtp(String phone) => _c.post('/auth/otp/request', {'phone': phone});
  Future<Tokens> verifyOtp(String phone, String code) async => Tokens.fromJson((await _c.post('/auth/otp/verify', {'phone': phone, 'code': code}) as Json)['tokens'] as Json);
  Future<void> logout() => _c.post('/auth/logout');
  Future<Me> me() async => Me.fromJson(await _c.get('/users/me') as Json);

  // ── store and verification ──
  /// null until the seller has started setting up a store.
  Future<VendorProfile?> profile() async {
    final j = await _c.get('/vendor/profile');
    return j is Json ? VendorProfile.fromJson(j) : null;
  }

  Future<VendorProfile> createProfile(Json body) async => VendorProfile.fromJson(await _c.post('/vendor/profile', body) as Json);
  Future<VendorProfile> updateProfile(Json body) async => VendorProfile.fromJson(await _c.patch('/vendor/profile', body) as Json);
  Future<VendorProfile> submit() async => VendorProfile.fromJson(await _c.post('/vendor/submit') as Json);
  Future<VendorProfile> addDocument(String kind, String mediaId) async =>
      VendorProfile.fromJson(await _c.post('/vendor/documents', {'kind': kind, 'mediaId': mediaId}) as Json);
  Future<VendorProfile> removeDocument(String id) async => VendorProfile.fromJson(await _c.delete('/vendor/documents/$id') as Json);

  // ── uploads (documents stay private; photos are processed into sizes) ──
  Future<UploadTicket> createUpload(String kind, String mimeType, int sizeBytes) async =>
      UploadTicket.fromJson(await _c.post('/media/uploads', {'kind': kind, 'mimeType': mimeType, 'sizeBytes': sizeBytes}) as Json);
  Future<void> completeUpload(String mediaId) => _c.post('/media/$mediaId/complete');
  Future<Photo> media(String mediaId) async => Photo.fromJson(await _c.get('/media/$mediaId') as Json);

  // ── catalogue ──
  Future<List<Category>> categories() async => (await _c.get('/product-categories') as List).cast<Json>().map(Category.fromJson).toList();
  Future<List<Product>> products() async => (await _c.get('/vendor/products') as List).cast<Json>().map(Product.fromJson).toList();
  Future<Product> createProduct(Json body) async => Product.fromJson(await _c.post('/vendor/products', body) as Json);
  Future<Product> updateProduct(String id, Json body) async => Product.fromJson(await _c.patch('/vendor/products/$id', body) as Json);
  Future<StockLevel> setStock(String variantId, int stock) async => StockLevel.fromJson(await _c.put('/vendor/variants/$variantId/stock', {'stock': stock}) as Json);

  // ── orders and returns ──
  /// Newest first. [status] narrows to one stage (CONFIRMED = to pack, PACKED = to ship, …).
  Future<(List<VendorOrder>, bool)> orders({String? status, int page = 1}) async {
    final (items, more) = await _c.getPaged('/vendor/orders', query: {'status': status, 'page': page, 'limit': 30});
    return (items.cast<Json>().map(VendorOrder.fromJson).toList(), more);
  }

  Future<VendorOrder> pack(String id) async => VendorOrder.fromJson(await _c.post('/vendor/orders/$id/pack') as Json);
  Future<VendorOrder> ship(String id, String courier, String trackingNumber) async =>
      VendorOrder.fromJson(await _c.post('/vendor/orders/$id/ship', {'courier': courier, 'trackingNumber': trackingNumber}) as Json);
  Future<VendorOrder> deliver(String id) async => VendorOrder.fromJson(await _c.post('/vendor/orders/$id/deliver') as Json);
  Future<VendorOrder> cancel(String id, String reason) async => VendorOrder.fromJson(await _c.post('/vendor/orders/$id/cancel', {'reason': reason}) as Json);

  /// APPROVE or REJECT a requested return (a rejection needs a note the customer sees); RECEIVED once it's back.
  Future<VendorOrder> decideReturn(String returnId, String decision, {String? note}) async =>
      VendorOrder.fromJson(await _c.post('/vendor/returns/$returnId/decide', {'decision': decision, if (note != null) 'note': note}) as Json);

  // ── coupons ──
  Future<List<Coupon>> coupons() async => (await _c.get('/vendor/coupons') as List).cast<Json>().map(Coupon.fromJson).toList();
  Future<Coupon> createCoupon(Json body) async => Coupon.fromJson(await _c.post('/vendor/coupons', body) as Json);
  Future<Coupon> updateCoupon(String id, Json body) async => Coupon.fromJson(await _c.patch('/vendor/coupons/$id', body) as Json);

  // ── home and money ──
  Future<Dashboard> dashboard() async => Dashboard.fromJson(await _c.get('/vendor/dashboard') as Json);
  Future<Earnings> earnings() async => Earnings.fromJson(await _c.get('/vendor/earnings') as Json);

  // ── payouts, statement and invoices ──
  Future<PayoutSummary> payouts() async => PayoutSummary.fromJson(await _c.get('/vendor/payouts') as Json);
  Future<PayoutAccounts> payoutAccount() async => PayoutAccounts.fromJson(await _c.get('/vendor/payout-account') as Json);

  /// BANK needs ifsc + accountNumber; UPI needs vpa. The bank checks it at once and returns the name it has.
  Future<PayoutAccounts> addPayoutAccount(Json body) async => PayoutAccounts.fromJson(await _c.post('/vendor/payout-account', body) as Json);

  Future<Statement> statement({int page = 1}) async => Statement.fromJson(await _c.get('/vendor/statement', query: {'page': page, 'limit': 30}) as Json);

  Future<(List<Invoice>, bool)> invoices({String? kind, int page = 1}) async {
    final (items, more) = await _c.getPaged('/vendor/invoices', query: {'kind': kind, 'page': page, 'limit': 30});
    return (items.cast<Json>().map(Invoice.fromJson).toList(), more);
  }

  /// A download link valid for a few minutes, to open in the browser.
  Future<InvoiceLink> invoiceLink(String id) async => InvoiceLink.fromJson(await _c.post('/invoices/$id/link') as Json);

  // ── terms ──
  Future<LegalDoc> legalDoc(String slug) async => LegalDoc.fromJson(await _c.get('/legal/$slug') as Json);
  Future<void> acceptTerms(String slug, int version) => _c.post('/me/consents', {'slug': slug, 'version': version});
  // ── chat (Phase 9a): the same methods in the partner and seller apps ──
  // ── reviews (Phase 9b) ── one public reply per review
  Future<(List<BusinessReview>, bool)> myReviews({int page = 1, bool unanswered = false, int? stars, bool photos = false}) async {
    final (items, more) = await _c.getPaged('/vendor/reviews', query: {'page': page, 'limit': 20, if (unanswered) 'unanswered': 'true', 'stars': stars, if (photos) 'photos': 'true'});
    return (items.cast<Json>().map(BusinessReview.fromJson).toList(), more);
  }

  Future<ReviewsOverview> reviewsOverview() async => ReviewsOverview.fromJson(await _c.get('/vendor/reviews/summary') as Json);
  Future<void> replyToReview(String id, String reply) => _c.post('/vendor/reviews/$id/reply', {'reply': reply});

  Future<ChatUnread> chatUnread() async => ChatUnread.fromJson(await _c.get('/chat/unread') as Json);
  Future<({List<ChatConversation> items, String? nextCursor})> conversations({String? cursor}) async {
    final j = await _c.get('/chat/conversations', query: {'as': 'seller', 'cursor': cursor}) as Json;
    return (items: (j['items'] as List).cast<Json>().map(ChatConversation.fromJson).toList(), nextCursor: j['nextCursor'] as String?);
  }
  /// Opens the conversation with the customer of a parcel (created the first time).
  Future<ChatStart> startChat(String subOrderId) async => ChatStart.fromJson(await _c.post('/chat/conversations', {'subOrderId': subOrderId}) as Json);
  Future<ChatHeader> conversation(String id) async => ChatHeader.fromJson(await _c.get('/chat/conversations/$id') as Json);
  Future<ChatPage> chatMessages(String id, {String? before, String? after}) async =>
      ChatPage.fromJson(await _c.get('/chat/conversations/$id/messages', query: {'before': before, 'after': after, 'limit': 30}) as Json);
  Future<ChatMessage> sendChat(String id, {required String clientId, String? body, String? mediaId, String? refType, String? refId}) async =>
      ChatMessage.fromJson(await _c.post('/chat/conversations/$id/messages', {
        'clientId': clientId,
        if (body != null && body.isNotEmpty) 'body': body,
        if (mediaId != null) 'mediaId': mediaId,
        if (refType != null) 'refType': refType,
        if (refId != null) 'refId': refId,
      }) as Json);
  Future<void> markChatRead(String id) => _c.post('/chat/conversations/$id/read');
  Future<ChatHeader> blockChat(String id, bool on) async =>
      ChatHeader.fromJson(await (on ? _c.post('/chat/conversations/$id/block') : _c.post('/chat/conversations/$id/unblock')) as Json);
  Future<RealtimeTicket> realtimeTicket() async => RealtimeTicket.fromJson(await _c.post('/chat/realtime-ticket') as Json);
  Future<void> reportMessage(String messageId, String reason) => _c.post('/reports', {'targetType': 'CHAT_MESSAGE', 'targetId': messageId, 'reason': reason});
  /// A private photo for a chat or a support ticket.
  Future<UploadTicket> createPhotoUpload(String mimeType, int sizeBytes) async =>
      UploadTicket.fromJson(await _c.post('/media/uploads', {'kind': 'IMAGE', 'mimeType': mimeType, 'sizeBytes': sizeBytes, 'private': true}) as Json);
  Future<String> photoStatus(String mediaId) async => (await _c.get('/media/$mediaId') as Json)['status'] as String;

  // ── help & support (Phase 9a) ──
  Future<HelpCenter> helpCenter({String? q}) async => HelpCenter.fromJson(await _c.get('/support/faqs', query: {'app': 'seller', 'q': q}) as Json);
  Future<void> faqFeedback(String id, bool helpful) => _c.post('/support/faqs/$id/feedback', {'helpful': helpful});
  Future<List<SupportTopic>> supportTopics() async => (await _c.get('/support/categories', query: {'app': 'seller'}) as List).cast<Json>().map(SupportTopic.fromJson).toList();
  Future<List<SupportTicket>> myTickets() async => (await _c.get('/support/tickets', query: {'app': 'seller'}) as List).cast<Json>().map(SupportTicket.fromJson).toList();
  Future<SupportTicket> ticket(String id) async => SupportTicket.fromJson(await _c.get('/support/tickets/$id') as Json);
  Future<SupportTicket> openTicket({required String categoryId, required String subject, required String body, List<String> mediaIds = const [], String? refType, String? refId}) async =>
      SupportTicket.fromJson(await _c.post('/support/tickets', {
        'app': 'seller',
        'categoryId': categoryId,
        'subject': subject,
        'body': body,
        if (mediaIds.isNotEmpty) 'mediaIds': mediaIds,
        if (refType != null) 'refType': refType,
        if (refId != null) 'refId': refId,
      }) as Json);
  Future<SupportTicket> closeTicket(String id) async => SupportTicket.fromJson(await _c.post('/support/tickets/$id/close') as Json);

  // ── push (Phase 9a) ──
  Future<void> registerDevice(String token, String platform) => _c.post('/devices', {'token': token, 'platform': platform, 'appVersion': '0.1.0'});
  Future<void> removeDevice(String token) => _c.delete('/devices/$token');
}
