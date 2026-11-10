import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';

import 'fixture.dart';

/// PetApp Assistant models parse responses recorded from the real API (tool/record_assistant_fixtures.py).
void main() {
  AskResult ask(String n) => AskResult.fromJson(fixture(n) as Json);

  test('what the assistant says about itself', () {
    final i = AssistantInfo.fromJson(fixture('assistant_info') as Json);
    expect(i.name, 'PetApp Assistant');
    expect(i.healthNotice, contains('not a vet'));
    expect(i.suggestions, isNotEmpty);
    expect(i.left, i.dailyLimit - i.usedToday);
  });

  test('answers come with cards, each parsed as its own model', () {
    final s = ask('assistant_services');
    expect(s.question.fromMe, isTrue);
    expect(s.answer.fromMe, isFalse);
    expect(s.answer.cards, isNotEmpty);
    expect(s.answer.cards.every((c) => c.item is NearbyPartner), isTrue);
    expect(ask('assistant_products').answer.cards.every((c) => c.item is ProductCard), isTrue);
    expect(ask('assistant_challenges').answer.cards.every((c) => c.item is ChallengeCard), isTrue);
    final link = ask('assistant_link').answer.cards.single.item as AssistantLink;
    expect(link.route, '/pets/new');
    expect(link.steps, isNotEmpty);
    final booking = ask('assistant_bookings').answer.cards.firstWhere((c) => c.type == 'BOOKING').item as AssistantBooking;
    expect(booking.petName, 'Momo');
    expect(booking.startsAt, isNotNull);
  });

  test('health answers are marked; emergencies stand out', () {
    final care = ask('assistant_care').answer;
    expect(care.safety, 'GENERAL_INFO');
    expect(care.notice, contains('not a diagnosis'));
    expect(care.cards.single.item, isA<CareNote>());
    final urgent = ask('assistant_urgent').answer;
    expect(urgent.urgent, isTrue);
    expect(urgent.notice, contains('emergency'));
    expect(urgent.text, contains('vet'));
    expect(ask('assistant_dose').answer.text, startsWith('I can’t suggest medicine doses'));
    expect(ask('assistant_services').answer.notice, isNull);
  });

  test('ratings, conversations, and cards of a type this app doesn’t know', () {
    expect(AssistantMessageView.fromJson(fixture('assistant_rate') as Json).rating, 'UP');
    final list = (fixture('assistant_conversations') as List).cast<Json>().map(AssistantConversation.fromJson).toList();
    expect(list.first.title, 'Find a groomer near me');
    final c = AssistantConversation.fromJson(fixture('assistant_conversation') as Json);
    expect(c.messages.first.fromMe, isTrue);
    expect(c.messages.length, 18);
    final m = AssistantMessageView.fromJson({'id': 'x', 'role': 'ASSISTANT', 'text': 'hi', 'cards': [{'type': 'HOLOGRAM', 'item': {'id': 'y'}}], 'safety': 'NONE'});
    expect(m.cards, isEmpty);
  });
}
