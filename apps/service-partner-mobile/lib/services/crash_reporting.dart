import 'dart:async';

import 'package:sentry_flutter/sentry_flutter.dart';

/// Crash and error reports go to Sentry (or a compatible service such as GlitchTip) when the app is built with
/// --dart-define=SENTRY_DSN=… (and APP_ENV=staging|production). Without a DSN nothing is sent.
const sentryDsn = String.fromEnvironment('SENTRY_DSN');
const appEnvironment = String.fromEnvironment('APP_ENV', defaultValue: 'development');

/// Starts the app, with crash reporting when it's configured. Reports carry no personal data: no IP address or user
/// details, no screenshots, no request bodies, and phone numbers, emails and tokens are masked in messages.
Future<void> runWithCrashReporting({required String app, required String version, required FutureOr<void> Function() run}) async {
  if (sentryDsn.isEmpty) {
    await run();
    return;
  }
  await SentryFlutter.init(
    (o) {
      o.dsn = sentryDsn;
      o.environment = appEnvironment;
      o.release = '$app@$version';
      o.sendDefaultPii = false;
      o.attachScreenshot = false;
      o.attachViewHierarchy = false;
      o.tracesSampleRate = 0;
      o.maxBreadcrumbs = 40;
      o.beforeSend = (event, hint) => scrubEvent(event);
      o.beforeBreadcrumb = (crumb, hint) => crumb?.copyWith(message: crumb.message == null ? null : scrubText(crumb.message!));
    },
    appRunner: run,
  );
}

SentryEvent scrubEvent(SentryEvent e) {
  final m = e.message;
  return m == null ? e : e.copyWith(message: SentryMessage(scrubText(m.formatted)));
}

/// Masks things that identify a person or open their account. Pure, unit-tested.
String scrubText(String s) => s
    .replaceAll(RegExp(r'Bearer\s+[A-Za-z0-9\-_.]+', caseSensitive: false), 'Bearer [token]')
    .replaceAll(RegExp(r'eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+'), '[token]')
    .replaceAll(RegExp(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'), '[email]')
    .replaceAll(RegExp(r'(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}'), '[phone]');
