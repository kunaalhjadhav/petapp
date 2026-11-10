import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../chat/chat_screens.dart';
import '../../config_share.dart';
import '../../api/models.dart';
import '../../common/widgets.dart';
import '../../services/location_service.dart';
import '../../services/payment_service.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../../common/share_button.dart';
import '../contests/contest_screens.dart' show rupees;
import '../home/place.dart';
import '../reviews/review_widgets.dart';
import '../reviews/reviews_logic.dart';
import '../safety/report_screen.dart';

// ── India time helpers (bookings are always shown in the partner's time zone) ──
const _ist = Duration(hours: 5, minutes: 30);
DateTime toIst(DateTime t) => t.toUtc().add(_ist);
String istDate(DateTime t) {
  final d = toIst(t);
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String istTime(DateTime t) {
  final d = toIst(t);
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
}

const _weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
String istDayLabel(DateTime t) {
  final d = toIst(t);
  return '${_weekdays[d.weekday % 7]} ${d.day} ${_months[d.month - 1]}';
}

const bookingStatusLabels = {
  'PENDING_PAYMENT': 'Waiting for payment',
  'CONFIRMED': 'Confirmed',
  'IN_PROGRESS': 'In progress',
  'COMPLETED': 'Completed',
  'CANCELLED': 'Cancelled',
  'NO_SHOW': 'Missed',
  'EXPIRED': 'Expired (not paid)',
};

final _categoriesProvider = FutureProvider.autoDispose<List<ServiceCategory>>((ref) => ref.watch(apiProvider).serviceCategories());

/// Whether services operate where the person is looking (Locations → Service coverage).
final _coverageProvider = FutureProvider.autoDispose.family<Coverage?, ({double lat, double lng})>((ref, at) async {
  try {
    return await ref.watch(apiProvider).coverage(at.lat, at.lng);
  } catch (_) {
    return null; // a failed check never hides services
  }
});
final _partnerProvider = FutureProvider.autoDispose.family<PartnerPage, String>((ref, id) => ref.watch(apiProvider).servicePartner(id));
final _bookingsProvider = FutureProvider.autoDispose.family<List<BookingView>, String>((ref, when) => ref.watch(apiProvider).myBookings(when: when));
final _bookingProvider = FutureProvider.autoDispose.family<BookingView, String>((ref, id) => ref.watch(apiProvider).booking(id));


class ServicesScreen extends ConsumerStatefulWidget {
  const ServicesScreen({super.key});
  @override
  ConsumerState<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends ConsumerState<ServicesScreen> {
  String? _categoryId;
  bool _homeVisit = false;
  Future<List<NearbyPartner>>? _results;
  bool _locating = true;

  @override
  void initState() {
    super.initState();
    _locate();
  }

  Future<void> _locate() async {
    await locateOnce(ref);
    if (mounted) setState(() => _locating = false);
    _search();
  }

  void _search() {
    final place = ref.read(searchPlaceProvider);
    if (place == null) return;
    setState(() => _results = ref.read(apiProvider).nearby(lat: place.at.lat, lng: place.at.lng, categoryId: _categoryId, mode: _homeVisit ? 'AT_HOME' : null));
  }

  Future<void> _pickCity() async {
    if (await pickPlace(context, ref)) _search();
  }

  @override
  Widget build(BuildContext context) {
    final place = ref.watch(searchPlaceProvider);
    final cats = ref.watch(_categoriesProvider).valueOrNull ?? const <ServiceCategory>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Pet services'), actions: [
        IconButton(tooltip: 'My bookings', icon: const Icon(Icons.event_note_outlined), onPressed: () => context.push('/my-bookings')),
      ]),
      body: Column(children: [
        ListTile(
          leading: const Icon(Icons.place_outlined, color: Brand.teal),
          title: Text(place?.label ?? (_locating ? 'Finding you…' : 'Choose where')),
          trailing: TextButton(onPressed: _pickCity, child: const Text('Change')),
        ),
        if (place != null)
          if (ref.watch(_coverageProvider((lat: place.at.lat, lng: place.at.lng))).valueOrNull case final c? when !c.covered)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFFF4E0), borderRadius: BorderRadius.circular(10)),
              child: Text(
                'PetApp services aren’t in ${cityOfLabel(place.label) == null ? 'your area' : place.label} yet.${c.nearestName != null ? ' The nearest city with services is ${c.nearestName} (${c.nearestKm?.round()} km).' : ''}',
              ),
            ),
        SizedBox(
          height: 44,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(label: const Text('All'), selected: _categoryId == null, onSelected: (_) {
                _categoryId = null;
                _search();
              }),
            ),
            for (final c in cats)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(label: Text(c.name), selected: _categoryId == c.id, onSelected: (_) {
                  _categoryId = c.id;
                  _search();
                }),
              ),
          ]),
        ),
        SwitchListTile(
          dense: true,
          title: const Text('Comes to my home'),
          value: _homeVisit,
          onChanged: (v) {
            _homeVisit = v;
            _search();
          },
        ),
        const Divider(height: 1),
        Expanded(
          child: place == null
              ? (_locating
                  ? const LoadingView()
                  : EmptyView(title: 'Where should we look?', message: 'Allow location, or pick your city.', action: OutlinedButton(onPressed: _pickCity, child: const Text('Choose a city'))))
              : FutureBuilder<List<NearbyPartner>>(
                  future: _results,
                  builder: (ctx, snap) {
                    if (snap.connectionState != ConnectionState.done) return const LoadingView();
                    if (snap.hasError) return ErrorView(error: snap.error!, onRetry: _search);
                    final list = snap.data ?? const <NearbyPartner>[];
                    if (list.isEmpty) return const EmptyView(title: 'No services found nearby', message: 'Try another category, or turn off “Comes to my home”.');
                    return ListView.separated(
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (ctx, i) {
                        final p = list[i];
                        return ListTile(
                          title: Text(p.businessName, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text([
                            '${p.distanceKm.toStringAsFixed(1)} km',
                            [p.area, p.city].whereType<String>().join(', '),
                            if (p.ratingCount > 0) '★ ${p.ratingAvg.toStringAsFixed(1)} (${p.ratingCount})' else 'New',
                          ].where((s) => s.isNotEmpty).join(' · ')),
                          trailing: Text('from ${rupees(p.fromPaise)}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          onTap: () => context.push('/service-partner/${p.id}'),
                        );
                      },
                    );
                  },
                ),
        ),
      ]),
    );
  }
}

