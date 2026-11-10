import { likeText } from '../../common/utils/search';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../marketplace/orders.service';
import { ContestsService } from '../contests/contests.service';
import { BookingsService } from '../services/bookings.service';
import { PlatformService } from '../platform/platform.service';
import { ProductsQuery } from '../marketplace/marketplace.dto';
import { NearbyQuery } from '../services/services.dto';
import { RecoService, type Who } from '../recommendations/reco.service';
import type { ToolSpec } from '../../providers/ai/assistant.provider';
import { findCareNote, findGuide, matchCategory, shopQuery } from './assistant.knowledge';

/** Something shown under an answer. `item` has the same shape as elsewhere in the API (product card, contest card…). */
export type Card =
  | { type: 'SERVICE' | 'PRODUCT' | 'CONTEST' | 'CHALLENGE'; item: { id: string } & Record<string, unknown> }
  | { type: 'BOOKING'; item: { id: string; code: string; title: string; petName: string; startsAt: Date; status: string } }
  | { type: 'LINK'; item: { id: string; title: string; route: string; steps: string[] } }
  | { type: 'CARE'; item: { id: string; title: string; body: string } };

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'find_services',
    description: 'Find approved pet-service partners near the person (grooming, vets, walking, boarding, training, day care…). Needs their location; returns name, distance, rating and starting price. Use for "near me", booking and "find a vet" questions.',
    input_schema: { type: 'object', properties: { category: { type: 'string', description: 'What kind of service, in the person’s words, e.g. "grooming" or "vet". Omit for any.' }, home_visit: { type: 'boolean', description: 'Only partners who come to the home' } } },
  },
  {
    name: 'find_products',
    description: 'Search the PetApp shop. Without a query, returns products picked for the person’s pets. Returns title, price, seller and stock.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search words, e.g. "puppy food" or "cat litter"' } } },
  },
  {
    name: 'find_contests',
    description: 'Contests open for entries that the person’s pets can enter (then ones open for voting), with fee and closing date.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'contest_details',
    description: 'The rules of one contest: who can enter, fee, deadlines, how winners are decided (judges and public votes), prizes and the tasks to submit. Use to explain contest rules.',
    input_schema: { type: 'object', properties: { contest: { type: 'string', description: 'The contest’s name (or part of it) or slug' } }, required: ['contest'] },
  },
  {
    name: 'find_challenges',
    description: 'Challenges running now or starting soon, and the person’s progress in ones they joined.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'my_bookings',
    description: 'The person’s upcoming service bookings (service, partner, pet, time, status).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'app_help',
    description: 'How to do something in the PetApp app (add a pet, post a reel, book, cancel, returns, refunds, invoices, prize payouts, contests, voting, challenges, notifications, privacy, reporting, deleting the account). Returns the steps and the screen.',
    input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'What they want to do, in their words' } }, required: ['topic'] },
  },
  {
    name: 'pet_care',
    description: 'A short general note on a pet-care topic (vaccinations, poisonous foods, heat, feeding, ticks and fleas, grooming, teeth, exercise). General information only.',
    input_schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  },
];

