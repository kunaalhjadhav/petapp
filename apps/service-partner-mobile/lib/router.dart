import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth_screens.dart';
import 'features/home.dart';
import 'state/providers.dart';

class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen<AuthState>(authProvider, (_, __) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) => GoRouter(
      initialLocation: '/',
      refreshListenable: _AuthListenable(ref),
      redirect: (context, state) {
        final s = ref.read(authProvider).status;
        final loc = state.matchedLocation;
        final inAuth = loc == '/login' || loc == '/otp';
        return switch (s) {
          AuthStatus.loading => loc == '/splash' ? null : '/splash',
          AuthStatus.signedOut => inAuth ? null : '/login',
          AuthStatus.signedIn => inAuth || loc == '/splash' ? '/' : null,
        };
      },
      routes: [
        GoRoute(path: '/splash', builder: (_, __) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
        GoRoute(path: '/login', builder: (_, __) => const PhoneScreen()),
        GoRoute(path: '/otp', builder: (_, __) => const OtpScreen()),
        GoRoute(path: '/', builder: (_, __) => const HomeGate()),
      ],
    ));
