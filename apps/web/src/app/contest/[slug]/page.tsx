import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { clip, formatDateTime, rupees } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { contestLd } from '@/lib/seo';
import { contestStage } from '@/lib/status';
import { absolute, site } from '@/lib/site';
import type { Contest } from '@/lib/types';
import { Facts, JsonLd, OpenInApp, Section, Tag } from '@/components/site';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => get<Contest>(`/contests/${encodeURIComponent(slug)}`);
const prizeText = (p: Contest['prizes'][number]) =>
  p.kind === 'CASH' && p.amountPaise ? rupees(p.amountPaise) : (p.description ?? p.title);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return { title: 'Contest not found', robots: { index: false } };
  const top = c.prizes.find((p) => p.rank === 1);
  return pageMeta({
    title: `${c.title}: pet contest`,
    description: clip(
      `${contestStage(c)}. ${c.feePaise ? `Entry ${rupees(c.feePaise)}` : 'Free to enter'}${top ? `, winner gets ${prizeText(top)}` : ''}. ${c.description ?? ''}`,
    ),
    path: webPath('contest', c.slug),
    image: c.bannerUrl,
  });
}

export default async function ContestPage({ params }: Props) {
  const c = await load((await params).slug);
  if (!c) notFound();
  const judged = 100 - c.publicWeight;
  return (
    <>
      <JsonLd data={contestLd(site.url, c, absolute(webPath('contest', c.slug)))} />
      {c.bannerUrl && (
        <img
          src={c.bannerUrl}
          alt=""
          className="mb-6 aspect-[3/1] w-full rounded-3xl object-cover"
        />
      )}
      <Tag title={c.title} kicker={c.category?.name}>
        <strong className="font-semibold text-collar-deep">{contestStage(c)}</strong>
      </Tag>
      {c.cancelReason && (
        <p className="mt-6 text-alert">{c.cancelReason}. Entry fees are refunded in full.</p>
      )}
      {c.description && (
        <p className="mt-8 max-w-prose whitespace-pre-line text-lg">{c.description}</p>
      )}

      <div className="mt-6">
        <Facts
          items={[
            ['Entry', c.feePaise ? rupees(c.feePaise) : 'Free'],
            ['Entries', `${c.entries}${c.maxParticipants ? ` of ${c.maxParticipants}` : ''}`],
            ['Entries close', formatDateTime(c.registrationClosesAt)],
            ['Voting closes', formatDateTime(c.votingClosesAt)],
            [
              'Winners chosen by',
              judged <= 0
                ? 'Public votes'
                : c.publicWeight <= 0
                  ? 'Judges'
                  : `Judges (${judged}%) and public votes (${c.publicWeight}%)`,
            ],
            ['Votes per person', c.publicWeight > 0 ? `${c.votesPerUserPerDay} a day` : null],
          ]}
        />
      </div>

      {c.prizes.length > 0 && (
        <Section title="Prizes">
          <ol className="flex flex-col gap-2">
            {[...c.prizes]
              .sort((a, b) => a.rank - b.rank)
              .map((p) => (
                <li
                  key={`${p.rank}-${p.title}`}
                  className="flex items-baseline justify-between gap-4 rounded-2xl bg-card px-5 py-3.5"
                >
                  <span>{p.title}</span>
                  <span className="font-semibold">{prizeText(p)}</span>
                </li>
              ))}
          </ol>
          <p className="mt-2 text-sm text-muted">
            Cash prizes are paid after TDS, as the Income-tax Act requires.
          </p>
        </Section>
      )}

      {c.tasks.length > 0 && (
        <Section title="What to submit">
          <ol className="flex list-decimal flex-col gap-2 pl-6">
            {c.tasks.map((t) => (
              <li key={t.id}>
                {t.title}
                {t.description && (
                  <span className="block text-[15px] text-muted">{t.description}</span>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {c.rules && (
        <Section title="Rules">
          <p className="max-w-prose whitespace-pre-line">{c.rules}</p>
        </Section>
      )}
      <OpenInApp kind="contest" keyValue={c.slug} label="Enter your pet or vote in PetApp" />
    </>
  );
}
