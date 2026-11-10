import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import { PREVIEW_CITIES } from '@/lib/labels';
import type { HomePreview, HomeSection, PreviewItem } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Home screen preview' };

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** A one-line description of an item, whatever kind of section it's in. */
function describe(kind: string, x: PreviewItem): { name: string; detail: string | null } {
  switch (kind) {
    case 'FEATURED_REELS': {
      const author = x.author as { name?: string } | undefined;
      return {
        name: str(x.caption)?.slice(0, 80) || 'Reel',
        detail: author?.name ? `by ${author.name}` : null,
      };
    }
    case 'TRENDING_PETS': {
      const sp = x.species as { name?: string } | undefined;
      return {
        name: `${str(x.name)} (@${str(x.handle)})`,
        detail: [sp?.name, str(x.city)].filter(Boolean).join(', ') || null,
      };
    }
    case 'NEARBY_SERVICES':
      return {
        name: str(x.businessName) ?? '',
        detail: [
          typeof x.distanceKm === 'number' ? `${x.distanceKm} km` : null,
          typeof x.fromPaise === 'number' ? `from ${formatPaise(x.fromPaise)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    case 'RECOMMENDED_PRODUCTS': {
      const v = x.vendor as { businessName?: string } | undefined;
      return {
        name: str(x.title) ?? '',
        detail: [typeof x.fromPaise === 'number' ? formatPaise(x.fromPaise) : null, v?.businessName]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'PARTNER_OFFERS': {
      const v = x.vendor as { businessName?: string } | null;
      return {
        name: str(x.code) ?? '',
        detail: [str(x.description), v?.businessName ?? 'PetApp'].filter(Boolean).join(' · '),
      };
    }
    case 'UPCOMING_EVENTS':
      return { name: str(x.title) ?? '', detail: `${str(x.label)} ${formatDateTime(str(x.at))}` };
    default:
      return { name: str(x.title) ?? '', detail: null };
  }
}

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="the home screen" />;
  const city = sp.city && PREVIEW_CITIES[sp.city] ? sp.city : 'Mumbai';
  const at = PREVIEW_CITIES[city];
  const [preview, all] = await Promise.all([
    api<HomePreview>('/admin/home-sections/preview', { query: { city, lat: at.lat, lng: at.lng } }),
    api<HomeSection[]>('/admin/home-sections'),
  ]);
  const byId = new Map(all.map((s) => [s.id, s]));

  return (
    <>
      <PageHeader
        back={{ href: '/home-screen', label: 'Home screen' }}
        title="Preview"
        description="What someone signed out sees right now, from the centre of the city you choose. Signed-in people also get picks for their pets and history, their own bookings and deadlines, and sections limited to their pets."
        actions={
          <form className="flex items-center gap-2">
            <label htmlFor="city" className="text-sm text-muted">
              City
            </label>
            <select id="city" name="city" defaultValue={city} className={`${inputClass} w-40`}>
              {Object.keys(PREVIEW_CITIES).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 rounded-md border border-line px-3 text-sm hover:bg-paper"
            >
              Show
            </button>
          </form>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {preview.sections.length === 0 && (
            <Panel>
              <p className="px-4 py-8 text-center text-sm text-muted">
                No sections have anything to show here. The app shows only the feed.
              </p>
            </Panel>
          )}
          {preview.sections.map((s) => (
            <Panel
              key={s.id}
              title={
                <span>
                  {s.title}
                  {s.subtitle && (
                    <span className="ml-2 text-sm font-normal text-muted">{s.subtitle}</span>
                  )}
                </span>
              }
              actions={
                <Link href={`/home-screen/${s.id}`} className="text-sm text-teal hover:underline">
                  Edit
                </Link>
              }
            >
              <ol className="divide-y divide-line-soft">
                {s.items.map((x, i) => {
                  const d = describe(s.kind, x);
                  return (
                    <li
                      key={x.id}
                      className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="mr-2 tabular-nums text-muted">{i + 1}</span>
                        <span className="font-medium">{d.name}</span>
                        {d.detail && <span className="ml-2 text-muted">{d.detail}</span>}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {x.pinned && <Tag tone="teal">Pinned</Tag>}
                        {x.reason && <Tag>{x.reason}</Tag>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          ))}
        </div>

        <Panel title="Not shown here">
          {preview.skipped.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">Every active section is shown.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {preview.skipped.map((k) => {
                const s = byId.get(k.id);
                return (
                  <li key={k.id} className="px-4 py-2.5 text-sm">
                    <Link href={`/home-screen/${k.id}`} className="font-medium hover:underline">
                      {s?.title ?? 'Section'}
                    </Link>
                    <span className="block text-muted">
                      {k.why[0].toUpperCase() + k.why.slice(1)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
            Switched-off sections aren’t listed.
          </p>
        </Panel>
      </div>
    </>
  );
}
