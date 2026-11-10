/**
 * What the PetApp Assistant knows without looking anything up: where things are in the app, and a small set of
 * general pet-care notes. Care notes are deliberately general, mainstream advice that always ends with the vet;
 * they are not a substitute for one. Pure data and matching, unit-tested.
 */

export interface AppGuide {
  id: string;
  title: string;
  /** The app screen it opens. */
  route: string;
  steps: string[];
  keywords: RegExp;
}

export const APP_GUIDE: AppGuide[] = [
  { id: 'add-pet', title: 'Add a pet', route: '/pets/new', steps: ['Open Me.', 'Tap Add pet.', 'Enter your pet’s name, species and birthday, then save.'], keywords: /\b(add|create|new|register)\b.{0,20}\bpet\b|\bpet profile\b/i },
  { id: 'post', title: 'Post a photo or reel', route: '/create', steps: ['Tap Create at the bottom.', 'Choose photos or a video (a reel).', 'Write a caption, tag your pets, then Post.'], keywords: /\b(post|upload|share)\b.{0,20}\b(photo|picture|video|reel)\b|\b(make|create) a reel\b/i },
  { id: 'book', title: 'Book a pet service', route: '/services', steps: ['Open Services from Home.', 'Pick a category and a partner near you.', 'Choose the service, your pet and a time, then pay to confirm.'], keywords: /\bhow (do|can) i book\b|\bbook(ing)? (a|an)? ?(service|groom|vet|appointment|slot)\b|\bmake a booking\b/i },
  { id: 'bookings', title: 'Your bookings: change or cancel', route: '/my-bookings', steps: ['Open Services, then My bookings.', 'Tap a booking to see its details.', 'Cancel from there; the refund follows the partner’s cancellation rules.'], keywords: /\b(my bookings?|cancel (my |a )?booking|reschedul\w*|change (my )?booking)\b/i },
  { id: 'orders', title: 'Your orders, returns and cancellations', route: '/orders', steps: ['Open Shop, then My orders.', 'Tap an order to track each parcel.', 'Cancel before it ships, or ask for a return within the return window after delivery.'], keywords: /\b(my orders?|track (my )?(order|parcel)|return (an? )?(item|order|product)|cancel (my |an )?order|where is my order)\b/i },
  { id: 'refunds', title: 'Refunds and payments', route: '/money', steps: ['Open Me, then the wallet icon.', 'Refunds shows each refund, its status and the bank reference.'], keywords: /\b(refunds?|money back|payment (failed|status)|charged twice)\b/i },
  { id: 'invoices', title: 'Invoices', route: '/money/invoices', steps: ['Open Me, then the wallet icon.', 'Tap Invoices and open one to download the PDF.'], keywords: /\b(invoices?|bills?|gst bill|receipt)\b/i },
  { id: 'prizes', title: 'Prize money and your payout account', route: '/money/prizes', steps: ['Open Me, then the wallet icon, then Prize money.', 'Add your UPI ID or bank account to be paid.'], keywords: /\b(prize money|payout account|get paid|upi id|bank account)\b/i },
  { id: 'contests', title: 'Enter a contest', route: '/contests', steps: ['Open Contests from Home.', 'Choose an open contest and read its rules.', 'Tap Enter, pick your pet, and pay the fee if there is one.', 'Submit your entry before the deadline.'], keywords: /\b(enter|join|register for) (a |the )?contest\b|\bhow (do|does) .{0,20}contests? work\b/i },
  { id: 'vote', title: 'Vote in a contest', route: '/contests', steps: ['Open a contest that is in voting.', 'Open the leaderboard or an entry and tap Vote.', 'Each contest sets how many votes you get per day.'], keywords: /\bvot(e|es|ing)\b/i },
  { id: 'challenges', title: 'Join a challenge', route: '/challenges', steps: ['Open Challenges from Home.', 'Join one, then check in each day to build your streak and earn points and badges.'], keywords: /\b(join|start) (a )?challenge\b|\bcheck[- ]?in\b|\bstreak\b|\bbadges?\b/i },
  { id: 'notifications', title: 'Notification settings', route: '/settings', steps: ['Open Me, then Settings.', 'Turn each kind of notification on or off.'], keywords: /\bnotifications?\b|\balerts?\b/i },
  { id: 'privacy', title: 'Recommendations and privacy', route: '/settings', steps: ['Open Me, then Settings.', 'Under Recommendations, turn personalisation off or clear your viewing history.'], keywords: /\b(personali[sz]\w*|recommendations?|viewing history|privacy)\b/i },
  { id: 'report', title: 'Report or block someone', route: '/home', steps: ['On the post, comment or profile, tap the ⋮ menu.', 'Choose Report (a moderator reviews it) or Block (you stop seeing each other).'], keywords: /\b(report|block|harass\w*|abuse|spam)\b/i },
  { id: 'delete-account', title: 'Delete your account', route: '/settings', steps: ['Open Me, then Settings.', 'Tap Delete account and confirm.'], keywords: /\bdelete (my )?account\b|\bclose (my )?account\b/i },
  { id: 'follow', title: 'Follow people and pets', route: '/search', steps: ['Search for a pet or open someone’s profile.', 'Tap Follow. Their posts appear in your Home feed.'], keywords: /\bfollow\w*\b/i },
];

