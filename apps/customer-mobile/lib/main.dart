import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/session_store.dart';
import 'config.dart';
import 'router.dart';
import 'services/prefs_cache.dart';
import 'services/chat_socket.dart';
import 'services/crash_reporting.dart';
import 'state/auth_controller.dart';
import 'state/providers.dart';
import 'theme.dart';

Future<void> main() => runWithCrashReporting(app: 'petapp', version: AppConfig.appVersion, run: _start);

Future<void> _start() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = SessionStore();
  await session.load();
  final container = ProviderContainer(overrides: [sessionStoreProvider.overrideWithValue(session), offlineCacheProvider.overrideWithValue(PrefsOfflineCache())]);
  await container.read(authProvider.notifier).init();
  runApp(UncontrolledProviderScope(container: container, child: const PetApp()));
}

class PetApp extends ConsumerStatefulWidget {
  const PetApp({super.key});
  @override
  ConsumerState<PetApp> createState() => _PetAppState();
}

/// Keeps the live chat connection open while the app is in front and signed in; push covers the rest.
class _PetAppState extends ConsumerState<PetApp> {
  late final AppLifecycleListener _life;
  bool _foreground = true;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(
      onResume: () => _setForeground(true),
      onHide: () => _setForeground(false),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  @override
  void dispose() {
    _life.dispose();
    super.dispose();
  }

  void _setForeground(bool v) {
    _foreground = v;
    _sync();
  }

  void _sync() {
    final socket = ref.read(chatSocketProvider);
    if (_foreground && ref.read(authProvider).status == AuthStatus.signedIn) {
      socket.start();
    } else {
      socket.stop();
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authProvider, (_, __) => _sync());
    return MaterialApp.router(
      title: 'PetApp',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
