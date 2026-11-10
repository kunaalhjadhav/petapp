import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../common/widgets.dart';
import '../state/providers.dart';
import '../theme.dart';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/// Weekly opening hours (India time) and time off.
class ScheduleScreen extends ConsumerStatefulWidget {
  const ScheduleScreen({super.key});
  @override
  ConsumerState<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends ConsumerState<ScheduleScreen> {
  /// One window per day (null = closed). Partners with split shifts can add them from the web later.
  late final List<(int, int)?> _days = _fromProfile();
  bool _dirty = false;
  bool _busy = false;

  List<(int, int)?> _fromProfile() {
    final hours = ref.read(profileProvider).valueOrNull?.hours ?? const <OpeningHours>[];
    return List.generate(7, (d) {
      final h = hours.where((x) => x.weekday == d).toList();
      return h.isEmpty ? null : (h.first.opensMin, h.first.closesMin);
    });
  }

  Future<int?> _pick(int minutes) async {
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: minutes ~/ 60, minute: minutes % 60));
    return t == null ? null : t.hour * 60 + t.minute;
  }

  Future<void> _save() async {
    final hours = [for (var d = 0; d < 7; d++) if (_days[d] != null) OpeningHours(weekday: d, opensMin: _days[d]!.$1, closesMin: _days[d]!.$2)];
    if (hours.any((h) => h.closesMin <= h.opensMin)) return showMessage(context, 'Closing time must be after opening time.');
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).setHours(hours);
      ref.invalidate(profileProvider);
      setState(() => _dirty = false);
      if (mounted) showMessage(context, 'Hours saved');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addTimeOff() async {
    final now = DateTime.now();
    final range = await showDateRangePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 365)), helpText: 'Days you’re closed');
    if (range == null || !mounted) return;
    final reason = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reason (optional)'),
        content: TextField(controller: reason, maxLength: 200, decoration: const InputDecoration(hintText: 'e.g. Diwali holidays')),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add'))],
      ),
    );
    if (ok != true) return;
    try {
      // Whole days in the phone's local time (India for our partners): start of the first day to end of the last.
      final from = DateTime(range.start.year, range.start.month, range.start.day);
      final to = DateTime(range.end.year, range.end.month, range.end.day).add(const Duration(days: 1));
      await ref.read(apiProvider).addTimeOff(from, to, reason.text.trim().isEmpty ? null : reason.text.trim());
      ref.invalidate(profileProvider);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final timeOff = ref.watch(profileProvider).valueOrNull?.timeOff ?? const <TimeOff>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Hours and time off'), actions: [if (_dirty) TextButton(onPressed: _busy ? null : _save, child: const Text('Save'))]),
      body: ListView(children: [
        const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text('Opening hours', style: TextStyle(fontWeight: FontWeight.w700))),
        for (var d = 0; d < 7; d++)
          ListTile(
            title: Text(weekdays[d]),
            subtitle: Text(_days[d] == null ? 'Closed' : '${clock(_days[d]!.$1)} – ${clock(_days[d]!.$2)}'),
            onTap: _days[d] == null
                ? null
                : () async {
                    final open = await _pick(_days[d]!.$1);
                    if (open == null) return;
                    final close = await _pick(_days[d]!.$2);
                    if (close == null) return;
                    setState(() {
                      _days[d] = (open, close);
                      _dirty = true;
                    });
                  },
            trailing: Switch(
              value: _days[d] != null,
              onChanged: (on) => setState(() {
                _days[d] = on ? (9 * 60, 18 * 60) : null;
                _dirty = true;
              }),
            ),
          ),
        if (_dirty) Padding(padding: const EdgeInsets.all(16), child: FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'Saving…' : 'Save hours'))),
        const Divider(),
        ListTile(
          title: const Text('Time off', style: TextStyle(fontWeight: FontWeight.w700)),
          subtitle: const Text('Customers can’t book you on these days. Existing bookings stay; cancel them from Bookings if needed.'),
          trailing: IconButton(tooltip: 'Add time off', icon: const Icon(Icons.add), onPressed: _addTimeOff),
        ),
        if (timeOff.isEmpty) const ListTile(title: Text('None planned', style: TextStyle(color: Brand.muted))),
        for (final t in timeOff)
          ListTile(
            leading: const Icon(Icons.event_busy_outlined),
            title: Text('${when(t.startsAt)} → ${when(t.endsAt)}'),
            subtitle: t.reason == null ? null : Text(t.reason!),
            trailing: IconButton(
              tooltip: 'Remove',
              icon: const Icon(Icons.delete_outline),
              onPressed: () async {
                try {
                  await ref.read(apiProvider).removeTimeOff(t.id);
                  ref.invalidate(profileProvider);
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              },
            ),
          ),
      ]),
    );
  }
}