export function findGuide(text: string): AppGuide | null {
  return APP_GUIDE.find((g) => g.keywords.test(text)) ?? null;
}

export interface CareNote {
  id: string;
  title: string;
  body: string;
  keywords: RegExp;
}

const VET = ' Your vet knows your pet and can advise for them specifically.';

export const CARE_NOTES: CareNote[] = [
  {
    id: 'vaccines',
    title: 'Vaccinations',
    body:
      'Puppies and kittens usually start vaccines at around 6–8 weeks, with boosters every few weeks until about 16 weeks, then boosters as advised. Rabies vaccination is especially important in India. Deworming and tick and flea prevention are usually part of the same plan.' +
      VET +
      ' You can keep the record in your pet’s profile.',
    keywords: /\bvaccin\w*|\bjabs?\b|\bboosters?\b|\brabies\b|\bdeworm\w*/i,
  },
  {
    id: 'toxic-foods',
    title: 'Foods and things that are poisonous to pets',
    body:
      'Keep these away from pets: chocolate, grapes and raisins, onions and garlic, xylitol (in sugar-free gum and some peanut butters), alcohol, caffeine, cooked bones, and human medicines such as paracetamol and ibuprofen. Lilies are very dangerous for cats. If your pet has eaten any of these, contact a vet straight away, even if they seem fine.',
    keywords: /\b(toxic|poisonous|safe (to|for) (eat|dogs?|cats?)|can (dogs?|cats?|my \w+) (eat|have)|is \w+ (safe|bad|ok|okay) for)\b/i,
  },
  {
    id: 'heat',
    title: 'Keeping pets safe in the heat',
    body:
      'Never leave a pet in a parked car, even briefly. Walk early in the morning or in the evening, check the pavement with the back of your hand, and give shade and fresh water all day. Flat-faced breeds (pugs, bulldogs, Persian cats) overheat easily. Heavy panting, drooling, weakness or collapse can mean heatstroke: move them somewhere cool, wet them with cool (not ice-cold) water and go to a vet.',
    keywords: /\b(heat|hot weather|summer|panting|sun)\b/i,
  },
  {
    id: 'feeding',
    title: 'Feeding basics',
    body:
      'Choose a complete food made for your pet’s life stage (puppy/kitten, adult or senior). Young pets eat smaller meals more often. Use the pack’s guide as a starting point and adjust to keep a healthy shape, with treats making up only a small part of the day’s food. Change foods gradually over about a week, and always keep fresh water out.' +
      VET,
    keywords: /\b(feed\w*|food|diet|meals?|how much (should|to) (i )?feed|eat(ing)?|treats?|weight|overweight|fat)\b/i,
  },
  {
    id: 'parasites',
    title: 'Ticks, fleas and worms',
    body:
      'Ticks and fleas are common, especially in the monsoon. Check your pet’s coat, ears and between the toes after walks, and use a preventive your vet recommends regularly. Some ticks carry serious diseases, so tell your vet if your pet seems tired, pale or off their food after a tick bite.' +
      VET,
    keywords: /\b(ticks?|fleas?|worms?|mites?|scratch\w*|itch\w*)\b/i,
  },
  {
    id: 'grooming',
    title: 'Grooming and coat care',
    body:
      'Brush regularly (daily for long coats), bathe only as often as needed with a pet shampoo, trim nails when you hear them on the floor, and check ears for redness or smell. A groomer can help with coat trims and nail clipping; you can book one in Services.',
    keywords: /\b(groom\w*|brush\w*|bath\w*|shampoo|coat|shedd\w*|nails?|hair)\b/i,
  },
  {
    id: 'dental',
    title: 'Teeth',
    body:
      'Brush with a pet toothpaste (never human toothpaste), a few times a week if you can. Dental chews help a little. Bad breath, red gums or dropping food can mean dental pain, so ask your vet to check.',
    keywords: /\b(teeth|tooth|dental|breath|gums?)\b/i,
  },
  {
    id: 'exercise',
    title: 'Exercise and play',
    body:
      'Most dogs need daily walks plus play; how much depends on age, breed and health. Cats need play too: short sessions with a wand toy, scratching posts and places to climb. Puzzle feeders and short training sessions keep minds busy. Build up slowly with puppies and older pets.',
    keywords: /\b(exercise|walks?|play\w*|bored|energy|toys?|enrichment)\b/i,
  },
];

