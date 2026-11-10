import Link from 'next/link';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { describeAction, formatDateTime, timeAgo } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/labels';

function summary(e: AuditEntry): string | null {
  const after = e.after as Record<string, unknown> | null;
  const before = e.before as Record<string, unknown> | null;
  if (!after || typeof after !== 'object') return null;
  if (Array.isArray(after)) return `Now: ${after.join(', ')}`;
  const parts: string[] = [];
  const label = (v: unknown) => STATUS_LABELS[String(v)] ?? String(v);
  if ('status' in after)
    parts.push(
      before?.status
        ? `${label(before.status)} to ${label(after.status)}`
        : `Now ${label(after.status)}`,
    );
  if ('isVerified' in after) parts.push(after.isVerified ? 'Verified' : 'Unverified');
  if ('reason' in after && after.reason) parts.push(`“${String(after.reason)}”`);
  return parts.join('. ') || null;
}

/**
 * The record's history: every audited change to it, newest first.
 * Shown beside record pages so decisions are made with the past in view.
 */
/** Matches on the record id only: one thing can be audited under different type labels (moderation vs. pet edits). */
export async function Trail({ entityId }: { entityId: string; entityType?: string }) {
  const me = await getMe();
  if (!can(me, PERMISSIONS.AUDIT_READ)) return null;
  const { items, meta } = await apiPage<AuditEntry>('/admin/audit-logs', {
    entityId,
    limit: 15,
  });
  return (
    <aside aria-labelledby="trail-h" className="lg:sticky lg:top-20">
      <h2 id="trail-h" className="mb-3 text-[15px] font-semibold">
        History
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">No recorded changes yet.</p>
      ) : (
        <ol className="relative ml-1.5 border-l border-line">
          {items.map((e) => {
            const s = summary(e);
            return (
              <li key={e.id} className="relative pb-5 pl-5 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper bg-teal"
                />
                <p className="text-sm font-medium">{describeAction(e.action)}</p>
                {s && <p className="text-sm text-muted">{s}</p>}
                <p className="mt-0.5 text-xs text-faint">
                  <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
                    {timeAgo(e.createdAt)}
                  </time>
                  {e.actor ? ` by ${e.actor.name ?? e.actor.email}` : ' by the system'}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      {meta.total > items.length && (
        <Link
          href={`/audit?entityId=${entityId}`}
          className="mt-4 inline-block text-sm text-teal hover:underline"
        >
          See all {meta.total} entries
        </Link>
      )}
    </aside>
  );
}
