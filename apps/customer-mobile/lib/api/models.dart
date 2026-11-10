// Models for the PetApp API. Hand-written fromJson (no code generation) and checked against
// real API responses in test/fixtures by test/models_test.dart and tool/contract_check.py.

typedef Json = Map<String, dynamic>;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
int _int(Object? v) => v is num ? v.toInt() : 0;
int? _intOrNull(Object? v) => v is num ? v.toInt() : null;
Json _map(Object? v) => v is Map<String, dynamic> ? v : const <String, dynamic>{};
List<T> _list<T>(Object? v, T Function(Json) f) => v is List ? v.whereType<Map<String, dynamic>>().map(f).toList() : <T>[];

class Tokens {
  Tokens({required this.accessToken, required this.refreshToken, required this.accessTokenExpiresIn});
  final String accessToken;
  final String refreshToken;
  final int accessTokenExpiresIn;

  factory Tokens.fromJson(Json j) =>
      Tokens(accessToken: j['accessToken'] as String, refreshToken: j['refreshToken'] as String, accessTokenExpiresIn: _int(j['accessTokenExpiresIn']));
}

class AuthResult {
  AuthResult({required this.userId, required this.tokens, required this.isNewUser, this.accountRestored = false});
  final String userId;
  final Tokens tokens;
  final bool isNewUser;

  /// They had asked to delete their account; signing in during the grace period cancelled it.
  final bool accountRestored;

  factory AuthResult.fromJson(Json j) => AuthResult(
        userId: (j['user'] as Json)['id'] as String,
        tokens: Tokens.fromJson(j['tokens'] as Json),
        isNewUser: j['isNewUser'] == true,
        accountRestored: j['accountRestored'] == true,
      );
}

class Me {
  Me({required this.id, this.name, this.phone, this.email, this.avatarUrl, this.city, required this.pets, required this.followers, required this.following, this.roles = const [], this.memberPlan});
  final String id;
  final String? name;
  final String? phone;
  final String? email;
  final String? avatarUrl;
  final String? city;
  final int pets;
  final int followers;
  final int following;
  final List<String> roles;
  /// The membership plan whose badge shows on the profile (Phase 9d), or null.
  final String? memberPlan;

  bool get isJudge => roles.contains('JUDGE');

  factory Me.fromJson(Json j) {
    final c = (j['counts'] as Json?) ?? const {};
    return Me(
      id: j['id'] as String,
      name: j['name'] as String?,
      phone: j['phone'] as String?,
      email: j['email'] as String?,
      avatarUrl: j['avatarUrl'] as String?,
      city: j['city'] as String?,
      pets: _int(c['pets']),
      followers: _int(c['followers']),
      following: _int(c['following']),
      roles: (j['roles'] as List?)?.whereType<String>().toList() ?? const [],
      memberPlan: (j['member'] as Json?)?['plan'] as String?,
    );
  }
}

class PersonRef {
  PersonRef({required this.id, this.name, this.avatarUrl});
  final String id;
  final String? name;
  final String? avatarUrl;
  factory PersonRef.fromJson(Json j) => PersonRef(id: j['id'] as String, name: j['name'] as String?, avatarUrl: j['avatarUrl'] as String?);
}

class PublicProfile {
  PublicProfile({required this.id, this.name, this.avatarUrl, this.city, required this.followers, required this.following, required this.isFollowing, required this.pets, this.memberPlan});
  final String id;
  final String? name;
  final String? avatarUrl;
  final String? city;
  final int followers;
  final int following;
  final bool isFollowing;
  final List<PetRef> pets;
  final String? memberPlan;

  factory PublicProfile.fromJson(Json j) => PublicProfile(
        id: j['id'] as String,
        name: j['name'] as String?,
        avatarUrl: j['avatarUrl'] as String?,
        city: j['city'] as String?,
        followers: _int(j['followers']),
        following: _int(j['following']),
        isFollowing: j['isFollowing'] == true,
        pets: _list(j['pets'], PetRef.fromJson),
        memberPlan: (j['member'] as Json?)?['plan'] as String?,
      );
}

class Species {
  Species({required this.id, required this.key, required this.name});
  final String id;
  final String key;
  final String name;
  factory Species.fromJson(Json j) => Species(id: j['id'] as String, key: j['key'] as String, name: j['name'] as String);
}

class Breed {
  Breed({required this.id, required this.name});
  final String id;
  final String name;
  factory Breed.fromJson(Json j) => Breed(id: j['id'] as String, name: j['name'] as String);
}

class PetRef {
  PetRef({required this.id, required this.name, required this.handle, this.avatarUrl});
  final String id;
  final String name;
  final String handle;
  final String? avatarUrl;
  factory PetRef.fromJson(Json j) => PetRef(id: j['id'] as String, name: j['name'] as String, handle: j['handle'] as String, avatarUrl: j['avatarUrl'] as String?);
}

class Pet {
  Pet({
    required this.id,
    required this.name,
    required this.handle,
    this.avatarUrl,
    required this.speciesName,
    this.speciesId,
    this.breedName,
    this.gender,
    this.ageMonths,
    this.about,
    required this.personality,
    this.city,
    required this.visibility,
    required this.followerCount,
    required this.isVerified,
    required this.isOwner,
    required this.isFollowing,
    required this.restricted,
    this.owner,
    this.microchipId,
    this.discoverable = false,
    this.distanceKm,
  });
  final String id;
  final String name;
  final String handle;
  final String? avatarUrl;
  final String speciesName;
  final String? speciesId;
  final String? breedName;
  final String? gender;
  final int? ageMonths;
  final String? about;
  final List<String> personality;
  final String? city;
  final String visibility;
  final int followerCount;
  final bool isVerified;
  final bool isOwner;
  final bool isFollowing;

  /// Followers-only pet viewed by someone who doesn't follow: only the card fields are present.
  final bool restricted;
  final PersonRef? owner;

  /// Owner only.
  final String? microchipId;

  /// Owner only (Phase 9c): shown in "Pets near you".
  final bool discoverable;

  /// "Pets near you" only: whole kilometres, rounded up.
  final int? distanceKm;

  factory Pet.fromJson(Json j) => Pet(
        id: j['id'] as String,
        name: j['name'] as String,
        handle: j['handle'] as String,
        avatarUrl: j['avatarUrl'] as String?,
        speciesName: ((j['species'] as Json?)?['name'] as String?) ?? '',
        speciesId: (j['species'] as Json?)?['id'] as String?,
        breedName: (j['breed'] as Json?)?['name'] as String?,
        gender: j['gender'] as String?,
        ageMonths: j['ageMonths'] is num ? (j['ageMonths'] as num).toInt() : null,
        about: j['about'] as String?,
        personality: (j['personality'] as List?)?.whereType<String>().toList() ?? const [],
        city: j['city'] as String?,
        visibility: (j['visibility'] as String?) ?? 'PUBLIC',
        followerCount: _int(j['followerCount']),
        isVerified: j['isVerified'] == true,
        isOwner: j['isOwner'] == true,
        isFollowing: j['isFollowing'] == true,
        restricted: j['restricted'] == true,
        owner: j['owner'] is Map<String, dynamic> ? PersonRef.fromJson(j['owner'] as Json) : null,
        microchipId: j['microchipId'] as String?,
        discoverable: j['discoverable'] == true,
        distanceKm: j['distanceKm'] is num ? (j['distanceKm'] as num).toInt() : null,
      );
}

class MediaImage {
  MediaImage(this.width, this.url);
  final int width;
  final String url;
}

class Media {
  Media({required this.id, required this.kind, required this.status, this.width, this.height, this.durationMs, required this.images, this.hls, this.poster});
  final String id;
  final String kind; // IMAGE | VIDEO
  final String status; // PENDING_UPLOAD | UPLOADED | PROCESSING | READY | FAILED | REJECTED
  final int? width;
  final int? height;
  final int? durationMs;
  final List<MediaImage> images;
  final String? hls;
  final String? poster;

  bool get isVideo => kind == 'VIDEO';
  bool get isReady => status == 'READY';
  bool get isFinal => status == 'READY' || status == 'FAILED' || status == 'REJECTED';
  double get aspectRatio => (width != null && height != null && height! > 0) ? width! / height! : 1;

  /// Smallest variant at least [minWidth] wide, so phones don't download more than they show.
  String? imageFor(double minWidth) {
    if (images.isEmpty) return null;
    final sorted = [...images]..sort((a, b) => a.width.compareTo(b.width));
    return sorted.firstWhere((i) => i.width >= minWidth, orElse: () => sorted.last).url;
  }

  factory Media.fromJson(Json j) => Media(
        id: j['id'] as String,
        kind: j['kind'] as String,
        status: j['status'] as String,
        width: j['width'] is num ? (j['width'] as num).toInt() : null,
        height: j['height'] is num ? (j['height'] as num).toInt() : null,
        durationMs: j['durationMs'] is num ? (j['durationMs'] as num).toInt() : null,
        images: (j['images'] as List?)?.whereType<Map<String, dynamic>>().map((i) => MediaImage(_int(i['width']), i['url'] as String)).toList() ?? const [],
        hls: j['hls'] as String?,
        poster: j['poster'] as String?,
      );
}

class Counts {
  Counts({required this.likes, required this.comments, required this.saves, required this.shares, required this.views});
  final int likes;
  final int comments;
  final int saves;
  final int shares;
  final int views;
  factory Counts.fromJson(Json j) =>
      Counts(likes: _int(j['likes']), comments: _int(j['comments']), saves: _int(j['saves']), shares: _int(j['shares']), views: _int(j['views']));
  Counts copyWith({int? likes, int? saves, int? comments}) =>
      Counts(likes: likes ?? this.likes, comments: comments ?? this.comments, saves: saves ?? this.saves, shares: shares, views: views);
}

class Post {
  Post({
    required this.id,
    required this.type,
    required this.status,
    required this.visibility,
    this.caption,
    this.locationName,
    required this.author,
    required this.pets,
    required this.hashtags,
    required this.media,
    required this.counts,
    required this.liked,
    required this.saved,
    required this.isAuthor,
    this.publishedAt,
  });
  final String id;
  final String type; // PHOTO | VIDEO | REEL
  final String status;
  final String visibility;
  final String? caption;
  final String? locationName;
  final PersonRef author;
  final List<PetRef> pets;
  final List<String> hashtags;
  final List<Media> media;
  final Counts counts;
  final bool liked;
  final bool saved;
  final bool isAuthor;
  final DateTime? publishedAt;

  bool get isReel => type == 'REEL';