/** Runs the assistant's tools for one person and collects the cards to show with the answer. */
@Injectable()
export class AssistantTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly reco: RecoService,
    private readonly orders: OrdersService,
    private readonly contests: ContestsService,
    private readonly bookings: BookingsService,
  ) {}

  /** The tools switched on (shop, services and contests follow their feature switches). */
  async specs(): Promise<ToolSpec[]> {
    const f = await this.platform.flags();
    const off = new Set([
      ...(f.ENABLE_SERVICES ? [] : ['find_services', 'my_bookings']),
      ...(f.ENABLE_MARKETPLACE ? [] : ['find_products']),
      ...(f.ENABLE_CONTESTS ? [] : ['find_contests', 'contest_details', 'find_challenges']),
    ]);
    return TOOL_SPECS.filter((t) => !off.has(t.name));
  }

  session(who: Who, allowed: ToolSpec[]) {
    const cards: Card[] = [];
    const add = (c: Card) => {
      if (!cards.some((x) => x.type === c.type && x.item.id === c.item.id)) cards.push(c);
    };
    const run = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
      if (!allowed.some((t) => t.name === name)) return { error: 'That isn’t available right now.' };
      switch (name) {
        case 'find_services':
          return this.services(who, str(input.category), input.home_visit === true, add);
        case 'find_products':
          return this.products(who, str(input.query), add);
        case 'find_contests': {
          const list = await this.reco.contests(who, 5);
          list.forEach((c) => add({ type: 'CONTEST', item: c }));
          return { results: list.map((c) => ({ title: c.title, fee: c.feePaise ? rupees(c.feePaise) : 'free', entriesClose: c.registrationClosesAt, status: c.status, why: c.reason })) };
        }
        case 'contest_details':
          return this.contestDetails(who, str(input.contest), add);
        case 'find_challenges': {
          const list = await this.reco.challenges(who, 5);
          list.forEach((c) => add({ type: 'CHALLENGE', item: c }));
          return { results: list.map((c) => ({ title: c.title, starts: c.startsAt, ends: c.endsAt, checkInsNeeded: c.requiredCheckIns, taking_part: c.participants, joined: !!c.mine, why: c.reason })) };
        }
        case 'my_bookings':
          return this.myBookings(who, add);
        case 'app_help': {
          const g = findGuide(str(input.topic));
          if (!g) return { found: false, note: 'No guide for that. Describe the main parts of the app instead: Home, Reels, Create, Alerts, Me.' };
          add({ type: 'LINK', item: { id: g.id, title: g.title, route: g.route, steps: g.steps } });
          return { found: true, title: g.title, steps: g.steps };
        }
        case 'pet_care': {
          const n = findCareNote(str(input.topic));
          if (!n) return { found: false, note: 'No note on that. Give brief general information and suggest asking a vet.' };
          add({ type: 'CARE', item: { id: n.id, title: n.title, body: n.body } });
          return { found: true, title: n.title, note: n.body };
        }
        default:
          return { error: `Unknown tool ${name}` };
      }
    };
    return { run, cards };
  }

  private async services(who: Who, category: string, homeVisit: boolean, add: (c: Card) => void) {
    const cats = await this.prisma.serviceCategory.findMany({ where: { isActive: true }, select: { id: true, key: true, name: true } });
    const cat = category ? matchCategory(category, cats) : null;
    if (who.lat === undefined || who.lng === undefined) {
      add({ type: 'LINK', item: { id: 'services', title: 'Pet services', route: '/services', steps: ['Open Services and choose your location to see partners near you.'] } });
      return { needLocation: true, category: cat?.name ?? null, note: 'No location set. Ask them to choose a place on the Home screen, or open Services.' };
    }
    const q = Object.assign(new NearbyQuery(), { lat: who.lat, lng: who.lng, categoryId: cat?.id, mode: homeVisit ? 'AT_HOME' : undefined, sort: 'rating', page: 1, limit: 5 });
    const found = await this.bookings.nearby(q);
    found.items.forEach((p) => add({ type: 'SERVICE', item: p }));
    if (!found.items.length) add({ type: 'LINK', item: { id: 'services', title: 'Pet services', route: '/services', steps: ['Open Services to search other categories or another place.'] } });
    return {
      category: cat?.name ?? (category || null),
      unknownCategory: !!category && !cat,
      results: found.items.map((p) => ({ name: p.businessName, area: p.area ?? p.city, distanceKm: p.distanceKm, rating: p.ratingCount ? `${p.ratingAvg.toFixed(1)} (${p.ratingCount})` : 'new', from: rupees(p.fromPaise) })),
    };
  }

  private async products(who: Who, query: string, add: (c: Card) => void) {
    const words = shopQuery(query, who.pets.map((p) => p.name));
    // The whole phrase first, then its words, longest first ("dog food" → "food").
    const tries = words ? [words, ...words.split(' ').filter((w) => w.length > 2 && w !== words).sort((a, b) => b.length - a.length)] : [];
    for (const t of tries) {
      const q = Object.assign(new ProductsQuery(), { q: t, page: 1, limit: 5 });
      const found = (await this.orders.products(q)).items;
      found.forEach((p) => add({ type: 'PRODUCT', item: p }));
      if (found.length) return { query: t, results: found.map((p) => ({ title: p.title, price: rupees(p.fromPaise), seller: p.vendor.businessName, inStock: p.inStock })) };
    }
    const picks = await this.reco.products(who, 5);
    picks.forEach((p) => add({ type: 'PRODUCT', item: p }));
    return { query: words || null, nothingMatched: !!words, picksForTheirPets: picks.map((p) => ({ title: p.title, price: rupees(p.fromPaise), why: p.reason })) };
  }

  private async contestDetails(who: Who, name: string, add: (c: Card) => void) {
    const hit = name
      ? await this.prisma.contest.findFirst({
          where: { status: { notIn: ['DRAFT', 'REVIEW'] }, OR: [{ slug: name.toLowerCase() }, { title: { contains: likeText(name), mode: 'insensitive' } }] },
          orderBy: { registrationClosesAt: 'desc' },
          select: { slug: true, eligibleSpeciesIds: true },
        })
      : null;
    if (!hit) return { found: false, note: 'No contest by that name. Use find_contests to list open ones.' };
    const c = await this.contests.detail(hit.slug, who.userId);
    add({ type: 'CONTEST', item: c });
    const species = hit.eligibleSpeciesIds.length ? (await this.prisma.petSpecies.findMany({ where: { id: { in: hit.eligibleSpeciesIds } }, select: { name: true } })).map((s) => s.name) : ['any pet'];
    return {
      found: true,
      title: c.title,
      status: c.status,
      fee: c.feePaise ? rupees(c.feePaise) : 'free',
      whoCanEnter: species,
      entriesOpen: c.registrationOpensAt,
      entriesClose: c.registrationClosesAt,
      submissionsClose: c.submissionClosesAt,
      votingCloses: c.votingClosesAt,
      places: c.maxParticipants ? `${c.entries} of ${c.maxParticipants} taken` : `${c.entries} entered`,
      winners: `Judges decide ${100 - c.publicWeight}% of the score and public votes ${c.publicWeight}%; each person gets ${c.votesPerUserPerDay} vote(s) a day.`,
      judgedOn: c.judgingCriteria,
      prizes: c.prizes.map((p) => `${p.rank ? `#${p.rank} ` : ''}${p.title}${p.amountPaise ? ` (${rupees(p.amountPaise)})` : ''}`),
      tasks: c.tasks.map((t) => `${t.title}${t.required ? '' : ' (optional)'}`),
      rules: (c.rules ?? '').slice(0, 1500),
      theyEntered: c.viewer.entries.map((e) => ({ pet: e.pet.name, status: e.status })),
    };
  }

  private async myBookings(who: Who, add: (c: Card) => void) {
    if (!who.userId) return { results: [] };
    const rows = await this.prisma.booking.findMany({
      where: { customerId: who.userId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'] }, startsAt: { gte: new Date(Date.now() - 6 * 3_600_000) } },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: { id: true, code: true, startsAt: true, status: true, service: { select: { name: true } }, partner: { select: { businessName: true } }, pet: { select: { name: true } } },
    });
    for (const b of rows) add({ type: 'BOOKING', item: { id: b.id, code: b.code, title: `${b.service.name} at ${b.partner.businessName}`, petName: b.pet.name, startsAt: b.startsAt, status: b.status } });
    add({ type: 'LINK', item: { id: 'bookings', title: 'Your bookings: change or cancel', route: '/my-bookings', steps: ['Open Services, then My bookings.', 'Tap a booking to see it or cancel it.'] } });
    return { results: rows.map((b) => ({ code: b.code, service: b.service.name, partner: b.partner.businessName, pet: b.pet.name, startsAt: b.startsAt, status: b.status })) };
  }
}
