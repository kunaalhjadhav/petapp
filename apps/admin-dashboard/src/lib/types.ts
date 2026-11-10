// Shapes returned by the PetApp admin API (see docs/API.md).
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'PENDING_DELETION' | 'DELETED';
export type PetStatus = 'ACTIVE' | 'HIDDEN' | 'REMOVED';
export type Visibility = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';

export interface Me {
  id: string;
  name: string | null;
  email: string | null;
  roles: string[];
  permissions: string[];
  /** Phase 9e: null while they still use the password they were given. */
  passwordChangedAt?: string | null;
  /** Whether the API can send email (password-reset links). */
  emailEnabled?: boolean;
  /** Phase 10a: two-factor sign-in. */
  mfaEnabled?: boolean;
  mfaEnabledAt?: string | null;
  recoveryCodesLeft?: number;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
}

export interface UserRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  roles: string[];
  petCount: number;
}

export interface UserDetail {
  id: string;
  mfaEnabledAt?: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  city: string | null;
  status: UserStatus;
  statusReason: string | null;
  phoneVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  marketingConsent: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
  roles: string[];
  identities: Array<{ provider: string; email: string | null; createdAt: string }>;
  pets: Array<{
    id: string;
    name: string;
    handle: string;
    status: PetStatus;
    isVerified: boolean;
    deletedAt: string | null;
  }>;
  addresses: Array<{ id: string; city: string; pincode: string; isDefault: boolean }>;
  sessions: Array<{
    id: string;
    audience: 'APP' | 'ADMIN';
    createdAt: string;
    userAgent: string | null;
    ipAddress: string | null;
  }>;
  _count: { pets: number; followers: number; following: number };
}

export interface PetRow {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  city: string | null;
  isVerified: boolean;
  followerCount: number;
  visibility: Visibility;
  status: PetStatus;
  deletedAt: string | null;
  createdAt: string;
  species: { id: string; key: string; name: string };
  breed: { id: string; name: string } | null;
  owner: { id: string; name: string | null; phone: string | null };
}

export interface PetDetail {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  species: { id: string; key: string; name: string };
  breed: { id: string; name: string } | null;
  isVerified: boolean;
  followerCount: number;
  visibility: Visibility;
  gender: string;
  dateOfBirth: string | null;
  ageMonths: number | null;
  weightKg: number | null;
  color: string | null;
  about: string | null;
  personality: string[];
  city: string | null;
  status: PetStatus;
  owner: { id: string; name: string | null; avatarUrl: string | null };
  createdAt: string;
  microchipId: string | null;
  medicalNotes: string | null;
  vaccinations: Array<{
    id: string;
    name: string;
    givenOn: string | null;
    validUntil: string | null;
    notes: string | null;
  }>;
}

export interface Species {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  breedCount: number;
}

export interface Breed {
  id: string;
  speciesId: string;
  name: string;
  isActive: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isStaff: boolean;
  permissionKeys: string[];
  userCount: number;
}

export interface Permission {
  id: string;
  key: string;
  module: string;
  description: string | null;
}

export interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
}

export interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string | null } | null;
}

export interface Overview {
  users: {
    total: number;
    active: number;
    suspended: number;
    blocked: number;
    pendingDeletion: number;
    newLast7d: number;
    signedInLast30d: number;
    staff: number;
    signupsByDay: Array<{ day: string; count: number }>;
  } | null;
  pets: {
    total: number;
    verified: number;
    hidden: number;
    newLast7d: number;
    bySpecies: Array<{ species: string; count: number }>;
  } | null;
  recentAudit: Array<
    Pick<AuditEntry, 'id' | 'action' | 'entityType' | 'entityId' | 'createdAt' | 'actor'>
  > | null;
  moderation: {
    openCases: number;
    oldestOpenAt: string | null;
    byType: Partial<Record<'USER' | 'PET' | 'POST' | 'COMMENT', number>>;
  } | null;
}

// ── Moderation (Phase 2) ──
export type TargetType =
  | 'USER'
  | 'PET'
  | 'POST'
  | 'COMMENT'
  | 'PRODUCT'
  | 'SERVICE_REVIEW'
  | 'CONTEST_ENTRY'
  | 'CHAT_MESSAGE'
  | 'SERVICE_PARTNER'
  | 'PRODUCT_REVIEW';
export type Resolution = 'DISMISSED' | 'CONTENT_HIDDEN' | 'CONTENT_REMOVED' | 'USER_SUSPENDED';

