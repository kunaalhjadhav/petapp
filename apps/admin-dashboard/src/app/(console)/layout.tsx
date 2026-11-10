import Link from 'next/link';
import { PERMISSIONS } from '@petapp/types';
import { Mark } from '@/components/brand';
import { Nav, type NavItem } from '@/components/nav';
import { can, getMe } from '@/lib/me';
import { humanize } from '@/lib/format';
import { signOut } from '../actions';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const P = PERMISSIONS;
  const only = (ok: boolean, item: NavItem) => (ok ? [item] : []);
  const groups = [
    {
      label: 'Workspace',
      items: [{ href: '/', label: 'Overview' }, ...only(can(me, P.ANALYTICS_READ), { href: '/analytics', label: 'Analytics' })],
    },
    {
      label: 'Community',
      items: [
        ...only(can(me, P.USERS_READ), { href: '/users', label: 'People' }),
        ...only(can(me, P.PETS_READ_ANY), { href: '/pets', label: 'Pets' }),
        ...only(can(me, P.CONTENT_READ), { href: '/moderation', label: 'Moderation' }),
        ...only(can(me, P.CONTENT_READ), { href: '/reports', label: 'Reports' }),
        ...only(can(me, P.CONTENT_READ), { href: '/reviews', label: 'Reviews' }),
        ...only(can(me, P.CONTENT_READ), { href: '/trust', label: 'AI moderation', exact: true }),
        ...only(can(me, P.USERS_READ), { href: '/trust/risk', label: 'Account risk' }),
        ...only(can(me, P.USERS_READ), { href: '/privacy', label: 'Privacy requests' }),
        ...only(can(me, P.SETTINGS_READ), { href: '/assistant', label: 'PetApp Assistant' }),
        ...only(can(me, P.CONTESTS_READ), { href: '/contests', label: 'Contests' }),
        ...only(can(me, P.CONTESTS_READ), { href: '/challenges', label: 'Challenges' }),
      ],
    },
    {
      label: 'Support',
      items: can(me, P.SUPPORT_READ)
        ? [
            { href: '/support', label: 'Tickets', exact: true },
            { href: '/support/faqs', label: 'Help center' },
            { href: '/support/topics', label: 'Topics' },
          ]
        : [],
    },
    {
      label: 'Marketplace',
      items: [
        ...only(can(me, P.PARTNERS_READ), { href: '/partners', label: 'Service partners' }),
        ...only(can(me, P.PARTNERS_READ), { href: '/bookings', label: 'Bookings' }),
        ...only(can(me, P.PARTNERS_READ), {
          href: '/service-categories',
          label: 'Service categories',
        }),
      ],
    },
    {
      label: 'Locations',
      items: can(me, P.LOCATIONS_READ)
        ? [
            { href: '/locations/cities', label: 'Cities and areas' },
            { href: '/locations/zones', label: 'Delivery zones' },
            { href: '/locations/coverage', label: 'Service coverage' },
            { href: '/locations/partners', label: 'Partner locations' },
          ]
        : [],
    },
    {
      label: 'Shop',
      items: [
        ...only(can(me, P.MARKETPLACE_READ), { href: '/shop/vendors', label: 'Vendors' }),
        ...only(can(me, P.MARKETPLACE_READ), { href: '/shop/products', label: 'Products' }),
        ...only(can(me, P.MARKETPLACE_READ), { href: '/shop/orders', label: 'Orders' }),
        ...only(can(me, P.MARKETPLACE_READ), { href: '/shop/coupons', label: 'Coupons' }),
        ...only(can(me, P.MARKETPLACE_READ), { href: '/shop/categories', label: 'Categories' }),
      ],
    },
    {
      label: 'Growth',
      items: [
        ...only(can(me, P.MEMBERSHIPS_READ), { href: '/memberships', label: 'Membership plans', exact: true }),
        ...only(can(me, P.MEMBERSHIPS_READ), { href: '/memberships/members', label: 'Members' }),
        ...only(can(me, P.PROMOTIONS_MANAGE), { href: '/promotions', label: 'Promotions' }),
      ],
    },
    {
      label: 'Finance',
      items: can(me, P.FINANCE_READ)
        ? [
            { href: '/finance', label: 'Money overview', exact: true },
            { href: '/finance/refunds', label: 'Refunds' },
            { href: '/finance/reconciliation', label: 'Reconciliation' },
            { href: '/finance/payouts', label: 'Payouts' },
            { href: '/finance/payout-accounts', label: 'Payout accounts' },
            { href: '/finance/prizes', label: 'Prizes' },
            { href: '/finance/settlements', label: 'Settlements' },
            { href: '/finance/invoices', label: 'Invoices' },
            { href: '/finance/tax', label: 'Tax report' },
            { href: '/finance/ledger', label: 'Ledger' },
          ]
        : [],
    },
    {
      label: 'Configuration',
      items: [
        ...only(can(me, P.SETTINGS_READ), { href: '/home-screen', label: 'Home screen' }),
        ...only(can(me, P.SPECIES_MANAGE), { href: '/species', label: 'Species & breeds' }),
        ...only(can(me, P.ROLES_READ), { href: '/access', label: 'Roles & permissions' }),
        ...only(can(me, P.SETTINGS_READ), { href: '/settings', label: 'Features & settings' }),
        ...only(can(me, P.SETTINGS_READ), { href: '/legal', label: 'Legal documents' }),
        ...only(can(me, P.SETTINGS_READ), { href: '/system', label: 'System health' }),
      ],
    },
    {
      label: 'Accountability',
      items: only(can(me, P.AUDIT_READ), { href: '/audit', label: 'Audit log' }),
    },
  ];
  const canSearch = can(me, P.USERS_READ) || can(me, P.PETS_READ_ANY);
  const env = process.env.NEXT_PUBLIC_ENV_LABEL;
  const isProd = env?.toLowerCase() === 'production';

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="border-b border-line px-3 py-3 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-4">
        <div className="flex items-center justify-between lg:block">
          <Link href="/" className="flex items-center gap-2.5 px-3 lg:mb-6">
            <Mark />
            <span className="font-semibold">PetApp Admin</span>
          </Link>
          {/* Small screens: the menu folds away so content comes first. */}
          <details className="group relative lg:hidden">
            <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-line bg-panel px-3 text-sm [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-line bg-paper p-2 shadow-lg">
              <Nav groups={groups} />
            </div>
          </details>
        </div>
        <div className="hidden lg:block">
          <Nav groups={groups} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur lg:px-8">
          {canSearch ? (
            <form action="/search" role="search" className="w-full max-w-md">
              <label htmlFor="q" className="sr-only">
                Search people and pets
              </label>
              <input
                id="q"
                name="q"
                placeholder="Search people and pets by name, phone, email or handle"
                className="h-9 w-full rounded-md border border-line bg-panel px-3 text-sm placeholder:text-faint focus:border-teal focus:outline-none"
              />
            </form>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-3">
            {env && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${isProd ? 'bg-danger text-white' : 'bg-warn-wash text-warn'}`}
                title="The environment you are changing"
              >
                {env}
              </span>
            )}
            <Link href="/account" className="hidden text-right hover:underline sm:block" title="Your account and password">
              <p className="text-sm font-medium leading-5">{me.name ?? me.email}</p>
              <p className="text-xs text-muted">
                {me.roles
                  .filter((r) => r !== 'CUSTOMER')
                  .map(humanize)
                  .join(', ')}
              </p>
            </Link>
            <Link href="/account" className="h-8 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-panel hover:text-ink sm:hidden">
              Account
            </Link>
            <form action={signOut}>
              <button className="h-8 rounded-md px-2.5 text-sm text-muted hover:bg-panel hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          {me.mfaSetupRequired && (
            <p role="status" className="mb-6 rounded-md border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
              PetApp requires two-factor sign-in for staff.{' '}
              <Link href="/account#two-factor" className="font-medium underline">
                Set it up now
              </Link>
              .
            </p>
          )}
          {me.passwordChangedAt === null && (
            <p role="status" className="mb-6 rounded-md border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
              You’re still using the password you were given.{' '}
              <Link href="/account" className="font-medium underline">
                Change it now
              </Link>
              .
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