export function findCareNote(text: string): CareNote | null {
  return CARE_NOTES.find((n) => n.keywords.test(text)) ?? null;
}

/** Words people use for each kind of service, matched against category keys and names. */
export const SERVICE_WORDS: Array<[RegExp, string[]]> = [
  [/\b(vets?|veterinar\w*|doctor|clinic|hospital|check-?up)\b/i, ['vet', 'veterinar', 'clinic']],
  [/\b(groom\w*|haircut|hair cut|bath|spa|nail)\b/i, ['groom', 'spa']],
  [/\b(walk\w*)\b/i, ['walk']],
  [/\b(board\w*|hostel|stay|kennel)\b/i, ['board']],
  [/\b(train\w*|obedience|behaviou?r)\b/i, ['train']],
  [/\b(day ?care|daycare)\b/i, ['daycare', 'day-care', 'day care']],
  [/\b(sit(ter|ting)?|pet sit\w*)\b/i, ['sit']],
  [/\b(photo\w*|shoot)\b/i, ['photo']],
];

/** The service category a question is about, from the ones that exist. */
export function matchCategory<T extends { key: string; name: string }>(text: string, categories: T[]): T | null {
  for (const [re, roots] of SERVICE_WORDS) {
    if (!re.test(text)) continue;
    const hit = categories.find((c) => roots.some((r) => c.key.toLowerCase().includes(r) || c.name.toLowerCase().includes(r)));
    if (hit) return hit;
  }
  return null;
}

const STOP = new Set(
  'a an and any are best buy can cheap do find for get good have i in is me my need of on please recommend search shop show some something the to want what where which with you your products product items item'.split(' '),
);

/** Shop search words from a question: "find good puppy food for Bruno" → "puppy food". */
export function shopQuery(text: string, petNames: string[] = []): string {
  const names = new Set(petNames.map((n) => n.toLowerCase()));
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !names.has(w))
    .slice(0, 4)
    .join(' ');
}

export type Intent = 'contest_rules' | 'contests' | 'challenges' | 'bookings' | 'services' | 'products' | 'app_help' | 'pet_care' | 'hello';

/** What the built-in assistant (no AI model) thinks a question is about. Order matters: most specific first. */
export function intentOf(text: string): Intent {
  const t = text.toLowerCase();
  if (/\b(rules?|judg\w*|how (are|is) .{0,20}(scored|judged|decided)|prize|fee|eligib\w*|deadline)\b/.test(t) && /\bcontest/.test(t)) return 'contest_rules';
  if (/\b(my bookings?|cancel (my |a )?booking|reschedul\w*|upcoming (booking|appointment))\b/.test(t)) return 'bookings';
  if (/\bhow (do|can|should) i\b|\bwhere (is|are|do|can)\b|\bhelp (me )?with the app\b/.test(t) && findGuide(t)) return 'app_help';
  if (/\b(contests?|competitions?|compete)\b/.test(t)) return 'contests';
  if (/\b(challenges?)\b/.test(t)) return 'challenges';
  if (SERVICE_WORDS.some(([re]) => re.test(t)) && /\b(find|near|nearby|book|need|looking|recommend|good|best|around|in my area|service)\b/.test(t)) return 'services';
  if (/\b(buy|shop|order|food|kibble|treats?|toys?|leash|collar|harness|bed|bowl|litter|shampoo|products?)\b/.test(t) && /\b(buy|shop|find|need|recommend|best|good|want|get|looking)\b/.test(t)) return 'products';
  if (findGuide(t)) return 'app_help';
  if (findCareNote(t)) return 'pet_care';
  return 'hello';
}