export interface MediaPreview {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  status: string;
  images?: Array<{ width: number; url: string }>;
  poster?: string;
  hls?: string;
  durationMs: number | null;
}

export interface TargetPreview {
  exists: boolean;
  kind?: TargetType;
  status?: string;
  caption?: string | null;
  body?: string;
  name?: string | null;
  handle?: string;
  about?: string | null;
  postType?: string;
  postId?: string;
  author?: { id: string; name: string | null };
  media?: MediaPreview[];
  createdAt?: string;
  /** PRODUCT */
  vendorId?: string;
  blockReason?: string | null;
  /** SERVICE_REVIEW, PRODUCT_REVIEW (and SERVICE_PARTNER: its average) */
  rating?: number;
  reply?: string | null;
  partner?: { id: string; businessName: string };
  /** PRODUCT_REVIEW */
  product?: { id: string; title: string };
  vendor?: { id: string; businessName: string };
  /** SERVICE_PARTNER */
  partnerId?: string;
  slug?: string;
  ratingCount?: number;
  /** CONTEST_ENTRY */
  contest?: { id: string; title: string };
  /** CHAT_MESSAGE: the conversation, and the messages around the reported one (never staff notes). */
  conversation?: {
    id: string;
    kind: 'SERVICE' | 'SHOP' | 'SUPPORT';
    customer: { id: string; name: string | null };
    business: string | null;
  };
  context?: Array<{
    id: string;
    side: 'CUSTOMER' | 'BUSINESS' | 'STAFF' | 'SYSTEM';
    body: string | null;
    mediaId: string | null;
    status: string;
    createdAt: string;
    reported?: boolean;
  }>;
}

/** One AI (or rules) check: result, confidence, reason, and which model and version made it. */
export interface AiCheck {
  id: string;
  verdict: 'CLEAR' | 'FLAGGED' | 'ERROR';
  labels: Array<{ label: string; score: number }>;
  topLabel: string | null;
  confidence: number;
  reason: string | null;
  provider: string;
  model: string;
  version: string;
  error: string | null;
  createdAt: string;
}

export interface CaseRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  status: 'OPEN' | 'RESOLVED';
  reportCount: number;
  lastReportedAt: string;
  resolution: Resolution | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  reasons: Array<{ reason: string; count: number }>;
  target: TargetPreview;
  aiFlaggedAt: string | null;
  ai: AiCheck | null;
}

export interface CaseDetail extends Omit<CaseRow, 'reasons'> {
  resolvedBy: { id: string; name: string | null; email: string | null } | null;
  previousCases: number;
  aiHistory: AiCheck[];
  reports: Array<{
    id: string;
    reason: string;
    details: string | null;
    status: string;
    createdAt: string;
    reporter: { id: string; name: string | null };
    /** Private screenshots the reporter attached (short-lived links). */
    evidence: MediaPreview[];
  }>;
  target: TargetPreview;
}

// ── Reports and reviews (Phase 9b) ──
export interface ReportRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
  createdAt: string;
  reporter: { id: string; name: string | null; email: string | null };
  entity: { label: string; status: string | null; owner: { id: string; name: string | null } | null; exists: boolean };
  evidence: MediaPreview[];
  case: {
    id: string;
    status: 'OPEN' | 'RESOLVED';
    reportCount: number;
    resolution: Resolution | null;
    resolutionNote: string | null;
    resolvedAt: string | null;
    moderator: { id: string; name: string | null } | null;
  } | null;
}

export interface ReportsSummary {
  open: number;
  actioned: number;
  dismissed: number;
  today: number;
  last7Days: number;
  openByType: Array<{ targetType: TargetType; count: number }>;
}

export interface AdminReview {
  id: string;
  kind: 'PRODUCT' | 'SERVICE';
  rating: number;
  comment: string | null;
  reply: string | null;
  repliedAt: string | null;
  status: 'VISIBLE' | 'HIDDEN';
  createdAt: string;
  photos: MediaPreview[];
  customer: { id: string; name: string | null };
  business: { id: string; name: string };
  subject: { id: string; label: string };
  openCase: { id: string; reports: number; aiFlagged: boolean } | null;
}

// ── Contests (Phase 3) ──
export type ContestStatus =
  | 'DRAFT'
  | 'REVIEW'
  | 'SCHEDULED'
  | 'LIVE'
  | 'VOTING'
  | 'EVALUATION'
  | 'WINNER_DECLARATION'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ContestCategory {
  id: string;
  key: string;
  name: string;
  group: string;
  isActive: boolean;
}

