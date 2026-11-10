import 'api_client.dart';
import 'models.dart';

/// Every endpoint the app calls. Paths here are checked against the API's OpenAPI spec by
/// tool/contract_check.py, so keep each call as `_c.<method>('<path>' …)`.
class PetAppApi {
  PetAppApi(this._c);
  final ApiClient _c;

  // ── auth ──
  Future<void> requestOtp(String phone) => _c.post('/auth/otp/request', {'phone': phone});
  Future<AuthResult> verifyOtp(String phone, String code) async =>
      AuthResult.fromJson(await _c.post('/auth/otp/verify', {'phone': phone, 'code': code}) as Json);
  Future<void> logout() => _c.post('/auth/logout');

  // ── config ──
  Future<Map<String, bool>> flags() async => (await _c.get('/config/flags') as Json).map((k, v) => MapEntry(k, v == true));

  // ── me & people ──
  Future<Me> me() async => Me.fromJson(await _c.get('/users/me') as Json);
  Future<Me> updateMe({String? name, String? city}) async => Me.fromJson(await _c.patch('/users/me', {if (name != null) 'name': name, if (city != null) 'city': city}) as Json);
  /// Schedules deletion after the grace period and signs out everywhere. Signing in again before then cancels it.
  Future<DeletionScheduled> deleteAccount() async => DeletionScheduled.fromJson(await _c.delete('/users/me') as Json);
  Future<PublicProfile> profile(String userId) async => PublicProfile.fromJson(await _c.get('/users/$userId') as Json);
  Future<void> follow(String userId) => _c.post('/users/$userId/follow');
  Future<void> unfollow(String userId) => _c.delete('/users/$userId/follow');

  // ── pets ──
  Future<List<Species>> species() async => (await _c.get('/species') as List).cast<Json>().map(Species.fromJson).toList();
  Future<List<Breed>> breeds(String speciesId) async => (await _c.get('/species/$speciesId/breeds') as List).cast<Json>().map(Breed.fromJson).toList();
  Future<List<Pet>> myPets() async => (await _c.get('/pets/mine') as List).cast<Json>().map(Pet.fromJson).toList();
  Future<Pet> pet(String idOrHandle) async => Pet.fromJson(await _c.get('/pets/$idOrHandle') as Json);
  Future<Pet> createPet(Map<String, Object?> body) async => Pet.fromJson(await _c.post('/pets', body) as Json);
  Future<Pet> updatePet(String id, Map<String, Object?> body) async => Pet.fromJson(await _c.patch('/pets/$id', body) as Json);
  Future<void> deletePet(String id) => _c.delete('/pets/$id');
  Future<void> followPet(String id) => _c.post('/pets/$id/follow');
  Future<void> unfollowPet(String id) => _c.delete('/pets/$id/follow');

  // ── media & posts ──
  /// [private]: a photo for a chat or a support ticket, only ever shown to the people in that conversation.
  /// [resumable]: large files may come back as MULTIPART, to be sent in parts (Phase 9e).
  Future<UploadTicket> createUpload(String kind, String mimeType, int sizeBytes, {bool private = false, bool resumable = false}) async => UploadTicket.fromJson(
      await _c.post('/media/uploads', {'kind': kind, 'mimeType': mimeType, 'sizeBytes': sizeBytes, if (private) 'private': true, if (resumable) 'resumable': true}) as Json);
  Future<List<PartUrl>> uploadPartUrls(String mediaId, List<int> partNumbers) async =>
      (((await _c.post('/media/$mediaId/parts', {'partNumbers': partNumbers})) as Json)['parts'] as List).cast<Json>().map(PartUrl.fromJson).toList();
  Future<UploadProgress> uploadProgress(String mediaId) async => UploadProgress.fromJson(await _c.get('/media/$mediaId/upload') as Json);
  Future<Media> completeUpload(String mediaId) async => Media.fromJson(await _c.post('/media/$mediaId/complete') as Json);
  Future<Media> media(String mediaId) async => Media.fromJson(await _c.get('/media/$mediaId') as Json);

