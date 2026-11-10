import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { Promotion } from '@/lib/types';
import { Empty, Field, Input, NoAccess, PageHeader, Panel, Select, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Stat, Stats } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';
import { cancelPromotion, createPromotion } from './actions';

export const metadata: Metadata = { title: 'Promotions' };
export const dynamic = 'force-dynamic';

const AUDIENCE: Record<string, string> = {
  ALL: 'Everyone who opted in',
  MEMBERS: 'Members who opted in',
  CITY: 'One city',
};
const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' | 'danger' }> = {
  QUEUED: { label: 'Scheduled', tone: 'warn' },
  SENDING: { label: 'Sending', tone: 'warn' },
  SENT: { label: 'Sent', tone: 'good' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** Promotional notifications (spec §36). Only people who turned on “Offers and announcements” get them. */
export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.PROMOTIONS_MANAGE)) return <NoAccess what="promotions" />;
  const [all, members, { items, meta }] = await Promise.all([
    api<{ people: number }>('/admin/promotions/audience', { query: { audience: 'ALL' } }),
    api<{ people: number }>('/admin/promotions/audience', { query: { audience: 'MEMBERS' } }),
    apiPage<Promotion>('/admin/promotions', { page: sp.page, limit: 30 }),
  ]);
  return (
    <>
      <PageHeader
        title="Promotions"
        description="Offers and announcements, sent as a notification. People choose to receive them (off unless they turn it on), and get at most promotions.dailyLimit a day."
        actions={
          <ActionDialog
            label="New promotion"
            title="New promotion"
            action={createPromotion}
            submitLabel="Queue it"
            variant="primary"
          >
            <Field label="Title" htmlFor="p-title">
              <Input id="p-title" name="title" required minLength={3} maxLength={60} />
            </Field>
            <Field label="Message" htmlFor="p-body">
              <Input id="p-body" name="body" required minLength={5} maxLength={200} />
            </Field>
            <Field
              label="Opens (optional)"
              htmlFor="p-link"
              hint="A page in the app, like /shop or /contest/summer-smiles"
            >
              <Input id="p-link" name="link" maxLength={160} placeholder="/shop" />
            </Field>
            <Field label="Who" htmlFor="p-aud">
              <Select id="p-aud" name="audience" defaultValue="ALL">
                {Object.entries(AUDIENCE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="City (for “One city”)" htmlFor="p-city">
              <Input id="p-city" name="city" maxLength={80} placeholder="Pune" />
            </Field>
            <Field
              label="Send at (India time, optional)"
              htmlFor="p-at"
              hint="Leave empty to send now"
            >
              <Input id="p-at" name="sendAt" type="datetime-local" />
            </Field>
          </ActionDialog>
        }
      />
      <div className="mb-6">
        <Stats>
          <Stat
            label="Can be reached now"
            value={formatNumber(all.people)}
            hint="Opted in to promotions"
          />
          <Stat label="Members who can be reached" value={formatNumber(members.people)} />
        </Stats>
      </div>
      <Panel>
        {items.length === 0 ? (
          <Empty title="No promotions yet" />
        ) : (
          <Table head={['Promotion', 'Who', 'When', 'Status', 'Reached', '']} numeric={[4]}>
            {items.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-medium">{p.title}</span>
                  <p className="text-xs text-muted">{p.body}</p>
                  {p.link && <p className="text-xs text-faint">Opens {p.link}</p>}
                </Td>
                <Td className="text-xs">{p.audience === 'CITY' ? p.city : AUDIENCE[p.audience]}</Td>
                <Td className="text-xs">
                  {formatDateTime(p.sentAt ?? p.sendAt)}
                  <p className="text-muted">by {p.createdBy}</p>
                </Td>
                <Td>
                  <Tag tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Tag>
                </Td>
                <Td className="text-right tabular-nums">
                  {p.status === 'SENT' ? formatNumber(p.recipients) : '—'}
                </Td>
                <Td>
                  {p.status === 'QUEUED' && (
                    <ActionDialog
                      label="Cancel"
                      size="sm"
                      danger
                      title="Cancel this promotion?"
                      action={cancelPromotion.bind(null, p.id)}
                      submitLabel="Cancel it"
                    />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/promotions" params={sp} />
      </Panel>
    </>
  );
}