export interface Finance {
  prizePoolPct: number;
  platformFeePct: number;
  gatewayPct: number;
  gstOnPlatformFeePct: number;
  promotionPct: number;
  refundReservePct: number;
  judgeFeesPaise: number;
}

export interface FinanceBreakdown {
  participants: number;
  grossPaise: number;
  prizePoolPaise: number;
  platformFeePaise: number;
  gstPaise: number;
  gatewayPaise: number;
  promotionPaise: number;
  refundReservePaise: number;
  judgeFeesPaise: number;
  unallocatedPaise: number;
  balanced: boolean;
}

export interface ContestRow {
  id: string;
  slug: string;
  title: string;
  status: ContestStatus;
  feePaise: number;
  entries: number;
  maxParticipants: number | null;
  registrationOpensAt: string;
  votingClosesAt: string;
  category: ContestCategory | null;
}

export interface ContestDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  bannerUrl: string | null;
  categoryId: string | null;
  category: ContestCategory | null;
  status: ContestStatus;
  feePaise: number;
  minParticipants: number;
  maxParticipants: number | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  submissionClosesAt: string;
  votingClosesAt: string;
  publicWeight: number;
  votesPerUserPerDay: number;
  minAccountAgeDays: number;
  eligibleSpeciesIds: string[];
  membersOnly?: boolean;
  rules: string | null;
  terms: string | null;
  legalReviewApprovedAt: string | null;
  legalReviewNote: string | null;
  leaderboardFrozenAt: string | null;
  cancelReason: string | null;
  tasks: Array<{
    id: string;
    type: 'POST' | 'TEXT';
    title: string;
    description: string | null;
    required: boolean;
  }>;
  criteria: Array<{ id: string; name: string; weight: number }>;
  prizes: Array<{
    id: string;
    rank: number | null;
    title: string;
    kind: string;
    amountPaise: number | null;
    description: string | null;
    participantId: string | null;
    payoutStatus: string;
  }>;
  judges: Array<{ userId: string; user: { id: string; name: string | null } }>;
  readiness: string[];
  entries: Partial<Record<string, number>>;
  finance: Finance;
  money: {
    collectedPaise: number;
    paidEntries: number;
    actual: FinanceBreakdown | null;
    atMinimum: FinanceBreakdown | null;
    atMaximum: FinanceBreakdown | null;
  };
}

export interface LeaderboardRowView {
  rank: number;
  entryId: string;
  pet?: { id: string; name: string; handle: string };
  owner?: { id: string; name: string | null };
  status?: string;
  votes: number;
  voteScore: number;
  judgeScore: number;
  combined: number;
}

export interface FlaggedVote {
  id: string;
  riskScore: number;
  riskReasons: string[];
  createdAt: string;
  voter: { id: string; name: string | null; createdAt: string };
  entry: { id: string; pet: string };
}

// ── Services marketplace (Phase 4) ──
export type PartnerStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface ServiceCategoryRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  commissionBps: number;
  isActive: boolean;
}

export interface PartnerRow {
  id: string;
  businessName: string;
  kind: string;
  city: string | null;
  area: string | null;
  status: PartnerStatus;
  submittedAt: string | null;
  ratingAvg: number;
  ratingCount: number;
  user: { id: string; name: string | null };
  _count: { services: number; documents: number; bookings: number };
}

export interface PartnerDetail extends Omit<PartnerRow, 'user' | '_count'> {
  slug: string;
  about: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  state: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  homeVisitRadiusKm: number;
  concurrency: number;
  gstin: string | null;
  commissionBps: number | null;
  statusReason: string | null;
  reviewedAt: string | null;
  user: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    createdAt: string;
  };
  documents: Array<{
    id: string;
    kind: string;
    status: string;
    note: string | null;
    createdAt: string;
    mimeType: string;
    url: string;
  }>;
  services: Array<{
    id: string;
    name: string;
    durationMin: number;
    pricePaise: number;
    modes: string[];
    isActive: boolean;
    category: { name: string; commissionBps: number } | null;
  }>;
  hours: Array<{ weekday: number; opensMin: number; closesMin: number }>;
  checklist: string[];
  bookings: Partial<Record<string, number>>;
  completedTotals: { pricePaise: number; platformFeePaise: number; partnerEarningPaise: number };
}