  factory Post.fromJson(Json j) {
    final v = (j['viewer'] as Json?) ?? const {};
    return Post(
      id: j['id'] as String,
      type: j['type'] as String,
      status: j['status'] as String,
      visibility: j['visibility'] as String,
      caption: j['caption'] as String?,
      locationName: j['locationName'] as String?,
      author: PersonRef.fromJson(j['author'] as Json),
      pets: _list(j['pets'], PetRef.fromJson),
      hashtags: (j['hashtags'] as List?)?.whereType<String>().toList() ?? const [],
      media: _list(j['media'], Media.fromJson),
      counts: Counts.fromJson(j['counts'] as Json),
      liked: v['liked'] == true,
      saved: v['saved'] == true,
      isAuthor: v['isAuthor'] == true,
      publishedAt: _date(j['publishedAt']),
    );
  }

  Post copyWith({bool? liked, bool? saved, Counts? counts}) => Post(
        id: id,
        type: type,
        status: status,
        visibility: visibility,
        caption: caption,
        locationName: locationName,
        author: author,
        pets: pets,
        hashtags: hashtags,
        media: media,
        counts: counts ?? this.counts,
        liked: liked ?? this.liked,
        saved: saved ?? this.saved,
        isAuthor: isAuthor,
        publishedAt: publishedAt,
      );
}

class Comment {
  Comment({required this.id, required this.body, this.parentId, required this.replyCount, required this.author, this.createdAt, required this.isAuthor});
  final String id;
  final String body;
  final String? parentId;
  final int replyCount;
  final PersonRef author;
  final DateTime? createdAt;
  final bool isAuthor;
  factory Comment.fromJson(Json j) => Comment(
        id: j['id'] as String,
        body: j['body'] as String,
        parentId: j['parentId'] as String?,
        replyCount: _int(j['replyCount']),
        author: PersonRef.fromJson(j['author'] as Json),
        createdAt: _date(j['createdAt']),
        isAuthor: j['isAuthor'] == true,
      );
}

class AppNotification {
  AppNotification({required this.id, required this.type, required this.title, required this.body, this.actor, this.entityType, this.entityId, this.link, required this.count, required this.read, this.at});
  final String id;
  final String type;
  final String title;
  final String body;
  final PersonRef? actor;
  final String? entityType;
  final String? entityId;
  /// A page in the app to open (promotions).
  final String? link;
  final int count;
  final bool read;
  final DateTime? at;
  factory AppNotification.fromJson(Json j) => AppNotification(
        id: j['id'] as String,
        type: j['type'] as String,
        title: j['title'] as String,
        body: j['body'] as String,
        actor: j['actor'] is Map<String, dynamic> ? PersonRef.fromJson(j['actor'] as Json) : null,
        entityType: j['entityType'] as String?,
        entityId: j['entityId'] as String?,
        link: j['link'] as String?,
        count: _int(j['count']),
        read: j['read'] == true,
        at: _date(j['at']),
      );
}

class NotificationPrefs {
  NotificationPrefs(this.values);
  final Map<String, bool> values;
  static const keys = ['push', 'likes', 'comments', 'mentions', 'follows', 'posts', 'chat', 'reminders', 'votes', 'promotions'];
  /// Off unless turned on: offers and announcements need the person's consent.
  static const optIn = {'promotions'};
  factory NotificationPrefs.fromJson(Json j) => NotificationPrefs({for (final k in keys) k: optIn.contains(k) ? j[k] == true : j[k] != false});
}

/// A cursor page (feeds, comments, notifications).
class CursorPage<T> {
  CursorPage(this.items, this.nextCursor);
  final List<T> items;
  final String? nextCursor;
  factory CursorPage.fromJson(Json j, T Function(Json) f) => CursorPage(_list(j['items'], f), j['nextCursor'] as String?);
}

class UploadTicket {
  UploadTicket({required this.mediaId, required this.url, required this.method, required this.headers, this.partSize = 0, this.partCount = 0});
  final String mediaId;
  /// Empty for a MULTIPART upload: each part gets its own address (Phase 9e).
  final String url;
  /// PUT (one request) or MULTIPART (in parts, resumable).
  final String method;
  final Map<String, String> headers;
  final int partSize;
  final int partCount;
  bool get inParts => method == 'MULTIPART';
  factory UploadTicket.fromJson(Json j) {
    final u = j['upload'] as Json;
    return UploadTicket(
      mediaId: (j['media'] as Json)['id'] as String,
      url: (u['url'] as String?) ?? '',
      method: u['method'] as String,
      headers: ((u['headers'] as Json?) ?? const {}).map((k, v) => MapEntry(k, v.toString())),
      partSize: _int(u['partSize']),
      partCount: _int(u['partCount']),
    );
  }
}

/// Where a resumable upload got to (Phase 9e).
class UploadProgress {
  UploadProgress({required this.method, required this.status, required this.sizeBytes, required this.partSize, required this.partCount, required this.uploaded, required this.missing, required this.uploadedBytes});
  final String method;
  final String status;
  final int sizeBytes;
  final int partSize;
  final int partCount;
  final List<int> uploaded;
  final List<int> missing;
  final int uploadedBytes;
  factory UploadProgress.fromJson(Json j) => UploadProgress(
        method: j['method'] as String,
        status: j['status'] as String,
        sizeBytes: _int(j['sizeBytes']),
        partSize: _int(j['partSize']),
        partCount: _int(j['partCount']),
        uploaded: (j['uploaded'] as List?)?.whereType<num>().map((n) => n.toInt()).toList() ?? const [],
        missing: (j['missing'] as List?)?.whereType<num>().map((n) => n.toInt()).toList() ?? const [],
        uploadedBytes: _int(j['uploadedBytes']),
      );
}

/// A signed address for one part of a resumable upload.
class PartUrl {
  PartUrl({required this.partNumber, required this.length, required this.url, required this.headers});
  final int partNumber;
  final int length;
  final String url;
  final Map<String, String> headers;
  factory PartUrl.fromJson(Json j) => PartUrl(
        partNumber: _int(j['partNumber']),
        length: _int(j['length']),
        url: j['url'] as String,
        headers: ((j['headers'] as Json?) ?? const {}).map((k, v) => MapEntry(k, v.toString())),
      );
}

// ── Contests (Phase 3) ──

class Prize {
  Prize({this.rank, required this.title, required this.kind, this.amountPaise});
  final int? rank;
  final String title;
  final String kind;
  final int? amountPaise;
  factory Prize.fromJson(Json j) => Prize(
        rank: j['rank'] is num ? (j['rank'] as num).toInt() : null,
        title: j['title'] as String,
        kind: j['kind'] as String,
        amountPaise: j['amountPaise'] is num ? (j['amountPaise'] as num).toInt() : null,
      );
}

class ContestCard {
  ContestCard({
    required this.id,
    required this.slug,
    required this.title,
    this.bannerUrl,
    this.categoryName,
    required this.status,
    required this.feePaise,
    required this.entries,
    this.maxParticipants,
    this.registrationOpensAt,
    this.registrationClosesAt,
    this.submissionClosesAt,
    this.votingClosesAt,
    required this.prizes,
    this.membersOnly = false,
  });
  final String id;
  final String slug;
  final String title;
  final String? bannerUrl;
  final String? categoryName;
  final String status;
  final int feePaise;
  final int entries;
  final int? maxParticipants;
  final DateTime? registrationOpensAt;
  final DateTime? registrationClosesAt;
  final DateTime? submissionClosesAt;
  final DateTime? votingClosesAt;
  final List<Prize> prizes;
  /// Only members whose plan includes members-only contests can enter (Phase 9d).
  final bool membersOnly;

  bool get isFree => feePaise == 0;
  bool get registrationOpen {
    final now = DateTime.now();
    return (status == 'SCHEDULED' || status == 'LIVE') &&
        (registrationOpensAt == null || now.isAfter(registrationOpensAt!)) &&
        (registrationClosesAt == null || now.isBefore(registrationClosesAt!));
  }

  factory ContestCard.fromJson(Json j) => ContestCard(
        id: j['id'] as String,
        slug: j['slug'] as String,
        title: j['title'] as String,
        bannerUrl: j['bannerUrl'] as String?,
        categoryName: (j['category'] as Json?)?['name'] as String?,
        status: j['status'] as String,
        feePaise: _int(j['feePaise']),
        entries: _int(j['entries']),
        maxParticipants: j['maxParticipants'] is num ? (j['maxParticipants'] as num).toInt() : null,
        registrationOpensAt: _date(j['registrationOpensAt']),
        registrationClosesAt: _date(j['registrationClosesAt']),
        submissionClosesAt: _date(j['submissionClosesAt']),
        votingClosesAt: _date(j['votingClosesAt']),
        prizes: _list(j['prizes'], Prize.fromJson),
        membersOnly: j['membersOnly'] == true,
      );
}

class ContestTask {
  ContestTask({required this.id, required this.type, required this.title, this.description, required this.required});
  final String id;
  final String type; // POST | TEXT
  final String title;
  final String? description;
  final bool required;
  factory ContestTask.fromJson(Json j) =>
      ContestTask(id: j['id'] as String, type: j['type'] as String, title: j['title'] as String, description: j['description'] as String?, required: j['required'] != false);
}

/// What the app needs to open the payment gateway's checkout.
class Checkout {
  Checkout({required this.paymentId, required this.provider, required this.orderId, required this.amountPaise, required this.key, required this.status});
  final String paymentId;
  final String provider; // razorpay | fake
  final String orderId;
  final int amountPaise;
  final String key;
  final String status;
  factory Checkout.fromJson(Json j) => Checkout(
        paymentId: j['paymentId'] as String,
        provider: j['provider'] as String,
        orderId: j['orderId'] as String,
        amountPaise: _int(j['amountPaise']),
        key: j['key'] as String,
        status: j['status'] as String,
      );
}

class MyEntry {
  MyEntry({required this.id, required this.status, required this.petName, required this.submittedTaskIds, this.payment});
  final String id;
  final String status;
  final String petName;
  final List<String> submittedTaskIds;
  final Checkout? payment;
  factory MyEntry.fromJson(Json j) => MyEntry(
        id: j['id'] as String,
        status: j['status'] as String,
        petName: ((j['pet'] as Json?)?['name'] as String?) ?? '',
        submittedTaskIds: (j['submittedTaskIds'] as List?)?.whereType<String>().toList() ?? const [],
        payment: j['payment'] is Map<String, dynamic> ? Checkout.fromJson(j['payment'] as Json) : null,
      );
}

