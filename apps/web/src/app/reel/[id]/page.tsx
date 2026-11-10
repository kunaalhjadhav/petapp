import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { clip, formatDate } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { postLd } from '@/lib/seo';
import { absolute, site } from '@/lib/site';
import { pickImage, type Post } from '@/lib/types';
import { postTitle } from '@/lib/titles';
import { JsonLd, OpenInApp } from '@/components/site';

type Props = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const load = (id: string) => (UUID.test(id) ? get<Post>(`/posts/${id}`) : Promise.resolve(null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).id);
  if (!p) return { title: 'Post not found', robots: { index: false } };
  return pageMeta({
    title: postTitle(p),
    description: clip(p.caption) || `${postTitle(p)} on PetApp.`,
    path: webPath('reel', p.id),
    image: pickImage(p.media[0]),
    type: p.type === 'REEL' ? 'video.other' : 'article',
  });
}

export default async function ReelPage({ params }: Props) {
  const p = await load((await params).id);
  if (!p) notFound();
  const title = postTitle(p);
  return (
    <>
      <JsonLd data={postLd(site.url, p, absolute(webPath('reel', p.id)), title)} />
      <article className="mx-auto max-w-md">
        <h1 className="display mb-4 text-4xl font-extrabold">{title}</h1>
        <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-3xl">
          {p.media.map((m, i) => {
            const img = pickImage(m);
            return (
              <li
                key={m.id}
                className="relative w-full shrink-0 snap-center overflow-hidden rounded-3xl bg-card"
              >
                {img && (
                  <img
                    src={img}
                    alt={
                      m.kind === 'VIDEO'
                        ? `Still from ${title}`
                        : `${title}, picture ${i + 1} of ${p.media.length}`
                    }
                    width={m.width ?? undefined}
                    height={m.height ?? undefined}
                    className="h-auto w-full object-cover"
                  />
                )}
                {m.kind === 'VIDEO' && (
                  <p className="absolute inset-x-3 bottom-3 rounded-full bg-ink/80 px-4 py-2 text-center text-sm text-white">
                    Watch the reel in PetApp
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {p.caption && <p className="mt-4 whitespace-pre-line text-lg">{p.caption}</p>}
        {p.pets.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-2">
            {p.pets.map((x) => (
              <Link
                key={x.id}
                href={webPath('pet', x.handle)}
                className="rounded-full bg-collar-wash px-3 py-1 text-collar-deep hover:underline"
              >
                @{x.handle}
              </Link>
            ))}
          </p>
        )}
        <p className="mt-4 text-sm text-muted">
          {formatDate(p.publishedAt)}
          {p.locationName ? `, ${p.locationName}` : ''}.{' '}
          {Math.max(0, p.counts.likes).toLocaleString('en-IN')} likes,{' '}
          {Math.max(0, p.counts.comments).toLocaleString('en-IN')} comments.
        </p>
      </article>
      <OpenInApp kind="reel" keyValue={p.id} label="Like and comment in PetApp" />
    </>
  );
}