class ServicePartnerScreen extends ConsumerWidget {
  const ServicePartnerScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final partner = ref.watch(_partnerProvider(id));
    return Scaffold(
      appBar: AppBar(actions: [
        if (ref.watch(chatEnabledProvider) && partner.valueOrNull != null)
          IconButton(tooltip: 'Message', icon: const Icon(Icons.chat_bubble_outline), onPressed: () => openChat(context, ref, partnerId: id)),
        if (partner.valueOrNull case final p?) ShareButton(kind: ShareKind.service, linkKey: p.id, text: '${p.businessName} on PetApp'),
        if (partner.valueOrNull case final p?)
          PopupMenuButton<String>(
            tooltip: 'More',
            onSelected: (_) => reportContent(context, 'SERVICE_PARTNER', p.id, 'business'),
            itemBuilder: (_) => const [PopupMenuItem(value: 'report', child: Text('Report this business'))],
          ),
      ]),
      body: partner.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_partnerProvider(id))),
        data: (p) {
          return ListView(padding: const EdgeInsets.all(16), children: [
            Text(p.businessName, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text([
              [p.area, p.city].whereType<String>().join(', '),
              if (p.ratingCount > 0) ratingLine(p.ratingAvg, p.ratingCount) else 'New on PetApp',
            ].where((s) => s.isNotEmpty).join(' · '), style: const TextStyle(color: Brand.muted)),
            if (p.about != null) ...[const SizedBox(height: 12), Text(p.about!)],
            const SizedBox(height: 16),
            const Text('Services', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            for (final s in p.services)
              Card(
                elevation: 0,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Brand.line)),
                child: ListTile(
                  title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text([
                    '${s.durationMin} min',
                    if (s.atCenter) 'at the centre',
                    if (s.atHome) 'home visit (within ${p.homeVisitRadiusKm} km)',
                    if (s.description != null) s.description!,
                  ].join(' · ')),
                  trailing: FilledButton(
                    style: FilledButton.styleFrom(minimumSize: const Size(72, 36)),
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => BookServiceScreen(partner: p, service: s))),
                    child: Text(rupees(s.pricePaise)),
                  ),
                ),
              ),
            if (p.addressLine != null) ...[
              const SizedBox(height: 12),
              ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.storefront_outlined), title: Text([p.addressLine, p.area, p.city].whereType<String>().join(', '))),
            ],
            if (p.hours.isNotEmpty) _Hours(hours: p.hours),
            const SizedBox(height: 12),
            ReviewsSection(subject: ReviewSubject.partner, id: p.id, title: p.businessName, summary: p.ratingSummary, recent: p.reviews, count: p.ratingCount),
          ]);
        },
      ),
    );
  }
}

