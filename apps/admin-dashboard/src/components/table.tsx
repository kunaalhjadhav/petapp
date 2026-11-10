import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PageMeta } from '@petapp/types';
import { formatNumber } from '@/lib/format';

/** `numeric` lists the columns (by index) holding amounts, whose headings are right-aligned to match. */
export function Table({
  head,
  children,
  numeric = [],
}: {
  head: string[];
  children: ReactNode;
  numeric?: number[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((h, i) => (
              <th
                key={`${i}:${h}`}
                scope="col"
                className={`whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted ${numeric.includes(i) ? 'text-right' : ''}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line-soft [&>tr:last-child]:border-0">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle ${className}`}>{children}</td>;
}

/** Page links that keep the current filters. */
export function Pagination({
  meta,
  basePath,
  params,
}: {
  meta: PageMeta;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (!meta.total) return null;
  const href = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'page') q.set(k, v);
    if (page > 1) q.set('page', String(page));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  const link =
    'inline-flex h-8 items-center rounded-md border border-line bg-panel px-3 text-sm hover:border-muted';
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-sm text-muted"
    >
      <span>
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(meta.total)}
      </span>
      <span className="flex gap-2">
        {meta.page > 1 && (
          <Link className={link} href={href(meta.page - 1)}>
            Previous
          </Link>
        )}
        {meta.page < meta.totalPages && (
          <Link className={link} href={href(meta.page + 1)}>
            Next
          </Link>
        )}
      </span>
    </nav>
  );
}
