import 'dart:convert';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/api/models.dart';
import 'package:petapp/features/chat/chat_logic.dart';

import 'fixture.dart';

/// Chat and support (Phase 9a), against responses recorded by tool/record_chat_fixtures.py.
/// Mirrored in scripts/check_chat_mirrors.py.
void main() {
  ChatPage page(String name) => ChatPage.fromJson(fixture(name) as Json);

  test('conversations, headers and messages', () {
    final inbox = CursorPage.fromJson(fixture('chat_inbox') as Json, ChatConversation.fromJson);
    final c = inbox.items.single;
    expect(c.kind, 'SHOP');
    expect(c.counterpart.type, 'SELLER');
    expect(c.unread, 1);
    expect(c.lastMessageText, isNotEmpty);

    final h = ChatHeader.fromJson(fixture('chat_header') as Json);
    expect(h.side, 'CUSTOMER');
    expect(h.counterpart.type, 'PARTNER');
    expect(h.canSend, isTrue);
    expect(h.isSupport, isFalse);
    final blocked = ChatHeader.fromJson(fixture('chat_blocked') as Json);
    expect(blocked.canSend, isFalse);
    expect(blocked.blockedByMe, isTrue);
    expect(blocked.cannotSendReason, contains('Unblock'));

    final p = page('chat_messages');
    expect(p.items, hasLength(2));
    expect(p.more, isTrue);
    expect(p.items.first.mine, isFalse); // newest first: the partner's reply
    final photo = p.items.last;
    expect(photo.media!.isReady, isTrue);
    expect(photo.media!.imageFor(480), contains('/private/'));
  });

  test('cards for a booking, a product and an order', () {
    final b = ChatMessage.fromJson(fixture('chat_send_booking') as Json).ref!;
    expect(refLines(b).title, contains(' · '));
    expect(refLines(b).subtitle, endsWith('Completed'));
    final pr = ChatMessage.fromJson(fixture('chat_send_product') as Json).ref!;
    expect(refLines(pr).subtitle, startsWith('₹'));
    final o = ChatMessage.fromJson(fixture('chat_reply_seller') as Json).ref!;
    expect(refLines(o).title, startsWith('Order SO-'));
    expect(refLines(o).subtitle, '1 item · ₹348 · Cancelled');
    expect(refLines(ChatRef(type: 'BOOKING', id: 'x')).subtitle, 'No longer available');
  });

  test('merging pages, live events and sends shows each message once, oldest first', () {
    final newest = page('chat_messages').items;
    final older = page('chat_messages_older').items;
    final all = mergeMessages(mergeMessages(const [], newest), older);
    expect(all.length, newest.length + older.length);
    for (var i = 1; i < all.length; i++) {
      expect(all[i - 1].createdAt.isAfter(all[i].createdAt), isFalse);
    }
    // The same page again changes nothing.
    expect(mergeMessages(all, newest).length, all.length);
    // A local message that was sending is replaced by the server's copy.
    final sent = ChatMessage.fromJson(fixture('chat_send_text') as Json);
    final local = ChatMessage(id: 'local:${sent.clientId}', side: 'CUSTOMER', mine: true, body: sent.body, removed: false, clientId: sent.clientId, createdAt: DateTime.now(), sending: true);
    final merged = mergeMessages([local], [sent]);
    expect(merged.single.id, sent.id);
    expect(merged.single.sending, isFalse);
  });

  test('the cursor the app builds is the one the server uses', () {
    final p = page('chat_messages');
    expect(afterCursor(p.items.last), p.nextCursor);
  });

  test('live events', () {
    final m = fixture('chat_reply_partner') as Json;
    final e = ChatEvent.parse(jsonEncode({'type': 'message', 'conversationId': m['conversationId'], 'message': m}))!;
    expect(e.type, 'message');
    expect(e.message!.forSide('CUSTOMER').mine, isFalse);
    expect(e.message!.forSide('BUSINESS').mine, isTrue);
    expect(ChatEvent.parse('{"type":"read","conversationId":"c","side":"STAFF","at":"2026-10-18T10:00:00.000Z"}')!.at, DateTime.utc(2026, 10, 18, 10));
    expect(ChatEvent.parse('{"type":"typing","conversationId":"c","side":"BUSINESS"}')!.side, 'BUSINESS');
    expect(ChatEvent.parse('{"type":"evil"}'), isNull);
    expect(ChatEvent.parse('not json'), isNull);
    expect(ChatEvent.parse('[1,2]'), isNull);
  });

  test('the live connection address and reconnect waits', () {
    final t = RealtimeTicket.fromJson(fixture('chat_realtime_ticket') as Json);
    expect(realtimeUri('https://api.petapp.in', t.path, 'abc').toString(), 'wss://api.petapp.in/api/v1/chat/ws?ticket=abc');
    expect(realtimeUri('http://10.0.2.2:4000', t.path, 'a b').toString(), 'ws://10.0.2.2:4000/api/v1/chat/ws?ticket=a+b');
    expect([for (var i = 0; i < 8; i++) reconnectDelay(i).inSeconds], [1, 2, 4, 8, 16, 30, 30, 30]);
    expect(newClientId(Random(1)), matches(RegExp(r'^[A-Za-z0-9]{20}$')));
  });

  test('days, times and read receipts', () {
    final now = DateTime(2026, 10, 18, 15);
    expect(dayLabel(DateTime(2026, 10, 18, 9), now), 'Today');
    expect(dayLabel(DateTime(2026, 10, 17, 23), now), 'Yesterday');
    expect(dayLabel(DateTime(2026, 10, 14, 9), now), 'Wednesday');
    expect(dayLabel(DateTime(2026, 9, 2), now), '2 Sep');
    expect(dayLabel(DateTime(2025, 12, 31), now), '31 Dec 2025');
    expect(timeLabel(DateTime(2026, 1, 1, 0, 5)), '12:05 am');
    expect(timeLabel(DateTime(2026, 1, 1, 13, 40)), '1:40 pm');

    final h = ChatHeader.fromJson(fixture('chat_header') as Json);
    final msgs = mergeMessages(const [], page('chat_messages').items);
    // The last message is the partner's, so there is no receipt under it.
    expect(seenText(msgs, h.otherReadAt), isNull);
    final mine = mergeMessages(msgs, [ChatMessage.fromJson(fixture('chat_send_text') as Json)]).where((m) => m.mine).toList();
    expect(seenText(mine, mine.last.createdAt), 'Seen');
    expect(seenText(mine, mine.last.createdAt.subtract(const Duration(seconds: 1))), 'Sent');
    expect(seenText(mine, null), 'Sent');
  });

  test('help center and tickets', () {
    final hc = HelpCenter.fromJson(fixture('help_center') as Json);
    expect(hc.topics.map((t) => t.key), contains('bookings'));
    expect(hc.faqs, isNotEmpty);
    final search = HelpCenter.fromJson(fixture('help_center_search') as Json);
    expect(search.faqs.every((f) => '${f.question} ${f.answer}'.toLowerCase().contains('refund')), isTrue);
    final created = SupportTicket.fromJson(fixture('ticket_created') as Json);
    expect(created.code, matches(RegExp(r'^T-[A-Z0-9]{6}$')));
    expect(created.status, 'OPEN');
    final mine = (fixture('tickets_mine') as List).cast<Json>().map(SupportTicket.fromJson).first;
    expect(mine.statusLabel, 'Waiting for your reply');
    expect(mine.unread, 1);
    final closed = SupportTicket.fromJson(fixture('ticket_closed') as Json);
    expect(closed.canReply, isFalse);
    expect(closed.open, isFalse);
    final th = ChatHeader.fromJson(fixture('ticket_header') as Json);
    expect(th.isSupport, isTrue);
    expect(th.counterpart.name, 'PetApp Support');
    final staff = page('ticket_messages').items.firstWhere((m) => m.side == 'STAFF');
    expect(staff.senderName, isNotEmpty);
    expect(staff.mine, isFalse);
  });
}