class _Hours extends StatelessWidget {
  const _Hours({required this.hours});
  final List<({int weekday, int opensMin, int closesMin})> hours;
  String _t(int m) {
    final h = m ~/ 60;
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return '$h12:${(m % 60).toString().padLeft(2, '0')} ${h < 12 || h == 24 ? 'am' : 'pm'}';
  }

  @override
  Widget build(BuildContext context) => ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: const Text('Opening hours'),
        children: [
          for (var d = 0; d < 7; d++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(children: [
                SizedBox(width: 48, child: Text(_weekdays[d])),
                Text(hours.where((h) => h.weekday == d).map((h) => '${_t(h.opensMin)}–${_t(h.closesMin)}').join(', ').ifEmpty('Closed')),
              ]),
            ),
        ],
      );
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// Pick a day and time, a pet and where; then pay. The slot is held for a few minutes while paying.
class BookServiceScreen extends ConsumerStatefulWidget {
  const BookServiceScreen({super.key, required this.partner, required this.service});
  final PartnerPage partner;
  final ServiceOffer service;
  @override
  ConsumerState<BookServiceScreen> createState() => _BookServiceScreenState();
}

class _BookServiceScreenState extends ConsumerState<BookServiceScreen> {
  late final List<DateTime> _days = List.generate(14, (i) => DateTime.now().toUtc().add(Duration(days: i)));
  int _day = 0;
  Slot? _slot;
  String? _petId;
  late String _mode = widget.service.atCenter ? 'AT_CENTER' : 'AT_HOME';
  final _address = TextEditingController();
  Future<SlotDay>? _slots;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _slot = null;
    _slots = ref.read(apiProvider).slots(widget.service.id, istDate(_days[_day]));
  }

  @override
  void dispose() {
    _address.dispose();
    super.dispose();
  }

  Future<void> _book() async {
    final slot = _slot;
    final pet = _petId;
    if (slot == null || pet == null) return;
    ({String line, double lat, double lng})? address;
    if (_mode == 'AT_HOME') {
      final at = await currentPosition() ?? ref.read(searchPlaceProvider)?.at;
      if (_address.text.trim().length < 5) {
        if (mounted) showMessage(context, 'Add your address for the home visit.');
        return;
      }
      if (at == null) {
        if (mounted) showMessage(context, 'We need your location to check the partner can reach you.');
        return;
      }
      address = (line: _address.text.trim(), lat: at.lat, lng: at.lng);
    }
    setState(() => _busy = true);
    final api = ref.read(apiProvider);
    try {
      final b = await api.book(serviceId: widget.service.id, petId: pet, startsAt: slot.startsAt, mode: _mode, address: address);
      if (b.payment != null) await PaymentService(api).pay(b.payment!, description: '${widget.service.name} · ${widget.partner.businessName}');
      if (!mounted) return;
      ref.invalidate(_bookingsProvider('upcoming'));
      context.pushReplacement('/booking/${b.id}');
      showMessage(context, 'Booked! Your code is ${b.code}.');
    } on PaymentCancelled catch (e) {
      if (mounted) showMessage(context, '${e.message} Your slot is held for a few minutes; finish paying from My bookings.');
    } on PaymentPending catch (e) {
      if (mounted) showMessage(context, e.message);
    } catch (e) {
      if (mounted) {
        showError(context, e);
        setState(_load); // the slot may have just been taken
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.service;
    final pets = ref.watch(myPetsProvider).valueOrNull ?? const <Pet>[];
    return Scaffold(
      appBar: AppBar(title: Text(s.name)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('${widget.partner.businessName} · ${s.durationMin} min · ${rupees(s.pricePaise)}', style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 16),
        SizedBox(
          height: 64,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _days.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (ctx, i) => ChoiceChip(
              label: Text(i == 0 ? 'Today' : i == 1 ? 'Tomorrow' : istDayLabel(_days[i])),
              selected: i == _day,
              onSelected: (_) => setState(() {
                _day = i;
                _load();
              }),
            ),
          ),
        ),
        FutureBuilder<SlotDay>(
          future: _slots,
          builder: (ctx, snap) {
            if (snap.connectionState != ConnectionState.done) return const LoadingView();
            if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => setState(_load));
            final slots = snap.data!.slots;
            if (slots.isEmpty) return const Padding(padding: EdgeInsets.all(16), child: Text('No times left on this day. Try another day.', style: TextStyle(color: Brand.muted)));
            return Wrap(spacing: 8, runSpacing: 8, children: [
              for (final sl in slots)
                ChoiceChip(label: Text(istTime(sl.startsAt)), selected: _slot == sl, onSelected: (_) => setState(() => _slot = sl)),
            ]);
          },
        ),
        const SizedBox(height: 20),
        const Text('Who’s it for?', style: TextStyle(fontWeight: FontWeight.w700)),
        if (pets.isEmpty) TextButton(onPressed: () => context.push('/pets/new'), child: const Text('Add your pet first')),
        Wrap(spacing: 8, children: [
          for (final p in pets)
            // Pets of a species this service doesn't take are shown, but can't be chosen.
            Builder(builder: (_) {
              final ok = s.speciesIds.isEmpty || (p.speciesId != null && s.speciesIds.contains(p.speciesId));
              return ChoiceChip(
                label: Text(ok ? p.name : '${p.name} (not offered for ${p.speciesName.toLowerCase()}s)'),
                selected: _petId == p.id,
                onSelected: ok ? (_) => setState(() => _petId = p.id) : null,
              );
            }),
        ]),
        if (s.atCenter && s.atHome) ...[
          const SizedBox(height: 16),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'AT_CENTER', label: Text('At the centre')), ButtonSegment(value: 'AT_HOME', label: Text('At my home'))],
            selected: {_mode},
            showSelectedIcon: false,
            onSelectionChanged: (v) => setState(() => _mode = v.first),
          ),
        ],
        if (_mode == 'AT_HOME') ...[
          const SizedBox(height: 12),
          TextField(controller: _address, maxLength: 300, minLines: 2, maxLines: 3, decoration: InputDecoration(labelText: 'Your address', helperText: 'They visit within ${widget.partner.homeVisitRadiusKm} km. We use your location to check.')),
        ],
        const SizedBox(height: 16),
        const Text('Cancel early for a full refund. Late cancellations get a partial refund; after the start time, none.', style: TextStyle(color: Brand.muted, fontSize: 12)),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy || _slot == null || _petId == null ? null : _book,
          child: Text(_busy ? 'Please wait…' : _slot == null ? 'Choose a time' : 'Book ${istTime(_slot!.startsAt)} · Pay ${rupees(s.pricePaise)}'),
        ),
      ]),
    );
  }
}