  Future<Post> createPost(Map<String, Object?> body) async => Post.fromJson(await _c.post('/posts', body) as Json);
  Future<Post> post(String id) async => Post.fromJson(await _c.get('/posts/$id') as Json);
  Future<void> deletePost(String id) => _c.delete('/posts/$id');

  Future<CursorPage<Post>> feed({String? cursor}) => _posts('/feed', cursor);
  Future<CursorPage<Post>> trending({String? cursor, bool reels = false}) async =>
      CursorPage.fromJson(await _c.get('/feed/trending', query: {'cursor': cursor, 'kind': reels ? 'reels' : null}) as Json, Post.fromJson);
  Future<CursorPage<Post>> userPosts(String userId, {String? cursor}) => _posts('/users/$userId/posts', cursor);
  Future<CursorPage<Post>> petPosts(String petId, {String? cursor}) => _posts('/pets/$petId/posts', cursor);
  Future<CursorPage<Post>> saved({String? cursor}) => _posts('/users/me/saved', cursor);
  Future<CursorPage<Post>> hashtagPosts(String tag, {String? cursor}) async =>
      CursorPage.fromJson(await _c.get('/hashtags/$tag/posts', query: {'cursor': cursor}) as Json, Post.fromJson);

  Future<CursorPage<Post>> _posts(String path, String? cursor) async =>
      CursorPage.fromJson(await _c.get(path, query: {'cursor': cursor}) as Json, Post.fromJson);

  /// Returns the new like count.
  Future<int> like(String id, bool on) async => _int(await (on ? _c.post('/posts/$id/like') : _c.delete('/posts/$id/like')));
  Future<int> save(String id, bool on) async => _int(await (on ? _c.post('/posts/$id/save') : _c.delete('/posts/$id/save')));
  Future<void> share(String id, String channel) => _c.post('/posts/$id/share', {'channel': channel});
  Future<void> view(String id) => _c.post('/posts/$id/view');
  /// The video played to its last frame (once per viewer per day counts; Phase 9d).
  Future<void> viewedToEnd(String id) => _c.post('/posts/$id/view', {'completed': true});

  Future<CursorPage<Comment>> comments(String postId, {String? cursor}) async =>
      CursorPage.fromJson(await _c.get('/posts/$postId/comments', query: {'cursor': cursor}) as Json, Comment.fromJson);
  Future<CursorPage<Comment>> replies(String commentId, {String? cursor}) async =>
      CursorPage.fromJson(await _c.get('/comments/$commentId/replies', query: {'cursor': cursor}) as Json, Comment.fromJson);
  Future<Comment> addComment(String postId, String body, {String? parentId}) async =>
      Comment.fromJson(await _c.post('/posts/$postId/comments', {'body': body, if (parentId != null) 'parentId': parentId}) as Json);
  Future<void> deleteComment(String id) => _c.delete('/comments/$id');

  // ── notifications ──
  Future<({CursorPage<AppNotification> page, int unread})> notifications({String? cursor}) async {
    final j = await _c.get('/notifications', query: {'cursor': cursor}) as Json;
    return (page: CursorPage.fromJson(j, AppNotification.fromJson), unread: (j['unread'] as num?)?.toInt() ?? 0);
  }

  Future<int> unreadCount() async => ((await _c.get('/notifications/unread-count') as Json)['unread'] as num).toInt();
  Future<void> markRead([List<String>? ids]) => _c.post('/notifications/read', {if (ids != null) 'ids': ids});
  Future<NotificationPrefs> notificationPrefs() async => NotificationPrefs.fromJson(await _c.get('/notifications/preferences') as Json);
  Future<NotificationPrefs> setNotificationPrefs(Map<String, bool> changes) async =>
      NotificationPrefs.fromJson(await _c.put('/notifications/preferences', changes) as Json);
  Future<void> registerDevice(String token, String platform) =>
      _c.post('/devices', {'token': token, 'platform': platform, 'appVersion': '0.1.0'});
  Future<void> removeDevice(String token) => _c.delete('/devices/$token');