class ContestDetail {
  ContestDetail({
    required this.card,
    required this.description,
    this.rules,
    this.terms,
    required this.publicWeight,
    required this.votesPerUserPerDay,
    this.cancelReason,
    required this.leaderboardFrozen,
    required this.tasks,
    required this.myEntries,
  });
  final ContestCard card;
  final String description;
  final String? rules;
  final String? terms;
  final int publicWeight;
  final int votesPerUserPerDay;
  final String? cancelReason;
  final bool leaderboardFrozen;
  final List<ContestTask> tasks;
  final List<MyEntry> myEntries;

  factory ContestDetail.fromJson(Json j) => ContestDetail(
        card: ContestCard.fromJson(j),
        description: j['description'] as String,
        rules: j['rules'] as String?,
        terms: j['terms'] as String?,
        publicWeight: _int(j['publicWeight']),
        votesPerUserPerDay: _int(j['votesPerUserPerDay']),
        cancelReason: j['cancelReason'] as String?,
        leaderboardFrozen: j['leaderboardFrozen'] == true,
        tasks: _list(j['tasks'], ContestTask.fromJson),
        myEntries: _list(((j['viewer'] as Json?) ?? const {})['entries'], MyEntry.fromJson),
      );
}

class RegisterResult {
  RegisterResult({required this.entryId, required this.status, this.payment});
  final String entryId;
  final String status;
  final Checkout? payment;
  factory RegisterResult.fromJson(Json j) => RegisterResult(
        entryId: j['entryId'] as String,
        status: j['status'] as String,
        payment: j['payment'] is Map<String, dynamic> ? Checkout.fromJson(j['payment'] as Json) : null,
      );
}

class BoardRow {
  BoardRow({required this.rank, required this.entryId, this.pet, this.ownerName, this.status, required this.votes, required this.combined});
  final int rank;
  final String entryId;
  final PetRef? pet;
  final String? ownerName;
  final String? status;
  final int votes;
  final double combined;
  factory BoardRow.fromJson(Json j) => BoardRow(
        rank: _int(j['rank']),
        entryId: j['entryId'] as String,
        pet: j['pet'] is Map<String, dynamic> ? PetRef.fromJson(j['pet'] as Json) : null,
        ownerName: (j['owner'] as Json?)?['name'] as String?,
        status: j['status'] as String?,
        votes: _int(j['votes']),
        combined: (j['combined'] as num?)?.toDouble() ?? 0,
      );
}

class Leaderboard {
  Leaderboard({required this.frozen, required this.publicWeight, required this.rows});
  final bool frozen;
  final int publicWeight;
  final List<BoardRow> rows;
  factory Leaderboard.fromJson(Json j) => Leaderboard(frozen: j['frozen'] == true, publicWeight: _int(j['publicWeight']), rows: _list(j['rows'], BoardRow.fromJson));
}

// ── Challenges and badges (Phase 3c) ──

class ChallengeMine {
  ChallengeMine({required this.status, required this.points, required this.checkIns, required this.streak, required this.checkedInToday});
  final String status;
  final int points;
  final int checkIns;
  final int streak;
  final bool checkedInToday;
  factory ChallengeMine.fromJson(Json j) =>
      ChallengeMine(status: j['status'] as String, points: _int(j['points']), checkIns: _int(j['checkIns']), streak: _int(j['streak']), checkedInToday: j['checkedInToday'] == true);
}

class ChallengeCard {
  ChallengeCard({
    required this.id,
    required this.title,
    this.bannerUrl,
    required this.kind,
    required this.feePaise,
    this.startsAt,
    this.endsAt,
    required this.status,
    required this.requiredCheckIns,
    required this.proof,
    required this.pointsPerCheckIn,
    required this.streakBonusEvery,
    required this.streakBonusPoints,
    required this.participants,
    this.badgeName,
    this.mine,
    this.membersOnly = false,
  });
  final String id;
  final String title;
  final String? bannerUrl;
  final String kind; // FREE | PAID | CONTEST_LINKED
  final int feePaise;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final String status;
  final int requiredCheckIns;
  final String proof; // NONE | POST | TEXT
  final int pointsPerCheckIn;
  final int streakBonusEvery;
  final int streakBonusPoints;
  final int participants;
  final String? badgeName;
  final ChallengeMine? mine;
  /// A premium challenge for members (Phase 9d).
  final bool membersOnly;

  bool get running {
    final now = DateTime.now();
    return status == 'PUBLISHED' && (startsAt == null || now.isAfter(startsAt!)) && (endsAt == null || now.isBefore(endsAt!));
  }

  factory ChallengeCard.fromJson(Json j) => ChallengeCard(
        id: j['id'] as String,
        title: j['title'] as String,
        bannerUrl: j['bannerUrl'] as String?,
        kind: j['kind'] as String,
        feePaise: _int(j['feePaise']),
        startsAt: _date(j['startsAt']),
        endsAt: _date(j['endsAt']),
        status: j['status'] as String,
        requiredCheckIns: _int(j['requiredCheckIns']),
        proof: j['proof'] as String,
        pointsPerCheckIn: _int(j['pointsPerCheckIn']),
        streakBonusEvery: _int(j['streakBonusEvery']),
        streakBonusPoints: _int(j['streakBonusPoints']),
        participants: _int(j['participants']),
        badgeName: (j['badge'] as Json?)?['name'] as String?,
        mine: j['mine'] is Map<String, dynamic> ? ChallengeMine.fromJson(j['mine'] as Json) : null,
        membersOnly: j['membersOnly'] == true,
      );
}

class ChallengeDetail {
  ChallengeDetail({required this.card, required this.description, this.entryId, required this.longestStreak, required this.days, this.payment});
  final ChallengeCard card;
  final String description;
  final String? entryId;
  final int longestStreak;
  final List<({String day, int points})> days;
  final Checkout? payment;
  factory ChallengeDetail.fromJson(Json j) {
    final e = j['entry'] as Json?;
    return ChallengeDetail(
      card: ChallengeCard.fromJson(j),
      description: j['description'] as String,
      entryId: e?['id'] as String?,
      longestStreak: _int(e?['longestStreak']),
      days: (e?['days'] as List?)?.whereType<Map<String, dynamic>>().map((d) => (day: d['day'] as String, points: _int(d['points']))).toList() ?? const [],
      payment: e?['payment'] is Map<String, dynamic> ? Checkout.fromJson(e!['payment'] as Json) : null,
    );
  }
}

class CheckInResult {
  CheckInResult({required this.earned, required this.bonus, required this.points, required this.streak, required this.checkIns, required this.requiredCheckIns, required this.completed, this.badgeName});
  final int earned;
  final int bonus;
  final int points;
  final int streak;
  final int checkIns;
  final int requiredCheckIns;
  final bool completed;
  final String? badgeName;
  factory CheckInResult.fromJson(Json j) => CheckInResult(
        earned: _int(j['earned']),
        bonus: _int(j['bonus']),
        points: _int(j['points']),
        streak: _int(j['streak']),
        checkIns: _int(j['checkIns']),
        requiredCheckIns: _int(j['requiredCheckIns']),
        completed: j['completed'] == true,
        badgeName: (j['badge'] as Json?)?['name'] as String?,
      );
}

class ChallengeRank {
  ChallengeRank({required this.rank, required this.userName, this.petName, required this.points, required this.checkIns, required this.streak, required this.completed});
  final int rank;
  final String userName;
  final String? petName;
  final int points;
  final int checkIns;
  final int streak;
  final bool completed;
  factory ChallengeRank.fromJson(Json j) => ChallengeRank(
        rank: _int(j['rank']),
        userName: ((j['user'] as Json?)?['name'] as String?) ?? 'Someone',
        petName: (j['pet'] as Json?)?['name'] as String?,
        points: _int(j['points']),
        checkIns: _int(j['checkIns']),
        streak: _int(j['streak']),
        completed: j['completed'] == true,
      );
}

class ChallengeBoard {
  ChallengeBoard({required this.rows, this.myRank, this.myPoints});
  final List<ChallengeRank> rows;
  final int? myRank;
  final int? myPoints;
  factory ChallengeBoard.fromJson(Json j) {
    final me = j['me'] as Json?;
    return ChallengeBoard(rows: _list(j['rows'], ChallengeRank.fromJson), myRank: me == null ? null : _int(me['rank']), myPoints: me == null ? null : _int(me['points']));
  }
}

class EarnedBadge {
  EarnedBadge({required this.key, required this.name, required this.description, this.iconUrl, this.awardedAt});
  final String key;
  final String name;
  final String description;
  final String? iconUrl;
  final DateTime? awardedAt;
  factory EarnedBadge.fromJson(Json j) =>
      EarnedBadge(key: j['key'] as String, name: j['name'] as String, description: j['description'] as String, iconUrl: j['iconUrl'] as String?, awardedAt: _date(j['awardedAt']));
}

// ── Judging ──

class Criterion {
  Criterion({required this.id, required this.name, required this.weight});
  final String id;
  final String name;
  final int weight;
  factory Criterion.fromJson(Json j) => Criterion(id: j['id'] as String, name: j['name'] as String, weight: _int(j['weight']));
}

class JudgeContest {
  JudgeContest({required this.id, required this.title, required this.status, required this.frozen, required this.entries, required this.criteria});
  final String id;
  final String title;
  final String status;
  final bool frozen;
  final int entries;
  final List<Criterion> criteria;
  factory JudgeContest.fromJson(Json j) => JudgeContest(
        id: j['id'] as String,
        title: j['title'] as String,
        status: j['status'] as String,
        frozen: j['frozen'] == true,
        entries: _int(j['entries']),
        criteria: _list(j['criteria'], Criterion.fromJson),
      );
}

