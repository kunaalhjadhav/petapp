import Link from 'next/link';
import type { Metadata } from 'next';
import { get } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { pageMeta } from '@/lib/meta';
import type { LegalSummary } from '@/lib/types';
import { Tag } from '@/components/site';

export const metadata: Metadata = pageMeta({
  title: 'Policies and terms',
  description:
    'PetApp’s terms, privacy policy, refund and cancellation policies, partner and seller terms, and community guidelines.',
  path: '/legal',
});

export default async function LegalIndex() {
  const docs = (await get<LegalSummary[]>('/legal')) ?? [];
  return (
    <>
      <Tag title="Policies and terms" />
      {docs.length === 0 ? (
        <p className="mt-8 text-muted">Our policies will be published here soon.</p>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl bg-card">
          {docs.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/legal/${d.slug}`}
                className="flex items-baseline justify-between gap-4 px-5 py-4 hover:bg-collar-wash"
              >
                <span className="font-medium">{d.title}</span>
                <span className="text-sm text-muted">since {formatDate(d.effectiveAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
