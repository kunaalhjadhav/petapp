import type { NotificationType } from '../../generated/prisma/enums';

export interface RenderInput {
  type: NotificationType;
  actorName?: string | null;
  count: number;
  data: Record<string, unknown>;
}

const who = (name: string | null | undefined, count: number) => {
  const n = name?.trim() || 'Someone';
  if (count <= 1) return n;
  const others = count - 1;
  return `${n} and ${others} other${others === 1 ? '' : 's'}`;
};

const snippet = (v: unknown, max = 80) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** One sentence per notification, used for the in-app list and for push. */
export function renderNotification(n: RenderInput): { title: string; body: string } {
  const d = n.data;
  switch (n.type) {
    case 'POST_LIKE':
      return { title: 'New likes', body: `${who(n.actorName, n.count)} liked your post${d.caption ? `: “${snippet(d.caption, 40)}”` : '.'}` };
    case 'POST_COMMENT':
      return { title: 'New comment', body: `${who(n.actorName, 1)} commented: “${snippet(d.body)}”` };
    case 'COMMENT_REPLY':
      return { title: 'New reply', body: `${who(n.actorName, 1)} replied to your comment: “${snippet(d.body)}”` };
    case 'MENTION':
      return { title: `${d.petName ?? 'Your pet'} was mentioned`, body: `${who(n.actorName, 1)} mentioned ${d.petName ?? 'your pet'}${d.body ? `: “${snippet(d.body)}”` : ' in a post.'}` };
    case 'NEW_FOLLOWER':
      return { title: 'New followers', body: `${who(n.actorName, n.count)} started following you.` };
    case 'PET_FOLLOWER':
      return { title: `${d.petName ?? 'Your pet'} has new followers`, body: `${who(n.actorName, n.count)} started following ${d.petName ?? 'your pet'}.` };
    case 'POST_PUBLISHED':
      return { title: 'Your post is live', body: d.postType === 'REEL' ? 'Your reel finished processing and is now live.' : 'Your post finished processing and is now live.' };
    case 'POST_FAILED':
      return { title: 'Your post couldn’t be published', body: 'We couldn’t process one of your photos or videos. Try uploading it again.' };
    case 'CONTENT_REMOVED': {
      const thing = String(d.targetType ?? 'content').toLowerCase().replace('post', 'post').replace('pet', 'pet profile');
      const verb = d.resolution === 'CONTENT_HIDDEN' ? 'hidden' : 'removed';
      return { title: `Your ${thing} was ${verb}`, body: `After review, your ${thing} was ${verb} for breaking the community guidelines.` };
    }
    case 'CONTEST_ENTRY_CONFIRMED':
      return { title: 'You’re in!', body: `${d.petName ?? 'Your pet'} is entered in ${d.contestTitle ?? 'the contest'}. Complete the tasks before submissions close.` };
    case 'CONTEST_VOTING_OPEN':
      return { title: 'Voting is open', body: `Voting has started in ${d.contestTitle ?? 'your contest'}. Share your entry with friends!` };
    case 'CONTEST_RESULT':
      return d.prize
        ? { title: 'You won! 🏆', body: `${d.petName ?? 'Your pet'} won “${d.prize}” in ${d.contestTitle ?? 'the contest'}.` }
        : { title: 'Results are out', body: `The winners of ${d.contestTitle ?? 'your contest'} have been announced. Thanks for taking part!` };
    case 'CHALLENGE_COMPLETED':
      return { title: 'Challenge complete!', body: `You finished ${d.challengeTitle ?? 'the challenge'} with ${d.points ?? 0} points.` };
    case 'BADGE_EARNED':
      return { title: 'New badge', body: `You earned the “${d.badgeName ?? 'new'}” badge.` };
    case 'PARTNER_STATUS':
      return d.status === 'APPROVED'
        ? { title: 'You’re approved!', body: `${d.businessName ?? 'Your business'} is now live on PetApp. Customers nearby can book you.` }
        : d.status === 'REJECTED'
          ? { title: 'Your application needs changes', body: `We couldn’t approve ${d.businessName ?? 'your business'} yet: ${d.reason ?? 'see the details in the app'}.` }
          : { title: 'Your business is paused', body: `${d.businessName ?? 'Your business'} isn’t taking bookings right now. Contact support for details.` };
    case 'BOOKING_CONFIRMED':
      return d.forPartner
        ? { title: 'New booking', body: `${d.serviceName ?? 'A service'} for ${d.petName ?? 'a pet'} on ${d.when ?? 'the booked date'} (${d.code ?? ''}).` }
        : { title: 'Booking confirmed', body: `${d.serviceName ?? 'Your service'} at ${d.partnerName ?? 'the partner'} on ${d.when ?? 'the booked date'}. Code ${d.code ?? ''}.` };
    case 'BOOKING_CANCELLED':
      return {
        title: 'Booking cancelled',
        body: `${d.serviceName ?? 'A booking'} on ${d.when ?? 'the booked date'} was cancelled${d.byPartner ? ' by the partner' : ''}.${typeof d.refundPaise === 'number' && d.refundPaise > 0 && !d.forPartner ? ` ₹${(d.refundPaise / 100).toLocaleString('en-IN')} will be refunded.` : ''}`,
      };
    case 'VENDOR_STATUS':
      return d.status === 'APPROVED'
        ? { title: 'Your store is approved!', body: `${d.businessName ?? 'Your store'} can now list products on PetApp.` }
        : d.status === 'REJECTED'
          ? { title: 'Your application needs changes', body: `We couldn’t approve ${d.businessName ?? 'your store'} yet: ${d.reason ?? 'see the details in the app'}.` }
          : { title: 'Your store is paused', body: `${d.businessName ?? 'Your store'} isn’t selling right now. Contact support for details.` };
    case 'VENDOR_NEW_ORDER':
      return { title: 'New order', body: `Order ${d.code ?? ''}: ${d.units ?? ''} item${d.units === 1 ? '' : 's'}, ${rupees(d.totalPaise)}. Pack it soon.` };
    case 'ORDER_CONFIRMED':
      return { title: 'Order placed', body: `Thanks! Order ${d.code ?? ''} (${rupees(d.totalPaise)}) is confirmed${Number(d.parcels) > 1 ? ` and will arrive in ${d.parcels} parcels` : ''}.` };
    case 'ORDER_UPDATE':
      return orderUpdate(d);
    case 'PAYOUT_UPDATE': {
      const to = d.last4 ? ` to ••••${d.last4}` : d.vpa ? ` to ${d.vpa}` : '';
      if (d.status === 'PROCESSED') return { title: 'Payout sent', body: `${rupees(d.amountPaise)} has been paid${to}.${d.utr ? ` Bank reference ${d.utr}.` : ''}` };
      if (d.status === 'REVERSED') return { title: 'Payout returned', body: `Your bank returned the ${rupees(d.amountPaise)} payout${to}. It’s back on your balance; check your payout account.` };
      return { title: 'Payout didn’t go through', body: `${rupees(d.amountPaise)} couldn’t be paid${to}. It’s back on your balance; check your payout account.` };
    }
    case 'PAYOUT_ACCOUNT': {
      const what = d.last4 ? `account ••••${d.last4}` : d.vpa ? `UPI ${d.vpa}` : 'account';
      if (d.status === 'VERIFIED') return { title: 'Payout account verified', body: `Payouts will go to your ${what}${d.payableFrom ? ` from ${d.payableFrom}` : ''}.` };
      if (d.status === 'DISABLED') return { title: 'Payout account switched off', body: `Your ${what} can no longer receive payouts. Add another account in the app, or contact support.` };
      return { title: 'Payout account not verified', body: `We couldn’t verify your ${what}: ${d.reason ?? 'check the details and try again'}.` };
    }
    case 'REFUND_PROCESSED':
      return {
        title: 'Refund sent',
        body: `${rupees(d.amountPaise)} for ${d.what ?? 'your payment'} is on its way back to your original payment method. Your bank may take a few working days to show it.`,
      };
    case 'SUPPORT_UPDATE':
      return d.status
        ? { title: `Ticket ${d.code ?? ''} ${d.status === 'WAITING' ? 'needs your reply' : d.status === 'RESOLVED' ? 'is resolved' : 'is closed'}`.replace('  ', ' '), body: d.status === 'WAITING' ? `Support is waiting for your reply about “${snippet(d.subject, 60)}”.` : d.status === 'RESOLVED' ? `We marked “${snippet(d.subject, 60)}” as resolved. Reply if you still need help.` : `Your ticket “${snippet(d.subject, 60)}” is closed.` }
        : { title: 'PetApp Support replied', body: d.body ? `“${snippet(d.body)}”` : `New reply about “${snippet(d.subject, 60)}”.` };
    case 'REVIEW_RECEIVED':
      return { title: `New ${'★'.repeat(Math.min(5, Math.max(1, Number(d.rating) || 1)))} review`, body: d.comment ? `${d.by ?? 'A customer'} on ${snippet(d.about, 40)}: “${snippet(d.comment)}”` : `${d.by ?? 'A customer'} rated ${snippet(d.about, 60)}. Reply to thank them.` };
    case 'REVIEW_REPLY':
      return { title: `${d.business ?? 'The business'} replied to your review`, body: `“${snippet(d.reply)}”` };
    case 'CHAT_MESSAGE':
      return { title: String(d.senderName ?? 'New message'), body: snippet(d.preview) || 'Sent you a message.' };
    case 'DATA_EXPORT_READY':
      return { title: 'Your data is ready', body: `Your copy of your PetApp data is ready to download${d.until ? ` until ${d.until}` : ''}. Settings → Your data.` };
    case 'BOOKING_COMPLETED':
      return { title: 'How was it?', body: `Rate ${d.partnerName ?? 'your service'} for ${d.petName ?? 'your pet'}. Your review helps other pet parents.` };
    case 'ACCOUNT_STATUS':
      return d.status === 'ACTIVE'
        ? { title: 'Your account is active again', body: 'You can use PetApp as usual.' }
        : { title: 'Your account is restricted', body: 'Your account was restricted after a review. Contact support if you think this is a mistake.' };
    case 'BOOKING_REMINDER':
      return { title: `Coming up: ${snippet(d.serviceName, 40) || 'your booking'}`, body: `${d.petName ?? 'Your pet'}’s visit with ${d.partnerName ?? 'your partner'} is ${d.when ?? 'soon'}.${d.atHome ? ' They’ll come to you.' : ''}${d.code ? ` Booking ${d.code}.` : ''}` };
    case 'CONTEST_REMINDER':
      return d.stage === 'SUBMIT'
        ? { title: 'Submit your entry', body: `Entries for ${snippet(d.contestTitle, 50)} close ${d.when ?? 'soon'}. Add ${d.petName ?? 'your pet'}’s entry so it can be judged.` }
        : { title: 'Voting closes soon', body: `Voting in ${snippet(d.contestTitle, 50)} ends ${d.when ?? 'soon'}. Share ${d.petName ?? 'your pet'}’s entry with friends.` };
    case 'CONTEST_VOTES': {
      const v = Number(d.votes) || 0;
      return { title: `${v} new vote${v === 1 ? '' : 's'}`, body: `${d.petName ?? 'Your pet'} got ${v} new vote${v === 1 ? '' : 's'} in ${snippet(d.contestTitle, 50)}.` };
    }
    case 'MEMBERSHIP_UPDATE':
      if (d.event === 'ACTIVE') return { title: `Welcome to ${d.plan ?? 'your membership'}`, body: `Your ${d.plan ?? ''} membership is active until ${d.until ?? 'its end date'}.`.replace('  ', ' ') };
      if (d.event === 'RENEWED') return { title: 'Membership renewed', body: `Your ${d.plan ?? ''} membership now runs until ${d.until ?? 'its new end date'}.`.replace('  ', ' ') };
      if (d.event === 'ENDING') return { title: 'Your membership ends soon', body: `Your ${d.plan ?? ''} membership ends on ${d.until ?? 'its end date'}. Renew in Membership to keep your benefits.`.replace('  ', ' ') };
      if (d.event === 'REVOKED') return { title: 'Your membership was ended', body: `Your ${d.plan ?? ''} membership was ended by PetApp. Contact support if you think this is a mistake.`.replace('  ', ' ') };
      return { title: 'Your membership has ended', body: `Your ${d.plan ?? ''} membership has ended. You can join again any time in Membership.`.replace('  ', ' ') };
    case 'PROMOTION':
      return { title: snippet(d.title, 60) || 'From PetApp', body: snippet(d.body, 200) };
  }
}

