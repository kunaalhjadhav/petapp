/** Starting topics for support tickets and FAQs. Staff can rename, reorder, add or switch them off. */
export const SUPPORT_CATEGORIES: Array<{ key: string; name: string; audience: string; sortOrder: number }> = [
  { key: 'account', name: 'Account and signing in', audience: 'ALL', sortOrder: 10 },
  { key: 'payments', name: 'Payments and refunds', audience: 'ALL', sortOrder: 20 },
  { key: 'orders', name: 'Shop orders and returns', audience: 'CUSTOMER', sortOrder: 30 },
  { key: 'bookings', name: 'Service bookings', audience: 'CUSTOMER', sortOrder: 40 },
  { key: 'contests', name: 'Contests and challenges', audience: 'CUSTOMER', sortOrder: 50 },
  { key: 'partner-business', name: 'My business, services and bookings', audience: 'PARTNER', sortOrder: 60 },
  { key: 'seller-shop', name: 'My shop, products and orders', audience: 'SELLER', sortOrder: 70 },
  { key: 'payouts', name: 'Payouts, invoices and tax', audience: 'ALL', sortOrder: 80 },
  { key: 'safety', name: 'Safety, abuse or a report', audience: 'ALL', sortOrder: 90 },
  { key: 'app', name: 'Something isn’t working in the app', audience: 'ALL', sortOrder: 100 },
  { key: 'other', name: 'Something else', audience: 'ALL', sortOrder: 110 },
];

/**
 * First drafts of the help center, describing how PetApp works. Created unpublished: staff check them against their
 * own policies (refund windows, payout timing) and publish from the dashboard.
 */
export const SUPPORT_FAQS: Array<{ category: string; audience: string; question: string; answer: string }> = [
  {
    category: 'bookings', audience: 'CUSTOMER', question: 'How do I cancel a booking, and what do I get back?',
    answer: 'Open **My bookings** (from your profile or the Services tab), choose the booking and tap **Cancel booking**. Cancelling well ahead gets a full refund; close to the start time, a partial one; after it has started, none. Once it’s cancelled, the app shows how much is being refunded. The refund goes back to the way you paid.',
  },
  {
    category: 'payments', audience: 'ALL', question: 'When will my refund arrive?',
    answer: 'We send refunds to your bank or card straight away. Most banks show them within 5–7 working days. You can follow a refund on the order or booking, and you’ll get a notification when the payment gateway confirms it. If it hasn’t arrived after 7 working days, open a ticket and include the order or booking.',
  },
  {
    category: 'orders', audience: 'CUSTOMER', question: 'How do I return something I bought?',
    answer: 'Open **My orders** (from the Shop tab), choose the order and tap **Return** on the parcel, saying what’s wrong. Returns are possible for a few days after delivery. The seller approves the return; once they receive the parcel back, your refund is sent.',
  },
  {
    category: 'account', audience: 'ALL', question: 'How do I delete my account?',
    answer: 'Go to **Settings → Your data and privacy → Delete account**. You’re signed out everywhere straight away and your account is erased after a short grace period; signing in before then keeps it. You can download a copy of your data first from the same screen.',
  },
  {
    category: 'contests', audience: 'CUSTOMER', question: 'How does voting in contests work?',
    answer: 'Each contest sets how many votes you can give and how often (for example, one vote per entry per day). You can’t vote for your own pet. To keep results fair, votes from new or suspicious accounts may be checked before they count, and the final result can also include judges’ scores, as the contest page explains.',
  },
  {
    category: 'safety', audience: 'ALL', question: 'How do I report a person, a post or a message?',
    answer: 'Use the **⋯** menu on a post, profile or message and choose **Report**. Our moderators review every report. You can also block someone from the same menu: you won’t see each other’s posts, and neither of you can message the other.',
  },
  {
    category: 'payouts', audience: 'PARTNER', question: 'When are my earnings paid out?',
    answer: 'Earnings from a completed booking become payable after a short holding period, then go out in the next payout batch to your verified bank account or UPI ID. Your **Statement** shows each booking, PetApp’s fee, taxes deducted and every payout with its bank reference.',
  },
  {
    category: 'seller-shop', audience: 'SELLER', question: 'How do I ship an order?',
    answer: 'Open **Orders**, pack the parcel and tap **Mark packed**. When the courier collects it, tap **Mark shipped** and enter the courier and tracking number: the customer gets them straight away. Mark it delivered once it arrives.',
  },
];
