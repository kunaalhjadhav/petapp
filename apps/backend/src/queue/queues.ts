// Queue names and job payloads shared by the API (producer) and the worker (consumer).
export const MEDIA_QUEUE = 'media';
export const MAINTENANCE_QUEUE = 'maintenance';

export interface ProcessMediaJob {
  mediaId: string;
}

export type MaintenanceJobName = 'recompute-scores' | 'cleanup-stale-uploads' | 'process-refunds' | 'process-payouts' | 'sync-settlements' | 'reconcile' | 'recompute-risk' | 'purge-interest' | 'purge-assistant'
  /** Privacy (Phase 8b): build one data export; delete expired exports; erase accounts past their grace period. */
  | 'build-export' | 'purge-exports' | 'purge-deleted-accounts'
  /** Support (Phase 9a): close tickets resolved more than support.autoCloseDays ago. */
  | 'close-resolved-tickets'
  /** Phase 9d: booking, contest and membership reminders; promotions due to go out; memberships that ended. */
  | 'send-reminders' | 'send-promotions' | 'expire-memberships';
export interface BuildExportJob {
  exportId: string;
}


/** Trust & safety: AI moderation checks and account risk scores (Phase 7a). */
export const TRUST_QUEUE = 'trust';
export const MODERATABLE = ['USER', 'PET', 'POST', 'COMMENT', 'PRODUCT', 'SERVICE_REVIEW', 'CONTEST_ENTRY', 'CHAT_MESSAGE', 'PRODUCT_REVIEW'] as const;
/** What AI moderation checks. A business page (SERVICE_PARTNER) is checked by people when it's onboarded, so only reports reach it. */
export type ModeratableTarget = (typeof MODERATABLE)[number];
export type TrustJob = { kind: 'assess'; targetType: ModeratableTarget; targetId: string } | { kind: 'risk'; userId: string };

export const NOTIFY_QUEUE = 'notifications';

/** Things that happened. The worker decides who hears about them, respecting blocks and preferences. */
export type NotifyEvent =
  | { type: 'POST_LIKE'; actorId: string; postId: string }
  | { type: 'POST_COMMENT'; actorId: string; postId: string; commentId: string }
  | { type: 'COMMENT_REPLY'; actorId: string; postId: string; commentId: string; parentId: string }
  | { type: 'MENTION'; actorId: string; postId: string; commentId?: string; handles: string[] }
  | { type: 'NEW_FOLLOWER'; actorId: string; userId: string }
  | { type: 'PET_FOLLOWER'; actorId: string; petId: string }
  /** quiet: published straight away by the author — skip telling them, but still notify mentioned pets. */
  | { type: 'POST_PUBLISHED' | 'POST_FAILED'; postId: string; quiet?: boolean }
  | { type: 'CONTENT_REMOVED'; ownerId: string; targetType: string; targetId: string; resolution: string }
  | { type: 'ACCOUNT_STATUS'; userId: string; status: string }
  | { type: 'CONTEST_ENTRY_CONFIRMED'; participantId: string }
  | { type: 'CONTEST_VOTING_OPEN' | 'CONTEST_RESULT'; contestId: string }
  | { type: 'CHALLENGE_COMPLETED'; participantId: string }
  | { type: 'BADGE_EARNED'; userId: string; badgeId: string }
  | { type: 'PARTNER_STATUS'; partnerId: string }
  | { type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'BOOKING_COMPLETED'; bookingId: string }
  | { type: 'VENDOR_STATUS'; vendorId: string }
  | { type: 'ORDER_CONFIRMED'; orderId: string }
  /** A sub-order changed: shipped, delivered, cancelled, return requested/decided. `to` says who hears about it. */
  | { type: 'ORDER_UPDATE'; subOrderId: string; to: 'customer' | 'vendor' }
  /** The gateway confirmed a refund: the customer hears the money is on its way. */
  | { type: 'REFUND_PROCESSED'; refundId: string }
  /** A payout was sent, failed or came back; the payee hears about it. */
  | { type: 'PAYOUT_UPDATE'; payoutId: string }
  /** A payout account was verified, refused by the bank, or switched off. */
  | { type: 'PAYOUT_ACCOUNT'; accountId: string }
  /** A copy of someone's data is ready to download. */
  | { type: 'DATA_EXPORT_READY'; exportId: string }
  /** A chat message: push to the other side when they aren't in the app (no row in the notifications list). */
  | { type: 'CHAT_MESSAGE'; messageId: string }
  /** Staff replied to a ticket or changed its status; the person hears about it. */
  | { type: 'SUPPORT_UPDATE'; ticketId: string; messageId?: string; status?: string }
  /** A business got a review (the seller or partner hears), or replied to one (the customer hears). */
  | { type: 'REVIEW_RECEIVED' | 'REVIEW_REPLY'; kind: 'PRODUCT' | 'SERVICE'; reviewId: string }
  /** A booked visit is coming up: the customer hears about it (Phase 9d reminders). */
  | { type: 'BOOKING_REMINDER'; bookingId: string }
  /** Submissions or voting close soon: an entrant hears about it. */
  | { type: 'CONTEST_REMINDER'; participantId: string; stage: 'SUBMIT' | 'VOTING' }
  /** New votes on an entry since the last update (at most one an hour per entry). */
  | { type: 'CONTEST_VOTES'; participantId: string; since: string }
  /** A membership started, ended, was ended by staff, or is about to end. */
  | { type: 'MEMBERSHIP_UPDATE'; membershipId: string; event: 'ACTIVE' | 'RENEWED' | 'EXPIRED' | 'REVOKED' | 'ENDING' };
