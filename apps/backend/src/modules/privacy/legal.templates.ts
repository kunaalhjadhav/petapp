/**
 * Starting drafts for PetApp's legal documents, written for an Indian consumer app (DPDP Act 2023, IT Act 2000 and
 * the IT Rules 2021, Consumer Protection (E-Commerce) Rules 2020). They are templates, not legal advice: a lawyer must
 * review them, and every {{placeholder}} must be filled in before a version can be published (publishing refuses
 * text that still has placeholders).
 */

export interface LegalTemplate {
  slug: string;
  title: string;
  /** People must accept it: everyone for terms and privacy; partners and sellers for their terms; contest terms before entering. */
  requiresAcceptance: boolean;
  /** Who is asked to accept it. */
  audience: 'everyone' | 'partners' | 'sellers' | 'contestants';
  body: string;
}

const CONTACT = `## Contact and grievances

Grievance Officer: {{Grievance Officer name}}, {{Company legal name}}, {{Registered address}}.
Email: {{grievance email}}. We acknowledge complaints within 48 hours and resolve them within one month.`;

export const LEGAL_TEMPLATES: LegalTemplate[] = [
  {
    slug: 'terms-of-service',
    title: 'Terms of Service',
    requiresAcceptance: true,
    audience: 'everyone',
    body: `# Terms of Service

These terms are an agreement between you and {{Company legal name}} ("PetApp", "we"), {{Registered address}}, for using the PetApp apps and website.

## Your account
- You must be 18 or older to use PetApp (or use it with a parent or guardian's permission and supervision).
- Keep your sign-in secure. You are responsible for what happens in your account.
- Give accurate information about yourself and your pets.

## What you post
- You keep ownership of the photos, videos and text you post. You give PetApp a licence to host, show and share them within PetApp and to promote PetApp, until you delete them.
- Only post content you have the right to post. Follow the Community Guidelines.
- We may hide or remove content, and suspend accounts, that break these terms or the law. You can ask us to review a decision.

## Contests and challenges
Contests are governed by the Contest Terms and each contest's own rules. Paid contests run only after PetApp's legal review for that contest.

## Services and shop
- Pet services are provided by independent service partners, and products are sold by independent sellers. PetApp runs the marketplace and takes payment on their behalf.
- Refunds and cancellations follow the Refund Policy and the Cancellation Policy.
- Prices include GST unless shown otherwise.

## Payments
Payments are processed by {{Payment gateway}}. We never see or store your card details.

## PetApp Assistant
The assistant gives general information. It is not veterinary advice and doesn't replace a vet.

## Liability
PetApp is provided "as is". To the extent the law allows, we are not liable for indirect losses, or for the acts of service partners, sellers or other users. Nothing in these terms limits rights you have under the Consumer Protection Act, 2019.

## Changes and ending
We may update these terms. We'll tell you about important changes in the app, and ask you to accept them again. You can delete your account at any time in Settings.

## Law
These terms are governed by the laws of India. Courts in {{City}} have jurisdiction.

${CONTACT}
`,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    requiresAcceptance: true,
    audience: 'everyone',
    body: `# Privacy Policy

This policy explains how {{Company legal name}} ("PetApp", "we") handles your personal data, in line with the Digital Personal Data Protection Act, 2023.

## What we collect
- **Account:** your mobile number, name, and email if you add one.
- **Pets:** profiles you create, including optional health records.
- **Content:** photos, videos, captions, comments, votes and reports. Location metadata is removed from photos and videos when they are processed.
- **Transactions:** orders, bookings, contest entries, payments and refunds, and invoices. For payouts and prizes: your bank account or UPI ID (account numbers are encrypted) and PAN where tax law needs it.
- **Location:** only when you allow it, to find nearby services, and only while you're using the app.
- **Use of the app:** pages you view in the shop, services and contests (for recommendations, if you allow it), and device and log data for security.
- **Assistant chats:** your questions to PetApp Assistant and its answers.

## Why we use it
To run your account and the features you use; to process payments, refunds and payouts; to keep PetApp safe (moderation, fraud prevention, including automated checks that staff review); to recommend things you may like (you can turn this off); to send notifications you can control; and to meet legal and tax duties.

## Who we share it with
- **Service partners and sellers:** what they need to serve you, such as your name, your pet and the delivery or visit address.
- **Service providers:** payments ({{Payment gateway}}), payouts, SMS, push notifications, cloud hosting ({{Cloud provider, region}}) and, when enabled, AI processing for moderation and the assistant ({{AI provider}}).
- **Authorities:** where the law requires it.

We don't sell your personal data.

## How long we keep it
- **Most data:** while your account is open.
- **Viewing history:** {{90}} days.
- **Assistant chats:** {{30}} days.
- **After you delete your account:** personal details are erased after a {{14}}-day grace period. Records that tax and accounting law require us to keep (invoices, payments, refunds, payouts) are kept for {{8}} years, without your profile.

## Your rights
In the app you can:
- see and correct your information
- download a copy of your data (Settings → Your data)
- withdraw consent for marketing and personalised recommendations
- delete pets, posts and your account

You can also nominate someone to exercise your rights. You can complain to our Grievance Officer, and then to the Data Protection Board of India.

## Children
PetApp is for adults. If a child uses it, a parent or guardian must consent and supervise.

## Security
Encryption in transit, encrypted bank details, access controls and audit logs for staff, and regular security testing.

${CONTACT}
`,
  },
  {
    slug: 'contest-terms',
    title: 'Contest Terms',
    requiresAcceptance: true,
    audience: 'contestants',
    body: `# Contest Terms

These terms apply to every PetApp contest, together with the contest's own rules shown on its page.

## Entering
- **Who can enter:** you must be 18 or older and a resident of India. Each contest page says which pets can enter and how many places there are.
- **Your entry:** it must be your own pet and your own content.
- **Entry fees:** shown before you pay, including GST. An entry is confirmed only once payment is verified.

## How winners are decided
Contests are decided on skill: the judges' scores against published criteria, and public votes where the contest says so. The weighting is shown on each contest page. Votes that look automated or fraudulent are held and may not count.

## Prizes
- **The prize pool:** shown on each contest page.
- **TDS:** prize money is paid after tax deducted at source (TDS) as required by the Income-tax Act. Winners must provide a PAN and a bank account or UPI ID in their own name.
- **When it's paid:** prizes are paid within {{30}} days of results.

## Cancellation and refunds
If PetApp cancels a contest, or it doesn't reach its minimum number of entries, every entry fee is refunded in full to the original payment method. If you withdraw before entries close, refunds follow the contest's rules.

## Disqualification
We may disqualify entries that break these terms, the contest rules or the Community Guidelines, or that use fake votes. Fees for disqualified entries are not refunded.

## Publicity
Winners agree that PetApp may show their pet's name, photos and entry in PetApp and its promotions.

${CONTACT}
`,
  },
  {
    slug: 'refund-policy',
    title: 'Refund Policy',
    requiresAcceptance: false,
    audience: 'everyone',
    body: `# Refund Policy

## Shop orders
- **Cancelled before it ships:** each parcel can be cancelled before it ships, for a full refund of that parcel.
- **Returns:** most products can be returned within {{7}} days of delivery if unused and in original packaging. Some items (opened food, medicines, hygiene products) can't be returned unless they arrive damaged or wrong. The seller decides each return; the refund is made once the item is received back.

## Service bookings
Refunds follow the Cancellation Policy. If the partner cancels or doesn't turn up, you get a full refund.

## Contests and challenges
Entry fees are refunded in full if PetApp cancels the contest or challenge. Other cases follow the Contest Terms.

## How refunds are paid
- **Where to:** refunds go back to the original payment method.
- **Timing:** they usually reach you within {{5–7}} working days after we start them, depending on your bank.
- **Tracking:** Settings → Payments and refunds shows each refund's status and its bank reference.

${CONTACT}
`,
  },
  {
    slug: 'cancellation-policy',
    title: 'Cancellation Policy',
    requiresAcceptance: false,
    audience: 'everyone',
    body: `# Cancellation Policy

## Service bookings
- **Your cancellations:**
  - more than {{24}} hours before the start: full refund
  - between {{24}} and {{2}} hours before: {{50}}% refund
  - less than {{2}} hours before, or not being there: no refund
- **Partner cancellations:** if the partner cancels, you get a full refund.
- **Changing the time:** to change the time, cancel and book again; the rules above apply.

## Shop orders
You can cancel a parcel until the seller ships it, for a full refund of that parcel.

## Unpaid bookings and orders
Places and stock are held for {{30}} minutes while you pay, then released automatically.

${CONTACT}
`,
  },
  {
    slug: 'partner-terms',
    title: 'Service Partner Terms',
    requiresAcceptance: true,
    audience: 'partners',
    body: `# Service Partner Terms

These terms apply to businesses and individuals offering pet services on PetApp ("partners").

## Joining
- Provide accurate business details and the documents we ask for. Keep your licences and registrations valid.
- PetApp reviews applications and may approve, reject or suspend a partner.

## Your services
- You provide the services yourself, as described, at the booked time, with proper care for animals and in line with animal welfare laws.
- Keep your hours, prices and availability up to date.
- Don't take payment for PetApp bookings outside PetApp.

## Fees and payouts
- **Commission:** PetApp charges the commission shown for each category (or as agreed in writing), plus GST on it.
- **Tax:** TDS and other taxes are deducted where the law requires.
- **Payouts:** earnings are paid to your verified bank account or UPI ID after the holding period, on the payout schedule shown in the partner app.
- **Late cancellations:** if a customer cancels late, you earn the share set out in the Cancellation Policy.

## Customers' data
Use customers' details only to provide the booked service. Don't contact them for other purposes, and keep their data secure.

## Reviews and conduct
Customers can review you. Don't post fake reviews or pressure customers. Follow the Community Guidelines.

## Ending
Either side can end this agreement. Bookings already confirmed must still be honoured or properly cancelled.

${CONTACT}
`,
  },
  {
    slug: 'vendor-terms',
    title: 'Seller Terms',
    requiresAcceptance: true,
    audience: 'sellers',
    body: `# Seller Terms

These terms apply to sellers of products on PetApp.

## Joining
- Provide accurate business details, your GSTIN where required, PAN, and the documents we ask for.
- PetApp reviews applications and may approve, reject or suspend a seller.

## Listings
- List only genuine, safe, legal products that you are allowed to sell.
- Give the details the Consumer Protection (E-Commerce) Rules require: maximum retail price, country of origin and seller details.
- Keep prices, stock and descriptions accurate.

## Orders
Ship confirmed orders within {{2}} working days, with tracking. Accept returns under the Refund Policy.

## Fees, taxes and payouts
- **Commission:** PetApp charges the commission shown for each category (or as agreed), plus GST on it.
- **Tax collected and deducted:** PetApp collects TCS under GST and deducts TDS under section 194-O as the law requires. These appear on your statement.
- **Payouts:** earnings are paid after the return window, to your verified bank account or UPI ID.
- **Invoices:** PetApp issues tax invoices to customers in your name.

## Customers' data
Use customers' details only to fulfil their orders.

## Ending
Either side can end this agreement. Orders already confirmed must still be fulfilled or properly cancelled.

${CONTACT}
`,
  },
  {
    slug: 'community-guidelines',
    title: 'Community Guidelines',
    requiresAcceptance: false,
    audience: 'everyone',
    body: `# Community Guidelines

PetApp is a friendly place for pets and the people who love them.

- **Be kind.** No harassment, hate, threats or bullying.
- **Keep animals safe.** No content showing cruelty, fighting, or dangerous handling. No selling animals in ways that break the law.
- **Be real.** No fake accounts, fake votes, spam or scams. Contest entries must be your own pet.
- **Respect privacy.** Don't post other people's personal information.
- **Keep it suitable for everyone.** No sexual or graphic content.
- **Follow the law,** including copyright: only post what you have the right to post.

Content may be checked automatically. Moderators decide on anything flagged or reported. Breaking these guidelines can lead to content being removed or accounts suspended. Report anything that worries you from the ⋮ menu.

${CONTACT}
`,
  },
];

/** Text that must be replaced before a document can be published. */
export const PLACEHOLDER = /\{\{[^}]+\}\}/;
