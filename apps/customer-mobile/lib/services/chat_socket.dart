import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../api/petapp_api.dart';
import '../config.dart';
import '../features/chat/chat_logic.dart';
import '../state/providers.dart';

final chatSocketProvider = Provider<ChatSocket>((ref) {
  final s = ChatSocket(ref.read(apiProvider));
  ref.onDispose(s.dispose);
  return s;
});

/// Live chat events (new messages, read receipts, typing) while the app is open and signed in.
final chatEventsProvider = StreamProvider<ChatEvent>((ref) => ref.watch(chatSocketProvider).events);

/// The live connection to the API. It only receives: messages are always sent over HTTP. When the connection
/// drops it reconnects with growing waits, and screens catch up on what they missed when `hello` arrives again.
class ChatSocket {
  ChatSocket(this._api);
  final PetAppApi _api;
  final _events = StreamController<ChatEvent>.broadcast();
  WebSocketChannel? _ch;
  StreamSubscription<dynamic>? _sub;
  Timer? _ping;
  Timer? _retry;
  int _attempt = 0;
  bool _wanted = false;
  bool _connecting = false;

  Stream<ChatEvent> get events => _events.stream;
  bool get connected => _ch != null;

  /// Call when the app comes to the foreground signed in.
  void start() {
    if (_wanted) return;
    _wanted = true;
    _attempt = 0;
    unawaited(_connect());
  }

  /// Call when the app goes to the background or signs out. Push notifications take over.
  void stop() {
    _wanted = false;
    _retry?.cancel();
    _close();
  }

  void typing(String conversationId) => _send({'type': 'typing', 'conversationId': conversationId});

  Future<void> _connect() async {
    if (!_wanted || _ch != null || _connecting) return;
    _connecting = true;
    try {
      final t = await _api.realtimeTicket();
      final ch = WebSocketChannel.connect(realtimeUri(AppConfig.apiBaseUrl, t.path, t.ticket));
      await ch.ready;
      if (!_wanted) {
        await ch.sink.close();
        return;
      }
      _ch = ch;
      _sub = ch.stream.listen(
        (data) {
          final e = ChatEvent.parse(data is String ? data : utf8.decode(data as List<int>));
          if (e == null) return;
          if (e.type == 'hello') _attempt = 0;
          _events.add(e);
        },
        onDone: _lost,
        onError: (Object _) => _lost(),
        cancelOnError: true,
      );
      _ping = Timer.periodic(const Duration(seconds: 25), (_) => _send({'type': 'ping'}));
    } catch (_) {
      _lost();
    } finally {
      _connecting = false;
    }
  }

  void _lost() {
    _close();
    if (!_wanted) return;
    _retry?.cancel();
    _retry = Timer(reconnectDelay(_attempt++), () => unawaited(_connect()));
  }

  void _close() {
    _ping?.cancel();
    _ping = null;
    unawaited(_sub?.cancel());
    _sub = null;
    final ch = _ch;
    _ch = null;
    if (ch != null) unawaited(ch.sink.close());
  }

  void _send(Map<String, Object?> m) {
    try {
      _ch?.sink.add(jsonEncode(m));
    } catch (_) {
      // A dropped connection is noticed by the stream; nothing to do here.
    }
  }

  void dispose() {
    stop();
    unawaited(_events.close());
  }
}
