import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatPhone } from '@/lib/format';
import { formatPaise } from '@/lib/money';
import type { MembershipPlan, MembershipRow } from '@/lib/types';
import {
  Empty,
  Field,
  Input,
  NoAccess,
  PageHeader,
  Panel,
  Select,
  Tag,
  buttonClass,
} from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Pagination, Table, Td } from '@/components/table';
import { grantMembership, revokeMembership } from '../actions';

export const metadata: Metadata = { title: 'Members' };
export const dynamic = 'force-dynamic';

const STATES = [
  { key: '', label: 'All' },
  { key: 'current', label: 'Current' },
  { key: 'upcoming', label: 'Paid ahead' },
  { key: 'ended', label: 'Ended' },
  { key: 'pending', label: 'Not paid yet' },
];

function state(m: MembershipRow) {
  if (m.status === 'PENDING_PAYMENT') return <Tag>Not paid</Tag>;
  if (m.status === 'REVOKED') return <Tag tone="danger">Ended by staff</Tag>;
  if (m.running) return <Tag tone="good">Current</Tag>;
  if (m.status === 'ACTIVE' && m.startsAt && new Date(m.startsAt) > new Date())
    return <Tag tone="warn">Paid ahead</Tag>;
  return <Tag>Ended</Tag>;
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.MEMBERSHIPS_READ)) return <NoAccess what="members" />;
  const manage = can(me, PERMISSIONS.MEMBERSHIPS_MANAGE);
  const [plans, { items, meta }] = await Promise.all([
    api<MembershipPlan[]>('/admin/memberships/plans'),
    apiPage<MembershipRow>('/admin/memberships/members', {
      state: sp.state || undefined,
      planId: sp.planId || undefined,
      q: sp.q || undefined,
      page: sp.page,
      limit: 50,
    }),
  ]);
  const paid = plans.filter((p) => p.pricePaise > 0);
  return (
    <>
      <PageHeader
        back={{ href: '/memberships', label: 'Plans' }}
        title="Members"
        description="Everyone who bought or was given a membership. Giving or ending one is recorded in the audit log, and the person is told."
        actions={
          manage ? (
            <ActionDialog
              label="Give a membership"
              title="Give a membership"
              description="Free, starting now. For goodwill or a prize."
              action={grantMembership}
              submitLabel="Give"
              variant="primary"
            >
              <Field
                label="Person’s user ID"
                htmlFor="g-user"
                hint="From People → the person’s page"
              >
                <Input id="g-user" name="userId" required pattern="[0-9a-fA-F-]{36}" />
              </Field>
              <Field label="Plan" htmlFor="g-plan">
                <Select id="g-plan" name="planId" required>
                  {paid.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Days" htmlFor="g-days">
                <Input
                  id="g-days"
                  name="days"
                  type="number"
                  min={1}
                  max={366}
                  defaultValue={30}
                  required
                />
              </Field>
              <Field label="Reason" htmlFor="g-reason" hint="Kept in the audit log">
                <Input id="g-reason" name="reason" required minLength={3} maxLength={300} />
              </Field>
            </ActionDialog>
          ) : undefined
        }
      />
      <Panel>
        <form
          className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3"
          role="search"
        >
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="sr-only">
              Search members
            </label>
            <Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder="Name, phone or email" />
          </div>
          <label className="text-xs text-muted">
            Plan
            <Select name="planId" defaultValue={sp.planId ?? ''} className="mt-1 w-40">
              <option value="">Any</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-muted">
            State
            <Select name="state" defaultValue={sp.state ?? ''} className="mt-1 w-40">
              {STATES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <button className={buttonClass('secondary')}>Filter</button>
        </form>
        {items.length === 0 ? (
          <Empty title="No memberships here" />
        ) : (
          <Table
            head={['Person', 'Plan', 'State', 'From', 'Until', 'Paid', 'How', '']}
            numeric={[5]}
          >
            {items.map((m) => (
              <tr key={m.id}>
                <Td>
                  <Link
                    href={`/users/${m.user.id}`}
                    className="font-medium text-teal hover:underline"
                  >
                    {m.user.name || 'No name'}
                  </Link>
                  <p className="text-xs text-muted">{formatPhone(m.user.phone)}</p>
                </Td>
                <Td>{m.plan.name}</Td>
                <Td>{state(m)}</Td>
                <Td>{formatDate(m.startsAt)}</Td>
                <Td>{formatDate(m.endsAt)}</Td>
                <Td className="text-right tabular-nums">
                  {m.pricePaise ? formatPaise(m.pricePaise) : '—'}
                </Td>
                <Td className="text-xs">
                  {m.source === 'GRANT' ? `Given by ${m.grantedBy ?? 'staff'}` : 'Bought'}
                  {m.note && <p className="text-muted">{m.note}</p>}
                </Td>
                <Td>
                  {manage &&
                    m.status === 'ACTIVE' &&
                    (!m.endsAt || new Date(m.endsAt) > new Date()) && (
                      <ActionDialog
                        label="End"
                        size="sm"
                        danger
                        title={`End ${m.user.name ?? 'this'}’s ${m.plan.name} membership`}
                        description="It stops at once. Paid time isn’t refunded automatically; record a refund in Finance if one is owed."
                        action={revokeMembership.bind(null, m.id)}
                        submitLabel="End membership"
                      >
                        <Field label="Reason" htmlFor={`r-${m.id}`} hint="Kept in the audit log">
                          <Input
                            id={`r-${m.id}`}
                            name="reason"
                            required
                            minLength={3}
                            maxLength={300}
                          />
                        </Field>
                      </ActionDialog>
                    )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/memberships/members" params={sp} />
      </Panel>
    </>
  );
}
