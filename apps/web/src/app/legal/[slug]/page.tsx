import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { clip, formatDate } from '@/lib/format';
import { pageMeta } from '@/lib/meta';
import type { LegalDoc } from '@/lib/types';
import { Markdown } from '@/components/markdown';
import { Tag } from '@/components/site';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) =>
  /^[a-z-]{2,60}$/.test(slug) ? get<LegalDoc>(`/legal/${slug}`) : Promise.resolve(null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await load((await params).slug);
  if (!d) return { title: 'Not found', robots: { index: false } };
  const first = d.body.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  return pageMeta({
    title: d.title,
    description: clip(first) || `PetApp ${d.title}.`,
    path: `/legal/${d.slug}`,
    type: 'article',
  });
}

export default async function LegalPage({ params }: Props) {
  const d = await load((await params).slug);
  if (!d) notFound();
  return (
    <article>
      <Tag title={d.title}>
        Version {d.version}, in effect from {formatDate(d.effectiveAt)}
      </Tag>
      <div className="mt-10">
        <Markdown source={d.body} />
      </div>
    </article>
  );
}
