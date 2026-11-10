import { formatDate } from '@/lib/format';
import { pickImage, type RatingSummary, type Review } from '@/lib/types';
import { Section } from './site';

/** The star breakdown and the latest reviews. Every review is from a verified purchase or booking. */
export function Reviews({
  summary,
  reviews,
  what,
}: {
  summary?: RatingSummary;
  reviews: Review[];
  /** "purchase" or "booking" */
  what: 'purchase' | 'booking';
}) {
  if (!reviews.length && !summary?.count) return null;
  return (
    <Section title="Reviews">
      {summary && summary.count > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-6 rounded-2xl bg-card px-5 py-4">
          <p>
            <span className="display text-4xl font-bold">{summary.avg.toFixed(1)}</span>
            <span className="ml-1 text-muted">out of 5</span>
            <span className="block text-sm text-muted">
              {summary.count} review{summary.count === 1 ? '' : 's'}
            </span>
          </p>
          <ul className="flex min-w-48 flex-1 flex-col gap-1" aria-label="Ratings by stars">
            {summary.stars.map((s) => (
              <li key={s.stars} className="flex items-center gap-2 text-sm">
                <span className="w-12 tabular-nums text-muted">{s.stars} star</span>
                <span aria-hidden="true" className="relative h-2 flex-1 overflow-hidden rounded-full bg-line">
                  <span
                    className="absolute inset-y-0 left-0 bg-brass"
                    style={{ width: `${summary.count ? (s.count / summary.count) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums text-muted">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {reviews.slice(0, 6).map((r) => (
          <li key={r.id} className="rounded-2xl bg-card px-5 py-4">
            <p className="text-sm text-muted">
              <span className="text-brass" aria-hidden="true">
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </span>{' '}
              <span className="sr-only">{r.rating} out of 5. </span>
              {r.by}, {formatDate(r.at)}
              {r.verified && <span className="ml-2 font-medium text-ink">Verified {what}</span>}
              {r.variantTitle && <span className="ml-2">· {r.variantTitle}</span>}
            </p>
            {r.comment && <p className="mt-1">{r.comment}</p>}
            {r.photos.length > 0 && (
              <ul className="mt-3 flex gap-2">
                {r.photos.map((m, i) => {
                  const src = pickImage(m, 320);
                  return src ? (
                    <li key={m.id} className="h-20 w-20 overflow-hidden rounded-xl bg-line">
                      <img src={src} alt={`Photo ${i + 1} from ${r.by}’s review`} loading="lazy" className="h-full w-full object-cover" />
                    </li>
                  ) : null;
                })}
              </ul>
            )}
            {r.reply && (
              <p className="mt-2 border-l-2 border-brass pl-3 text-[15px] text-muted">Reply: {r.reply}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
