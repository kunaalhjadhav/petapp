import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber } from '@/lib/format';
import { SUPPORT_APPS } from '@/lib/labels';
import type { SupportCategory } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Select, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton, ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { createTopic, saveTopic, setTopicActive } from '../actions';

export const metadata: Metadata = { title: 'Support topics' };
export const dynamic = 'force-dynamic';

const audiences = ['ALL', 'CUSTOMER', 'PARTNER', 'SELLER'] as const;

export default async function TopicsPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.SUPPORT_READ)) return <NoAccess what="support topics" />;
  const topics = await api<SupportCategory[]>('/admin/support/categories');
  const manage = can(me, PERMISSIONS.SUPPORT_MANAGE);

  return (
    <>
      <PageHeader
        back={{ href: '/support', label: 'Support tickets' }}
        title="Support topics"
        description="What people choose when they write to you, and how help center questions are grouped. Turning a topic off hides it for new tickets; existing tickets keep it."
        actions={
          manage && (
            <ActionDialog label="New topic" title="New topic" action={createTopic} submitLabel="Add topic" variant="primary">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Name
                <input name="name" required minLength={2} maxLength={60} className={inputClass} placeholder="e.g. Delivery problems" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Key
                <input name="key" required pattern="[a-z][a-z0-9-]{1,39}" className={inputClass} placeholder="delivery" />
                <span className="text-xs font-normal text-muted">Lower case letters, digits and dashes. Can’t be changed later.</span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Offered in
                <Select name="audience" defaultValue="ALL">
                  {audiences.map((a) => (
                    <option key={a} value={a}>
                      {a === 'ALL' ? 'Every app' : SUPPORT_APPS[a]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Order
                <input name="sortOrder" type="number" min={0} max={10000} defaultValue={200} className={inputClass} />
              </label>
            </ActionDialog>
          )
        }
      />
      <Panel>
        <Table head={['Topic', 'Offered in', 'Order', 'Tickets', 'Questions', 'On']} numeric={[3, 4]}>
          {topics.map((t) => (
            <tr key={t.id}>
              <Td>
                {manage ? (
                  <InlineForm action={saveTopic.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`n-${t.id}`}>
                      Name
                    </label>
                    <input id={`n-${t.id}`} name="name" defaultValue={t.name} required minLength={2} maxLength={60} className={`${inputClass} w-56`} />
                    <input type="hidden" name="audience" value={t.audience} />
                    <input type="hidden" name="sortOrder" value={t.sortOrder} />
                    <SubmitButton size="sm" variant="secondary">
                      Rename
                    </SubmitButton>
                  </InlineForm>
                ) : (
                  t.name
                )}
                <code className="mt-1 block text-xs text-muted">{t.key}</code>
              </Td>
              <Td className="text-sm">{t.audience === 'ALL' ? 'Every app' : SUPPORT_APPS[t.audience]}</Td>
              <Td className="text-sm tabular-nums">{t.sortOrder}</Td>
              <Td className="text-right text-sm tabular-nums">{formatNumber(t._count.tickets)}</Td>
              <Td className="text-right text-sm tabular-nums">{formatNumber(t._count.faqs)}</Td>
              <Td>
                {manage ? <ToggleForm action={setTopicActive.bind(null, t.id)} checked={t.active} label={`Offer “${t.name}”`} /> : t.active ? 'On' : 'Off'}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