  // ── safety ──
  /// [evidenceIds]: private photo uploads (screenshots), seen only by moderators.
  Future<void> report(String targetType, String targetId, String reason, {String? details, List<String> evidenceIds = const []}) => _c.post('/reports', {
        'targetType': targetType,
        'targetId': targetId,
        'reason': reason,
        if (details != null && details.isNotEmpty) 'details': details,
        if (evidenceIds.isNotEmpty) 'evidenceIds': evidenceIds,
      });
  Future<void> block(String userId) => _c.post('/users/$userId/block');
  Future<void> unblock(String userId) => _c.delete('/users/$userId/block');
  Future<List<PersonRef>> blocks() async => (await _c.get('/users/me/blocks') as List).cast<Json>().map(PersonRef.fromJson).toList();

  // ── contests ──
  Future<List<ContestCard>> contests({String? when}) async =>
      ((await _c.get('/contests', query: {'when': when, 'limit': 50})) as List).cast<Json>().map(ContestCard.fromJson).toList();
  Future<ContestDetail> contest(String idOrSlug) async => ContestDetail.fromJson(await _c.get('/contests/$idOrSlug') as Json);
  Future<RegisterResult> registerForContest(String contestId, String petId) async =>
      RegisterResult.fromJson(await _c.post('/contests/$contestId/register', {'petId': petId}) as Json);
  Future<void> verifyPayment(String paymentId, String providerPaymentId, String signature) =>
      _c.post('/payments/$paymentId/verify', {'providerPaymentId': providerPaymentId, 'signature': signature});
  /// Development only: the API's fake gateway completes the payment.
  Future<void> simulatePayment(String paymentId) => _c.post('/payments/$paymentId/simulate');
  Future<void> submitTask(String entryId, String taskId, {String? postId, String? text}) =>
      _c.post('/contest-entries/$entryId/submissions', {'taskId': taskId, if (postId != null) 'postId': postId, if (text != null) 'text': text});
  Future<Leaderboard> leaderboard(String contestId) async => Leaderboard.fromJson(await _c.get('/contests/$contestId/leaderboard') as Json);
  Future<void> vote(String entryId) => _c.post('/contest-entries/$entryId/vote');

  // ── challenges and badges ──
  Future<List<ChallengeCard>> challenges({String? when}) async =>
      ((await _c.get('/challenges', query: {'when': when, 'limit': 50})) as List).cast<Json>().map(ChallengeCard.fromJson).toList();
  Future<ChallengeDetail> challenge(String idOrSlug) async => ChallengeDetail.fromJson(await _c.get('/challenges/$idOrSlug') as Json);
  Future<RegisterResult> joinChallenge(String id, {String? petId}) async =>
      RegisterResult.fromJson(await _c.post('/challenges/$id/join', {if (petId != null) 'petId': petId}) as Json);
  Future<CheckInResult> checkIn(String id, {String? postId, String? text}) async =>
      CheckInResult.fromJson(await _c.post('/challenges/$id/check-in', {if (postId != null) 'postId': postId, if (text != null) 'text': text}) as Json);
  Future<ChallengeBoard> challengeBoard(String id) async => ChallengeBoard.fromJson(await _c.get('/challenges/$id/leaderboard') as Json);
  Future<List<EarnedBadge>> myBadges() async => (await _c.get('/users/me/badges') as List).cast<Json>().map(EarnedBadge.fromJson).toList();