class JudgeEntry {
  JudgeEntry({required this.id, required this.petName, required this.submissions, required this.myScores});
  final String id;
  final String petName;
  final List<({String task, String type, String? postId, String? text})> submissions;
  final Map<String, double> myScores;
  factory JudgeEntry.fromJson(Json j) => JudgeEntry(
        id: j['id'] as String,
        petName: ((j['pet'] as Json?)?['name'] as String?) ?? '',
        submissions: (j['submissions'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map((s) => (task: ((s['task'] as Json?)?['title'] as String?) ?? '', type: ((s['task'] as Json?)?['type'] as String?) ?? '', postId: s['postId'] as String?, text: s['text'] as String?))
                .toList() ??
            const [],
        myScores: {
          for (final s in (j['myScores'] as List?)?.whereType<Map<String, dynamic>>() ?? const <Map<String, dynamic>>[]) s['criterionId'] as String: (s['score'] as num).toDouble(),
        },
      );
}

// ── Services marketplace (Phase 4) ──

class ServiceCategory {
  ServiceCategory({required this.id, required this.key, required this.name, this.description});
  final String id;
  final String key;
  final String name;
  final String? description;
  factory ServiceCategory.fromJson(Json j) => ServiceCategory(id: j['id'] as String, key: j['key'] as String, name: j['name'] as String, description: j['description'] as String?);
}

class NearbyPartner {
  NearbyPartner({required this.id, required this.businessName, this.area, this.city, required this.ratingAvg, required this.ratingCount, required this.distanceKm, required this.fromPaise, required this.homeVisitRadiusKm});
  final String id;
  final String businessName;
  final String? area;
  final String? city;
  final double ratingAvg;
  final int ratingCount;
  final double distanceKm;
  final int fromPaise;
  final int homeVisitRadiusKm;
  factory NearbyPartner.fromJson(Json j) => NearbyPartner(
        id: j['id'] as String,
        businessName: j['businessName'] as String,
        area: j['area'] as String?,
        city: j['city'] as String?,
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble() ?? 0,
        ratingCount: _int(j['ratingCount']),
        distanceKm: (j['distanceKm'] as num?)?.toDouble() ?? 0,
        fromPaise: _int(j['fromPaise']),
        homeVisitRadiusKm: _int(j['homeVisitRadiusKm']),
      );
}

class ServiceOffer {
  ServiceOffer({required this.id, required this.name, this.description, this.categoryName, required this.durationMin, required this.pricePaise, required this.modes, required this.speciesIds});
  final String id;
  final String name;
  final String? description;
  final String? categoryName;
  final int durationMin;
  final int pricePaise;
  final List<String> modes; // AT_CENTER | AT_HOME
  final List<String> speciesIds;
  bool get atHome => modes.contains('AT_HOME');
  bool get atCenter => modes.contains('AT_CENTER');
  factory ServiceOffer.fromJson(Json j) => ServiceOffer(
        id: j['id'] as String,
        name: j['name'] as String,
        description: j['description'] as String?,
        categoryName: (j['category'] as Json?)?['name'] as String?,
        durationMin: _int(j['durationMin']),
        pricePaise: _int(j['pricePaise']),
        modes: (j['modes'] as List?)?.whereType<String>().toList() ?? const [],
        speciesIds: (j['speciesIds'] as List?)?.whereType<String>().toList() ?? const [],
      );
}

/// A review from a delivered order or a completed booking (Phase 9b). [status] is only sent for your own review.
class ReviewView {
  ReviewView({required this.id, required this.rating, this.comment, required this.photos, this.reply, this.repliedAt, required this.by, this.at, required this.verified, this.variantTitle, this.status});
  final String id;
  final int rating;
  final String? comment;
  final List<Media> photos;
  final String? reply;
  final DateTime? repliedAt;

  /// First name and initial ("Riya S.").
  final String by;
  final DateTime? at;
  final bool verified;

  /// The size or pack bought ("3 kg").
  final String? variantTitle;

  /// VISIBLE | HIDDEN
  final String? status;
  bool get hidden => status == 'HIDDEN';
  // Booking pages recorded before Phase 9b sent the review without an id; it's only needed to report one.
  factory ReviewView.fromJson(Json j) => ReviewView(
        id: (j['id'] as String?) ?? '',
        rating: _int(j['rating']),
        comment: j['comment'] as String?,
        photos: _list(j['photos'], Media.fromJson),
        reply: j['reply'] as String?,
        repliedAt: _date(j['repliedAt']),
        by: (j['by'] as String?) ?? 'PetApp user',
        at: _date(j['at']),
        verified: j['verified'] == true,
        variantTitle: j['variantTitle'] as String?,
        status: j['status'] as String?,
      );
}

/// The average and how many reviews have each number of stars.
class RatingSummary {
  RatingSummary({required this.avg, required this.count, required this.stars});
  final double avg;
  final int count;

  /// Five rows, 5 stars first.
  final List<({int stars, int count})> stars;

  /// The share of reviews with [n] stars, 0..1, for the bars.
  double share(int n) => count == 0 ? 0 : (stars.where((s) => s.stars == n).fold<int>(0, (a, s) => a + s.count)) / count;

  static RatingSummary? maybe(Object? v) => v is Map<String, dynamic> ? RatingSummary.fromJson(v) : null;
  factory RatingSummary.fromJson(Json j) => RatingSummary(
        avg: (j['avg'] as num?)?.toDouble() ?? 0,
        count: _int(j['count']),
        stars: (j['stars'] as List?)?.whereType<Map<String, dynamic>>().map((s) => (stars: _int(s['stars']), count: _int(s['count']))).toList() ?? const [],
      );
}

class PartnerPage {
  PartnerPage({required this.id, required this.businessName, this.about, this.area, this.city, this.addressLine, this.lat, this.lng, required this.homeVisitRadiusKm, required this.ratingAvg, required this.ratingCount, this.ratingSummary, required this.services, required this.hours, required this.reviews});
  final String id;
  final String businessName;
  final String? about;
  final String? area;
  final String? city;
  final String? addressLine;
  final double? lat;
  final double? lng;
  final int homeVisitRadiusKm;
  final double ratingAvg;
  final int ratingCount;
  final List<ServiceOffer> services;
  final List<({int weekday, int opensMin, int closesMin})> hours;
  final RatingSummary? ratingSummary;
  final List<ReviewView> reviews;
  factory PartnerPage.fromJson(Json j) => PartnerPage(
        id: j['id'] as String,
        businessName: j['businessName'] as String,
        about: j['about'] as String?,
        area: j['area'] as String?,
        city: j['city'] as String?,
        addressLine: j['addressLine'] as String?,
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
        homeVisitRadiusKm: _int(j['homeVisitRadiusKm']),
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble() ?? 0,
        ratingCount: _int(j['ratingCount']),
        services: _list(j['services'], ServiceOffer.fromJson),
        hours: (j['hours'] as List?)?.whereType<Map<String, dynamic>>().map((h) => (weekday: _int(h['weekday']), opensMin: _int(h['opensMin']), closesMin: _int(h['closesMin']))).toList() ?? const [],
        ratingSummary: RatingSummary.maybe(j['ratingSummary']),
        reviews: _list(j['reviews'], ReviewView.fromJson),
      );
}

class Slot {
  Slot(this.startsAt, this.endsAt);
  final DateTime startsAt;
  final DateTime endsAt;
}

class SlotDay {
  SlotDay({required this.date, required this.durationMin, required this.slots});
  final String date;
  final int durationMin;
  final List<Slot> slots;
  factory SlotDay.fromJson(Json j) => SlotDay(
        date: j['date'] as String,
        durationMin: _int(j['durationMin']),
        slots: (j['slots'] as List?)?.whereType<Map<String, dynamic>>().map((s) => Slot(DateTime.parse(s['startsAt'] as String), DateTime.parse(s['endsAt'] as String))).toList() ?? const [],
      );
}

class BookingView {
  BookingView({
    required this.id,
    required this.code,
    required this.status,
    required this.startsAt,
    required this.mode,
    required this.serviceName,
    required this.petName,
    required this.pricePaise,
    required this.partnerId,
    required this.partnerName,
    this.partnerAddress,
    this.partnerPhone,
    this.addressLine,
    this.cancelledBy,
    this.cancelReason,
    this.refundPaise,
    this.reviewRating,
    this.review,
    this.payment,
  });
  final String id;
  final String code;
  final String status;
  final DateTime startsAt;
  final String mode;
  final String serviceName;
  final String petName;
  final int pricePaise;
  final String partnerId;
  final String partnerName;
  final String? partnerAddress;
  final String? partnerPhone;
  final String? addressLine;
  final String? cancelledBy;
  final String? cancelReason;
  final int? refundPaise;
  final int? reviewRating;

  /// Your review of this visit, with the partner's reply (hidden ones too, marked).
  final ReviewView? review;
  final Checkout? payment;

  bool get canCancel => status == 'PENDING_PAYMENT' || status == 'CONFIRMED';
  bool get canReview => status == 'COMPLETED' && reviewRating == null;

  factory BookingView.fromJson(Json j) {
    final partner = (j['partner'] as Json?) ?? const {};
    return BookingView(
      id: j['id'] as String,
      code: j['code'] as String,
      status: j['status'] as String,
      startsAt: DateTime.parse(j['startsAt'] as String),
      mode: j['mode'] as String,
      serviceName: ((j['service'] as Json?)?['name'] as String?) ?? '',
      petName: ((j['pet'] as Json?)?['name'] as String?) ?? '',
      pricePaise: _int(j['pricePaise']),
      partnerId: (partner['id'] as String?) ?? '',
      partnerName: (partner['businessName'] as String?) ?? '',
      partnerAddress: [partner['addressLine'], partner['city']].whereType<String>().join(', '),
      partnerPhone: partner['phone'] as String?,
      addressLine: (j['address'] as Json?)?['line'] as String?,
      cancelledBy: j['cancelledBy'] as String?,
      cancelReason: j['cancelReason'] as String?,
      refundPaise: j['refundPaise'] is num ? (j['refundPaise'] as num).toInt() : null,
      reviewRating: (j['review'] as Json?)?['rating'] is num ? ((j['review'] as Json)['rating'] as num).toInt() : null,
      review: j['review'] is Map<String, dynamic> ? ReviewView.fromJson(j['review'] as Json) : null,
      payment: j['payment'] is Map<String, dynamic> ? Checkout.fromJson(j['payment'] as Json) : null,
    );
  }
}

// ── Shop (Phase 5) ──

class ShopCategory {
  ShopCategory({required this.id, required this.name, this.parentId});
  final String id;
  final String name;
  final String? parentId;
  factory ShopCategory.fromJson(Json j) => ShopCategory(id: j['id'] as String, name: j['name'] as String, parentId: j['parentId'] as String?);
}

class ProductCard {
  ProductCard({required this.id, required this.title, this.brand, required this.vendorName, this.image, required this.fromPaise, required this.mrpPaise, required this.inStock, this.ratingAvg = 0, this.ratingCount = 0});
  final String id;
  final String title;
  final String? brand;
  final String vendorName;
  final Media? image;
  final int fromPaise;
  final int mrpPaise;
  final bool inStock;
  final double ratingAvg;
  final int ratingCount;
  int get offPct => mrpPaise > fromPaise && mrpPaise > 0 ? ((mrpPaise - fromPaise) * 100 / mrpPaise).floor() : 0;
  factory ProductCard.fromJson(Json j) => ProductCard(
        id: j['id'] as String,
        title: j['title'] as String,
        brand: j['brand'] as String?,
        vendorName: ((j['vendor'] as Json?)?['businessName'] as String?) ?? '',
        image: j['image'] is Map<String, dynamic> ? Media.fromJson(j['image'] as Json) : null,
        fromPaise: _int(j['fromPaise']),
        mrpPaise: _int(j['mrpPaise']),
        inStock: j['inStock'] == true,
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble() ?? 0,
        ratingCount: _int(j['ratingCount']),
      );
}

class ProductVariantView {
  ProductVariantView({required this.id, required this.title, required this.mrpPaise, required this.pricePaise, required this.inStock, this.lowStock});
  final String id;
  final String title;
  final int mrpPaise;
  final int pricePaise;
  final bool inStock;
  final int? lowStock;
  factory ProductVariantView.fromJson(Json j) => ProductVariantView(
        id: j['id'] as String,
        title: j['title'] as String,
        mrpPaise: _int(j['mrpPaise']),
        pricePaise: _int(j['pricePaise']),
        inStock: j['inStock'] == true,
        lowStock: j['lowStock'] is num ? (j['lowStock'] as num).toInt() : null,
      );
}

class ProductDetail {
  ProductDetail({required this.id, required this.title, this.brand, required this.description, required this.categoryName, required this.vendorName, this.vendorCity, required this.images, required this.variants, this.ratingAvg = 0, this.ratingCount = 0, this.ratingSummary, this.reviews = const []});
  final String id;
  final String title;
  final String? brand;
  final String description;
  final String categoryName;
  final String vendorName;
  final String? vendorCity;
  final List<Media> images;
  final List<ProductVariantView> variants;
  final double ratingAvg;
  final int ratingCount;
  final RatingSummary? ratingSummary;

  /// The latest few; the rest are on the reviews screen.
  final List<ReviewView> reviews;
  factory ProductDetail.fromJson(Json j) => ProductDetail(
        id: j['id'] as String,
        title: j['title'] as String,
        brand: j['brand'] as String?,
        description: j['description'] as String,
        categoryName: ((j['category'] as Json?)?['name'] as String?) ?? '',
        vendorName: ((j['vendor'] as Json?)?['businessName'] as String?) ?? '',
        vendorCity: (j['vendor'] as Json?)?['city'] as String?,
        images: _list(j['images'], Media.fromJson),
        variants: _list(j['variants'], ProductVariantView.fromJson),
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble() ?? 0,
        ratingCount: _int(j['ratingCount']),
        ratingSummary: RatingSummary.maybe(j['ratingSummary']),
        reviews: _list(j['reviews'], ReviewView.fromJson),
      );
}

class CartLine {
  CartLine({required this.variantId, required this.qty, required this.productId, required this.productTitle, required this.variantTitle, required this.vendorName, required this.unitPricePaise, required this.mrpPaise, this.image, this.problem});
  final String variantId;
  final int qty;
  final String productId;
  final String productTitle;
  final String variantTitle;
  final String vendorName;
  final int unitPricePaise;
  final int mrpPaise;
  final Media? image;

  /// "Only 2 left. Lower the quantity to continue." etc.
  final String? problem;
  factory CartLine.fromJson(Json j) => CartLine(
        variantId: j['variantId'] as String,
        qty: _int(j['qty']),
        productId: j['productId'] as String,
        productTitle: j['productTitle'] as String,
        variantTitle: j['variantTitle'] as String,
        vendorName: ((j['vendor'] as Json?)?['businessName'] as String?) ?? '',
        unitPricePaise: _int(j['unitPricePaise']),
        mrpPaise: _int(j['mrpPaise']),
        image: j['image'] is Map<String, dynamic> ? Media.fromJson(j['image'] as Json) : null,
        problem: j['problem'] as String?,
      );
}

class CartParcel {
  CartParcel({required this.vendorId, required this.itemsPaise, required this.discountPaise, required this.shippingPaise, required this.totalPaise});
  final String vendorId;
  final int itemsPaise;
  final int discountPaise;
  final int shippingPaise;
  final int totalPaise;
  factory CartParcel.fromJson(Json j) => CartParcel(
        vendorId: j['vendorId'] as String,
        itemsPaise: _int(j['itemsPaise']),
        discountPaise: _int(j['discountPaise']),
        shippingPaise: _int(j['shippingPaise']),
        totalPaise: _int(j['totalPaise']),
      );
}

class Cart {
  Cart({required this.items, required this.parcels, required this.itemsPaise, required this.discountPaise, required this.shippingPaise, required this.totalPaise, this.couponCode, this.couponProblem, required this.canCheckout, this.delivery});
  final List<CartLine> items;
  final List<CartParcel> parcels;
  final int itemsPaise;
  final int discountPaise;
  final int shippingPaise;
  final int totalPaise;
  final String? couponCode;
  final String? couponProblem;
  final bool canCheckout;

  /// Only when priced for an address (Phase 9c delivery zones).
  final Delivery? delivery;
  int get units => items.fold(0, (a, i) => a + i.qty);
  factory Cart.fromJson(Json j) => Cart(
        items: _list(j['items'], CartLine.fromJson),
        parcels: _list(j['parcels'], CartParcel.fromJson),
        itemsPaise: _int(j['itemsPaise']),
        discountPaise: _int(j['discountPaise']),
        shippingPaise: _int(j['shippingPaise']),
        totalPaise: _int(j['totalPaise']),
        couponCode: (j['coupon'] as Json?)?['code'] as String?,
        couponProblem: j['couponProblem'] as String?,
        canCheckout: j['canCheckout'] == true,
        delivery: j['delivery'] is Map<String, dynamic> ? Delivery.fromJson(j['delivery'] as Json) : null,
      );
}

/// Whether the shop delivers to an address, and how fast.
class Delivery {
  Delivery({required this.deliverable, this.zoneName, this.line, this.problem});
  final bool deliverable;
  final String? zoneName;

  /// "Delivery in 2–4 days"; null outside every zone.
  final String? line;

  /// Why it can't be delivered.
  final String? problem;
  factory Delivery.fromJson(Json j) => Delivery(
        deliverable: j['deliverable'] == true,
        zoneName: (j['zone'] as Json?)?['name'] as String?,
        line: j['line'] as String?,
        problem: j['problem'] as String?,
      );
}

class Address {
  Address({required this.id, this.label, required this.line1, this.locality, required this.city, required this.pincode, required this.isDefault});
  final String id;
  final String? label;
  final String line1;
  final String? locality;
  final String city;
  final String pincode;
  final bool isDefault;
  String get oneLine => [line1, if (locality != null) locality!, '$city $pincode'].join(', ');
  factory Address.fromJson(Json j) => Address(
        id: j['id'] as String,
        label: j['label'] as String?,
        line1: j['line1'] as String,
        locality: j['locality'] as String?,
        city: j['city'] as String,
        pincode: j['pincode'] as String,
        isDefault: j['isDefault'] == true,
      );
}

class ParcelItem {
  ParcelItem({required this.productTitle, required this.variantTitle, required this.qty, required this.lineTotalPaise, this.productId, this.productSlug, this.reviewId, this.reviewRating, required this.canReview});
  final String productTitle;
  final String variantTitle;
  final int qty;
  final int lineTotalPaise;

  /// Null when the product is no longer listed.
  final String? productId;
  final String? productSlug;

  /// Your review of this product, if you wrote one (from any order).
  final String? reviewId;
  final int? reviewRating;

  /// Delivered, and not reviewed yet.
  final bool canReview;
  factory ParcelItem.fromJson(Json j) {
    final r = j['review'] as Json?;
    return ParcelItem(
      productTitle: j['productTitle'] as String,
      variantTitle: j['variantTitle'] as String,
      qty: _int(j['qty']),
      lineTotalPaise: _int(j['lineTotalPaise']),
      productId: j['productId'] as String?,
      productSlug: j['productSlug'] as String?,
      reviewId: r?['id'] as String?,
      reviewRating: r?['rating'] is num ? (r!['rating'] as num).toInt() : null,
      canReview: j['canReview'] == true,
    );
  }
}

class Parcel {
  Parcel({
    required this.id,
    required this.code,
    required this.status,
    required this.vendorName,
    required this.totalPaise,
    this.courier,
    this.trackingNumber,
    this.cancelReason,
    this.cancelledBy,
    required this.items,
    required this.canCancel,
    required this.canReturn,
    this.returnStatus,
    this.returnNote,
    this.returnRefundPaise,
  });
  final String id;
  final String code;
  final String status; // CONFIRMED | PACKED | SHIPPED | DELIVERED | CANCELLED | RETURN_REQUESTED | RETURNED
  final String vendorName;
  final int totalPaise;
  final String? courier;
  final String? trackingNumber;
  final String? cancelReason;
  final String? cancelledBy;
  final List<ParcelItem> items;
  final bool canCancel;
  final bool canReturn;
  final String? returnStatus;
  final String? returnNote;
  final int? returnRefundPaise;
  factory Parcel.fromJson(Json j) {
    final r = j['returnRequest'] as Json?;
    return Parcel(
      id: j['id'] as String,
      code: j['code'] as String,
      status: j['status'] as String,
      vendorName: ((j['vendor'] as Json?)?['businessName'] as String?) ?? '',
      totalPaise: _int(j['totalPaise']),
      courier: j['courier'] as String?,
      trackingNumber: j['trackingNumber'] as String?,
      cancelReason: j['cancelReason'] as String?,
      cancelledBy: j['cancelledBy'] as String?,
      items: _list(j['items'], ParcelItem.fromJson),
      canCancel: j['canCancel'] == true,
      canReturn: j['canReturn'] == true,
      returnStatus: r?['status'] as String?,
      returnNote: r?['note'] as String?,
      returnRefundPaise: r == null ? null : _int(r['refundPaise']),
    );
  }
}

class RefundView {
  RefundView({required this.amountPaise, required this.reason, required this.status});
  final int amountPaise;
  final String reason;
  final String status; // PENDING | PROCESSED
  factory RefundView.fromJson(Json j) => RefundView(amountPaise: _int(j['amountPaise']), reason: j['reason'] as String, status: j['status'] as String);
}

class ShopOrder {
  ShopOrder({required this.id, required this.code, required this.status, this.createdAt, required this.itemsPaise, required this.discountPaise, required this.shippingPaise, required this.totalPaise, this.payment, required this.refunds, required this.parcels});
  final String id;
  final String code;
  final String status; // PENDING_PAYMENT | PAID | COMPLETED | CANCELLED
  final DateTime? createdAt;
  final int itemsPaise;
  final int discountPaise;
  final int shippingPaise;
  final int totalPaise;
  final Checkout? payment;
  final List<RefundView> refunds;
  final List<Parcel> parcels;
  factory ShopOrder.fromJson(Json j) => ShopOrder(
        id: j['id'] as String,
        code: j['code'] as String,
        status: j['status'] as String,
        createdAt: _date(j['createdAt']),
        itemsPaise: _int(j['itemsPaise']),
        discountPaise: _int(j['discountPaise']),
        shippingPaise: _int(j['shippingPaise']),
        totalPaise: _int(j['totalPaise']),
        payment: j['payment'] is Map<String, dynamic> ? Checkout.fromJson(j['payment'] as Json) : null,
        refunds: _list(j['refunds'], RefundView.fromJson),
        parcels: _list(j['parcels'], Parcel.fromJson),
      );
}

class ShopOrderSummary {
  ShopOrderSummary({required this.id, required this.code, required this.status, required this.totalPaise, this.createdAt, required this.units, required this.parcelStatuses});
  final String id;
  final String code;
  final String status;
  final int totalPaise;
  final DateTime? createdAt;
  final int units;
  final List<String> parcelStatuses;
  factory ShopOrderSummary.fromJson(Json j) => ShopOrderSummary(
        id: j['id'] as String,
        code: j['code'] as String,
        status: j['status'] as String,
        totalPaise: _int(j['totalPaise']),
        createdAt: _date(j['createdAt']),
        units: _int(j['units']),
        parcelStatuses: (j['parcels'] as List?)?.whereType<Map<String, dynamic>>().map((p) => p['status'] as String).toList() ?? const [],
      );
}

// ── money: refunds, invoices and prize payouts (Phase 6d) ──

/// A bank account or UPI ID a prize winner is paid to. Full account numbers never leave the server.
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

/// One transfer of prize money to the winner's account.
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

/// Prize money PetApp owes the winner, what can be paid now, where it goes, and recent payouts.
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

/// A line on the winner's account: a prize (with TDS deducted) or a payout.
class StatementLine {
  StatementLine({required this.id, this.occurredAt, required this.kind, required this.memo, required this.amountPaise, this.salePaise, required this.feePaise, required this.tcsPaise, required this.tdsPaise});
  final String id;
  final DateTime? occurredAt;
  final String kind;
  final String memo;
  final int amountPaise;
  final int? salePaise; // the prize before TDS; null for payouts
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

/// An invoice or credit note from a seller or service partner for something the customer bought.
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

/// A refund on one of the customer's payments, and what it was for.
class RefundItem {
  RefundItem({
    required this.id,
    required this.amountPaise,
    required this.reason,
    required this.status,
    this.createdAt,
    this.processedAt,
    this.reference,
    required this.paidPaise,
    required this.aboutKind,
    this.aboutId,
    required this.aboutTitle,
  });
  final String id;
  final int amountPaise;
  final String reason;
  final String status; // PENDING | PROCESSING | PROCESSED | FAILED | SETTLED_MANUALLY
  final DateTime? createdAt;
  final DateTime? processedAt;

  /// The gateway's refund id, or the bank transfer reference when paid another way.
  final String? reference;
  final int paidPaise;
  final String aboutKind; // ORDER | BOOKING | CONTEST | CHALLENGE | OTHER
  final String? aboutId;
  final String aboutTitle;

  /// Where tapping the refund leads in the app, if anywhere.
  String? get route => switch (aboutKind) {
        'ORDER' when aboutId != null => '/order/$aboutId',
        'BOOKING' when aboutId != null => '/booking/$aboutId',
        'CONTEST' when aboutId != null => '/contest/$aboutId',
        'CHALLENGE' when aboutId != null => '/challenge/$aboutId',
        _ => null,
      };

  factory RefundItem.fromJson(Json j) {
    final a = _map(j['about']);
    return RefundItem(
      id: j['id'] as String,
      amountPaise: _int(j['amountPaise']),
      reason: (j['reason'] as String?) ?? '',
      status: j['status'] as String,
      createdAt: _date(j['createdAt']),
      processedAt: _date(j['processedAt']),
      reference: j['reference'] as String?,
      paidPaise: _int(j['paidPaise']),
      aboutKind: (a['kind'] as String?) ?? 'OTHER',
      aboutId: a['id'] as String?,
      aboutTitle: (a['title'] as String?) ?? 'Payment',
    );
  }
}

// ── Home screen and recommendations (Phase 7b) ──

/// A recommended item with why it was picked ("For Bruno", "1.2 km away") and whether admins pinned it.
class Picked<T> {
  Picked(this.item, {this.reason, this.pinned = false});
  final T item;
  final String? reason;
  final bool pinned;
  factory Picked.fromJson(Json j, T Function(Json) f) => Picked(f(j), reason: j['reason'] as String?, pinned: j['pinned'] == true);
}

/// A coupon admins put on the home screen.
class HomeOffer {
  HomeOffer({required this.id, required this.code, this.description, required this.kind, required this.value, this.maxDiscountPaise, required this.minOrderPaise, this.endsAt, this.vendorId, this.vendorName});
  final String id;
  final String code;
  final String? description;
  final String kind; // PERCENT | FLAT
  final int value;
  final int? maxDiscountPaise;
  final int minOrderPaise;
  final DateTime? endsAt;
  final String? vendorId;
  final String? vendorName;
  factory HomeOffer.fromJson(Json j) {
    final v = j['vendor'] is Map<String, dynamic> ? j['vendor'] as Json : null;
    return HomeOffer(
      id: j['id'] as String,
      code: j['code'] as String,
      description: j['description'] as String?,
      kind: j['kind'] as String,
      value: _int(j['value']),
      maxDiscountPaise: _intOrNull(j['maxDiscountPaise']),
      minOrderPaise: _int(j['minOrderPaise']),
      endsAt: _date(j['endsAt']),
      vendorId: v?['id'] as String?,
      vendorName: v?['businessName'] as String?,
    );
  }
}

/// Something coming up: the person's booking or contest deadline, or a contest or challenge starting soon.
class UpcomingItem {
  UpcomingItem({required this.id, required this.kind, required this.title, this.subtitle, required this.label, this.at, this.imageUrl});
  final String id;
  final String kind; // BOOKING | CONTEST | CHALLENGE
  final String title;
  final String? subtitle;
  final String label; // "Your booking", "Entries due", "Entries open", "Starts", "Voting closes"
  final DateTime? at;
  final String? imageUrl;
  String get route => switch (kind) { 'BOOKING' => '/booking/$id', 'CHALLENGE' => '/challenge/$id', _ => '/contest/$id' };
  factory UpcomingItem.fromJson(Json j) => UpcomingItem(
        id: j['id'] as String,
        kind: j['kind'] as String,
        title: j['title'] as String,
        subtitle: j['subtitle'] as String?,
        label: (j['label'] as String?) ?? '',
        at: _date(j['at']),
        imageUrl: j['imageUrl'] as String?,
      );
}

/// One section of the home screen. [items] hold the model for its [kind].
class HomeSectionView {
  HomeSectionView({required this.id, required this.kind, required this.title, this.subtitle, required this.items});
  final String id;
  final String kind;
  final String title;
  final String? subtitle;
  final List<Picked<Object>> items;

  static const kinds = {'FEATURED_REELS', 'TRENDING_PETS', 'ACTIVE_CONTESTS', 'CHALLENGES', 'NEARBY_SERVICES', 'RECOMMENDED_PRODUCTS', 'PARTNER_OFFERS', 'UPCOMING_EVENTS'};

  static Object Function(Json)? parserFor(String kind) => switch (kind) {
        'FEATURED_REELS' => Post.fromJson,
        'TRENDING_PETS' => Pet.fromJson,
        'ACTIVE_CONTESTS' => ContestCard.fromJson,
        'CHALLENGES' => ChallengeCard.fromJson,
        'NEARBY_SERVICES' => NearbyPartner.fromJson,
        'RECOMMENDED_PRODUCTS' => ProductCard.fromJson,
        'PARTNER_OFFERS' => HomeOffer.fromJson,
        'UPCOMING_EVENTS' => UpcomingItem.fromJson,
        _ => null, // a kind added after this app version: skipped
      };

  /// What "Not interested" is recorded against for this kind, if it can be dismissed.
  static String? dismissTarget(String kind) => switch (kind) {
        'FEATURED_REELS' => 'POST',
        'TRENDING_PETS' => 'PET',
        'ACTIVE_CONTESTS' => 'CONTEST',
        'CHALLENGES' => 'CHALLENGE',
        'NEARBY_SERVICES' => 'PARTNER',
        'RECOMMENDED_PRODUCTS' => 'PRODUCT',
        _ => null,
      };

  /// Sections of a kind this app version doesn't know have no items, and are left out.
  factory HomeSectionView.fromJson(Json j) {
    final kind = j['kind'] as String;
    final parse = parserFor(kind);
    return HomeSectionView(
      id: j['id'] as String,
      kind: kind,
      title: j['title'] as String,
      subtitle: j['subtitle'] as String?,
      items: parse == null ? const [] : _list(j['items'], (x) => Picked<Object>.fromJson(x, parse)),
    );
  }
}

class HomeFeed {
  HomeFeed({this.city, required this.personalised, required this.sections});
  final String? city;
  final bool personalised;
  final List<HomeSectionView> sections;
  factory HomeFeed.fromJson(Json j) => HomeFeed(
        city: j['city'] as String?,
        personalised: j['personalised'] == true,
        sections: _list(j['sections'], HomeSectionView.fromJson).where((s) => s.items.isNotEmpty).toList(),
      );
}

/// Whether recommendations use the person's pets and history, and what they're based on.
class RecoSettings {
  RecoSettings({required this.personalised, required this.availableOnPlatform, required this.historyDays, required this.basedOn, required this.viewsKept, required this.hiddenItems});
  final bool personalised;
  final bool availableOnPlatform;
  final int historyDays;
  final List<String> basedOn;
  final int viewsKept;
  final int hiddenItems;
  factory RecoSettings.fromJson(Json j) => RecoSettings(
        personalised: j['personalised'] != false,
        availableOnPlatform: j['availableOnPlatform'] != false,
        historyDays: _int(j['historyDays']),
        basedOn: (j['basedOn'] as List? ?? const []).whereType<String>().toList(),
        viewsKept: _int(j['viewsKept']),
        hiddenItems: _int(j['hiddenItems']),
      );
}

// ── PetApp Assistant (Phase 7c) ──

class AssistantInfo {
  AssistantInfo({required this.name, required this.usesModel, required this.intro, required this.healthNotice, required this.privacy, required this.dailyLimit, required this.usedToday, required this.suggestions});
  final String name;
  final bool usesModel;
  final String intro;
  final String healthNotice;
  final String privacy;
  final int dailyLimit;
  final int usedToday;
  final List<String> suggestions;
  int get left => (dailyLimit - usedToday).clamp(0, dailyLimit);
  factory AssistantInfo.fromJson(Json j) => AssistantInfo(
        name: (j['name'] as String?) ?? 'PetApp Assistant',
        usesModel: j['usesModel'] == true,
        intro: (j['intro'] as String?) ?? '',
        healthNotice: (j['healthNotice'] as String?) ?? '',
        privacy: (j['privacy'] as String?) ?? '',
        dailyLimit: _int(j['dailyLimit']),
        usedToday: _int(j['usedToday']),
        suggestions: (j['suggestions'] as List? ?? const []).whereType<String>().toList(),
      );
}

/// One of the person's upcoming bookings, shown under an answer.
class AssistantBooking {
  AssistantBooking({required this.id, required this.code, required this.title, required this.petName, this.startsAt, required this.status});
  final String id;
  final String code;
  final String title;
  final String petName;
  final DateTime? startsAt;
  final String status;
  factory AssistantBooking.fromJson(Json j) => AssistantBooking(
        id: j['id'] as String,
        code: j['code'] as String,
        title: j['title'] as String,
        petName: (j['petName'] as String?) ?? '',
        startsAt: _date(j['startsAt']),
        status: j['status'] as String,
      );
}

/// A screen of the app, with the steps to do something there.
class AssistantLink {
  AssistantLink({required this.id, required this.title, required this.route, required this.steps});
  final String id;
  final String title;
  final String route;
  final List<String> steps;
  factory AssistantLink.fromJson(Json j) =>
      AssistantLink(id: j['id'] as String, title: j['title'] as String, route: j['route'] as String, steps: (j['steps'] as List? ?? const []).whereType<String>().toList());
}

/// A general pet-care note.
class CareNote {
  CareNote({required this.id, required this.title, required this.body});
  final String id;
  final String title;
  final String body;
  factory CareNote.fromJson(Json j) => CareNote(id: j['id'] as String, title: j['title'] as String, body: j['body'] as String);
}

/// Something shown under an answer. [item] is the model for its [type]; unknown types (from a newer API) are skipped.
class AssistantCard {
  AssistantCard(this.type, this.item);
  final String type; // SERVICE | PRODUCT | CONTEST | CHALLENGE | BOOKING | LINK | CARE
  final Object item;
  static AssistantCard? fromJson(Json j) {
    final item = _map(j['item']);
    final type = j['type'] as String? ?? '';
    final Object? parsed = switch (type) {
      'SERVICE' => NearbyPartner.fromJson(item),
      'PRODUCT' => ProductCard.fromJson(item),
      'CONTEST' => ContestCard.fromJson(item),
      'CHALLENGE' => ChallengeCard.fromJson(item),
      'BOOKING' => AssistantBooking.fromJson(item),
      'LINK' => AssistantLink.fromJson(item),
      'CARE' => CareNote.fromJson(item),
      _ => null,
    };
    return parsed == null ? null : AssistantCard(type, parsed);
  }
}

class AssistantMessageView {
  AssistantMessageView({required this.id, required this.fromMe, required this.text, required this.cards, required this.safety, this.notice, this.rating, this.createdAt});
  final String id;
  final bool fromMe;
  final String text;
  final List<AssistantCard> cards;
  final String safety; // NONE | GENERAL_INFO | URGENT
  final String? notice;
  final String? rating; // UP | DOWN
  final DateTime? createdAt;
  bool get urgent => safety == 'URGENT';
  AssistantMessageView rated(String r) =>
      AssistantMessageView(id: id, fromMe: fromMe, text: text, cards: cards, safety: safety, notice: notice, rating: r, createdAt: createdAt);
  factory AssistantMessageView.fromJson(Json j) => AssistantMessageView(
        id: j['id'] as String,
        fromMe: j['role'] == 'USER',
        text: (j['text'] as String?) ?? '',
        cards: (j['cards'] as List? ?? const []).whereType<Map<String, dynamic>>().map(AssistantCard.fromJson).whereType<AssistantCard>().toList(),
        safety: (j['safety'] as String?) ?? 'NONE',
        notice: j['notice'] as String?,
        rating: j['rating'] as String?,
        createdAt: _date(j['createdAt']),
      );
}

class AskResult {
  AskResult({required this.conversationId, required this.title, required this.question, required this.answer});
  final String conversationId;
  final String title;
  final AssistantMessageView question;
  final AssistantMessageView answer;
  factory AskResult.fromJson(Json j) {
    final c = _map(j['conversation']);
    return AskResult(
      conversationId: c['id'] as String,
      title: (c['title'] as String?) ?? '',
      question: AssistantMessageView.fromJson(_map(j['question'])),
      answer: AssistantMessageView.fromJson(_map(j['answer'])),
    );
  }
}

class AssistantConversation {
  AssistantConversation({required this.id, required this.title, this.lastMessageAt, required this.messages});
  final String id;
  final String title;
  final DateTime? lastMessageAt;
  final List<AssistantMessageView> messages;
  factory AssistantConversation.fromJson(Json j) => AssistantConversation(
        id: j['id'] as String,
        title: (j['title'] as String?) ?? '',
        lastMessageAt: _date(j['lastMessageAt']),
        messages: _list(j['messages'], AssistantMessageView.fromJson),
      );
}

// ── Privacy and legal (Phase 8b) ──

/// A published legal document, as listed.
class LegalDocSummary {
  LegalDocSummary({required this.slug, required this.title, required this.version, this.effectiveAt, required this.requiresAcceptance});
  final String slug;
  final String title;
  final int version;
  final DateTime? effectiveAt;
  final bool requiresAcceptance;
  factory LegalDocSummary.fromJson(Json j) => LegalDocSummary(
        slug: j['slug'] as String,
        title: j['title'] as String? ?? '',
        version: _int(j['version']),
        effectiveAt: _date(j['effectiveAt']),
        requiresAcceptance: j['requiresAcceptance'] == true,
      );
}

/// The current version of a legal document, in Markdown.
class LegalDoc {
  LegalDoc({required this.slug, required this.title, required this.version, required this.body, this.changeSummary, this.effectiveAt});
  final String slug;
  final String title;
  final int version;
  final String body;
  final String? changeSummary;
  final DateTime? effectiveAt;
  factory LegalDoc.fromJson(Json j) => LegalDoc(
        slug: j['slug'] as String,
        title: j['title'] as String? ?? '',
        version: _int(j['version']),
        body: j['body'] as String? ?? '',
        changeSummary: j['changeSummary'] as String?,
        effectiveAt: _date(j['effectiveAt']),
      );
}

/// One document that must be accepted, and where the person stands with it.
class ConsentDoc {
  ConsentDoc({required this.slug, required this.title, required this.version, this.changeSummary, this.acceptedVersion, this.acceptedAt, required this.pending, required this.updated});
  final String slug;
  final String title;
  final int version;
  final String? changeSummary;
  final int? acceptedVersion;
  final DateTime? acceptedAt;
  final bool pending;

  /// They accepted an earlier version: say it was updated, and what changed.
  final bool updated;
  factory ConsentDoc.fromJson(Json j) => ConsentDoc(
        slug: j['slug'] as String,
        title: j['title'] as String? ?? '',
        version: _int(j['version']),
        changeSummary: j['changeSummary'] as String?,
        acceptedVersion: _intOrNull(j['acceptedVersion']),
        acceptedAt: _date(j['acceptedAt']),
        pending: j['pending'] == true,
        updated: j['updated'] == true,
      );
}

class ConsentStatus {
  ConsentStatus({required this.documents, required this.pending, required this.marketing, this.marketingChangedAt});
  final List<ConsentDoc> documents;
  final List<String> pending;
  final bool marketing;
  final DateTime? marketingChangedAt;
  List<ConsentDoc> get toAccept => documents.where((d) => d.pending).toList();
  factory ConsentStatus.fromJson(Json j) => ConsentStatus(
        documents: _list(j['documents'], ConsentDoc.fromJson),
        pending: (j['pending'] as List? ?? const []).whereType<String>().toList(),
        marketing: _map(j['marketing'])['granted'] == true,
        marketingChangedAt: _date(_map(j['marketing'])['changedAt']),
      );
}

class DataExportItem {
  DataExportItem({required this.id, required this.status, this.sizeBytes, required this.createdAt, this.readyAt, this.expiresAt});
  final String id;

  /// PENDING, READY, FAILED or EXPIRED.
  final String status;
  final int? sizeBytes;
  final DateTime? createdAt;
  final DateTime? readyAt;
  final DateTime? expiresAt;
  bool get ready => status == 'READY';
  factory DataExportItem.fromJson(Json j) => DataExportItem(
        id: j['id'] as String,
        status: j['status'] as String? ?? 'PENDING',
        sizeBytes: _intOrNull(j['sizeBytes']),
        createdAt: _date(j['createdAt']),
        readyAt: _date(j['readyAt']),
        expiresAt: _date(j['expiresAt']),
      );
}

class DataExports {
  DataExports({required this.items, required this.canRequest, this.nextAllowedAt});
  final List<DataExportItem> items;
  final bool canRequest;
  final DateTime? nextAllowedAt;
  factory DataExports.fromJson(Json j) => DataExports(
        items: _list(j['items'], DataExportItem.fromJson),
        canRequest: j['canRequest'] == true,
        nextAllowedAt: _date(j['nextAllowedAt']),
      );
}

class ExportLink {
  ExportLink({required this.url, required this.fileName});
  final String url;
  final String fileName;
  factory ExportLink.fromJson(Json j) => ExportLink(url: j['url'] as String, fileName: j['fileName'] as String? ?? 'petapp-data.json');
}

class DeletionScheduled {
  DeletionScheduled({required this.graceDays, this.eraseAfter});
  final int graceDays;
  final DateTime? eraseAfter;
  factory DeletionScheduled.fromJson(Json j) => DeletionScheduled(graceDays: _int(j['graceDays']), eraseAfter: _date(j['eraseAfter']));
}

// ── chat and support (Phase 9a) ──

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
  final Media? media;
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
        media: j['media'] is Map ? Media.fromJson(_map(j['media'])) : null,
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

// ── search, discovery and locations (Phase 9c) ──

/// One search result. [route] is where it opens in the app.
class SearchHit {
  SearchHit({required this.type, required this.id, required this.title, this.subtitle, this.imageUrl, required this.linkKind, required this.linkKey, required this.meta});
  /// PET | USER | REEL | PRODUCT | SERVICE | PARTNER | CONTEST | CHALLENGE
  final String type;
  final String id;
  final String title;
  final String? subtitle;
  final String? imageUrl;
  final String linkKind;
  final String linkKey;
  final Map<String, Object?> meta;
  factory SearchHit.fromJson(Json j) {
    final link = (j['link'] as Json?) ?? const {};
    return SearchHit(
      type: j['type'] as String,
      id: j['id'] as String,
      title: (j['title'] as String?) ?? '',
      subtitle: j['subtitle'] as String?,
      imageUrl: j['imageUrl'] as String?,
      linkKind: (link['kind'] as String?) ?? '',
      linkKey: (link['key'] as String?) ?? '',
      meta: (j['meta'] as Map?)?.cast<String, Object?>() ?? const {},
    );
  }
}

/// The best few of one kind, for the "All" tab.
class SearchGroup {
  SearchGroup({required this.type, required this.items, required this.more});
  /// pets | users | reels | products | services | partners | contests | challenges
  final String type;
  final List<SearchHit> items;
  final bool more;
  factory SearchGroup.fromJson(Json j) => SearchGroup(type: j['type'] as String, items: _list(j['items'], SearchHit.fromJson), more: j['more'] == true);
}

class SearchAll {
  SearchAll({required this.query, required this.groups});
  final String query;
  final List<SearchGroup> groups;
  factory SearchAll.fromJson(Json j) => SearchAll(query: (j['query'] as String?) ?? '', groups: _list(j['groups'], SearchGroup.fromJson));
}

class FilterOption {
  FilterOption(this.id, this.name);
  final String id;
  final String name;
  static List<FilterOption> list(Object? v) => [for (final o in (v as List?)?.whereType<Map<String, dynamic>>() ?? const <Map<String, dynamic>>[]) FilterOption(o['id'] as String, o['name'] as String)];
}

/// The kinds that can be searched (features switched on) and each one's filter choices.
class SearchFilters {
  SearchFilters({required this.types, required this.species, required this.productCategories, required this.serviceCategories, required this.serviceModes, required this.contestCategories, required this.contestWhen, required this.challengeWhen});
  final List<String> types;
  final List<FilterOption> species;
  final List<FilterOption> productCategories;
  final List<FilterOption> serviceCategories;
  final List<FilterOption> serviceModes;
  final List<FilterOption> contestCategories;
  final List<FilterOption> contestWhen;
  final List<FilterOption> challengeWhen;
  factory SearchFilters.fromJson(Json j) {
    Json part(String k) => (j[k] as Json?) ?? const {};
    return SearchFilters(
      types: (j['types'] as List?)?.whereType<String>().toList() ?? const [],
      species: FilterOption.list(part('pets')['species']),
      productCategories: FilterOption.list(part('products')['categories']),
      serviceCategories: FilterOption.list(part('services')['categories']),
      serviceModes: FilterOption.list(part('services')['modes']),
      contestCategories: FilterOption.list(part('contests')['categories']),
      contestWhen: FilterOption.list(part('contests')['when']),
      challengeWhen: FilterOption.list(part('challenges')['when']),
    );
  }
}

/// A pet entered in a contest that is open or voting.
class ContestEntryCard {
  ContestEntryCard({required this.entryId, required this.pet, required this.contestId, required this.contestSlug, required this.contestTitle, required this.voting});
  final String entryId;
  final Pet pet;
  final String contestId;
  final String contestSlug;
  final String contestTitle;
  final bool voting;
  factory ContestEntryCard.fromJson(Json j) {
    final c = (j['contest'] as Json?) ?? const {};
    return ContestEntryCard(entryId: j['entryId'] as String, pet: Pet.fromJson(j['pet'] as Json), contestId: (c['id'] as String?) ?? '', contestSlug: (c['slug'] as String?) ?? '', contestTitle: (c['title'] as String?) ?? '', voting: j['voting'] == true);
  }
}

/// A pet in a challenge that is on now, with its progress.
class ChallengeEntryCard {
  ChallengeEntryCard({required this.entryId, required this.pet, required this.challengeSlug, required this.challengeTitle, required this.points, required this.checkIns, required this.requiredCheckIns, required this.completed});
  final String entryId;
  final Pet pet;
  final String challengeSlug;
  final String challengeTitle;
  final int points;
  final int checkIns;
  final int requiredCheckIns;
  final bool completed;
  factory ChallengeEntryCard.fromJson(Json j) {
    final c = (j['challenge'] as Json?) ?? const {};
    return ChallengeEntryCard(
      entryId: j['entryId'] as String,
      pet: Pet.fromJson(j['pet'] as Json),
      challengeSlug: (c['slug'] as String?) ?? '',
      challengeTitle: (c['title'] as String?) ?? '',
      points: _int(j['points']),
      checkIns: _int(j['checkIns']),
      requiredCheckIns: _int(c['requiredCheckIns']),
      completed: j['completed'] == true,
    );
  }
}

/// What a PIN code is: for filling in an address.
class PincodeInfo {
  PincodeInfo({required this.pincode, required this.city, required this.stateName, this.locality, required this.lat, required this.lng});
  final String pincode;
  final String city;
  final String stateName;
  final String? locality;
  final double lat;
  final double lng;
  factory PincodeInfo.fromJson(Json j) => PincodeInfo(
        pincode: j['pincode'] as String,
        city: ((j['city'] as Json?)?['name'] as String?) ?? '',
        stateName: ((j['state'] as Json?)?['name'] as String?) ?? '',
        locality: (j['locality'] as Json?)?['name'] as String?,
        lat: (j['lat'] as num?)?.toDouble() ?? 0,
        lng: (j['lng'] as num?)?.toDouble() ?? 0,
      );
}

/// One answer to "where?" (spec §19): a PIN code, a city or area from PetApp, or a place from the map provider.
class PlaceHit {
  PlaceHit({required this.kind, required this.label, required this.detail, required this.lat, required this.lng, this.pincode, this.city, this.citySlug, required this.fromMaps});
  final String kind; // CITY | LOCALITY | PINCODE | PLACE
  final String label;
  final String detail;
  final double lat;
  final double lng;
  final String? pincode;
  final String? city;
  final String? citySlug;
  final bool fromMaps;
  factory PlaceHit.fromJson(Json j) => PlaceHit(
        kind: j['kind'] as String,
        label: j['label'] as String,
        detail: (j['detail'] as String?) ?? '',
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        pincode: j['pincode'] as String?,
        city: j['city'] as String?,
        citySlug: j['citySlug'] as String?,
        fromMaps: j['source'] == 'maps',
      );
}

/// Whether services operate where someone is looking.
class Coverage {
  Coverage({required this.covered, this.cityName, this.nearestName, this.nearestKm, required this.liveCities});
  final bool covered;
  final String? cityName;
  final String? nearestName;
  final double? nearestKm;
  final int liveCities;
  factory Coverage.fromJson(Json j) {
    final n = j['nearest'] as Json?;
    return Coverage(
      covered: j['covered'] == true,
      cityName: (j['city'] as Json?)?['name'] as String?,
      nearestName: n?['name'] as String?,
      nearestKm: (n?['distanceKm'] as num?)?.toDouble(),
      liveCities: _int(j['liveCities']),
    );
  }
}

/// A city to look from (the location database, Phase 9c).
class CityOption {
  CityOption({required this.id, required this.slug, required this.name, required this.stateName, required this.lat, required this.lng, required this.servicesLive});
  final String id;
  final String slug;
  final String name;
  final String stateName;
  final double lat;
  final double lng;
  final bool servicesLive;
  factory CityOption.fromJson(Json j) => CityOption(
        id: j['id'] as String,
        slug: j['slug'] as String,
        name: j['name'] as String,
        stateName: ((j['state'] as Json?)?['name'] as String?) ?? '',
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        servicesLive: j['servicesLive'] == true,
      );
}

// ───────────── Phase 9d: memberships ─────────────

class MembershipPlan {
  MembershipPlan({required this.id, required this.key, required this.name, required this.description, required this.pricePaise, required this.periodDays, required this.lines, required this.priorityDays});
  final String id;
  final String key;
  final String name;
  final String description;
  final int pricePaise;
  final int periodDays;
  /// Benefits in words, from the API.
  final List<String> lines;
  final int priorityDays;
  bool get isFree => pricePaise == 0;
  factory MembershipPlan.fromJson(Json j) => MembershipPlan(
        id: j['id'] as String,
        key: j['key'] as String,
        name: j['name'] as String,
        description: (j['description'] as String?) ?? '',
        pricePaise: _int(j['pricePaise']),
        periodDays: _int(j['periodDays']),
        lines: (j['lines'] as List?)?.whereType<String>().toList() ?? const [],
        priorityDays: _int((j['benefits'] as Json?)?['priorityDays']),
      );
}

class MembershipPeriod {
  MembershipPeriod({required this.id, required this.plan, required this.status, this.startsAt, this.endsAt, required this.pricePaise, required this.source});
  final String id;
  final MembershipPlan plan;
  final String status; // ACTIVE | EXPIRED | REVOKED
  final DateTime? startsAt;
  final DateTime? endsAt;
  final int pricePaise;
  final String source; // PURCHASE | GRANT
  factory MembershipPeriod.fromJson(Json j) => MembershipPeriod(
        id: j['id'] as String,
        plan: MembershipPlan.fromJson(j['plan'] as Json),
        status: j['status'] as String,
        startsAt: _date(j['startsAt']),
        endsAt: _date(j['endsAt']),
        pricePaise: _int(j['pricePaise']),
        source: (j['source'] as String?) ?? 'PURCHASE',
      );
}

class MyMembership {
  MyMembership({required this.enabled, this.current, required this.upcoming, required this.history});
  final bool enabled;
  final MembershipPeriod? current;
  final List<MembershipPeriod> upcoming;
  final List<MembershipPeriod> history;
  factory MyMembership.fromJson(Json j) => MyMembership(
        enabled: j['enabled'] == true,
        current: j['current'] is Map<String, dynamic> ? MembershipPeriod.fromJson(j['current'] as Json) : null,
        upcoming: _list(j['upcoming'], MembershipPeriod.fromJson),
        history: _list(j['history'], MembershipPeriod.fromJson),
      );
}
