import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { MembershipPlan, MembershipSummary } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Stat, Stats } from '@/components/finance';
import { Table, Td } from '@/components/table';
import { createPlan, savePlan } from './actions';
import { PlanFields } from './plan-fields';

export const metadata: Metadata = { title: 'Membership plans' };
export const dynamic = 'force-dynamic';

/** Membership plans (spec §40): prices, lengths and benefits. Off until ENABLE_MEMBERSHIPS is on. */
export default async function MembershipsPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.MEMBERSHIPS_READ)) return <NoAccess what="memberships" />;
  const manage = can(me, PERMISSIONS.MEMBERSHIPS_MANAGE);
  const [summary, plans] = await Promise.all([
    api<MembershipSummary>('/admin/memberships/summary'),
    api<MembershipPlan[]>('/admin/memberships/plans'),
  ]);
  return (
    <>
      <PageHeader
        title="Membership plans"
        description="Nothing is members-only unless you mark a contest, challenge or coupon as members-only. Price changes apply to new purchases; what people already paid for keeps its price and length."
        actions={
          manage ? (
            <ActionDialog
              label="Add plan"
              title="Add a membership plan"
              action={createPlan}
              submitLabel="Add plan"
              variant="primary"
            >
              <PlanFields />
            </ActionDialog>
          ) : undefined
        }
      />
      {!summary.enabled && (
        <p className="mb-4 rounded-md border border-warn bg-warn-wash px-4 py-3 text-sm text-warn">
          Memberships are switched off: the app doesn’t show plans and members-only marks have no
          effect. Turn on “Memberships” in{' '}
          <Link href="/settings" className="underline">
            Features &amp; settings
          </Link>{' '}
          when you’re ready.
        </p>
      )}
      <div className="mb-6">
        <Stats>
          <Stat
            label="Members now"
            value={formatNumber(summary.members)}
            href="/memberships/members?state=current"
          />
          <Stat label="Bought in the last 30 days" value={formatNumber(summary.purchases30d)} />
          <Stat
            label="Paid in the last 30 days"
            paise={summary.revenue30dPaise}
            hint="Before refunds"
          />
        </Stats>
      </div>
      <Panel>
        <Table head={['Plan', 'Price', 'Length', 'Benefits', 'Members now', '']} numeric={[1, 4]}>
          {plans.map((p) => (
            <tr key={p.id}>
              <Td>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="text-xs text-muted">{p.key}</span>
                {!p.isActive && (
                  <span className="ml-2">
                    <Tag>Not for sale</Tag>
                  </span>
                )}
                {p.description && <p className="text-xs text-muted">{p.description}</p>}
              </Td>
              <Td className="text-right tabular-nums">
                {p.pricePaise ? formatPaise(p.pricePaise) : 'Free'}
              </Td>
              <Td>{p.periodDays} days</Td>
              <Td className="text-xs">
                {p.lines.length ? p.lines.join(' · ') : <span className="text-muted">None</span>}
              </Td>
              <Td className="text-right tabular-nums">
                <Link
                  href={`/memberships/members?planId=${p.id}&state=current`}
                  className="hover:underline"
                >
                  {formatNumber(p.members)}
                </Link>
              </Td>
              <Td>
                {manage && (
                  <ActionDialog
                    label="Edit"
                    size="sm"
                    title={`Edit ${p.name}`}
                    action={savePlan.bind(null, p.id)}
                    submitLabel="Save"
                  >
                    <PlanFields plan={p} />
                  </ActionDialog>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
