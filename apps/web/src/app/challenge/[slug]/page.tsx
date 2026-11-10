import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { clip, formatDate, rupees } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { challengeLd } from '@/lib/seo';
import { challengeStage } from '@/lib/status';
import { absolute, site } from '@/lib/site';
import type { Challenge } from '@/lib/types';
import { Facts, JsonLd, OpenInApp, Tag } from '@/components/site';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => get<Challenge>(`/challenges/${encodeURIComponent(slug)}`);
const PROOF: Record<string, string> = {
  POST: 'Share a post',
  TEXT: 'Write a few words',
  NONE: 'Just check in',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return { title: 'Challenge not found', robots: { index: false } };
  return pageMeta({
    title: `${c.title}: pet challenge`,
    description: clip(
      `${challengeStage(c)}, ${formatDate(c.startsAt)} to ${formatDate(c.endsAt)}. Check in ${c.requiredCheckIns} times${c.badge ? ` to earn the ${c.badge.name} badge` : ''}. ${c.description ?? ''}`,
    ),
    path: webPath('challenge', c.slug),
    image: c.bannerUrl,
  });
}

export default async function ChallengePage({ params }: Props) {
  const c = await load((await params).slug);
  if (!c) notFound();
  return (
    <>
      <JsonLd data={challengeLd(site.url, c, absolute(webPath('challenge', c.slug)))} />
      <Tag
        title={c.title}
        image={c.badge?.iconUrl}
        imageAlt={c.badge ? `${c.badge.name} badge` : undefined}
        kicker={challengeStage(c)}
      >
        {formatDate(c.startsAt)} to {formatDate(c.endsAt)}
      </Tag>
      {c.description && (
        <p className="mt-8 max-w-prose whitespace-pre-line text-lg">{c.description}</p>
      )}
      <div className="mt-6">
        <Facts
          items={[
            ['To join', c.feePaise ? rupees(c.feePaise) : 'Free'],
            ['Check-ins to finish', String(c.requiredCheckIns)],
            ['Each check-in', PROOF[c.proof] ?? c.proof],
            ['Points per check-in', String(c.pointsPerCheckIn)],
            ['Taking part', c.participants.toLocaleString('en-IN')],
            ['Badge', c.badge?.name],
          ]}
        />
      </div>
      <OpenInApp kind="challenge" keyValue={c.slug} label="Join and check in with PetApp" />
    </>
  );
}