export interface BookingRow {
  id: string;
  code: string;
  status: string;
  startsAt: string;
  mode: 'AT_CENTER' | 'AT_HOME';
  service: { id: string; name: string };
  pet: { id: string; name: string };
  pricePaise: number;
  partner: { id: string; businessName: string; city: string | null };
  customer?: { id: string; name: string | null; phone: string | null };
  earnings?: { platformFeePaise: number; partnerEarningPaise: number };
  cancelledBy: string | null;
  cancelReason: string | null;
  refundPaise: number | null;
}

// ── Marketplace (Phase 5) ──
export type VendorStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface VendorRow {
  id: string;
  businessName: string;
  city: string;
  status: VendorStatus;
  gstin: string | null;
  submittedAt: string | null;
  createdAt: string;
  products: number;
}

export interface VendorDetail extends Omit<VendorRow, 'products'> {
  legalName: string | null;
  phone: string;
  email: string | null;
  addressLine: string;
  state: string;
  pincode: string;
  statusReason: string | null;
  commissionBps: number | null;
  reviewedAt: string | null;
  user: { id: string; name: string | null; phone: string | null };
  documents: Array<{
    id: string;
    kind: string;
    status: string;
    note: string | null;
    createdAt: string;
    mimeType: string;
    url: string;
  }>;
  checklist: string[];
  products: Partial<Record<string, number>>;
  orders: Partial<Record<string, number>>;
}

export interface ProductCategoryRow {
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  commissionBps: number;
  isActive: boolean;
  sortOrder: number;
  _count: { products: number };
}

export interface AdminProductRow {
  id: string;
  title: string;
  brand: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  blockReason: string | null;
  updatedAt: string;
  vendor: { id: string; businessName: string };
  category: { name: string };
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    pricePaise: number;
    mrpPaise: number;
    stock: number;
    isActive: boolean;
  }>;
}

export interface AdminSubOrderRow {
  id: string;
  code: string;
  status: string;
  totalPaise: number;
  commissionPaise: number;
  vendorEarningPaise: number;
  courier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  vendor: { id: string; businessName: string };
  order: { code: string; user: { id: string; name: string | null } };
  items: Array<{ productTitle: string; variantTitle: string; qty: number }>;
}

export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  kind: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  perUserLimit: number;
  usedCount: number;
  isActive: boolean;
  vendor: { id: string; businessName: string } | null;
}

// ── Trust & safety (Phase 7a) ──
export interface AiStatus {
  provider: string;
  usesModel: boolean;
  enabled: boolean;
  flagPct: number;
  autoHidePct: number;
  last24h: Partial<Record<'CLEAR' | 'FLAGGED' | 'ERROR', number>>;
}

export interface AiAssessmentRow extends AiCheck {
  targetType: TargetType;
  targetId: string;
  ownerId: string | null;
}

export interface RiskSignal {
  signal: string;
  points: number;
  detail: string;
}

export interface RiskRow {
  userId: string;
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  signals: RiskSignal[];
  computedAt: string;
  needsReview: boolean;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewedScore: number | null;
  user: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    createdAt: string;
  };
}

export interface RiskDetail extends RiskRow {
  reviewedBy: { id: string; name: string | null; email: string | null } | null;
}

// ── Home screen (Phase 7b) ──
export type HomeKind =
  | 'FEATURED_REELS'
  | 'TRENDING_PETS'
  | 'ACTIVE_CONTESTS'
  | 'CHALLENGES'
  | 'NEARBY_SERVICES'
  | 'RECOMMENDED_PRODUCTS'
  | 'PARTNER_OFFERS'
  | 'UPCOMING_EVENTS';

export interface HomeSection {
  id: string;
  kind: HomeKind;
  title: string;
  subtitle: string | null;
  position: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  cities: string[];
  speciesIds: string[];
  itemLimit: number;
  pinnedIds: string[];
  pinsAllowed: boolean;
  pinWhat: string | null;
  pins: Array<{ id: string; label: string; live: boolean }>;
  updatedAt: string;
}

/** One item in a previewed section. Its fields depend on the section's kind. */
export type PreviewItem = { id: string; reason: string | null; pinned: boolean } & Record<
  string,
  unknown
>;

export interface HomePreview {
  city: string | null;
  sections: Array<{
    id: string;
    kind: HomeKind;
    title: string;
    subtitle: string | null;
    items: PreviewItem[];
  }>;
  skipped: Array<{ id: string; why: string }>;
}

