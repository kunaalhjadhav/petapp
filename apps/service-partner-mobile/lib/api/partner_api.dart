import 'api_client.dart';
import 'models.dart';

/// Every endpoint the partner app calls. Checked against the API spec by tool/contract_check.py,
/// so keep each call as `_c.<method>('<path>' …)`.
class PartnerApi {
  PartnerApi(this._c);
  final ApiClient _c;

  // ── sign-in ──
  Future<void> requestOtp(String phone) => _c.post('/auth/otp/request', {'phone': phone});
  Future<Tokens> verifyOtp(String phone, String code) async => Tokens.fromJson((await _c.post('/auth/otp/verify', {'phone': phone, 'code': code}) as Json)['tokens'] as Json);
  Future<Tokens> googleLogin(String idToken) async => Tokens.fromJson((await _c.post('/auth/google', {'idToken': idToken}) as Json)['tokens'] as Json);
  Future<Tokens> appleLogin(String identityToken, String nonce, {String? name}) async =>
      Tokens.fromJson((await _c.post('/auth/apple', {'identityToken': identityToken, 'nonce': nonce, if (name != null) 'name': name}) as Json)['tokens'] as Json);
  Future<void> logout() => _c.post('/auth/logout');
  Future<Me> me() async => Me.fromJson(await _c.get('/users/me') as Json);
  Future<void> setName(String name) => _c.patch('/users/me', {'name': name});

  // ── profile and verification ──
  /// null until the partner has started onboarding.
  Future<PartnerProfile?> profile() async {
    final j = await _c.get('/partner/profile');
    return j is Json ? PartnerProfile.fromJson(j) : null;
  }

  Future<PartnerProfile> createProfile(Json body) async => PartnerProfile.fromJson(await _c.post('/partner/profile', body) as Json);
  Future<PartnerProfile> updateProfile(Json body) async => PartnerProfile.fromJson(await _c.patch('/partner/profile', body) as Json);
  Future<PartnerProfile> submit() async => PartnerProfile.fromJson(await _c.post('/partner/submit') as Json);
  Future<List<Category>> categories() async => (await _c.get('/service-categories') as List).cast<Json>().map(Category.fromJson).toList();

  Future<UploadTicket> createDocumentUpload(String mimeType, int sizeBytes) async =>
      UploadTicket.fromJson(await _c.post('/media/uploads', {'kind': 'DOCUMENT', 'mimeType': mimeType, 'sizeBytes': sizeBytes}) as Json);
  Future<void> completeUpload(String mediaId) => _c.post('/media/$mediaId/complete');
  Future<PartnerProfile> addDocument(String kind, String mediaId) async =>
      PartnerProfile.fromJson(await _c.post('/partner/documents', {'kind': kind, 'mediaId': mediaId}) as Json);
  Future<PartnerProfile> removeDocument(String id) async => PartnerProfile.fromJson(await _c.delete('/partner/documents/$id') as Json);

  // ── services, hours, time off ──
  Future<PartnerProfile> addService(Json body) async => PartnerProfile.fromJson(await _c.post('/partner/services', body) as Json);
  Future<PartnerProfile> updateService(String id, Json body) async => PartnerProfile.fromJson(await _c.patch('/partner/services/$id', body) as Json);
  Future<PartnerProfile> setHours(List<OpeningHours> hours) async =>
      PartnerProfile.fromJson(await _c.put('/partner/hours', {'hours': [for (final h in hours) h.toJson()]}) as Json);
  Future<PartnerProfile> addTimeOff(DateTime from, DateTime to, String? reason) async => PartnerProfile.fromJson(
      await _c.post('/partner/time-off', {'startsAt': from.toUtc().toIso8601String(), 'endsAt': to.toUtc().toIso8601String(), if (reason != null) 'reason': reason}) as Json);
  Future<PartnerProfile> removeTimeOff(String id) async => PartnerProfile.fromJson(await _c.delete('/partner/time-off/$id') as Json);

