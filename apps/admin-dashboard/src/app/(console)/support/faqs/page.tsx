import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate } from '@/lib/format';
import { SUPPORT_APPS } from '@/lib/labels';
import type { SupportFaq } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Tag, buttonClass } from '@/components/ui';
import { ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { setFaqPublished } from '../actions';

export const metadata: Metadata = { title: 'Help center' };
export const dynamic = 'force-dynamic';

export default async function FaqsPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.SUPPORT_READ)) return <NoAccess what="the help center" />;
  const faqs = await api<SupportFaq[]>('/admin/support/faqs');
  const manage = can(me, PERMISSIONS.SUPPORT_MANAGE);
  const drafts = faqs.filter((f) => !f.published).length;

  return (
    <>
      <PageHeader
        back={{ href: '/support', label: 'Support tickets' }}
        title="Help center"
        description="Answers people see under Help & support in each app, before they write to you. First drafts were added when PetApp was set up: check each against your own policies (refund windows, payout timing) before publishing."
        actions={
          manage && (
            <Link href="/support/faqs/new" className={buttonClass('primary')}>
              New question
            </Link>
          )
        }
      />
      {drafts > 0 && (
        <p className="mb-4 text-sm text-warn">
          {drafts} question{drafts === 1 ? ' is' : 's are'} still a draft and not shown in the apps.
        </p>
      )}
      <Panel>
        {faqs.length === 0 ? (
          <Empty title="No questions yet">Add the questions people ask most often.</Empty>
        ) : (
          <Table head={['Question', 'Topic', 'For', 'Helpful', 'Updated', 'Shown in apps']}>
            {faqs.map((f) => (
              <tr key={f.id}>
                <Td>
                  <Link href={`/support/faqs/${f.id}`} className="text-teal hover:underline">
                    {f.question}
                  </Link>
                </Td>
                <Td className="text-sm text-muted">{f.category?.name ?? '—'}</Td>
                <Td className="text-sm">{SUPPORT_APPS[f.audience] ?? f.audience}</Td>
                <Td className="whitespace-nowrap text-sm tabular-nums">
                  {f.helpful + f.notHelpful > 0 ? `${f.helpful} of ${f.helpful + f.notHelpful}` : <span className="text-muted">—</span>}
                </Td>
                <Td className="whitespace-nowrap text-sm text-muted">{formatDate(f.updatedAt)}</Td>
                <Td>
                  {manage ? (
                    <ToggleForm action={setFaqPublished.bind(null, f.id)} checked={f.published} label={`Show “${f.question}” in the apps`} />
                  ) : (
                    <Tag tone={f.published ? 'good' : 'warn'}>{f.published ? 'Published' : 'Draft'}</Tag>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
