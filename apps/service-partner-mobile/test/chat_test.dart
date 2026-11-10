import 'package:flutter_test/flutter_test.dart';
import 'package:petapp_partner/api/models.dart';
import 'package:petapp_partner/features/chat/chat_logic.dart';

import 'fixture.dart';

/// Chat and support (Phase 9a), against responses recorded by apps/customer-mobile/tool/record_chat_fixtures.py.
/// chat_logic.dart is the same file as the customer app's (scripts/check_chat_mirrors.py checks it).
void main() {
  test('the inbox and a conversation with a customer', () {
    final inbox = (fixture('chat_inbox_partner') as Json)['items'] as List;
    final c = ChatConversation.fromJson(inbox.first as Json);
    expect(c.counterpart.type, 'CUSTOMER');
    final h = ChatHeader.fromJson(fixture('chat_header_partner') as Json);
    expect(h.side, 'BUSINESS');
    expect(h.canSend, isTrue);
    final page = ChatPage.fromJson(fixture('chat_messages_partner') as Json);
    final all = mergeMessages(const [], page.items);
    expect(all.where((m) => m.mine).every((m) => m.side == 'BUSINESS'), isTrue);
    expect(all.any((m) => m.media?.imageFor(480)?.contains('/private/') ?? false), 'partner' == 'partner');
    final start = ChatStart.fromJson(fixture('chat_start_booking') as Json);
    expect(start.refType, 'BOOKING');
    final u = ChatUnread.fromJson(fixture('chat_unread_partner') as Json);
    expect(u.partner, greaterThanOrEqualTo(0));
  });

  test('help center and tickets from this app', () {
    final hc = HelpCenter.fromJson(fixture('help_center') as Json);
    expect(hc.topics, isNotEmpty);
    final t = SupportTicket.fromJson(fixture('ticket_created_partner') as Json);
    expect(t.status, 'OPEN');
    expect((fixture('tickets_mine_partner') as List), isNotEmpty);
    expect(ChatHeader.fromJson(fixture('ticket_header') as Json).isSupport, isTrue);
  });
}
