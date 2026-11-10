import Link from 'next/link';
import type { TargetPreview } from '@/lib/types';
import { StatusTag } from '@/components/ui';
import { CHAT_SIDES, stars } from '@/lib/labels';

/** What was reported, shown even if it is now hidden or removed. */
export function TargetCard({
  target,
  compact = false,
}: {
  target: TargetPreview;
  compact?: boolean;
}) {
  if (!target.exists) return <p className="text-sm text-muted">This no longer exists.</p>;
  const media = target.media ?? [];
  const thumb = (m: (typeof media)[number]) =>
    m.kind === 'IMAGE'
      ? (m.images?.find((i) => i.width <= 640)?.url ?? m.images?.[0]?.url)
      : m.poster;
  return (
    <div className={`flex gap-3 ${compact ? 'items-center' : 'flex-col'}`}>
      {media.length > 0 && (
        <div className={`flex gap-2 ${compact ? '' : 'flex-wrap'}`}>
          {media.slice(0, compact ? 1 : 4).map((m) => {
            const src = thumb(m);
            return (
              <span
                key={m.id}
                className={`relative block shrink-0 overflow-hidden rounded-md bg-line-soft ${compact ? 'h-12 w-12' : 'h-48 w-48'}`}
              >
                {src ? (
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted">
                    {m.status.toLowerCase()}
                  </span>
                )}
                {m.kind === 'VIDEO' && (
                  <span className="absolute bottom-1 left-1 rounded bg-ink/75 px-1 text-[10px] font-medium text-white">
                    Video{m.durationMs ? ` ${Math.round(m.durationMs / 1000)} s` : ''}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {target.kind === 'POST' && (
          <p className={`text-sm ${compact ? 'truncate' : 'whitespace-pre-wrap'}`}>
            {target.caption || <span className="text-muted">No caption</span>}
          </p>
        )}
        {target.kind === 'COMMENT' && (
          <p className={`text-sm ${compact ? 'truncate' : 'whitespace-pre-wrap'}`}>
            “{target.body}”
          </p>
        )}
        {target.kind === 'PET' && (
          <p className="text-sm">
            <span className="font-medium">{target.name}</span>{' '}
            <span className="text-muted">@{target.handle}</span>
            {!compact && target.about && (
              <span className="mt-1 block text-muted">{target.about}</span>
            )}
          </p>
        )}
        {target.kind === 'USER' && (
          <p className="text-sm font-medium">{target.name ?? 'No name'}</p>
        )}
        {target.kind === 'PRODUCT' && (
          <p className="text-sm">
            <span className="font-medium">{target.name}</span>
            {target.body && (
              <span
                className={`block text-muted ${compact ? 'truncate' : 'mt-1 whitespace-pre-wrap'}`}
              >
                {target.body}
              </span>
            )}
            {!compact && target.blockReason && (
              <span className="mt-1 block text-xs text-danger">Blocked: {target.blockReason}</span>
            )}
          </p>
        )}
        {(target.kind === 'SERVICE_REVIEW' || target.kind === 'PRODUCT_REVIEW') && (
          <div className="text-sm">
            <p className={compact ? 'truncate' : 'whitespace-pre-wrap'}>
              <span className="font-medium" aria-label={`${target.rating ?? 0} of 5 stars`}>
                {stars(target.rating ?? 0)}
              </span>{' '}
              {target.body ? `“${target.body}”` : <span className="text-muted">No words</span>}
            </p>
            {!compact && (
              <p className="mt-1 text-xs text-muted">
                about{' '}
                {target.kind === 'SERVICE_REVIEW'
                  ? target.partner?.businessName
                  : `${target.name} from ${target.vendor?.businessName ?? 'a seller'}`}
              </p>
            )}
            {!compact && target.reply && (
              <p className="mt-2 rounded-md border border-line-soft bg-paper px-3 py-2 text-[13px]">
                <span className="mr-2 text-xs font-medium text-muted">Business replied</span>
                {target.reply}
              </p>
            )}
          </div>
        )}
        {target.kind === 'SERVICE_PARTNER' && (
          <p className="text-sm">
            <span className="font-medium">{target.name}</span>
            {target.body && (
              <span className={`block text-muted ${compact ? 'truncate' : 'mt-1 whitespace-pre-wrap'}`}>
                {target.body}
              </span>
            )}
            {!compact && (
              <span className="mt-1 block text-xs text-muted">
                {target.ratingCount ? `${target.rating} ★ from ${target.ratingCount} reviews · ` : ''}
                <a href={`/partners/${target.partnerId}`} className="text-teal hover:underline">
                  Open the business
                </a>
              </span>
            )}
          </p>
        )}
        {target.kind === 'CONTEST_ENTRY' && (
          <p className="text-sm">
            <span className="font-medium">{target.name}</span>
            {target.contest && <span className="text-muted"> in {target.contest.title}</span>}
            {!compact && target.body && (
              <span className="mt-1 block whitespace-pre-wrap text-muted">{target.body}</span>
            )}
          </p>
        )}
        {target.kind === 'CHAT_MESSAGE' && (
          <div className="text-sm">
            <p className={compact ? 'truncate' : 'whitespace-pre-wrap'}>
              {target.body ? `“${target.body}”` : <span className="text-muted">Photo</span>}
            </p>
            {!compact && target.conversation && (
              <p className="mt-1 text-xs text-muted">
                Private chat between {target.conversation.customer.name ?? 'a customer'} and{' '}
                {target.conversation.kind === 'SUPPORT'
                  ? 'PetApp support'
                  : (target.conversation.business ?? 'a business')}
                . Shown here only because it was reported.
              </p>
            )}
            {!compact && target.context && target.context.length > 1 && (
              <ol className="mt-3 flex flex-col gap-1.5 rounded-md border border-line-soft bg-paper p-3">
                {target.context.map((m) => (
                  <li
                    key={m.id}
                    className={`text-[13px] ${m.reported ? 'rounded bg-warn-wash px-2 py-1' : ''}`}
                  >
                    <span className="mr-2 text-xs font-medium text-muted">
                      {CHAT_SIDES[m.side] ?? m.side}
                    </span>
                    {m.status !== 'VISIBLE' ? (
                      <span className="italic text-muted">removed</span>
                    ) : (
                      (m.body ?? (m.mediaId ? <span className="text-muted">Photo</span> : ''))
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          {target.author &&
            (compact ? (
              // Rows are already links; a nested link would be invalid HTML.
              <span>by {target.author.name ?? 'no name'}</span>
            ) : (
              <Link href={`/users/${target.author.id}`} className="hover:underline">
                by {target.author.name ?? 'no name'}
              </Link>
            ))}
          {target.status && <StatusTag status={target.status} />}
        </p>
      </div>
    </div>
  );
}