const rupees = (p: unknown) => (typeof p === 'number' ? `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '');

function orderUpdate(d: Record<string, unknown>): { title: string; body: string } {
  const code = String(d.code ?? '');
  const refund = typeof d.refundPaise === 'number' && d.refundPaise > 0 ? ` ${rupees(d.refundPaise)} will be refunded.` : '';
  if (d.forVendor) {
    if (d.status === 'CANCELLED') return { title: 'Order cancelled', body: `The customer cancelled ${code}. Don’t ship it.` };
    if (d.returnStatus === 'REQUESTED') return { title: 'Return requested', body: `A customer asked to return ${code}. Review it in your orders.` };
    return { title: 'Order update', body: `${code} is now ${String(d.status ?? '').toLowerCase().replace(/_/g, ' ')}.` };
  }
  switch (d.returnStatus ?? d.status) {
    case 'SHIPPED':
      return { title: 'Shipped', body: `${code} from ${d.vendorName ?? 'the seller'} is on its way${d.courier ? ` with ${d.courier}` : ''}${d.trackingNumber ? ` (tracking ${d.trackingNumber})` : ''}.` };
    case 'DELIVERED':
      return { title: 'Delivered', body: `${code} from ${d.vendorName ?? 'the seller'} was delivered. Enjoy!` };
    case 'CANCELLED':
      return { title: 'Order cancelled', body: `${code} was cancelled${d.cancelledBy === 'VENDOR' ? ` by ${d.vendorName ?? 'the seller'}${d.cancelReason ? `: ${d.cancelReason}` : ''}` : ''}.${refund}` };
    case 'APPROVED':
      return { title: 'Return approved', body: `Your return for ${code} was approved. Hand the parcel to the courier when they come.` };
    case 'REJECTED':
      return { title: 'Return not accepted', body: `${d.vendorName ?? 'The seller'} couldn’t accept the return for ${code}. Contact support if you disagree.` };
    case 'RECEIVED':
      return { title: 'Return received', body: `${d.vendorName ?? 'The seller'} received your return for ${code}.${refund}` };
    default:
      return { title: 'Order update', body: `${code} is now ${String(d.status ?? '').toLowerCase().replace(/_/g, ' ')}.` };
  }
}
