import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';

import 'fixture.dart';

/// Every model parses the API's real responses (recorded in test/fixtures).
void main() {
  List<Json> items(String name) => ((fixture(name) as Json)['items'] as List).cast<Json>();

  test('auth result and tokens', () {
    final r = AuthResult.fromJson(fixture('auth_result') as Json);
    expect(r.userId, isNotEmpty);
    expect(r.tokens.accessToken, isNotEmpty);
    expect(r.tokens.accessTokenExpiresIn, greaterThan(0));
    expect(Tokens.fromJson(fixture('auth_refresh') as Json).refreshToken, isNot(r.tokens.refreshToken));
  });

  test('me and public profile', () {
    final me = Me.fromJson(fixture('me') as Json);
    expect(me.name, 'Aanya Test');
    expect(me.pets, greaterThanOrEqualTo(0));
    final p = PublicProfile.fromJson(fixture('user_profile') as Json);
    expect(p.isFollowing, isTrue);
    expect(p.pets.single.name, 'Bruno');
  });

  test('species, breeds and pets — private fields only for the owner', () {
    expect((fixture('species') as List).cast<Json>().map(Species.fromJson).map((s) => s.key), contains('dog'));
    expect((fixture('breeds') as List).cast<Json>().map(Breed.fromJson), isNotEmpty);
    final owner = Pet.fromJson(fixture('pet_view_owner') as Json);
    final public = Pet.fromJson(fixture('pet_view_public') as Json);
    expect(owner.isOwner, isTrue);
    expect(owner.microchipId, '985100001234567');
    expect(public.isOwner, isFalse);
    expect(public.microchipId, isNull);
    expect(public.handle, owner.handle);
    expect(public.speciesName, 'Dog');
    expect(public.ageMonths, greaterThan(0));
    expect((fixture('pets_mine') as List).cast<Json>().map(Pet.fromJson).single.name, 'Bruno');
  });

  test('posts in every feed parse, with media, counts and viewer state', () {
    for (final name in ['feed', 'trending', 'reels', 'hashtag_posts', 'user_posts', 'pet_posts', 'saved']) {
      final page = CursorPage.fromJson(fixture(name) as Json, Post.fromJson);
      expect(page.items, isNotEmpty, reason: name);
    }
    final p = Post.fromJson(fixture('post_get') as Json);
    expect(p.type, 'PHOTO');
    expect(p.hashtags, ['beach']);
    expect(p.pets.single.name, 'Bruno');
    expect(p.liked && p.saved, isTrue);
    expect(p.counts.likes, 1);
    expect(p.counts.comments, 2);
    final img = p.media.single;
    expect(img.isReady && !img.isVideo, isTrue);
    expect(img.images.map((i) => i.width), containsAll([320, 640, 1080]));
    expect(img.imageFor(500), contains('640'));
    expect(img.imageFor(5000), contains('1080'));
  });

  test('a reel carries an HLS stream and a poster', () {
    final reel = CursorPage.fromJson(fixture('reels') as Json, Post.fromJson).items.first;
    expect(reel.isReel, isTrue);
    final v = reel.media.single;
    expect(v.isVideo && v.isReady, isTrue);
    expect(v.hls, contains('master.m3u8'));
    expect(v.poster, isNotNull);
    expect(v.aspectRatio, closeTo(720 / 1280, 0.01));
  });

  test('comments, replies and notifications', () {
    final cs = items('comments').map(Comment.fromJson).toList();
    expect(cs.single.replyCount, 1);
    expect(items('replies').map(Comment.fromJson).single.parentId, cs.single.id);
    final ns = items('notifications').map(AppNotification.fromJson).toList();
    expect(ns.map((n) => n.type), containsAll(['POST_LIKE', 'POST_COMMENT', 'NEW_FOLLOWER', 'PET_FOLLOWER']));
    expect(ns.every((n) => n.title.isNotEmpty && n.body.isNotEmpty), isTrue);
    expect(ns.firstWhere((n) => n.type == 'POST_LIKE').entityType, 'Post');
    expect((fixture('notifications') as Json)['unread'], greaterThan(0));
    expect(NotificationPrefs.fromJson(fixture('notification_prefs') as Json).values.keys, NotificationPrefs.keys);
  });

  test('upload tickets and processed media', () {
    final t = UploadTicket.fromJson(fixture('image_upload_create') as Json);
    expect(t.method, 'PUT');
    expect(t.headers['Content-Type'], 'image/jpeg');
    expect(Media.fromJson(fixture('image_media_ready') as Json).isReady, isTrue);
    expect(Media.fromJson(fixture('image_upload_complete') as Json).isFinal, isFalse);
  });
}