class MyBookingsScreen extends StatelessWidget {
  const MyBookingsScreen({super.key});
  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 2,
        child: Scaffold(
          appBar: AppBar(title: const Text('My bookings'), bottom: const TabBar(tabs: [Tab(text: 'Upcoming'), Tab(text: 'Past')])),
          body: const TabBarView(children: [_BookingList(when: 'upcoming'), _BookingList(when: 'past')]),
        ),
      );
}

class _BookingList extends ConsumerWidget {
  const _BookingList({required this.when});
  final String when;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref.watch(_bookingsProvider(when)).when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_bookingsProvider(when))),
        data: (list) => list.isEmpty
            ? EmptyView(title: when == 'upcoming' ? 'Nothing booked' : 'No past bookings', action: when == 'upcoming' ? OutlinedButton(onPressed: () => context.push('/services'), child: const Text('Find a service')) : null)
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(_bookingsProvider(when)),
                child: ListView.separated(
                  itemCount: list.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (ctx, i) {
                    final b = list[i];
                    return ListTile(
                      title: Text('${b.serviceName} · ${b.petName}'),
                      subtitle: Text('${istDayLabel(b.startsAt)}, ${istTime(b.startsAt)} · ${b.partnerName}'),
                      trailing: Text(bookingStatusLabels[b.status] ?? b.status, style: TextStyle(color: b.status == 'CONFIRMED' ? Brand.teal : Brand.muted)),
                      onTap: () => context.push('/booking/${b.id}'),
                    );
                  },
                ),
              ),
      );
}

