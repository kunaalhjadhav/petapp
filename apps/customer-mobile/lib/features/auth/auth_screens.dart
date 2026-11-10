import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../api/api_client.dart';
import '../../common/social_buttons.dart';
import '../../services/phone.dart';
import '../../state/providers.dart';
import '../../theme.dart';

class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});
  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _ctrl = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _send() async {
    final phone = normalizeIndianMobile(_ctrl.text);
    if (phone == null) {
      setState(() => _error = 'Enter a 10-digit mobile number.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).requestOtp(phone);
      if (mounted) context.push('/otp');
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 48),
          const Icon(Icons.pets_rounded, size: 48, color: Brand.teal),
          const SizedBox(height: 16),
          Text('Welcome to PetApp', style: t.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          const Text('Sign in with your mobile number, and we’ll text you a code. Or continue with your Google or Apple account.', style: TextStyle(color: Brand.muted)),
          if (ref.watch(authProvider).notice case final notice?) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Brand.line, borderRadius: BorderRadius.circular(10)),
              child: Text(notice),
            ),
          ],
          const SizedBox(height: 32),
          TextField(
            controller: _ctrl,
            autofocus: true,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumberNational],
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]')), LengthLimitingTextInputFormatter(16)],
            decoration: InputDecoration(labelText: 'Mobile number', prefixText: '+91  ', errorText: _error),
            onSubmitted: (_) => _send(),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending…' : 'Send code')),
          SocialSignInButtons(onCredential: (c) => ref.read(authProvider.notifier).socialSignIn(c)),
          const SizedBox(height: 16),
          Wrap(alignment: WrapAlignment.center, crossAxisAlignment: WrapCrossAlignment.center, children: [
            const Text('By continuing you agree to the ', style: TextStyle(color: Brand.muted, fontSize: 12)),
            InkWell(onTap: () => context.push('/legal/terms-of-service'), child: const Text('Terms', style: TextStyle(color: Brand.teal, fontSize: 12, decoration: TextDecoration.underline))),
            const Text(' and ', style: TextStyle(color: Brand.muted, fontSize: 12)),
            InkWell(onTap: () => context.push('/legal/privacy-policy'), child: const Text('Privacy Policy', style: TextStyle(color: Brand.teal, fontSize: 12, decoration: TextDecoration.underline))),
            const Text('.', style: TextStyle(color: Brand.muted, fontSize: 12)),
          ]),
        ]),
      ),
    );
  }
}

class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key});
  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _ctrl = TextEditingController();
  String? _error;
  bool _busy = false;
  int _wait = 30; // matches the API's resend cooldown
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _tick();
  }

  void _tick() {
    _timer?.cancel();
    _wait = 30;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _wait = (_wait - 1).clamp(0, 30));
      if (_wait == 0) t.cancel();
    });
  }

  Future<void> _verify() async {
    if (_ctrl.text.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authProvider.notifier).verifyOtp(_ctrl.text);
      // The router moves on once signed in.
    } catch (e) {
      setState(() => _error = ApiException.from(e).message); // e.g. "Incorrect code. 2 attempts left."
      _ctrl.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    final phone = ref.read(authProvider).phone;
    if (phone == null) return;
    try {
      await ref.read(authProvider.notifier).requestOtp(phone);
      _tick();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('New code sent.')));
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final phone = ref.watch(authProvider).phone;
    return Scaffold(
      appBar: AppBar(),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        Text('Enter the code', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Text('Sent to ${phone == null ? 'your phone' : formatIndianMobile(phone)}', style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 24),
        TextField(
          controller: _ctrl,
          autofocus: true,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          style: const TextStyle(fontSize: 24, letterSpacing: 8),
          decoration: InputDecoration(labelText: '6-digit code', errorText: _error, errorMaxLines: 2),
          onChanged: (v) {
            if (v.length == 6) _verify();
          },
        ),
        const SizedBox(height: 24),
        FilledButton(onPressed: _busy ? null : _verify, child: Text(_busy ? 'Checking…' : 'Continue')),
        TextButton(onPressed: _wait > 0 ? null : _resend, child: Text(_wait > 0 ? 'Resend code in $_wait s' : 'Resend code')),
      ]),
    );
  }
}

