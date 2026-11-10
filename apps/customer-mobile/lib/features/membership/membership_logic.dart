import '../../api/models.dart';
import '../../common/money_text.dart';
import '../contests/contest_screens.dart' show rupees;

// Pure helpers for the membership screen (Phase 9d, spec §40). Mirrored in scripts/check_membership_mirrors.py.

/// "₹149 for 30 days", "₹1,499 a year", "₹399 a month", or "Free".
String planPrice(MembershipPlan p) {
  if (p.isFree) return 'Free';
  final period = switch (p.periodDays) {
    30 || 31 => 'a month',
    365 || 366 => 'a year',
    7 => 'a week',
    _ => 'for ${p.periodDays} days',
  };
  return '${rupees(p.pricePaise)} $period';
}

/// The line at the top of the screen: what the person has now.
String membershipHeadline(MyMembership m, [DateTime? now]) {
  final c = m.current;
  if (c == null) return 'You’re on the Free plan';
  final until = m.upcoming.isNotEmpty ? m.upcoming.last.endsAt : c.endsAt;
  final renewed = m.upcoming.isNotEmpty ? ', renewed' : '';
  return '${c.plan.name}$renewed until ${until == null ? '—' : shortDate(until, now)}';
}

/// What a plan's button does for this person, or null for no button (the Free plan).
/// `enabled` false: shown, but greyed out, with the reason as its label.
({String label, bool enabled})? planAction(MembershipPlan p, MyMembership m, {int maxPeriodsAhead = 2, DateTime? now}) {
  if (p.isFree) return null;
  final c = m.current;
  if (c == null) return (label: 'Join ${p.name} · ${rupees(p.pricePaise)}', enabled: true);
  if (c.plan.id != p.id) {
    final end = m.upcoming.isNotEmpty ? m.upcoming.last.endsAt : c.endsAt;
    return (label: 'Available after ${end == null ? 'your plan ends' : shortDate(end, now)}', enabled: false);
  }
  if (m.upcoming.length >= maxPeriodsAhead) return (label: 'Renewed', enabled: false);
  return (label: 'Renew · ${rupees(p.pricePaise)}', enabled: true);
}
