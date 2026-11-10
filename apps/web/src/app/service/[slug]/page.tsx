import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { get } from '@/lib/api';
import { clip, clock, rupees, WEEKDAYS } from '@/lib/format';
import { webPath } from '@/lib/links';
import { pageMeta } from '@/lib/meta';
import { partnerLd } from '@/lib/seo';
import { absolute } from '@/lib/site';
import type { Partner } from '@/lib/types';
import { JsonLd, OpenInApp, Rating, Section, Tag } from '@/components/site';
import { Reviews } from '@/components/reviews';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => get<Partner>(`/service-partners/${encodeURIComponent(slug)}`);
const categories = (p: Partner) => [...new Set(p.services.map((s) => s.category.name))];
const MODES: Record<string, string> = {
  AT_CENTER: 'At the centre',
  AT_HOME: 'At your home',
  ONLINE: 'Online',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: 'Not found', robots: { index: false } };
  const where = [p.area, p.city].filter(Boolean).join(', ');
  return pageMeta({
    title: `${p.businessName}: ${categories(p).join(', ') || 'pet services'} in ${where}`,
    description: clip(
      `${p.about ?? `${categories(p).join(', ')} for pets in ${where}.`} Book online with PetApp${p.ratingCount ? `, rated ${p.ratingAvg.toFixed(1)} out of 5` : ''}.`,
    ),
    path: webPath('service', p.slug),
  });
}

export default async function ServicePage({ params }: Props) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const days = new Map(p.hours.map((h) => [h.weekday, h]));
  return (
    <>
      <JsonLd data={partnerLd(p, absolute(webPath('service', p.slug)))} />
      <Tag title={p.businessName} monogram kicker={categories(p).join(', ')}>
        <span className="block">{[p.area, p.city].filter(Boolean).join(', ')}</span>
        <Rating avg={p.ratingAvg} count={p.ratingCount} />
      </Tag>

      {p.about && <p className="mt-8 max-w-prose text-lg">{p.about}</p>}
      {p.homeVisitRadiusKm > 0 && (
        <p className="mt-4 text-muted">Also visits homes within {p.homeVisitRadiusKm} km.</p>
      )}

      <Section title="Services">
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card">
          {p.services.map((s) => (
            <li key={s.id} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{s.name}</span>
                <span className="font-semibold tabular-nums">{rupees(s.pricePaise)}</span>
              </div>
              <p className="text-sm text-muted">
                {s.durationMin} min, {s.modes.map((m) => MODES[m]?.toLowerCase() ?? m).join(' or ')}
              </p>
              {s.description && <p className="mt-1 text-[15px]">{s.description}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Opening hours">
        <table className="w-full max-w-sm text-[15px]">
          <tbody>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const h = days.get(d);
              return (
                <tr key={d} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 text-left font-normal text-muted">
                    {WEEKDAYS[d]}
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {h ? `${clock(h.opensMin)} to ${clock(h.closesMin)}` : 'Closed'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-muted">
          {p.addressLine}, {[p.area, p.city].filter(Boolean).join(', ')}
        </p>
      </Section>

      <Reviews summary={p.ratingSummary} reviews={p.reviews} what="booking" />
      <OpenInApp kind="service" keyValue={p.slug} label="Pick a time and book in PetApp" />
    </>
  );
}
