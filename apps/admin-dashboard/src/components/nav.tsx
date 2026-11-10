'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  /** Highlight only on this exact path (a section's overview page). */
  exact?: boolean;
}

export function Nav({ groups }: { groups: Array<{ label: string; items: NavItem[] }> }) {
  const path = usePathname();
  const active = (i: NavItem) =>
    i.href === '/' || i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-3 text-xs text-faint">{g.label}</p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active(i) ? 'page' : undefined}
                    className={`block rounded-md px-3 py-1.5 text-sm ${active(i) ? 'bg-panel font-medium text-ink shadow-[inset_2px_0_0_var(--color-teal)]' : 'text-muted hover:bg-panel hover:text-ink'}`}
                  >
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </nav>
  );
}
