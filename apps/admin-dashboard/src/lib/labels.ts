// Plain-language names shared by several screens.

export const FLAG_LABELS: Record<string, { name: string; about: string; phase: string }> = {
  ENABLE_REELS: {
    name: 'Reels and posts',
    about: 'Photo and video posts, the feed and reels.',
    phase: 'Phase 2',
  },
  ENABLE_CHAT: {
    name: 'In-app chat',
    about: 'Messages between customers, partners and support.',
    phase: 'Phase 2',
  },
  ENABLE_CONTESTS: {
    name: 'Contests',
    about: 'Contest listings, registration and entries.',
    phase: 'Phase 3',
  },
  ENABLE_PUBLIC_VOTING: {
    name: 'Public voting',
    about: 'Let app users vote on contest entries.',
    phase: 'Phase 3',
  },
  ENABLE_PAID_VOTING: {
    name: 'Paid votes',
    about: 'Votes that cost money. Needs legal review before it is switched on.',
    phase: 'Phase 3',
  },
  ENABLE_SERVICES: {
    name: 'Services marketplace',
    about: 'Groomers, vets, boarding and other bookable services.',
    phase: 'Phase 4',
  },
  ENABLE_MARKETPLACE: {
    name: 'Product shop',
    about: 'Food, toys and accessories from vendors.',
    phase: 'Phase 5',
  },
  ENABLE_AI_ASSISTANT: {
    name: 'PetApp Assistant',
    about: 'AI help for finding services, products and contests.',
    phase: 'Phase 7',
  },
  ENABLE_MEMBERSHIPS: {
    name: 'Memberships',
    about: 'Paid membership plans with benefits. Nothing is members-only unless you mark it.',
    phase: 'Phase 9',
  },
};

export const SETTING_LABELS: Record<
  string,
  { name: string; kind: 'number' | 'string'; suffix?: string }
> = {
  'app.name': { name: 'App name', kind: 'string' },
  'app.supportEmail': { name: 'Support email', kind: 'string' },
  'app.currency': { name: 'Currency', kind: 'string' },
  'pets.maxPerUser': { name: 'Pets per account', kind: 'number', suffix: 'pets' },
  'pets.maxVaccinationsPerPet': {
    name: 'Vaccination records per pet',
    kind: 'number',
    suffix: 'records',
  },
};

export const MODULE_LABELS: Record<string, string> = {
  users: 'People',
  pets: 'Pets',
  rbac: 'Roles and access',
  platform: 'Platform',
  content: 'Content moderation',
  contests: 'Contests',
};

export const REASON_LABELS: Record<string, string> = {
  SPAM: 'Spam',
  ABUSE: 'Abuse or harassment',
  ANIMAL_WELFARE: 'Animal welfare',
  NUDITY: 'Nudity',
  VIOLENCE: 'Violence',
  MISINFORMATION: 'Misinformation',
  IMPERSONATION: 'Impersonation',
  OTHER: 'Other',
};

export const TARGET_LABELS: Record<string, string> = {
  POST: 'Post',
  COMMENT: 'Comment',
  PET: 'Pet profile',
  USER: 'Person',
  PRODUCT: 'Product listing',
  SERVICE_REVIEW: 'Service review',
  CONTEST_ENTRY: 'Contest entry',
  CHAT_MESSAGE: 'Chat message',
  SERVICE_PARTNER: 'Service business',
  PRODUCT_REVIEW: 'Product review',
};

/** The plural, for filters ("Product reviews"). */
export const targetPlural = (t: string) => {
  const l = TARGET_LABELS[t] ?? t;
  if (l === 'Person') return 'People';
  if (l.endsWith('ss')) return `${l}es`;
  return l.endsWith('s') ? l : `${l}s`;
};

export const REPORT_STATUS: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' }> = {
  OPEN: { label: 'Open', tone: 'warn' },
  ACTIONED: { label: 'Action taken', tone: 'good' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
};

/** 4 → "★★★★☆". */
export const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));

/** What AI moderation can say about something (Phase 7a). */
export const AI_LABELS: Record<string, string> = {
  SPAM: 'Spam',
  UNSAFE: 'Unsafe',
  ABUSE: 'Abusive',
  INAPPROPRIATE: 'Inappropriate',
  FAKE_PROFILE: 'Fake profile',
  DUPLICATE: 'Copied photo or text',
  SUSPICIOUS_ENTRY: 'Suspicious entry',
};

/** 0.874 → "87%". */
export const confidence = (score: number) => `${Math.round(score * 100)}%`;

/** Account risk signals in plain words (the API also sends a detail sentence). */
export const RISK_SIGNALS: Record<string, string> = {
  new_account: 'New account',
  unverified_phone: 'Phone not verified',
  shared_network: 'Shared network',
  held_votes: 'Held votes',
  vote_burst: 'Many votes',
  payment_anomaly: 'Payment problems',
  copied_photos: 'Copied photos',
  ai_flags: 'AI flags',
  open_cases: 'Open cases',
};

