import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet';

const variants: Record<Variant, string> = {
  primary: 'bg-teal text-white hover:bg-teal-hover',
  secondary: 'bg-panel text-ink border border-line hover:border-muted',
  danger: 'bg-danger text-white hover:brightness-95',
  quiet: 'text-teal hover:bg-teal-wash',
};

export function buttonClass(variant: Variant = 'secondary', size: 'md' | 'sm' = 'md') {
  return [
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
    size === 'md' ? 'h-9 px-3.5 text-sm' : 'h-8 px-2.5 text-[13px]',
    variants[variant],
  ].join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...p
}: ComponentProps<'button'> & { variant?: Variant; size?: 'md' | 'sm' }) {
  return <button {...p} className={`${buttonClass(variant, size)} ${className}`} />;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-block text-sm text-muted hover:text-ink">
            {back.label}
          </Link>
        )}
        <h1 className="text-title font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  children,
  actions,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'teal';
const tones: Record<Tone, string> = {
  neutral: 'bg-line-soft text-muted',
  good: 'bg-good-wash text-good',
  warn: 'bg-warn-wash text-warn',
  danger: 'bg-danger-wash text-danger',
  teal: 'bg-teal-wash text-teal',
};

export function Tag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  ACTIVE: 'good',
  SUSPENDED: 'warn',
  BLOCKED: 'danger',
  PENDING_DELETION: 'neutral',
  DELETED: 'neutral',
  HIDDEN: 'warn',
  REMOVED: 'danger',
  PUBLISHED: 'good',
  VISIBLE: 'good',
  PROCESSING: 'neutral',
  FAILED: 'danger',
  OPEN: 'warn',
  RESOLVED: 'neutral',
};
const statusLabel: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  BLOCKED: 'Blocked',
  PENDING_DELETION: 'Deletion requested',
  DELETED: 'Deleted',
  HIDDEN: 'Hidden',
  REMOVED: 'Removed',
  PUBLISHED: 'Published',
  VISIBLE: 'Visible',
  PROCESSING: 'Processing',
  FAILED: 'Failed',
  OPEN: 'Open',
  RESOLVED: 'Resolved',
};
export function StatusTag({ status }: { status: string }) {
  return <Tag tone={statusTone[status] ?? 'neutral'}>{statusLabel[status] ?? status}</Tag>;
}

export function Monogram({
  text,
  tone = 'neutral',
  size = 32,
}: {
  text: string;
  tone?: 'neutral' | 'teal' | 'warm';
  size?: number;
}) {
  const bg =
    tone === 'teal'
      ? 'bg-teal-wash text-teal'
      : tone === 'warm'
        ? 'bg-warn-wash text-warn'
        : 'bg-line-soft text-muted';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${bg}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {text}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'h-9 w-full rounded-md border border-line bg-panel px-3 text-sm placeholder:text-faint hover:border-muted focus:border-teal focus:outline-none';

export function Input(p: ComponentProps<'input'>) {
  return <input {...p} className={`${inputClass} ${p.className ?? ''}`} />;
}

export function Select({ children, ...p }: ComponentProps<'select'>) {
  return (
    <select {...p} className={`${inputClass} pr-8 ${p.className ?? ''}`}>
      {children}
    </select>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[52ch] text-sm text-muted">{children}</div>}
    </div>
  );
}

export function NoAccess({ what }: { what: string }) {
  return (
    <Panel>
      <Empty title={`You can’t view ${what}`}>
        Your role doesn’t include this permission. Ask a super admin if you need it.
      </Empty>
    </Panel>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}

/** Definition list used on record pages. */
export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