class BookingScreen extends ConsumerStatefulWidget {
  const BookingScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends ConsumerState<BookingScreen> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } on PaymentCancelled catch (e) {
      if (mounted) showMessage(context, e.message);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      ref.invalidate(_bookingProvider(widget.id));
      ref.invalidate(_bookingsProvider('upcoming'));
      ref.invalidate(_bookingsProvider('past'));
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(BookingView b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this booking?'),
        content: Text(b.status == 'PENDING_PAYMENT'
            ? 'You haven’t paid yet, so nothing is charged.'
            : 'Your refund depends on how early you cancel. Cancelling well ahead gets a full refund; close to the time, a partial one.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel booking'))],
      ),
    );
    if (ok != true) return;
    await _run(() async {
      final r = await ref.read(apiProvider).cancelBooking(b.id);
      if (mounted) showMessage(context, r.refundPaise != null && r.refundPaise! > 0 ? 'Cancelled. ${rupees(r.refundPaise!)} will be refunded.' : 'Cancelled.');
    });
  }

  Future<void> _review(BookingView b) async {
    final posted = await writeReview(
      context,
      title: 'Rate your visit',
      subtitle: 'How was ${b.serviceName} for ${b.petName} at ${b.partnerName}?',
      submit: (rating, comment, photoIds) => ref.read(apiProvider).reviewBooking(b.id, rating, comment: comment, photoIds: photoIds),
    );
    if (posted) {
      ref.invalidate(_bookingProvider(widget.id));
      ref.invalidate(_partnerProvider(b.partnerId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final booking = ref.watch(_bookingProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Booking')),
      body: booking.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_bookingProvider(widget.id))),
        data: (b) => ListView(padding: const EdgeInsets.all(16), children: [
          Text(b.code, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 1)),
          const Text('Show or read this code to the partner.', style: TextStyle(color: Brand.muted)),
          const SizedBox(height: 12),
          Chip(label: Text(bookingStatusLabels[b.status] ?? b.status)),
          ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.schedule), title: Text('${istDayLabel(b.startsAt)}, ${istTime(b.startsAt)}'), subtitle: const Text('India time')),
          ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.pets), title: Text('${b.serviceName} for ${b.petName}'), trailing: Text(rupees(b.pricePaise))),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(b.mode == 'AT_HOME' ? Icons.home_outlined : Icons.storefront_outlined),
            title: Text(b.partnerName),
            subtitle: Text(b.mode == 'AT_HOME' ? 'Home visit: ${b.addressLine ?? ''}' : (b.partnerAddress ?? '')),
            onTap: () => context.push('/service-partner/${b.partnerId}'),
          ),
          if (b.partnerPhone != null && b.status == 'CONFIRMED') ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.call_outlined), title: Text(b.partnerPhone!)),
          if (b.cancelReason != null) Text('Cancelled${b.cancelledBy != null ? ' by ${b.cancelledBy!.toLowerCase()}' : ''}: ${b.cancelReason}', style: const TextStyle(color: Brand.heart)),
          if (b.refundPaise != null && b.refundPaise! > 0) Text('Refund: ${rupees(b.refundPaise!)}', style: const TextStyle(fontWeight: FontWeight.w600)),
          if (b.review != null) ...[
            const SizedBox(height: 8),
            const Text('Your review', style: TextStyle(fontWeight: FontWeight.w600)),
            ReviewCard(review: b.review!, subject: ReviewSubject.partner, showReport: false),
          ] else if (b.reviewRating != null)
            Text('You rated this ${starsText(b.reviewRating!)}'),
          const SizedBox(height: 16),
          if (b.status == 'PENDING_PAYMENT' && b.payment != null)
            FilledButton(onPressed: _busy ? null : () => _run(() => PaymentService(ref.read(apiProvider)).pay(b.payment!, description: '${b.serviceName} · ${b.partnerName}')), child: Text('Pay ${rupees(b.pricePaise)}')),
          if (b.canReview) FilledButton(onPressed: _busy ? null : () => _review(b), child: const Text('Rate this visit')),
          if (b.canCancel) TextButton(onPressed: _busy ? null : () => _cancel(b), child: const Text('Cancel booking')),
          const Divider(height: 32),
          if (ref.watch(chatEnabledProvider))
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.chat_bubble_outline, color: Brand.teal),
              title: Text('Message ${b.partnerName}'),
              onTap: () => openChat(context, ref, bookingId: b.id),
            ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.help_outline, color: Brand.teal),
            title: const Text('Get help with this booking'),
            onTap: () => context.push('/help/new?ref=BOOKING&refId=${b.id}&label=${Uri.encodeComponent('booking ${b.code}')}'),
          ),
        ]),
      ),
    );
  }
}
