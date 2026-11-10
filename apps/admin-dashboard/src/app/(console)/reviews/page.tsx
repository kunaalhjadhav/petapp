import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, timeAgo } from '@/lib/format';
import { stars } from '@/lib/labels';
import type { AdminReview } from '@/lib/types';
import { Empty, Input, NoAccess, PageHeader, Panel, Select, Tag, buttonClass } from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';
import { ActionDialog } from '@/components/forms';
import { setReviewStatus } from './actions';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

/** Product and service reviews (spec §38). Every one comes from a delivered order or a completed booking. */
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTENT_READ)) return <NoAccess what="reviews" />;
  const kind = sp.kind === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
  const status = sp.status === 'VISIBLE' || sp.status === 'HIDDEN' ? sp.status : undefined;
  const { items, meta } = await apiPage<AdminReview>('/admin/reviews', {
    kind,
    status,
    stars: sp.stars,
    q: sp.q,
    page: sp.page,
    limit: 25,
  });
  const canModerate = can(me, PERMISSIONS.CONTENT_MODERATE);

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Ratings and reviews from people who bought the product or had the service. Hiding one removes it from the app and from the average straight away; the business and the reviewer still see it, marked hidden."
        actions={
          <Link href="/reports?targetType=PRODUCT_REVIEW" className={buttonClass('secondary')}>
            Reported reviews
          </Link>
        }
      />
      <Panel>
        <nav aria-label="Review kind" className="flex flex-wrap items-center gap-1 border-b border-line-soft px-4 py-2">
          {(
            [
              ['PRODUCT', 'Products'],
              ['SERVICE', 'Services'],
            ] as const
          ).map(([k, label]) => (
            <Link
              key={k}
              href={`/reviews?kind=${k}`}
              aria-current={kind === k ? 'page' : undefined}
              className={`rounded px-3 py-1.5 text-sm ${kind === k ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3" role="search">
          <input type="hidden" name="kind" value={kind} />
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search reviews
            </label>
            <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder={kind === 'PRODUCT' ? 'Words, product, seller or customer' : 'Words, business or customer'} />
          </div>
          <div>
            <label htmlFor="stars" className="sr-only">
              Stars
            </label>
            <Select id="stars" name="stars" defaultValue={sp.stars ?? ''}>
              <option value="">Any rating</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="status" className="sr-only">
              Status
            </label>
            <Select id="status" name="status" defaultValue={status ?? ''}>
              <option value="">Shown and hidden</option>
              <option value="VISIBLE">Shown</option>
              <option value="HIDDEN">Hidden</option>
            </Select>
          </div>
          <button className={buttonClass('secondary')}>Filter</button>
        </form>

        {items.length === 0 ? (
          <Empty title={sp.q || sp.stars || status ? 'No reviews match' : 'No reviews yet'}>
            {!sp.q ? 'Reviews appear once people rate what they bought or booked.' : undefined}
          </Empty>
        ) : (
          <>
            <Table head={['Review', kind === 'PRODUCT' ? 'Product' : 'Booking', 'By', 'Status', '']}>
              {items.map((r) => (
                <tr key={r.id} className="align-top hover:bg-paper">
                  <Td className="max-w-[46ch]">
                    <p className="text-sm">
                      <span className="font-medium text-warn" aria-label={`${r.rating} of 5 stars`}>
                        {stars(r.rating)}
                      </span>
                      <span className="ml-2 text-xs text-muted" title={formatDateTime(r.createdAt)}>
                        {timeAgo(r.createdAt)}
                      </span>
                    </p>
                    {r.comment ? <p className="mt-1 whitespace-pre-wrap text-sm">{r.comment}</p> : <p className="mt-1 text-sm text-muted">No words, just stars</p>}
                    {r.photos.length > 0 && (
                      <span className="mt-2 flex gap-1">
                        {r.photos.map((m) => {
                          const src = m.images?.find((i) => i.width <= 640)?.url ?? m.images?.[0]?.url;
                          return src ? (
                            <a key={m.id} href={m.images?.at(-1)?.url ?? src} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded border border-line-soft bg-line-soft">
                              <img src={src} alt="Review photo" className="h-full w-full object-cover" />
                            </a>
                          ) : null;
                        })}
                      </span>
                    )}
                    {r.reply && (
                      <p className="mt-2 rounded-md border border-line-soft bg-paper px-3 py-2 text-[13px]">
                        <span className="mr-2 text-xs font-medium text-muted">{r.business.name} replied</span>
                        {r.reply}
                      </p>
                    )}
                  </Td>
                  <Td className="text-sm">
                    {r.subject.label}
                    <span className="block text-xs text-muted">
                      {kind === 'PRODUCT' ? (
                        <Link href={`/shop/vendors/${r.business.id}`} className="hover:underline">
                          {r.business.name}
                        </Link>
                      ) : (
                        <Link href={`/partners/${r.business.id}`} className="hover:underline">
                          {r.business.name}
                        </Link>
                      )}
                    </span>
                  </Td>
                  <Td className="text-sm">
                    <Link href={`/users/${r.customer.id}`} className="hover:underline">
                      {r.customer.name ?? 'No name'}
                    </Link>
                    <span className="block text-xs text-muted">Verified {kind === 'PRODUCT' ? 'purchase' : 'booking'}</span>
                  </Td>
                  <Td>
                    <span className="flex flex-col items-start gap-1">
                      <Tag tone={r.status === 'VISIBLE' ? 'good' : 'warn'}>{r.status === 'VISIBLE' ? 'Shown' : 'Hidden'}</Tag>
                      {r.openCase && (
                        <Link href={`/moderation/${r.openCase.id}`} className="text-xs text-danger hover:underline">
                          {r.openCase.reports ? `${r.openCase.reports} report${r.openCase.reports === 1 ? '' : 's'}` : 'Flagged by AI'}
                        </Link>
                      )}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    {canModerate &&
                      (r.status === 'VISIBLE' ? (
                        <ActionDialog
                          label="Hide"
                          size="sm"
                          title="Hide this review?"
                          description="It disappears from the app and stops counting towards the rating. You can show it again later."
                          action={setReviewStatus.bind(null, kind, r.id, 'HIDDEN')}
                          submitLabel="Hide review"
                          danger
                        >
                          <label className="flex flex-col gap-1 text-sm">
                            Why
                            <Input name="note" required minLength={3} maxLength={500} placeholder="For the audit log" />
                          </label>
                        </ActionDialog>
                      ) : (
                        <ActionDialog
                          label="Show again"
                          size="sm"
                          title="Show this review again?"
                          description="It returns to the app and counts towards the rating again."
                          action={setReviewStatus.bind(null, kind, r.id, 'VISIBLE')}
                          submitLabel="Show review"
                        >
                          <label className="flex flex-col gap-1 text-sm">
                            Note (optional)
                            <Input name="note" maxLength={500} />
                          </label>
                        </ActionDialog>
                      ))}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pagination meta={meta} basePath="/reviews" params={{ kind, status, stars: sp.stars, q: sp.q }} />
          </>
        )}
      </Panel>
    </>
  );
}
