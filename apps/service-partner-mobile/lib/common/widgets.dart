import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../theme.dart';

/// ₹ with Indian grouping: 84900 → ₹849, 7216500 → ₹72,165, 12735 → ₹127.35.
String rupees(int paise) {
  final neg = paise < 0;
  final a = paise.abs();
  final r = (a ~/ 100).toString();
  final p = a % 100;
  final head = r.length > 3 ? r.substring(0, r.length - 3) : '';
  final tail = r.length > 3 ? r.substring(r.length - 3) : r;
  final grouped = head.isEmpty ? tail : '${head.replaceAllMapped(RegExp(r'\B(?=(\d{2})+(?!\d))'), (m) => ',')},$tail';
  return '${neg ? '−' : ''}₹$grouped${p == 0 ? '' : '.${p.toString().padLeft(2, '0')}'}';
}

/// 1500 → "15%", 1250 → "12.5%".
String percent(int bps) => '${(bps / 100).toStringAsFixed(bps % 100 == 0 ? 0 : (bps % 10 == 0 ? 1 : 2))}%';

/// Minutes after midnight → "9:00 am".
String clock(int minutes) {
  final h = minutes ~/ 60 % 24;
  final m = minutes % 60;
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${m.toString().padLeft(2, '0')} ${h < 12 ? 'am' : 'pm'}';
}

/// Local (India) date and time for a booking.
String when(DateTime t) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final l = t.toLocal();
  return '${days[l.weekday - 1]} ${l.day} ${months[l.month - 1]}, ${clock(l.hour * 60 + l.minute)}';
}

/// "10 Oct" (and the year when it isn't this year).
String day(DateTime t) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  final l = t.toLocal();
  return '${l.day} ${months[l.month - 1]}${l.year == DateTime.now().year ? '' : ' ${l.year}'}';
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    final e = ApiException.from(error);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(e.isOffline ? Icons.wifi_off_rounded : Icons.error_outline_rounded, size: 40, color: Brand.muted),
          const SizedBox(height: 12),
          Text(e.message, textAlign: TextAlign.center),
          if (onRetry != null) ...[const SizedBox(height: 16), OutlinedButton(onPressed: onRetry, child: const Text('Try again'))],
        ]),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.title, this.message, this.action});
  final String title;
  final String? message;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
            if (message != null) ...[const SizedBox(height: 6), Text(message!, textAlign: TextAlign.center, style: const TextStyle(color: Brand.muted))],
            if (action != null) ...[const SizedBox(height: 16), action!],
          ]),
        ),
      );
}

/// Shows the API's message, including its list of reasons ("Add at least one service." …).
void showError(BuildContext context, Object e) {
  final x = ApiException.from(e);
  final text = x.fields.isEmpty ? x.message : '${x.message}\n• ${x.fields.join('\n• ')}';
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

void showMessage(BuildContext context, String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
