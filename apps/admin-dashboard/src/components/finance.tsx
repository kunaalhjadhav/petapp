import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatPaise } from '@/lib/money';
import type { Labelled } from '@/lib/finance';
import { Tag } from './ui';

/** An amount, right-aligned with even digits; negative amounts in red. */
export function Amount({
  paise,
  strong = false,
}: {
  paise: number | null | undefined;
  strong?: boolean;
}) {
  const neg = (paise ?? 0) < 0;
  return (
    <span
      className={`whitespace-nowrap tabular-nums ${strong ? 'font-semibold' : ''} ${neg ? 'text-danger' : ''}`}
    >
      {neg ? `−${formatPaise(-(paise as number))}` : formatPaise(paise)}
    </span>
  );
}

/** A labelled number on a summary strip. */
export function Stat({
  label,
  paise,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  paise?: number;
  value?: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: 'warn' | 'danger';
}) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''}`}
      >
        {paise !== undefined ? <Amount paise={paise} /> : value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-lg border border-line bg-panel px-4 py-3 hover:border-muted"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">{body}</div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export function StatusOf({ map, status }: { map: Labelled; status: string }) {
  const s = map[status];
  return <Tag tone={s?.tone ?? 'neutral'}>{s?.label ?? status}</Tag>;
}

/** Filter tabs that are plain links (the page reads them from the URL). */
export function Tabs({
  label,
  tabs,
  current,
  href,
}: {
  label: string;
  tabs: Array<{ key: string; label: string }>;
  current: string;
  href: (key: string) => string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-line-soft px-4 py-2">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={href(t.key)}
          aria-current={current === t.key ? 'page' : undefined}
          className={`rounded px-3 py-1.5 text-sm ${current === t.key ? 'bg-teal-wash font-medium text-teal' : 'text-muted hover:text-ink'}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Short id for display: the first block of a UUID. */
export const shortId = (id: string) => id.slice(0, 8);