// ── PetApp Assistant (Phase 7c) ──
export interface AssistantStatus {
  provider: string;
  usesModel: boolean;
  model: string;
  enabled: boolean;
  dailyLimit: number;
  historyDays: number;
  last24h: {
    answers: number;
    urgent: number;
    healthInfo: number;
    byProvider: Record<string, number>;
    modelFailures: number;
    avgLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  ratings30d: { up: number; down: number };
}

export interface AssistantFeedback {
  id: string;
  question: string | null;
  answer: string;
  rating: 'UP' | 'DOWN';
  note: string | null;
  safety: 'NONE' | 'GENERAL_INFO' | 'URGENT';
  cards: string[];
  tools: Array<{ name: string; input: Record<string, unknown> }>;
  provider: string | null;
  model: string | null;
  version: string | null;
  error: string | null;
  ratedAt: string;
}

// ── System health (Phase 8a) ──
export interface SystemCheck {
  ok: boolean;
  ms: number;
  error?: string;
}

export interface SystemStatus {
  environment: string;
  release: string | null;
  uptimeSeconds: number;
  checks: { database: SystemCheck; redis: SystemCheck; storage: SystemCheck };
  queues: Array<{
    name: string;
    counts: Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number>;
    recentFailures: Array<{
      id: string;
      job: string;
      error: string;
      attempts: number;
      at: string | null;
    }>;
  }>;
  providers: Record<string, string>;
  money: {
    refundsFailed: number;
    payoutsFailed: number;
    refundsOverdue: number;
    webhooksUnprocessed: number;
  };
}

// ── Privacy and legal (Phase 8b) ──
export type LegalAudience = 'everyone' | 'partners' | 'sellers' | 'contestants';
export type LegalStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface LegalVersionSummary {
  id: string;
  slug: string;
  version: number;
  title: string;
  status: LegalStatus;
  requiresAcceptance: boolean;
  changeSummary: string | null;
  effectiveAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface LegalRow {
  slug: string;
  title: string;
  audience: LegalAudience;
  current: (LegalVersionSummary & { acceptances: number }) | null;
  draft: (LegalVersionSummary & { placeholders: number }) | null;
  versions: number;
}

export interface LegalDocumentDetail extends LegalVersionSummary {
  body: string;
  audience: LegalAudience;
  placeholders: string[];
  acceptances: number;
  createdAt: string;
  history: LegalVersionSummary[];
}

export interface DeletionRequest {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: 'PENDING_DELETION' | 'DELETED';
  requestedAt: string | null;
  eraseAfter: string | null;
  waitingFor: string[];
  erasedAt: string | null;
  createdAt: string;
}

export interface DeletionMeta {
  graceDays: number;
  counts: { scheduled: number; deferred: number; erased: number };
  exports30d: Partial<Record<'PENDING' | 'READY' | 'FAILED' | 'EXPIRED', number>>;
}

// ── Support center (Phase 9a) ──
export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type Audience = 'ALL' | 'CUSTOMER' | 'PARTNER' | 'SELLER';

export interface TicketRow {
  id: string;
  code: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  /** CUSTOMER, PARTNER, SELLER, or STAFF when staff started it. */
  app: string;
  category: { id: string; key: string; name: string };
  user: { id: string; name: string | null; phone: string | null; email: string | null };
  assignee: { id: string; name: string | null } | null;
  /** Messages from the person staff haven't read. */
  unread: number;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetail extends Omit<TicketRow, 'user'> {
  user: TicketRow['user'] & {
    status: string;
    avatarUrl: string | null;
    partner: { id: string; businessName: string; status: string } | null;
    vendor: { id: string; businessName: string; status: string } | null;
  };
  ref: {
    type: 'BOOKING' | 'ORDER';
    id: string;
    code: string;
    status: string;
    amountPaise: number;
    business: string;
    startsAt?: string;
    orderId?: string;
  } | null;
  otherTickets: Array<{ id: string; code: string; subject: string; status: TicketStatus; createdAt: string }>;
  resolvedAt: string | null;
  closedAt: string | null;
  seenByPersonAt: string | null;
  canReply: boolean;
}

export interface ChatAttachment {
  id: string;
  kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  status: string;
  images?: Array<{ width: number; url: string }>;
  /** DOCUMENT: a short-lived link to the PDF. */
  url?: string | null;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ChatMessage {
  id: string;
  side: 'CUSTOMER' | 'BUSINESS' | 'STAFF' | 'SYSTEM';
  mine: boolean;
  senderName?: string;
  body: string | null;
  removed: boolean;
  internal?: boolean;
  media: ChatAttachment | null;
  ref: { type: string; id: string; code?: string; title?: string; status?: string; unavailable?: boolean } | null;
  createdAt: string;
}

export interface SupportSummary {
  open: number;
  unassigned: number;
  mine: number;
  waiting: number;
  needsReply: number;
  urgent: number;
}

export interface SupportCategory {
  id: string;
  key: string;
  name: string;
  audience: Audience;
  sortOrder: number;
  active: boolean;
  _count: { tickets: number; faqs: number };
}

export interface SupportFaq {
  id: string;
  question: string;
  answer: string;
  audience: Audience;
  sortOrder: number;
  published: boolean;
  helpful: number;
  notHelpful: number;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  updatedAt: string;
}

// ── Locations (Phase 9c) ──
export interface StateRow {
  code: string;
  name: string;
  isUnionTerritory: boolean;
}

export interface CityRow {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  servicesLive: boolean;
  isActive: boolean;
  sortOrder: number;
  state: { code: string; name: string };
  localities: number;
  pincodes: number;
}

export interface CityDetail extends Omit<CityRow, 'localities'> {
  partnersNearby: number;
  coverageRadiusKm: number;
  localities: Array<{ id: string; slug: string; name: string; lat: number | null; lng: number | null; isActive: boolean; pincodes: number }>;
}

export interface PincodeRow {
  code: string;
  lat: number | null;
  lng: number | null;
  locality: { id: string; name: string } | null;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  areasCreated: number;
  pincodesAdded: number;
  pincodesUpdated: number;
  errors: string[];
}

export interface DeliveryZoneRow {
  id: string;
  name: string;
  isActive: boolean;
  pincodes: string[];
  cityIds: string[];
  stateCodes: string[];
  deliverable: boolean;
  shippingFlatPaise: number | null;
  freeAbovePaise: number | null;
  minDays: number;
  maxDays: number;
  note: string | null;
  cities: Array<{ id: string; name: string }>;
}

export interface CoverageOverview {
  coverageRadiusKm: number;
  liveCities: number;
  partnersOutside: number;
  cities: Array<{ id: string; name: string; slug: string; servicesLive: boolean; partners: number; homeVisits: number }>;
}

export interface PartnerLocationRow {
  id: string;
  businessName: string;
  status: string;
  addressLine: string;
  area: string | null;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  homeVisitRadiusKm: number;
  nearestCity: { name: string; distanceKm: number } | null;
  covered: boolean;
}

// ── Phase 9d: analytics, memberships, promotions ──

export type MetricFormat = 'count' | 'paise' | 'pct';
export interface AnalyticsReport {
  tab: string;
  from: string;
  to: string;
  days: number;
  generatedAt: string;
  kpis: Array<{ key: string; label: string; value: number | null; format: MetricFormat; previous?: number | null; hint?: string }>;
  series: Array<{ key: string; label: string; format: MetricFormat; points: Array<{ day: string; value: number }> }>;
  tables: Array<{
    key: string;
    label: string;
    columns: Array<{ key: string; label: string; format: MetricFormat | 'text' }>;
    rows: Array<Record<string, string | number | null>>;
  }>;
  notes: string[];
}

export interface PlanBenefits {
  exclusiveContests: boolean;
  premiumChallenges: boolean;
  memberDiscounts: boolean;
  priorityDays: number;
  badge: boolean;
}
export interface MembershipPlan {
  id: string;
  key: string;
  name: string;
  description: string;
  pricePaise: number;
  periodDays: number;
  rank: number;
  benefits: PlanBenefits;
  lines: string[];
  isActive: boolean;
  members: number;
}
export interface MembershipRow {
  id: string;
  user: { id: string; name: string | null; phone: string | null };
  plan: { id: string; key: string; name: string };
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  pricePaise: number;
  source: string;
  grantedBy: string | null;
  note: string | null;
  createdAt: string;
  running: boolean;
}
export interface MembershipSummary {
  enabled: boolean;
  members: number;
  purchases30d: number;
  revenue30dPaise: number;
}
export interface Promotion {
  id: string;
  title: string;
  body: string;
  link: string | null;
  audience: 'ALL' | 'MEMBERS' | 'CITY';
  city: string | null;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'CANCELLED';
  sendAt: string;
  sentAt: string | null;
  recipients: number;
  createdBy: string;
  createdAt: string;
}
