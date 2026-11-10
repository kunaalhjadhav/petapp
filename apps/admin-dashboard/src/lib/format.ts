// Formatting helpers. Pure functions so they can be unit-tested.

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
const numFmt = new Intl.NumberFormat('en-IN');

export const formatDate = (iso: string | null | undefined): string =>
  iso ? dateFmt.format(new Date(iso)) : '—';
export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? dateTimeFmt.format(new Date(iso)) : '—';
export const formatNumber = (n: number): string => numFmt.format(n);

/** "just now", "5 min ago", "3 h ago", "2 days ago", then an absolute date after a week. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  if (d <= 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return formatDate(iso);
}

/** "+919812345678" → "+91 98123 45678". Other numbers are returned unchanged. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export function formatAge(months: number | null): string {
  if (months === null) return '—';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr${y === 1 ? '' : 's'}`;
}

/** "SUPPORT_AGENT" → "Support agent" */
export function humanize(key: string): string {
  const s = key.replace(/[_.]+/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Readable sentence for an audit action, e.g. "user.status" → "Changed account status". */
const ACTIONS: Record<string, string> = {
  'user.register': 'Signed up',
  'user.status': 'Changed account status',
  'user.roles': 'Changed roles',
  'user.delete_request': 'Requested account deletion',
  'admin.login': 'Signed in to admin',
  'admin.login_denied': 'Was refused admin sign-in',
  'pet.create': 'Added pet',
  'pet.delete': 'Removed pet',
  'pet.verify': 'Changed verification',
  'pet.status': 'Changed pet status',
  'species.create': 'Added species',
  'species.update': 'Edited species',
  'breed.create': 'Added breed',
  'breed.update': 'Edited breed',
  'role.create': 'Created role',
  'role.update': 'Edited role',
  'role.delete': 'Deleted role',
  'flag.update': 'Changed feature flag',
  'setting.update': 'Changed setting',
  'post.create': 'Created post',
  'post.delete': 'Deleted post',
  'moderation.resolve': 'Resolved a report',
  'moderation.auto_hide': 'Hid content automatically after reports',
  'contest.create': 'Created contest',
  'challenge.create': 'Created challenge',
  'vendor.create': 'Created a store',
  'vendor.submit': 'Submitted the store for verification',
  'vendor.approve': 'Approved the store',
  'vendor.reject': 'Asked the store for changes',
  'vendor.suspend': 'Suspended the store',
  'vendor.reinstate': 'Reinstated the store',
  'vendor.commission': 'Changed the store’s commission',
  'product.create': 'Added a product',
  'product.update': 'Edited a product',
  'product.block': 'Blocked a product',
  'product.unblock': 'Unblocked a product',
  'product_category.create': 'Added a product category',
  'product_category.update': 'Edited a product category',
  'coupon.create': 'Created a coupon',
  'coupon.update': 'Edited a coupon',
  'order.place': 'Placed an order',
  'sub_order.packed': 'Packed an order',
  'sub_order.shipped': 'Shipped an order',
  'sub_order.delivered': 'Marked an order delivered',
  'sub_order.cancel': 'Cancelled an order',
  'return.request': 'Asked for a return',
  'return.approve': 'Approved a return',
  'return.reject': 'Rejected a return',
  'return.received': 'Received a return',
  'partner.create': 'Created a partner profile',
  'partner.update': 'Edited the partner profile',
  'partner.submit': 'Submitted for verification',
  'partner.approve': 'Approved the partner',
  'partner.reject': 'Rejected the partner',
  'partner.suspend': 'Suspended the partner',
  'partner.reinstate': 'Reinstated the partner',
  'service_review.status': 'Changed a review’s visibility',
  'product_review.status': 'Changed a product review’s visibility',
  'membership.start': 'Membership started (paid)',
  'membership.grant': 'Gave a membership',
  'membership.revoke': 'Ended a membership',
  'membership.plan_create': 'Added a membership plan',
  'membership.plan_update': 'Edited a membership plan',
  'promotion.create': 'Queued a promotion',
  'promotion.cancel': 'Cancelled a promotion',
  'notifications.promotions_on': 'Turned promotions on',
  'notifications.promotions_off': 'Turned promotions off',
  'location.city_create': 'Added a city',
  'location.city_update': 'Edited a city',
  'location.city_delete': 'Deleted a city',
  'location.coverage': 'Changed service coverage',
  'location.area_create': 'Added an area',
  'location.area_update': 'Edited an area',
  'location.area_delete': 'Deleted an area',
  'location.pincode_create': 'Added a PIN code',
  'location.pincode_update': 'Edited a PIN code',
  'location.pincode_delete': 'Removed a PIN code',
  'location.import': 'Imported PIN codes and areas',
  'location.zone_create': 'Added a delivery zone',
  'location.zone_update': 'Edited a delivery zone',
  'location.zone_delete': 'Deleted a delivery zone',
  'location.partner_update': 'Corrected a partner’s location',
  'partner.commission': 'Changed the partner’s commission',
  'booking.cancel': 'Cancelled a booking',
  'booking.in_progress': 'Started a booking',
  'booking.completed': 'Completed a booking',
  'booking.no_show': 'Marked a no-show',
  'challenge.update': 'Edited challenge',
  'challenge.status': 'Changed challenge status',
  'badge.create': 'Added badge',
  'badge.update': 'Edited badge',
  'contest.update': 'Edited contest',
  'contest.transition': 'Moved contest to the next stage',
  'contest.legal_approval': 'Recorded the legal review',
  'contest.freeze': 'Froze the leaderboard',
  'contest.winners': 'Declared winners',
  'contest.special_award': 'Gave a special award',
  'contest.entry_status': 'Changed an entry’s status',
  'contest.vote_review': 'Reviewed a held vote',
  'contest_category.create': 'Added contest category',
  'contest_category.update': 'Edited contest category',
  'payment.captured': 'Payment confirmed',
  'payment.signature_invalid': 'Rejected a payment with an invalid signature',
  'payment.amount_mismatch': 'Rejected a payment with the wrong amount',
  'moderation.ai_flag': 'Flagged by AI moderation for a moderator',
  'risk.high': 'Listed for review as a high-risk account',
  'system.queue_retry': 'Retried failed background jobs',
  'home.section_create': 'Added a home screen section',
  'home.section_update': 'Changed a home screen section',
  'home.section_delete': 'Deleted a home screen section',
  'home.sections_reorder': 'Reordered the home screen',
  'home.pin_add': 'Pinned an item to a home screen section',
  'home.pin_remove': 'Unpinned an item from a home screen section',
  'risk.review': 'Reviewed the account’s risk score',
};
export const describeAction = (action: string): string => ACTIONS[action] ?? humanize(action);

export function initials(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const parts = name
    .replace(/^dr\.?\s+/i, '')
    .trim()
    .split(/\s+/);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() ||
    fallback
  );
}