  // ── judging (accounts with the Judge role) ──
  Future<List<JudgeContest>> judgeContests() async => (await _c.get('/judge/contests') as List).cast<Json>().map(JudgeContest.fromJson).toList();
  Future<List<JudgeEntry>> judgeEntries(String contestId) async =>
      (await _c.get('/judge/contests/$contestId/entries') as List).cast<Json>().map(JudgeEntry.fromJson).toList();
  Future<void> saveScores(String entryId, Map<String, double> scores) =>
      _c.put('/judge/contest-entries/$entryId/scores', {'scores': [for (final e in scores.entries) {'criterionId': e.key, 'score': e.value}]});

  // ── services marketplace ──
  Future<List<ServiceCategory>> serviceCategories() async =>
      (await _c.get('/service-categories') as List).cast<Json>().map(ServiceCategory.fromJson).toList();
  Future<List<NearbyPartner>> nearby({required double lat, required double lng, String? categoryId, String? mode, int? radiusKm}) async =>
      (await _c.get('/services/nearby', query: {'lat': lat, 'lng': lng, 'categoryId': categoryId, 'mode': mode, 'radiusKm': radiusKm}) as List)
          .cast<Json>()
          .map(NearbyPartner.fromJson)
          .toList();
  Future<PartnerPage> servicePartner(String idOrSlug) async => PartnerPage.fromJson(await _c.get('/service-partners/$idOrSlug') as Json);
  /// A page of reviews. [stars] and [photos] filter; [sort] is recent | highest | lowest.
  Future<(List<ReviewView>, bool)> partnerReviews(String id, {int page = 1, int? stars, bool photos = false, String? sort}) async {
    final (items, more) = await _c.getPaged('/service-partners/$id/reviews', query: {'page': page, 'limit': 20, 'stars': stars, if (photos) 'photos': 'true', 'sort': sort});
    return (items.cast<Json>().map(ReviewView.fromJson).toList(), more);
  }
  Future<SlotDay> slots(String serviceId, String date) async => SlotDay.fromJson(await _c.get('/partner-services/$serviceId/slots', query: {'date': date}) as Json);
  Future<BookingView> book({required String serviceId, required String petId, required DateTime startsAt, required String mode, ({String line, double lat, double lng})? address}) async =>
      BookingView.fromJson(await _c.post('/bookings', {
        'serviceId': serviceId,
        'petId': petId,
        'startsAt': startsAt.toUtc().toIso8601String(),
        'mode': mode,
        if (address != null) 'address': {'line': address.line, 'lat': address.lat, 'lng': address.lng},
      }) as Json);
  Future<List<BookingView>> myBookings({String? when}) async =>
      (await _c.get('/bookings', query: {'when': when, 'limit': 50}) as List).cast<Json>().map(BookingView.fromJson).toList();
  Future<BookingView> booking(String id) async => BookingView.fromJson(await _c.get('/bookings/$id') as Json);
  Future<BookingView> cancelBooking(String id, {String? reason}) async =>
      BookingView.fromJson(await _c.post('/bookings/$id/cancel', {if (reason != null) 'reason': reason}) as Json);
  Future<BookingView> reviewBooking(String id, int rating, {String? comment, List<String> photoIds = const []}) async => BookingView.fromJson(await _c.post('/bookings/$id/review', {
        'rating': rating,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
        if (photoIds.isNotEmpty) 'photoIds': photoIds,
      }) as Json);

  // ── shop ──
  Future<List<ShopCategory>> shopCategories() async => (await _c.get('/product-categories') as List).cast<Json>().map(ShopCategory.fromJson).toList();
  Future<List<ProductCard>> products({String? q, String? categoryId, String? vendorId, String? sort}) async =>
      (await _c.get('/products', query: {'q': q, 'categoryId': categoryId, 'vendorId': vendorId, 'sort': sort, 'limit': 50}) as List).cast<Json>().map(ProductCard.fromJson).toList();
  Future<ProductDetail> product(String idOrSlug) async => ProductDetail.fromJson(await _c.get('/products/$idOrSlug') as Json);
  Future<(List<ReviewView>, bool)> productReviews(String idOrSlug, {int page = 1, int? stars, bool photos = false, String? sort}) async {
    final (items, more) = await _c.getPaged('/products/$idOrSlug/reviews', query: {'page': page, 'limit': 20, 'stars': stars, if (photos) 'photos': 'true', 'sort': sort});
    return (items.cast<Json>().map(ReviewView.fromJson).toList(), more);
  }

