import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/api_client.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/api/session_store.dart';
import 'package:petapp/features/privacy/legal_markdown.dart';
import 'package:petapp/features/privacy/privacy_screens.dart';
import 'package:petapp/state/auth_controller.dart';

import 'api_client_test.dart' show FakeAdapter;
import 'fixture.dart';

/// Privacy and legal (Phase 8b), against responses recorded by tool/record_privacy_fixtures.py.
void main() {
  test('published documents and one document', () {
    final list = (fixture('legal_list') as List).cast<Json>().map(LegalDocSummary.fromJson).toList();
    expect(list.map((d) => d.slug), containsAll(['terms-of-service', 'privacy-policy']));
    expect(list.first.requiresAcceptance, isTrue);
    final d = LegalDoc.fromJson(fixture('legal_doc') as Json);
    expect(d.title, 'Privacy Policy');
    expect(d.body, startsWith('# Privacy Policy'));
    expect(d.body, isNot(contains('{{')));
  });

  test('what to accept, then nothing once accepted', () {
    final p = ConsentStatus.fromJson(fixture('consents_pending') as Json);
    expect(p.pending, ['terms-of-service', 'privacy-policy']);
    expect(p.toAccept.every((d) => d.acceptedVersion == null && !d.updated), isTrue);
    expect(p.marketing, isFalse);
    final a = ConsentStatus.fromJson(fixture('consents_accepted') as Json);
    expect(a.pending, isEmpty);
    expect(a.documents.every((d) => d.acceptedVersion == d.version && d.acceptedAt != null), isTrue);
    expect(a.marketing, isTrue);
  });

  test('data copies', () {
    final asked = DataExports.fromJson(fixture('data_exports_requested') as Json);
    expect(asked.items.single.status, 'PENDING');
    expect(asked.canRequest, isFalse);
    expect(exportStatusText(asked.items.single), startsWith('Being prepared'));
    final ready = DataExports.fromJson(fixture('data_exports') as Json);
    final e = ready.items.single;
    expect(e.ready, isTrue);
    expect(exportStatusText(e), allOf(startsWith('Ready · '), contains('KB'), contains('download until')));
    expect(ready.nextAllowedAt, isNotNull);
    final link = ExportLink.fromJson(fixture('data_export_link') as Json);
    expect(link.fileName, matches(RegExp(r'^petapp-data-\d{4}-\d{2}-\d{2}\.json$')));
    expect(link.url, startsWith('http'));
    expect(sizeText(840 * 1024), '840 KB');
    expect(sizeText(3 * 1024 * 1024 + 200000), '3.2 MB');
  });

  test('deleting the account, and coming back during the grace period', () {
    final r = DeletionScheduled.fromJson(fixture('account_deletion') as Json);
    expect(r.graceDays, 14);
    expect(deletionNotice(r), allOf(startsWith('Your account will be deleted on '), endsWith('Sign in before then to keep it.')));
    expect(deletionNotice(DeletionScheduled(graceDays: 14)), startsWith('Your account will be deleted in 14 days.'));
    expect(AuthResult.fromJson(fixture('auth_restored') as Json).accountRestored, isTrue);
    expect(AuthResult.fromJson(fixture('auth_result') as Json).accountRestored, isFalse);
  });

  test('a "terms first" refusal names the document', () async {
    const body = '{"success":false,"message":"Please read and accept the Contest Terms first.","errors":[{"code":"TERMS_NOT_ACCEPTED","field":"contest-terms","message":"Accept version 1 of the Contest Terms."}],"requestId":"x"}';
    final c = ApiClient(baseUrl: 'http://api', session: SessionStore.memory(), adapter: FakeAdapter((_) async => (403, body)));
    await expectLater(c.post('/contests/x/register', {}), throwsA(isA<ApiException>().having((e) => e.termsSlug, 'termsSlug', 'contest-terms').having((e) => e.needsTerms, 'needsTerms', isTrue)));
    final other = ApiClient(baseUrl: 'http://api', session: SessionStore.memory(), adapter: FakeAdapter((_) async => (400, fixtureRaw('error_validation'))));
    await expectLater(other.post('/pets', {}), throwsA(isA<ApiException>().having((e) => e.needsTerms, 'needsTerms', isFalse)));
  });

  test('legal Markdown: headings, paragraphs, nested lists and bold', () {
    final b = parseLegalMarkdown('# Title\n\nFirst line\nsecond line\n\n## Rights\n- **See** data\n  - in the app\n- delete it\nAfter');
    expect(b.map((x) => x.kind).toList(), ['heading', 'paragraph', 'heading', 'list', 'paragraph']);
    expect(b[0].level, 1);
    expect(b[1].lines.length, 2);
    expect(b[3].items.length, 2);
    expect(b[3].items.first.text.first.bold, isTrue);
    expect(b[3].items.first.children.single.single.text, 'in the app');
    expect(mdInline('no ** close').single.text, 'no ** close');
    final doc = parseLegalMarkdown(LegalDoc.fromJson(fixture('legal_doc') as Json).body);
    expect(doc.first.kind, 'heading');
    expect(doc.where((x) => x.kind == 'heading' && x.level == 2).length, greaterThan(4));
  });
}
