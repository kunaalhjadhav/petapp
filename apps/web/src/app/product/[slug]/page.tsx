import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { clip, rupees } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { breadcrumbs, productLd } from '@/lib/seo';
import { absolute, site } from '@/lib/site';
import { pickImage, type Product } from '@/lib/types';
import { JsonLd, OpenInApp, Rating, Section, Tag } from '@/components/site';
import { Reviews } from '@/components/reviews';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => get<Product>(`/products/${encodeURIComponent(slug)}`);
const from = (p: Product) =>
  p.variants.length ? Math.min(...p.variants.map((v) => v.pricePaise)) : null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: 'Product not found', robots: { index: false } };
  const price = from(p);
  return pageMeta({
    title: `${p.title}${p.brand ? ` by ${p.brand}` : ''}`,
    description: clip(
      `${price !== null ? `${p.variants.length > 1 ? 'From ' : ''}${rupees(price)}. ` : ''}${p.description ?? ''} Sold by ${p.vendor.businessName}.`,
    ),
    path: webPath('product', p.slug),
    image: pickImage(p.images[0]),
  });
}

export default async function ProductPage({ params }: Props) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const url = absolute(webPath('product', p.slug));
  const price = from(p);
  return (
    <>
      <JsonLd
        data={[
          productLd(p, url),
          breadcrumbs(site.url, [
            ['Shop', '/'],
            [p.category?.name ?? 'Products', '/'],
            [p.title, webPath('product', p.slug)],
          ]),
        ]}
      />
      <Tag
        title={p.title}
        image={pickImage(p.images[0], 320)}
        imageAlt={p.title}
        kicker={p.brand ?? p.category?.name}
      >
        {price !== null && (
          <span className="text-xl font-semibold text-ink">
            {p.variants.length > 1 ? 'From ' : ''}
            {rupees(price)}
          </span>
        )}
        {!!p.ratingCount && (
          <span className="mt-1 block text-sm text-muted">
            <Rating avg={p.ratingAvg ?? 0} count={p.ratingCount} />
          </span>
        )}
      </Tag>

      {p.images.length > 1 && (
        <ul className="mt-8 flex snap-x gap-2 overflow-x-auto">
          {p.images.map((m, i) => {
            const src = pickImage(m, 640);
            return src ? (
              <li
                key={m.id}
                className="w-60 shrink-0 snap-start overflow-hidden rounded-2xl bg-card"
              >
                <img
                  src={src}
                  alt={`${p.title}, picture ${i + 1}`}
                  loading="lazy"
                  className="aspect-square h-full w-full object-cover"
                />
              </li>
            ) : null;
          })}
        </ul>
      )}

      {p.description && (
        <p className="mt-8 max-w-prose whitespace-pre-line text-lg">{p.description}</p>
      )}

      <Section title="Sizes and prices">
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card">
          {p.variants.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-4 px-5 py-3.5">
              <span>
                {v.title}
                {!v.inStock && <span className="ml-2 text-sm text-alert">Out of stock</span>}
              </span>
              <span className="text-right tabular-nums">
                {v.mrpPaise > v.pricePaise && (
                  <s className="mr-2 text-sm text-muted">{rupees(v.mrpPaise)}</s>
                )}
                <span className="font-semibold">{rupees(v.pricePaise)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">
          Prices include GST. Delivery charges are shown at checkout.
        </p>
      </Section>

      <Section title="Sold by">
        <p className="font-medium">
          {p.vendor.businessName}
          {p.vendor.city ? `, ${p.vendor.city}` : ''}
        </p>
        <p className="text-sm text-muted">
          <Rating avg={p.vendor.ratingAvg} count={p.vendor.ratingCount} />
        </p>
      </Section>
      <Reviews summary={p.ratingSummary} reviews={p.reviews ?? []} what="purchase" />
      <OpenInApp kind="product" keyValue={p.slug} label="Buy it in PetApp" />
    </>
  );
}
