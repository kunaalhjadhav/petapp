import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { age, clip } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { petLd } from '@/lib/seo';
import { absolute, site } from '@/lib/site';
import { pickImage, type Pet, type Post } from '@/lib/types';
import { Facts, JsonLd, OpenInApp, Section, Tag } from '@/components/site';

type Props = { params: Promise<{ handle: string }> };
const load = (handle: string) => get<Pet>(`/pets/${encodeURIComponent(handle)}`);
const describe = (p: Pet) => [p.breed?.name ?? p.species.name, p.city].filter(Boolean).join(' in ');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load(decodeURIComponent((await params).handle));
  if (!p) return { title: 'Pet not found', robots: { index: false } };
  return pageMeta({
    title: `${p.name} (@${p.handle})`,
    description:
      clip(p.about) || `${p.name} is a ${describe(p)} on PetApp. Follow for photos and reels.`,
    path: webPath('pet', p.handle),
    image: p.avatarUrl,
    type: 'profile',
    // Followers-only profiles show only their name here: keep them out of search results.
    noindex: p.restricted,
  });
}

export default async function PetPage({ params }: Props) {
  const p = await load(decodeURIComponent((await params).handle));
  if (!p) notFound();
  const posts = p.restricted ? null : await get<{ items: Post[] }>(`/pets/${p.id}/posts?limit=12`);
  const url = absolute(webPath('pet', p.handle));
  return (
    <>
      <JsonLd data={petLd(site.url, p, url)} />
      <Tag
        title={p.name}
        monogram
        image={p.avatarUrl}
        imageAlt={`${p.name}, a ${describe(p)}`}
        kicker={`@${p.handle}${p.isVerified ? ', verified' : ''}`}
      >
        {describe(p)}
      </Tag>

      {p.restricted ? (
        <p className="mt-8 max-w-prose text-muted">
          {p.name}’s profile is shared with followers only. Follow {p.name} in the app to see their
          photos and reels.
        </p>
      ) : (
        <>
          {p.about && <p className="mt-8 max-w-prose text-lg">{p.about}</p>}
          <div className="mt-6">
            <Facts
              items={[
                ['Species', p.species.name],
                ['Breed', p.breed?.name],
                ['Age', age(p.ageMonths)],
                ['Lives in', p.city],
                ['Followers', p.followerCount.toLocaleString('en-IN')],
                ['Personality', p.personality?.length ? p.personality.join(', ') : null],
              ]}
            />
          </div>
          {posts && posts.items.length > 0 && (
            <Section title="Latest posts">
              <ul className="grid grid-cols-3 gap-1.5">
                {posts.items.map((post) => {
                  const img = pickImage(post.media[0], 320);
                  return (
                    <li key={post.id}>
                      <Link
                        href={webPath('reel', post.id)}
                        className="block aspect-square overflow-hidden rounded-lg bg-card"
                      >
                        {img ? (
                          <img
                            src={img}
                            alt={
                              clip(post.caption, 100) ||
                              `A ${post.type === 'REEL' ? 'reel' : 'photo'} of ${p.name}`
                            }
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center p-2 text-center text-sm text-muted">
                            {clip(post.caption, 60)}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </>
      )}
      <OpenInApp kind="pet" keyValue={p.handle} label={`Follow ${p.name} on PetApp`} />
    </>
  );
}
