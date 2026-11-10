import Link from 'next/link';
import type { ReactNode } from 'react';
import { site } from '@/lib/site';
import { appUrl, type LinkKind } from '@/lib/links';
import { ldJson } from '@/lib/seo';

/** The tag shape on its own, used as the logo mark. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="6" width="28" height="20" rx="8" fill="var(--color-collar)" />
      <circle
        cx="9"
        cy="16"
        r="3.2"
        fill="var(--color-mist)"
        stroke="var(--color-brass)"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-3xl items-center justify-between px-4 pb-2 pt-5 sm:px-6">
      <Link href="/" className="flex items-center gap-2 rounded text-lg font-semibold text-ink">
        <Mark />
        <span className="display text-[1.35rem]">PetApp</span>
      </Link>
      <StoreLinks compact />
    </header>
  );
}

/** Store buttons, only for stores whose link is configured. */
export function StoreLinks({ compact = false }: { compact?: boolean }) {
  const stores = [
    site.playStoreUrl && {
      href: site.playStoreUrl,
      label: compact ? 'Android' : 'Get it on Google Play',
    },
    site.appStoreUrl && {
      href: site.appStoreUrl,
      label: compact ? 'iPhone' : 'Download on the App Store',
    },
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  if (!stores.length) return null;
  return (
    <nav aria-label="Get the app" className="flex flex-wrap gap-2">
      {stores.map((s) => (
        <a
          key={s.href}
          href={s.href}
          rel="noopener"
          className={`rounded-full border border-line bg-card font-medium text-ink hover:border-collar ${compact ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5'}`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteFooter({ legal }: { legal: Array<{ slug: string; title: string }> }) {
  return (
    <footer className="mx-auto mt-16 max-w-3xl px-4 pb-28 pt-8 text-sm text-muted sm:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-6">
        <span className="flex items-center gap-2 text-ink">
          <Mark size={20} />
          PetApp, for pets and the people who love them
        </span>
        <Link href="/help" className="hover:text-ink hover:underline">
          Help
        </Link>
        <Link href="/account-deletion" className="hover:text-ink hover:underline">
          Delete your account
        </Link>
        {legal.map((d) => (
          <Link key={d.slug} href={`/legal/${d.slug}`} className="hover:text-ink hover:underline">
            {d.title}
          </Link>
        ))}
      </div>
    </footer>
  );
}

/**
 * The subject of the page, engraved on a pet tag. `image` is round like a tag photo; `children` carries the small
 * facts under the name.
 */
export function Tag({
  title,
  image,
  imageAlt,
  kicker,
  monogram,
  children,
}: {
  title: string;
  image?: string | null;
  imageAlt?: string;
  kicker?: ReactNode;
  monogram?: boolean;
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="tag-swing">
      <div className="relative">
        <div className="tag flex items-center gap-4 py-6 pl-16 pr-5 sm:gap-6 sm:py-8 sm:pl-20 sm:pr-8">
          {image ? (
            <img
              src={image}
              alt={imageAlt ?? ''}
              width={112}
              height={112}
              className="h-16 w-16 shrink-0 rounded-full bg-mist object-cover sm:h-28 sm:w-28"
            />
          ) : (
            monogram && (
              // No photo yet: the first letter, as if stamped on the tag.
              <span
                aria-hidden="true"
                className="display flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-collar-wash text-4xl font-extrabold text-collar sm:h-28 sm:w-28 sm:text-6xl"
              >
                {title.trim().charAt(0).toUpperCase()}
              </span>
            )
          )}
          <div className="min-w-0">
            {kicker && <p className="mb-1 text-sm text-muted">{kicker}</p>}
            <h1 className="display break-words text-[2.4rem] font-extrabold text-ink sm:text-[3.4rem]">
              {title}
            </h1>
            {children && <div className="mt-2 text-[15px] text-muted">{children}</div>}
          </div>
        </div>
        <span className="tag-eyelet" aria-hidden="true" />
      </div>
    </section>
  );
}

/** "Open in the app" bar, fixed to the bottom of the screen. The https page itself opens the app when installed. */
export function OpenInApp({
  kind,
  keyValue,
  label,
}: {
  kind: LinkKind;
  keyValue: string;
  label: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p className="text-sm text-muted">{label}</p>
        <a
          href={appUrl(site.appScheme, kind, keyValue)}
          className="shrink-0 rounded-full bg-collar px-5 py-2.5 font-medium text-white hover:bg-collar-deep"
        >
          Open in PetApp
        </a>
      </div>
    </div>
  );
}

export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(data) }} />;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="display mb-3 text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-card p-5 sm:grid-cols-3">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-muted">{k}</dt>
          <dd className="mt-0.5 font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Out of 5, drawn as a brass bar with the number in words for screen readers. */
export function Rating({ avg, count }: { avg: number; count: number }) {
  if (!count) return <span>No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="relative inline-block h-2 w-16 overflow-hidden rounded-full bg-line"
      >
        <span
          className="absolute inset-y-0 left-0 bg-brass"
          style={{ width: `${(avg / 5) * 100}%` }}
        />
      </span>
      <span>
        {avg.toFixed(1)} out of 5 from {count} review{count === 1 ? '' : 's'}
      </span>
    </span>
  );
}
