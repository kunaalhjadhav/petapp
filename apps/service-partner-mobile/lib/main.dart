import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/session_store.dart';
import 'config.dart';
import 'features/chat/business_chat.dart';
import 'router.dart';
import 'services/prefs_cache.dart';
import 'services/crash_reporting.dart';
import 'state/providers.dart';
import 'theme.dart';

Future<void> main() => runWithCrashReporting(app: 'petapp_partner', version: AppConfig.appVersion, run: _start);

Future<void> _start() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = SessionStore();
  await session.load();
  final container = ProviderContainer(overrides: [sessionStoreProvider.overrideWithValue(session), offlineCacheProvider.overrideWithValue(PrefsOfflineCache())]);
  await container.read(authProvider.notifier).init();
  runApp(UncontrolledProviderScope(container: container, child: const PartnerApp()));
}

class PartnerApp extends ConsumerWidget {
  const PartnerApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      MaterialApp.router(
        title: 'PetApp Partners',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: ref.watch(routerProvider),
        // Live chat while the app is open, and opening tapped notifications.
        builder: (context, child) => ChatLifecycle(child: child ?? const SizedBox.shrink()),
      );
}
