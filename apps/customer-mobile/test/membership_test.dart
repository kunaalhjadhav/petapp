import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/membership/membership_logic.dart';
import 'package:petapp/features/notifications/notifications_screen.dart';
import 'package:petapp/features/posts/video_view.dart';

import 'fixture.dart';

/// Memberships, notification preferences and promotions (Phase 9d), against responses recorded from the real API
/// (tool/record_membership_fixtures.py). scripts/check_membership_mirrors.py runs the same checks in Python.
void main() {
  final plans = (fixture('membership_plans') as List).cast<Json>().map(MembershipPlan.fromJson).toList();
  final none = MyMembership.fromJson(fixture('membership_me_none') as Json);
  final member = MyMembership.fromJson(fixture('membership_me_member') as Json);
  MembershipPlan plan(String key) => plans.firstWhere((p) => p.key == key);

  test('plans come in order, with prices and benefits in words', () {
    expect(plans.map((p) => p.key), ['FREE', 'PLUS', 'PREMIUM']);
    expect(planPrice(plan('FREE')), 'Free');
    expect(planPrice(plan('PLUS')), '₹149 a month');
    expect(planPrice(MembershipPlan(id: 'y', key: 'Y', name: 'Yearly', description: '', pricePaise: 149900, periodDays: 365, lines: const [], priorityDays: 0)), '₹1,499 a year');
    expect(planPrice(MembershipPlan(id: 'z', key: 'Z', name: 'Trial', description: '', pricePaise: 4900, periodDays: 14, lines: const [], priorityDays: 0)), '₹49 for 14 days');
    expect(plan('PREMIUM').lines, contains('Book services up to 30 days earlier than everyone else'));
    expect(plan('PREMIUM').priorityDays, 30);
  });

  test('what each plan’s button does', () {
    expect(none.enabled, isTrue);
    expect(none.current, isNull);
    expect(membershipHeadline(none), 'You’re on the Free plan');
    expect(planAction(plan('FREE'), none), isNull);
    expect(planAction(plan('PLUS'), none), (label: 'Join Plus · ₹149', enabled: true));

    expect(member.current!.plan.key, 'PLUS');
    expect(member.upcoming, hasLength(1));
    expect(member.upcoming.first.startsAt, member.current!.endsAt);
    final now = member.current!.startsAt!;
    expect(membershipHeadline(member, now), startsWith('Plus, renewed until '));
    expect(planAction(plan('PLUS'), member), (label: 'Renew · ₹149', enabled: true));
    expect(planAction(plan('PLUS'), member, maxPeriodsAhead: 1), (label: 'Renewed', enabled: false));
    expect(planAction(plan('PREMIUM'), member, now: now)!.enabled, isFalse);
    expect(planAction(plan('PREMIUM'), member, now: now)!.label, startsWith('Available after '));
  });

  test('profiles show the member badge', () {
    expect(Me.fromJson(fixture('me_member') as Json).memberPlan, 'Plus');
    expect(PublicProfile.fromJson(fixture('user_profile_member') as Json).memberPlan, 'Plus');
    expect(Me.fromJson(fixture('me') as Json).memberPlan, isNull);
  });

  test('members-only marks', () {
    final contests = (fixture('contests_with_members_flag') as List).cast<Json>().map(ContestCard.fromJson).toList();
    expect(contests, isNotEmpty);
    expect(contests.every((c) => !c.membersOnly), isTrue);
    final raw = (fixture('contests_with_members_flag') as List).first as Json;
    expect(ContestCard.fromJson({...raw, 'membersOnly': true}).membersOnly, isTrue);
    expect(ChallengeCard.fromJson(fixture('challenge_detail_members_flag') as Json).membersOnly, isFalse);
  });

  test('reminders and votes are on, promotions off unless chosen', () {
    final old = NotificationPrefs.fromJson(fixture('notification_prefs') as Json);
    expect(old.values['reminders'], isTrue);
    expect(old.values['votes'], isTrue);
    expect(old.values['promotions'], isFalse);
    expect(NotificationPrefs.fromJson(fixture('notification_prefs_9d') as Json).values['promotions'], isTrue);
  });

  test('a promotion opens its page in the app; other notifications open what they are about', () {
    final items = ((fixture('notifications_9d') as Json)['items'] as List).cast<Json>().map(AppNotification.fromJson).toList();
    final promo = items.firstWhere((n) => n.type == 'PROMOTION');
    expect(promo.link, '/shop');
    expect(notificationTarget(promo.entityType, promo.entityId, promo.link), '/shop');
    final m = items.firstWhere((n) => n.type == 'MEMBERSHIP_UPDATE');
    expect(notificationTarget(m.entityType, m.entityId, m.link), '/membership');
    expect(safeAppLink('https://evil.example'), isFalse);
    expect(safeAppLink('//evil.example'), isFalse);
    expect(safeAppLink('/contest/summer-smiles'), isTrue);
    expect(notificationTarget('Post', 'p1', 'javascript:alert(1)'), '/post/p1');
  });

  test('a reel counts as watched to the end in its last moments', () {
    expect(reachedEnd(const Duration(milliseconds: 14700), const Duration(seconds: 15)), isTrue);
    expect(reachedEnd(const Duration(seconds: 10), const Duration(seconds: 15)), isFalse);
    expect(reachedEnd(Duration.zero, Duration.zero), isFalse);
  });
}