  /// Only for products delivered to you; one review per product.
  Future<ReviewView> reviewProduct(String productId, int rating, {String? comment, List<String> photoIds = const []}) async => ReviewView.fromJson(await _c.post('/products/$productId/reviews', {
        'rating': rating,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
        if (photoIds.isNotEmpty) 'photoIds': photoIds,
      }) as Json);
  Future<ReviewView> myProductReview(String productId) async => ReviewView.fromJson(await _c.get('/products/$productId/reviews/mine') as Json);
  Future<Cart> cart() async => Cart.fromJson(await _c.get('/cart') as Json);
  Future<Cart> setCartItem(String variantId, int qty) async => Cart.fromJson(await _c.put('/cart/items', {'variantId': variantId, 'qty': qty}) as Json);
  Future<Cart> clearCart() async => Cart.fromJson(await _c.delete('/cart') as Json);
  /// With [addressId], shipping and delivery time follow that address's delivery zone.
  Future<Cart> previewCheckout(String? couponCode, {String? addressId}) async => Cart.fromJson(await _c.post('/checkout/preview', {
        if (couponCode != null && couponCode.isNotEmpty) 'couponCode': couponCode,
        if (addressId != null) 'addressId': addressId,
      }) as Json);
  Future<({ShopOrder order, Checkout payment})> placeOrder(String addressId, {String? couponCode}) async {
    final j = await _c.post('/orders', {'addressId': addressId, if (couponCode != null && couponCode.isNotEmpty) 'couponCode': couponCode}) as Json;
    return (order: ShopOrder.fromJson(j['order'] as Json), payment: Checkout.fromJson(j['payment'] as Json));
  }

  Future<List<ShopOrderSummary>> shopOrders() async => (await _c.get('/orders') as List).cast<Json>().map(ShopOrderSummary.fromJson).toList();
  Future<ShopOrder> shopOrder(String id) async => ShopOrder.fromJson(await _c.get('/orders/$id') as Json);
  Future<ShopOrder> cancelParcel(String subOrderId, String reason) async => ShopOrder.fromJson(await _c.post('/sub-orders/$subOrderId/cancel', {'reason': reason}) as Json);
  Future<ShopOrder> returnParcel(String subOrderId, String reason) async => ShopOrder.fromJson(await _c.post('/sub-orders/$subOrderId/return', {'reason': reason}) as Json);
  Future<List<Address>> addresses() async => (await _c.get('/users/me/addresses') as List).cast<Json>().map(Address.fromJson).toList();
  Future<Address> addAddress(Map<String, Object?> body) async => Address.fromJson(await _c.post('/users/me/addresses', body) as Json);

  // ── money: refunds, invoices, prize payouts ──
  Future<(List<RefundItem>, bool)> refunds({int page = 1}) async {
    final (items, more) = await _c.getPaged('/me/refunds', query: {'page': page, 'limit': 30});
    return (items.cast<Json>().map(RefundItem.fromJson).toList(), more);
  }

  Future<(List<Invoice>, bool)> invoices({int page = 1}) async {
    final (items, more) = await _c.getPaged('/me/invoices', query: {'page': page, 'limit': 30});
    return (items.cast<Json>().map(Invoice.fromJson).toList(), more);
  }

  /// A download link valid for a few minutes, to open in the browser.
  Future<InvoiceLink> invoiceLink(String id) async => InvoiceLink.fromJson(await _c.post('/invoices/$id/link') as Json);

