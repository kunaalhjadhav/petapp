import Link from 'next/link';
import type { Metadata } from 'next';
import { get } from '@/lib/api';
import { formatDate, rupees } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { websiteLd } from '@/lib/seo';
import { site } from '@/lib/site';
import { contestStage } from '@/lib/status';
import type { Contest } from '@/lib/types';
import { JsonLd, Section, StoreLinks, Tag } from '@/components/site';

export const metadata: Metadata = pageMeta({
  title: 'PetApp: pets, reels, contests, care and shopping',
  description:
    'Share your pet’s best moments, enter contests, book groomers and vets nearby, and shop for pet supplies, in one app.',
  path: '/',
});

const THINGS: Array<[string, string]> = [
  [
    'A profile for every pet',
    'Photos, reels, vaccinations and milestones in one place, with a handle friends can follow.',
  ],
  [
    'Contests and challenges',
    'Enter your pet, get votes from friends, win prizes. Daily challenges earn badges.',
  ],
  [
    'Care nearby',
    'Groomers, vets, trainers and boarding near you, with prices, open hours and reviews. Book a time in the app.',
  ],
  [
    'A shop for pets',
    'Food, treats, toys and care products from verified sellers, delivered to your door.',
  ],
];

export default async function Home() {
  const live = (await get<Contest[]>('/contests?when=live&limit=3').catch(() => null)) ?? [];
  return (
    <>
      <JsonLd data={websiteLd(site.url)} />
      <Tag title="Every pet deserves a name tag">
        A home for your pet’s best moments, and everything they need.
      </Tag>
      <div className="mt-8">
        <StoreLinks />
      </div>

      <ul className="mt-12 grid gap-x-8 gap-y-7 sm:grid-cols-2">
        {THINGS.map(([title, text]) => (
          <li key={title}>
            <h2 className="display text-[1.7rem] font-bold">{title}</h2>
            <p className="mt-1 text-muted">{text}</p>
          </li>
        ))}
      </ul>

      {live.length > 0 && (
        <Section title="Contests open now">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card">
            {live.map((c) => (
              <li key={c.id}>
                <Link
                  href={webPath('contest', c.slug)}
                  className="block px-5 py-4 hover:bg-collar-wash"
                >
                  <span className="block font-medium">{c.title}</span>
                  <span className="text-sm text-muted">
                    {contestStage(c)}.{' '}
                    {c.feePaise ? `Entry ${rupees(c.feePaise)}` : 'Free to enter'}, closes{' '}
                    {formatDate(c.registrationClosesAt)}.
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