class NameScreen extends ConsumerStatefulWidget {
  const NameScreen({super.key});
  @override
  ConsumerState<NameScreen> createState() => _NameScreenState();
}

class _NameScreenState extends ConsumerState<NameScreen> {
  final _ctrl = TextEditingController();
  bool _busy = false;

  Future<void> _save() async {
    final name = _ctrl.text.trim();
    if (name.isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(authProvider.notifier).saveName(name);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiException.from(e).message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const SizedBox(height: 48),
            Text('What should we call you?', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text('This is shown on your posts and comments.', style: TextStyle(color: Brand.muted)),
            const SizedBox(height: 24),
            TextField(
              controller: _ctrl,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              maxLength: 80,
              decoration: const InputDecoration(labelText: 'Your name'),
              onSubmitted: (_) => _save(),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _busy ? null : _save, child: const Text('Continue')),
          ]),
        ),
      );
}

/// Add (or change) the mobile number on an account made with Google or Apple: a code goes to the number, and
/// entering it saves the number as verified. Voting in contests needs a verified number.
class AddPhoneScreen extends ConsumerStatefulWidget {
  const AddPhoneScreen({super.key});
  @override
  ConsumerState<AddPhoneScreen> createState() => _AddPhoneScreenState();
}

class _AddPhoneScreenState extends ConsumerState<AddPhoneScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _sentTo; // the number the code went to; null while choosing the number
  String? _error;
  bool _busy = false;
  int _wait = 0;
  Timer? _timer;

  void _tick() {
    _timer?.cancel();
    _wait = 30; // matches the API's resend cooldown
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _wait = (_wait - 1).clamp(0, 30));
      if (_wait == 0) t.cancel();
    });
  }

  Future<void> _run(Future<void> Function() work) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await work();
    } catch (e) {
      if (mounted) setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send([String? again]) async {
    final phone = again ?? normalizeIndianMobile(_phone.text);
    if (phone == null) return setState(() => _error = 'Enter a 10-digit mobile number.');
    await _run(() async {
      await ref.read(apiProvider).requestPhoneCode(phone);
      _code.clear();
      setState(() => _sentTo = phone);
      _tick();
    });
  }

  Future<void> _verify() async {
    final phone = _sentTo;
    if (phone == null || _code.text.length != 6) return;
    await _run(() async {
      await ref.read(apiProvider).verifyPhone(phone, _code.text);
      ref.invalidate(meProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${formatIndianMobile(phone)} is verified.')));
      context.pop(true);
    });
    if (mounted && _error != null) _code.clear();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sentTo = _sentTo;
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Mobile number')),
      body: ListView(padding: const EdgeInsets.all(24), children: [
        if (sentTo == null) ...[
          Text('Add your mobile number', style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          const Text('You need a verified number to vote in contests, and you can then also sign in with it. We’ll text you a code.', style: TextStyle(color: Brand.muted)),
          const SizedBox(height: 24),
          TextField(
            controller: _phone,
            autofocus: true,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumberNational],
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]')), LengthLimitingTextInputFormatter(16)],
            decoration: InputDecoration(labelText: 'Mobile number', prefixText: '+91  ', errorText: _error, errorMaxLines: 3),
            onSubmitted: (_) => _send(),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending…' : 'Send code')),
        ] else ...[
          Text('Enter the code', style: t.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('Sent to ${formatIndianMobile(sentTo)}', style: const TextStyle(color: Brand.muted)),
          const SizedBox(height: 24),
          TextField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            style: const TextStyle(fontSize: 24, letterSpacing: 8),
            decoration: InputDecoration(labelText: '6-digit code', errorText: _error, errorMaxLines: 3),
            onChanged: (v) {
              if (v.length == 6) _verify();
            },
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _verify, child: Text(_busy ? 'Checking…' : 'Verify')),
          TextButton(onPressed: _wait > 0 || _busy ? null : () => _send(sentTo), child: Text(_wait > 0 ? 'Resend code in $_wait s' : 'Resend code')),
          TextButton(onPressed: _busy ? null : () => setState(() { _sentTo = null; _error = null; }), child: const Text('Use a different number')),
        ],
      ]),
    );
  }
}
