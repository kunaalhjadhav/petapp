import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';

import 'fixture.dart';

/// Challenge, badge and judging models parse real API responses (tool/record_challenge_fixtures.py).
void main() {
  test('joined, checked in, completed with a badge', () {
    final joined = ChallengeDetail.fromJson(fixture('challenge_detail_joined') as Json);
    expect(joined.card.mine!.status, 'ACTIVE');
    expect(joined.card.mine!.checkedInToday, isFalse);
    expect(joined.card.proof, 'TEXT');
    expect(joined.card.badgeName, 'First Step');
    expect(joined.entryId, isNotNull);

    final r = CheckInResult.fromJson(fixture('challenge_checkin') as Json);
    expect(r.earned, 10);
    expect(r.completed, isTrue);
    expect(r.badgeName, 'First Step');

    final done = ChallengeDetail.fromJson(fixture('challenge_detail_done') as Json);
    expect(done.card.mine!.status, 'COMPLETED');
    expect(done.card.mine!.checkedInToday, isTrue);
    expect(done.days.single.points, 10);
    expect((fixture('badges_mine') as List).cast<Json>().map(EarnedBadge.fromJson).single.name, 'First Step');
  });

  test('rankings and the viewer’s own rank', () {
    final b = ChallengeBoard.fromJson(fixture('challenge_board') as Json);
    expect(b.rows.first.rank, 1);
    expect(b.rows.first.completed, isTrue);
    expect(b.myRank, 1);
  });

  test('judges see their contests, entries and saved scores', () {
    expect(Me.fromJson(fixture('me_judge') as Json).isJudge, isTrue);
    expect(Me.fromJson(fixture('me') as Json).isJudge, isFalse);
    final contests = (fixture('judge_contests') as List).cast<Json>().map(JudgeContest.fromJson).toList();
    final c = contests.firstWhere((x) => x.title.startsWith('Fixture Judged Cup'));
    expect(c.criteria.map((x) => x.weight).fold<int>(0, (a, b) => a + b), 100);
    final before = (fixture('judge_entries') as List).cast<Json>().map(JudgeEntry.fromJson).single;
    expect(before.myScores, isEmpty);
    expect(before.submissions.single.text, 'Balances a treat on her nose.');
    final after = (fixture('judge_entries_scored') as List).cast<Json>().map(JudgeEntry.fromJson).single;
    expect(after.myScores.values.toSet(), {9.0, 7.5});
  });
}