export const RESOLUTION_LABELS: Record<string, string> = {
  DISMISSED: 'Dismissed',
  CONTENT_HIDDEN: 'Content hidden',
  CONTENT_REMOVED: 'Content removed',
  USER_SUSPENDED: 'Account suspended',
};

export const PARTNER_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' }
> = {
  DRAFT: { label: 'Not submitted', tone: 'neutral' },
  SUBMITTED: { label: 'Waiting for review', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'good' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
};

export const BOOKING_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'danger' }
> = {
  PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'warn' },
  CONFIRMED: { label: 'Confirmed', tone: 'good' },
  IN_PROGRESS: { label: 'In progress', tone: 'good' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  NO_SHOW: { label: 'No-show', tone: 'danger' },
  EXPIRED: { label: 'Expired (unpaid)', tone: 'neutral' },
};

export const DOC_KIND: Record<string, string> = {
  ID_PROOF: 'ID proof',
  ADDRESS_PROOF: 'Address proof',
  BUSINESS_REGISTRATION: 'Business registration',
  GST_CERTIFICATE: 'GST certificate',
  PROFESSIONAL_LICENSE: 'Professional licence',
  OTHER: 'Other document',
};

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** 540 → "9:00 am" */
export function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 || h === 24 ? 'am' : 'pm'}`;
}

/** 1500 basis points → "15%" */
export const bpsToPct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BLOCKED: 'Blocked',
  PENDING_DELETION: 'Deletion requested',
  DELETED: 'Deleted',
  HIDDEN: 'Hidden',
  REMOVED: 'Removed',
  PUBLISHED: 'Published',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  VISIBLE: 'Visible',
};

/** Home screen section kinds: what each shows and how it fills itself. */
export const HOME_KINDS: Record<string, { name: string; about: string }> = {
  FEATURED_REELS: {
    name: 'Featured reels',
    about:
      'Trending reels, lifted for each person by who they follow, their pets and what they like.',
  },
  TRENDING_PETS: {
    name: 'Trending pets',
    about: 'Pets gaining the most followers and likes this week.',
  },
  ACTIVE_CONTESTS: {
    name: 'Contests',
    about: 'Contests open for entries that the person’s pets can enter, then ones open for voting.',
  },
  CHALLENGES: {
    name: 'Challenges',
    about: 'Challenges running now or starting soon; the person’s own check-ins come first.',
  },
  NEARBY_SERVICES: {
    name: 'Nearby services',
    about:
      'Service partners near the person, for their pets, ranked by distance, rating and history.',
  },
  RECOMMENDED_PRODUCTS: {
    name: 'Recommended products',
    about: 'Products for the person’s pets (species and age), past purchases and what they browse.',
  },
  PARTNER_OFFERS: {
    name: 'Partner offers',
    about: 'Coupons you pick. Shown only while they can be used.',
  },
  UPCOMING_EVENTS: {
    name: 'Coming up',
    about:
      'The person’s next bookings and contest deadlines, then contests and challenges starting soon.',
  },
};

/** City centres for previewing the home screen (the same list the app offers). */
export const PREVIEW_CITIES: Record<string, { lat: number; lng: number }> = {
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Delhi: { lat: 28.6139, lng: 77.209 },
  Bengaluru: { lat: 12.9716, lng: 77.5946 },
  Hyderabad: { lat: 17.385, lng: 78.4867 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  Pune: { lat: 18.5204, lng: 73.8567 },
  Kolkata: { lat: 22.5726, lng: 88.3639 },
  Ahmedabad: { lat: 23.0225, lng: 72.5714 },
};

/** Who is asked to accept each legal document. */
export const LEGAL_AUDIENCES: Record<string, string> = {
  everyone: 'Everyone, on their next app start',
  partners: 'Service partners, before applying',
  sellers: 'Sellers, before applying',
  contestants: 'Anyone entering a contest',
};

/** Support tickets (Phase 9a). */
export const TICKET_STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' | 'teal' }> = {
  OPEN: { label: 'New', tone: 'warn' },
  ASSIGNED: { label: 'Assigned', tone: 'teal' },
  IN_PROGRESS: { label: 'In progress', tone: 'teal' },
  WAITING: { label: 'Waiting for them', tone: 'neutral' },
  RESOLVED: { label: 'Resolved', tone: 'good' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const TICKET_PRIORITY: Record<string, { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' | 'teal' }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  NORMAL: { label: 'Normal', tone: 'neutral' },
  HIGH: { label: 'High', tone: 'warn' },
  URGENT: { label: 'Urgent', tone: 'danger' },
};

/** Which app a ticket came from, or who an FAQ or topic is for. */
export const SUPPORT_APPS: Record<string, string> = {
  ALL: 'Everyone',
  CUSTOMER: 'Customer app',
  PARTNER: 'Partner app',
  SELLER: 'Seller app',
  STAFF: 'Started by staff',
};

export const CHAT_SIDES: Record<string, string> = {
  CUSTOMER: 'Customer',
  BUSINESS: 'Business',
  STAFF: 'Staff',
  SYSTEM: 'PetApp',
};
