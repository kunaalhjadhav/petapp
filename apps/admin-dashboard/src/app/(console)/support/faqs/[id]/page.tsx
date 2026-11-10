import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { SUPPORT_APPS } from '@/lib/labels';
import type { SupportCategory, SupportFaq } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Select, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton } from '@/components/forms';
import { Markdown } from '@/components/markdown';
import { createFaq, deleteFaq, saveFaq } from '../../actions';

export const metadata: Metadata = { title: 'Help center question' };
export const dynamic = 'force-dynamic';

export default async function FaqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SUPPORT_READ)) return <NoAccess what="the help center" />;
  const isNew = id === 'new';
  const [faqs, categories] = await Promise.all([api<SupportFaq[]>('/admin/support/faqs'), api<SupportCategory[]>('/admin/support/categories')]);
  const f = isNew ? null : faqs.find((x) => x.id === id);
  if (!isNew && !f) notFound();
  const manage = can(me, PERMISSIONS.SUPPORT_MANAGE);

  return (
    <>
      <PageHeader
        back={{ href: '/support/faqs', label: 'Help center' }}
        title={isNew ? 'New question' : f!.question}
        actions={
          manage &&
          f && (
            <ActionDialog
              label="Delete"
              title="Delete this question?"
              description="It disappears from the apps straight away."
              action={async () => {
                'use server';
                return deleteFaq(f.id);
              }}
              submitLabel="Delete"
              danger
            />
          )
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <Panel title={isNew ? 'Question and answer' : 'Edit'}>
          <InlineForm action={isNew ? createFaq : saveFaq.bind(null, f!.id)} className="flex flex-col gap-4 px-4 py-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Question
              <input name="question" required minLength={5} maxLength={200} defaultValue={f?.question ?? ''} disabled={!manage} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Answer (Markdown)
              <textarea
                name="answer"
                required
                minLength={5}
                maxLength={10_000}
                rows={12}
                defaultValue={f?.answer ?? ''}
                disabled={!manage}
                className={`${inputClass} h-auto py-2 leading-relaxed`}
              />
              <span className="text-xs font-normal text-muted">**bold** for screen and button names, - for lists. Keep it short: people read this on a phone.</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Topic
                <Select name="categoryId" defaultValue={f?.categoryId ?? ''} disabled={!manage}>
                  <option value="">No topic</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Shown in
                <Select name="audience" defaultValue={f?.audience ?? 'ALL'} disabled={!manage}>
                  {['ALL', 'CUSTOMER', 'PARTNER', 'SELLER'].map((a) => (
                    <option key={a} value={a}>
                      {a === 'ALL' ? 'Every app' : SUPPORT_APPS[a]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Order
                <input name="sortOrder" type="number" min={0} max={10000} defaultValue={f?.sortOrder ?? 100} disabled={!manage} className={inputClass} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="published" defaultChecked={f?.published ?? false} disabled={!manage} className="h-4 w-4 accent-[var(--color-teal)]" />
              Show in the apps
            </label>
            {manage && (
              <div>
                <SubmitButton>{isNew ? 'Add question' : 'Save'}</SubmitButton>
              </div>
            )}
          </InlineForm>
        </Panel>
        {f && (
          <Panel title="How it looks (as last saved)">
            <div className="px-4 py-4">
              <p className="mb-2 font-semibold">{f.question}</p>
              <Markdown source={f.answer} />
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
