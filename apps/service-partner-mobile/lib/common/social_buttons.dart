import 'package:flutter/material.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../api/api_client.dart';
import '../services/social_sign_in.dart';
import '../theme.dart';

/// "or" and the sign-in buttons for this phone: Continue with Google on Android, Sign in with Apple on iPhone.
/// Shows nothing where neither applies (the web build, or an Android build without GOOGLE_SERVER_CLIENT_ID).
class SocialSignInButtons extends StatefulWidget {
  const SocialSignInButtons({super.key, required this.onCredential});

  /// Signs in with the API. Errors it throws are shown under the buttons.
  final Future<void> Function(SocialCredential credential) onCredential;

  @override
  State<SocialSignInButtons> createState() => _SocialSignInButtonsState();
}

class _SocialSignInButtonsState extends State<SocialSignInButtons> {
  SocialProvider? _busy;
  String? _error;

  Future<void> _go(SocialProvider p) async {
    setState(() {
      _busy = p;
      _error = null;
    });
    try {
      final c = p == SocialProvider.google ? await SocialSignIn.google() : await SocialSignIn.apple();
      if (c != null) await widget.onCredential(c); // the router moves on once signed in
    } on SocialSignInError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final providers = SocialSignIn.available;
    if (providers.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 24),
      const Row(children: [
        Expanded(child: Divider()),
        Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: Brand.muted))),
        Expanded(child: Divider()),
      ]),
      const SizedBox(height: 16),
      for (final p in providers)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: switch (p) {
            SocialProvider.google => OutlinedButton(
                onPressed: _busy != null ? null : () => _go(p),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), foregroundColor: Brand.ink, side: const BorderSide(color: Brand.line)),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  if (_busy == p)
                    const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  else
                    const _GoogleMark(),
                  const SizedBox(width: 12),
                  Text(_busy == p ? 'Signing in…' : 'Continue with Google', style: const TextStyle(fontWeight: FontWeight.w600)),
                ]),
              ),
            // Apple's own button, as App Review expects.
            SocialProvider.apple => _busy == p
                ? const SizedBox(height: 48, child: Center(child: CircularProgressIndicator()))
                : SignInWithAppleButton(
                    onPressed: _busy != null ? () {} : () => _go(p),
                    text: 'Sign in with Apple',
                    height: 48,
                    borderRadius: const BorderRadius.all(Radius.circular(12)),
                  ),
          },
        ),
      if (_error != null) Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.error)),
    ]);
  }
}

/// Google's "G", drawn without an image file.
class _GoogleMark extends StatelessWidget {
  const _GoogleMark();
  @override
  Widget build(BuildContext context) => Container(
        width: 22,
        height: 22,
        alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Brand.line)),
        child: const Text('G', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: Color(0xFF4285F4))),
      );
}