  /// Prize money: what's owed, the account it goes to, and payouts so far.
  Future<PayoutSummary> payouts() async => PayoutSummary.fromJson(await _c.get('/me/payouts') as Json);
  Future<PayoutAccounts> payoutAccount() async => PayoutAccounts.fromJson(await _c.get('/me/payout-account') as Json);
  Future<PayoutAccounts> addPayoutAccount(Map<String, Object?> body) async => PayoutAccounts.fromJson(await _c.post('/me/payout-account', body) as Json);
  Future<Statement> prizeStatement({int page = 1}) async => Statement.fromJson(await _c.get('/me/statement', query: {'page': page, 'limit': 30}) as Json);

  // ── home and recommendations ──
  /// The home screen for this place (the phone's position or a chosen city). Without one the API uses the saved address.
  Future<HomeFeed> home({double? lat, double? lng, String? city}) async =>
      HomeFeed.fromJson(await _c.get('/home', query: {'lat': lat, 'lng': lng, 'city': city}) as Json);
  Future<List<Picked<ProductCard>>> recommendedProducts({int limit = 10}) async =>
      (await _c.get('/recommendations/products', query: {'limit': limit}) as List).cast<Json>().map((j) => Picked.fromJson(j, ProductCard.fromJson)).toList();
  /// The Reels tab, "For you".
  Future<CursorPage<Post>> recommendedReels({String? cursor}) async =>
      CursorPage.fromJson(await _c.get('/recommendations/reels', query: {'cursor': cursor, 'limit': 10}) as Json, Post.fromJson);
  /// "Not interested": [targetType] is PRODUCT, PARTNER, CONTEST, CHALLENGE, POST or PET.
  Future<void> notInterested(String targetType, String targetId) => _c.post('/recommendations/dismiss', {'targetType': targetType, 'targetId': targetId});
  Future<RecoSettings> recoSettings() async => RecoSettings.fromJson(await _c.get('/me/recommendations') as Json);
  Future<RecoSettings> setPersonalised(bool on) async => RecoSettings.fromJson(await _c.put('/me/recommendations', {'personalised': on}) as Json);
  Future<RecoSettings> clearRecoHistory() async => RecoSettings.fromJson(await _c.delete('/me/recommendations/history') as Json);
  Future<List<Pet>> searchPets(String q) async =>
      (await _c.get('/pets', query: {'search': q, 'limit': 20}) as List).cast<Json>().map(Pet.fromJson).toList();

  // ── PetApp Assistant ──
  Future<AssistantInfo> assistantInfo() async => AssistantInfo.fromJson(await _c.get('/assistant') as Json);
  /// Ask a question; starts a conversation unless [conversationId] is given. [lat]/[lng] help find nearby services.
  Future<AskResult> askAssistant(String text, {String? conversationId, double? lat, double? lng}) async => AskResult.fromJson(await _c.post('/assistant/messages', {
        'text': text,
        if (conversationId != null) 'conversationId': conversationId,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
      }) as Json);
  Future<AssistantMessageView> rateAnswer(String messageId, String rating, {String? note}) async =>
      AssistantMessageView.fromJson(await _c.post('/assistant/messages/$messageId/rating', {'rating': rating, if (note != null && note.isNotEmpty) 'note': note}) as Json);
  /// Conversations, newest first (title and time only).
  Future<(List<AssistantConversation>, bool)> assistantConversations({int page = 1}) async {
    final (items, more) = await _c.getPaged('/assistant/conversations', query: {'page': page, 'limit': 30});
    return (items.cast<Json>().map(AssistantConversation.fromJson).toList(), more);
  }

  Future<AssistantConversation> assistantConversation(String id) async => AssistantConversation.fromJson(await _c.get('/assistant/conversations/$id') as Json);
  Future<void> deleteConversation(String id) => _c.delete('/assistant/conversations/$id');
  Future<void> deleteAllConversations() => _c.delete('/assistant/conversations');