  // ── bookings ──
  Future<List<Booking>> bookings({String? when, String? status}) async =>
      (await _c.get('/partner/bookings', query: {'when': when, 'status': status}) as List).cast<Json>().map(Booking.fromJson).toList();
  Future<Booking> start(String id) async => Booking.fromJson(await _c.post('/partner/bookings/$id/start') as Json);
  Future<Booking> complete(String id) async => Booking.fromJson(await _c.post('/partner/bookings/$id/complete') as Json);
  Future<Booking> noShow(String id) async => Booking.fromJson(await _c.post('/partner/bookings/$id/no-show') as Json);
  Future<Booking> cancel(String id, String reason) async => Booking.fromJson(await _c.post('/partner/bookings/$id/cancel', {'reason': reason}) as Json);
  // ── reviews (Phase 9b) ── one public reply per review
  Future<(List<BusinessReview>, bool)> myReviews({int page = 1, bool unanswered = false, int? stars, bool photos = false}) async {
    final (items, more) = await _c.getPaged('/partner/reviews', query: {'page': page, 'limit': 20, if (unanswered) 'unanswered': 'true', 'stars': stars, if (photos) 'photos': 'true'});
    return (items.cast<Json>().map(BusinessReview.fromJson).toList(), more);
  }

  Future<ReviewsOverview> reviewsOverview() async => ReviewsOverview.fromJson(await _c.get('/partner/reviews/summary') as Json);
  Future<void> replyToReview(String id, String reply) => _c.post('/partner/reviews/$id/reply', {'reply': reply});

  // ── money ──
  Future<Earnings> earnings() async => Earnings.fromJson(await _c.get('/partner/earnings') as Json);

  // ── payouts, statement and invoices ──
  Future<PayoutSummary> payouts() async => PayoutSummary.fromJson(await _c.get('/partner/payouts') as Json);
  Future<PayoutAccounts> payoutAccount() async => PayoutAccounts.fromJson(await _c.get('/partner/payout-account') as Json);

  /// BANK needs ifsc + accountNumber; UPI needs vpa. The bank checks it at once and returns the name it has.
  Future<PayoutAccounts> addPayoutAccount(Json body) async => PayoutAccounts.fromJson(await _c.post('/partner/payout-account', body) as Json);

  Future<Statement> statement({int page = 1}) async => Statement.fromJson(await _c.get('/partner/statement', query: {'page': page, 'limit': 30}) as Json);

  Future<(List<Invoice>, bool)> invoices({String? kind, int page = 1}) async {
    final (items, more) = await _c.getPaged('/partner/invoices', query: {'kind': kind, 'page': page, 'limit': 30});
    return (items.cast<Json>().map(Invoice.fromJson).toList(), more);
  }

  /// A download link valid for a few minutes, to open in the browser.
  Future<InvoiceLink> invoiceLink(String id) async => InvoiceLink.fromJson(await _c.post('/invoices/$id/link') as Json);

  // ── terms ──
  Future<LegalDoc> legalDoc(String slug) async => LegalDoc.fromJson(await _c.get('/legal/$slug') as Json);
  Future<void> acceptTerms(String slug, int version) => _c.post('/me/consents', {'slug': slug, 'version': version});
  // ── chat (Phase 9a): the same methods in the partner and seller apps ──
  Future<ChatUnread> chatUnread() async => ChatUnread.fromJson(await _c.get('/chat/unread') as Json);
  Future<({List<ChatConversation> items, String? nextCursor})> conversations({String? cursor}) async {
    final j = await _c.get('/chat/conversations', query: {'as': 'partner', 'cursor': cursor}) as Json;
    return (items: (j['items'] as List).cast<Json>().map(ChatConversation.fromJson).toList(), nextCursor: j['nextCursor'] as String?);
  }
  /// Opens the conversation with the customer of a booking (created the first time).
  Future<ChatStart> startChat(String bookingId) async => ChatStart.fromJson(await _c.post('/chat/conversations', {'bookingId': bookingId}) as Json);
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
  Future<HelpCenter> helpCenter({String? q}) async => HelpCenter.fromJson(await _c.get('/support/faqs', query: {'app': 'partner', 'q': q}) as Json);
  Future<void> faqFeedback(String id, bool helpful) => _c.post('/support/faqs/$id/feedback', {'helpful': helpful});
  Future<List<SupportTopic>> supportTopics() async => (await _c.get('/support/categories', query: {'app': 'partner'}) as List).cast<Json>().map(SupportTopic.fromJson).toList();
  Future<List<SupportTicket>> myTickets() async => (await _c.get('/support/tickets', query: {'app': 'partner'}) as List).cast<Json>().map(SupportTicket.fromJson).toList();
  Future<SupportTicket> ticket(String id) async => SupportTicket.fromJson(await _c.get('/support/tickets/$id') as Json);
  Future<SupportTicket> openTicket({required String categoryId, required String subject, required String body, List<String> mediaIds = const [], String? refType, String? refId}) async =>
      SupportTicket.fromJson(await _c.post('/support/tickets', {
        'app': 'partner',
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
