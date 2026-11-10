import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/api_client.dart';
import '../services/phone.dart';
import '../state/providers.dart';
import '../theme.dart';

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
    if (phone == null) return setState(() => _error = 'Enter a 10-digit mobile number.');
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
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const SizedBox(height: 48),
            const Icon(Icons.storefront_rounded, size: 48, color: Brand.teal),
            const SizedBox(height: 16),
            Text('PetApp for Partners', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text('Run your grooming, vet, training or pet-care business: bookings, schedule and earnings in one place.', style: TextStyle(color: Brand.muted)),
            const SizedBox(height: 32),
            TextField(
              controller: _ctrl,
              autofocus: true,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d +]')), LengthLimitingTextInputFormatter(16)],
              decoration: InputDecoration(labelText: 'Mobile number', prefixText: '+91  ', errorText: _error),
              onSubmitted: (_) => _send(),
            ),
            const SizedBox(height: 24),
            FilledButton(onPressed: _busy ? null : _send, child: Text(_busy ? 'Sending…' : 'Send code')),
          ]),
        ),
      );
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
  int _wait = 30;
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
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
      _ctrl.clear();
    } finally {
      if (mounted) setState(() => _busy = false);
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
        TextButton(
          onPressed: _wait > 0 || phone == null
              ? null
              : () async {
                  try {
                    await ref.read(authProvider.notifier).requestOtp(phone);
                    _tick();
                  } catch (e) {
                    setState(() => _error = ApiException.from(e).message);
                  }
                },
          child: Text(_wait > 0 ? 'Resend code in $_wait s' : 'Resend code'),
        ),
      ]),
    );
  }
}