  static int _int(Object? r) => r is Map && r['count'] is num ? (r['count'] as num).toInt() : 0;

  // ── privacy and legal ──
  Future<List<LegalDocSummary>> legalDocs() async => (await _c.get('/legal') as List).cast<Json>().map(LegalDocSummary.fromJson).toList();
  Future<LegalDoc> legalDoc(String slug) async => LegalDoc.fromJson(await _c.get('/legal/$slug') as Json);
  Future<ConsentStatus> consents() async => ConsentStatus.fromJson(await _c.get('/me/consents') as Json);
  Future<ConsentStatus> accept(String slug, int version) async => ConsentStatus.fromJson(await _c.post('/me/consents', {'slug': slug, 'version': version}) as Json);
  Future<ConsentStatus> setMarketing(bool granted) async => ConsentStatus.fromJson(await _c.put('/me/marketing', {'granted': granted}) as Json);
  Future<DataExports> dataExports() async => DataExports.fromJson(await _c.get('/me/data-exports') as Json);
  Future<DataExports> requestDataExport() async => DataExports.fromJson(await _c.post('/me/data-exports') as Json);
  Future<ExportLink> dataExportLink(String id) async => ExportLink.fromJson(await _c.get('/me/data-exports/$id/link') as Json);

  // ── chat (Phase 9a) ──
  Future<ChatUnread> chatUnread() async => ChatUnread.fromJson(await _c.get('/chat/unread') as Json);
  Future<CursorPage<ChatConversation>> conversations({String? cursor}) async =>
      CursorPage.fromJson(await _c.get('/chat/conversations', query: {'as': 'customer', 'cursor': cursor}) as Json, ChatConversation.fromJson);
  /// Opens the conversation with a partner, about a product, a booking or an order (created the first time).
  Future<ChatStart> startChat({String? partnerId, String? productId, String? bookingId, String? subOrderId}) async => ChatStart.fromJson(await _c.post('/chat/conversations', {
        if (partnerId != null) 'partnerId': partnerId,
        if (productId != null) 'productId': productId,
        if (bookingId != null) 'bookingId': bookingId,
        if (subOrderId != null) 'subOrderId': subOrderId,
      }) as Json);
  Future<ChatHeader> conversation(String id) async => ChatHeader.fromJson(await _c.get('/chat/conversations/$id') as Json);
  /// Newest first; [before] pages back. [after] catches up after reconnecting (oldest first).
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

  // ── help & support (Phase 9a) ──
  Future<HelpCenter> helpCenter({String? q}) async => HelpCenter.fromJson(await _c.get('/support/faqs', query: {'app': 'customer', 'q': q}) as Json);
  Future<void> faqFeedback(String id, bool helpful) => _c.post('/support/faqs/$id/feedback', {'helpful': helpful});
  Future<List<SupportTopic>> supportTopics() async => (await _c.get('/support/categories', query: {'app': 'customer'}) as List).cast<Json>().map(SupportTopic.fromJson).toList();
  Future<List<SupportTicket>> myTickets() async => (await _c.get('/support/tickets', query: {'app': 'customer'}) as List).cast<Json>().map(SupportTicket.fromJson).toList();
  Future<SupportTicket> ticket(String id) async => SupportTicket.fromJson(await _c.get('/support/tickets/$id') as Json);
  Future<SupportTicket> openTicket({required String categoryId, required String subject, required String body, List<String> mediaIds = const [], String? refType, String? refId}) async =>
      SupportTicket.fromJson(await _c.post('/support/tickets', {
        'app': 'customer',
        'categoryId': categoryId,
        'subject': subject,
        'body': body,
        if (mediaIds.isNotEmpty) 'mediaIds': mediaIds,
        if (refType != null) 'refType': refType,
        if (refId != null) 'refId': refId,
      }) as Json);
  Future<SupportTicket> closeTicket(String id) async => SupportTicket.fromJson(await _c.post('/support/tickets/$id/close') as Json);

