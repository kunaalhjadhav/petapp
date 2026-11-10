import 'dart:convert';
import 'dart:math';

import '../../api/models.dart';

/// Pure helpers for chat (no Flutter), tested in test/chat_test.dart and mirrored in scripts/check_chat_mirrors.py.

/// The live connection's address: the API's own host, with ws(s) for http(s), and the one-time ticket.
Uri realtimeUri(String apiBaseUrl, String path, String ticket) {
  final base = Uri.parse(apiBaseUrl);
  return Uri(
    scheme: base.scheme == 'https' ? 'wss' : 'ws',
    host: base.host,
    port: base.hasPort ? base.port : null,
    path: path,
    queryParameters: {'ticket': ticket},
  );
}

/// Waits between reconnection attempts: 1, 2, 4, 8, 16 seconds, then every 30.
Duration reconnectDelay(int attempt) => Duration(seconds: attempt >= 5 ? 30 : 1 << attempt);

/// Something that arrived over the live connection.
class ChatEvent {
  ChatEvent(this.type, {this.conversationId, this.message, this.side, this.at, this.status});

  /// hello | pong | message | read | typing | conversation
  final String type;
  final String? conversationId;
  final ChatMessage? message;
  final String? side;
  final DateTime? at;
  final String? status;

  static const _known = {'hello', 'pong', 'message', 'read', 'typing', 'conversation'};

  /// Null for anything unexpected: the app never trusts the socket blindly.
  static ChatEvent? parse(String raw) {
    try {
      final j = jsonDecode(raw);
      if (j is! Map<String, dynamic>) return null;
      final type = j['type'];
      if (type is! String || !_known.contains(type)) return null;
      final m = j['message'];
      return ChatEvent(
        type,
        conversationId: j['conversationId'] as String?,
        message: m is Map<String, dynamic> ? ChatMessage.fromJson(m) : null,
        side: j['side'] as String?,
        at: j['at'] is String ? DateTime.tryParse(j['at'] as String) : null,
        status: j['status'] as String?,
      );
    } catch (_) {
      return null;
    }
  }
}

/// The API's cursor for "messages after this one": base64url of "<ISO time>|<id>", as the server writes it.
String afterCursor(ChatMessage m) => base64Url.encode(utf8.encode('${m.createdAt.toUtc().toIso8601String()}|${m.id}')).replaceAll('=', '');

/// A message id the app chooses, so a send that is retried (bad network) is stored once.
String newClientId([Random? random]) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  final r = random ?? Random.secure();
  return List.generate(20, (_) => chars[r.nextInt(chars.length)]).join();
}

/// Adds messages (a page, a live event, a sent message) to what's shown: each message once, oldest first.
/// A message from the server replaces the local copy that was still sending (same clientId).
List<ChatMessage> mergeMessages(List<ChatMessage> current, Iterable<ChatMessage> incoming) {
  final byId = <String, ChatMessage>{for (final m in current) m.id: m};
  for (final m in incoming) {
    if (m.clientId != null) {
      byId.removeWhere((id, old) => id != m.id && old.clientId == m.clientId && id.startsWith('local:'));
    }
    byId[m.id] = m;
  }
  final out = byId.values.toList()
    ..sort((a, b) {
      final c = a.createdAt.compareTo(b.createdAt);
      return c != 0 ? c : a.id.compareTo(b.id);
    });
  return out;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/// "Today", "Yesterday", "Tuesday" (this week), "12 Oct" (this year), "12 Oct 2025".
String dayLabel(DateTime t, DateTime now) {
  final d = DateTime(t.year, t.month, t.day);
  final today = DateTime(now.year, now.month, now.day);
  final days = today.difference(d).inDays;
  if (days == 0) return 'Today';
  if (days == 1) return 'Yesterday';
  if (days > 1 && days < 7) return _weekdays[d.weekday - 1];
  return d.year == today.year ? '${d.day} ${_months[d.month - 1]}' : '${d.day} ${_months[d.month - 1]} ${d.year}';
}

/// "9:05 am"
String timeLabel(DateTime t) {
  final h12 = t.hour % 12 == 0 ? 12 : t.hour % 12;
  return '$h12:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'am' : 'pm'}';
}

/// A day heading goes above the first message of each day.
bool needsDayDivider(ChatMessage? previous, ChatMessage current) {
  if (previous == null) return true;
  final a = previous.createdAt.toLocal();
  final b = current.createdAt.toLocal();
  return a.year != b.year || a.month != b.month || a.day != b.day;
}

/// Under your last message: "Seen" once the other side has read past it, else "Sent". Null if the last message isn't yours.
String? seenText(List<ChatMessage> messages, DateTime? otherReadAt) {
  final visible = messages.where((m) => !m.isSystem).toList();
  if (visible.isEmpty) return null;
  final last = visible.last;
  if (!last.mine || last.sending || last.failed) return null;
  return otherReadAt != null && !otherReadAt.isBefore(last.createdAt) ? 'Seen' : 'Sent';
}

String _rupees(int paise) {
  final r = paise ~/ 100;
  final p = paise % 100;
  final s = r.toString();
  // Indian grouping: 1,23,456
  final last3 = s.length > 3 ? s.substring(s.length - 3) : s;
  var rest = s.length > 3 ? s.substring(0, s.length - 3) : '';
  final parts = <String>[];
  while (rest.length > 2) {
    parts.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) parts.insert(0, rest);
  final whole = [...parts, last3].join(',');
  return p == 0 ? '₹$whole' : '₹$whole.${p.toString().padLeft(2, '0')}';
}

String _status(String? s) => s == null ? '' : s[0] + s.substring(1).toLowerCase().replaceAll('_', ' ');

/// The two lines of a shared card.
({String title, String subtitle}) refLines(ChatRef r) {
  if (r.unavailable) return (title: switch (r.type) { 'BOOKING' => 'Booking', 'ORDER' => 'Order', _ => 'Product' }, subtitle: 'No longer available');
  switch (r.type) {
    case 'BOOKING':
      final when = r.startsAt == null ? '' : '${r.startsAt!.toLocal().day} ${_months[r.startsAt!.toLocal().month - 1]}, ${timeLabel(r.startsAt!.toLocal())}';
      return (title: [r.title, r.petName].whereType<String>().join(' · '), subtitle: [when, _status(r.status)].where((x) => x.isNotEmpty).join(' · '));
    case 'ORDER':
      return (title: 'Order ${r.code ?? ''}'.trim(), subtitle: [if (r.units != null) '${r.units} item${r.units == 1 ? '' : 's'}', if (r.totalPaise != null) _rupees(r.totalPaise!), _status(r.status)].where((x) => x.isNotEmpty).join(' · '));
    default:
      return (title: r.title ?? 'Product', subtitle: !r.available ? 'Not available right now' : r.pricePaise != null ? _rupees(r.pricePaise!) : '');
  }
}