  // ── search, discovery and locations (Phase 9c) ──
  /// The best few of every kind. [lat]/[lng] put nearby services first.
  Future<SearchAll> searchAll(String q, {double? lat, double? lng}) async => SearchAll.fromJson(await _c.get('/search', query: {'q': q, 'lat': lat, 'lng': lng}) as Json);

  /// One kind, paged, with that kind's filters (only the ones given are sent).
  Future<(List<SearchHit>, bool)> searchType(String type, String q, {int page = 1, Map<String, Object?> filters = const {}}) async {
    final (items, more) = await _c.getPaged('/search/$type', query: {'q': q, 'page': page, 'limit': 20, ...filters});
    return (items.cast<Json>().map(SearchHit.fromJson).toList(), more);
  }

  Future<SearchFilters> searchFilters() async => SearchFilters.fromJson(await _c.get('/search/filters') as Json);
  Future<List<Pet>> trendingPets() async => (await _c.get('/discover/pets/trending', query: {'limit': 30}) as List).cast<Json>().map(Pet.fromJson).toList();
  Future<(List<Pet>, bool)> nearbyPets({required double lat, required double lng, int page = 1, String? speciesId}) async {
    final (items, more) = await _c.getPaged('/discover/pets/nearby', query: {'lat': lat, 'lng': lng, 'page': page, 'limit': 30, 'speciesId': speciesId});
    return (items.cast<Json>().map(Pet.fromJson).toList(), more);
  }

  Future<CursorPage<Post>> popularReels({String? cursor}) => _posts('/discover/reels', cursor);
  Future<List<ContestEntryCard>> contestEntries() async => (await _c.get('/discover/contest-entries', query: {'limit': 30}) as List).cast<Json>().map(ContestEntryCard.fromJson).toList();
  Future<List<ChallengeEntryCard>> challengeEntries() async => (await _c.get('/discover/challenge-entries', query: {'limit': 30}) as List).cast<Json>().map(ChallengeEntryCard.fromJson).toList();
  /// A PIN code, city, area or landmark (spec §19).
  Future<List<PlaceHit>> searchPlaces(String q) async =>
      ((await _c.get('/locations/search', query: {'q': q}) as Json)['places'] as List).cast<Json>().map(PlaceHit.fromJson).toList();
  /// The area at a point (PetApp's, else the map provider's name for it), for "Near Koregaon Park".
  Future<String?> areaAt(double lat, double lng) async {
    final j = await _c.get('/locations/resolve', query: {'lat': lat, 'lng': lng}) as Json;
    return ((j['locality'] as Json?)?['name'] as String?) ?? ((j['place'] as Json?)?['label'] as String?);
  }
  Future<PincodeInfo> pincode(String code) async => PincodeInfo.fromJson(await _c.get('/locations/pincodes/$code') as Json);
  Future<Coverage> coverage(double lat, double lng) async => Coverage.fromJson(await _c.get('/locations/coverage', query: {'lat': lat, 'lng': lng}) as Json);
  Future<List<CityOption>> cities({String? q}) async => (await _c.get('/locations/cities', query: {'q': q}) as List).cast<Json>().map(CityOption.fromJson).toList();

  // ───────────── memberships (Phase 9d) ─────────────
  Future<List<MembershipPlan>> membershipPlans() async => (await _c.get('/memberships/plans') as List).cast<Json>().map(MembershipPlan.fromJson).toList();
  Future<MyMembership> myMembership() async => MyMembership.fromJson(await _c.get('/memberships/me') as Json);
  Future<Checkout> buyMembership(String planId) async => Checkout.fromJson((await _c.post('/memberships/purchase', {'planId': planId}) as Json)['payment'] as Json);
}
