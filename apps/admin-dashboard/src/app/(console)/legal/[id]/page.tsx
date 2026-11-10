import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { LEGAL_AUDIENCES } from '@/lib/labels';
import type { LegalDocumentDetail, LegalStatus } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton } from '@/components/forms';
import { Markdown } from '@/components/markdown';
import { deleteDraft, newVersion, publishDraft, saveDraft } from '../actions';

export const metadata: Metadata = { title: 'Legal document' };
export const dynamic = 'force-dynamic';

const STATUS: Record<LegalStatus, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  PUBLISHED: { label: 'Current version', tone: 'good' },
  DRAFT: { label: 'Draft', tone: 'warn' },
  RETIRED: { label: 'Replaced', tone: 'neutral' },
};

export default async function LegalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="legal documents" />;
  let d: LegalDocumentDetail;
  try {
    d = await api<LegalDocumentDetail>(`/admin/legal/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const manage = can(me, PERMISSIONS.LEGAL_MANAGE);
  const editable = manage && d.status === 'DRAFT';
  const hasDraft = d.history.some((h) => h.status === 'DRAFT');
  const current = d.history.find((h) => h.status === 'PUBLISHED');

  return (
    <>
      <PageHeader
        back={{ href: '/legal', label: 'Legal documents' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.title}
            <span className="text-base font-normal text-muted">version {d.version}</span>
            <Tag tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Tag>
          </span>
        }
        description={
          d.requiresAcceptance
            ? `Must be accepted by: ${LEGAL_AUDIENCES[d.audience]?.toLowerCase() ?? d.audience}.`
            : 'For reading; nobody is asked to accept it.'
        }
        actions={
          manage &&
          d.status !== 'DRAFT' &&
          !hasDraft && (
            <ActionDialog
              label="Start a new version"
              title={`New version of the ${d.title}`}
              description="Starts a draft copied from the latest version. People keep seeing the current version until you publish the new one."
              action={newVersion.bind(null, d.slug)}
              submitLabel="Start draft"
              variant="primary"
            />
          )
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {editable ? (
            <Panel title="Edit draft">
              <InlineForm
                action={saveDraft.bind(null, d.id)}
                className="flex flex-col gap-4 px-4 py-4"
              >
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Title
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={d.title}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  What changed in this version
                  <input
                    name="changeSummary"
                    maxLength={500}
                    defaultValue={d.changeSummary ?? ''}
                    placeholder="e.g. Added how the assistant uses your questions"
                    className={inputClass}
                  />
                  <span className="text-xs font-normal text-muted">
                    Shown to people when they’re asked to accept the new version. Required from
                    version 2.
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="requiresAcceptance"
                    defaultChecked={d.requiresAcceptance}
                    className="h-4 w-4 accent-teal"
                  />
                  People must accept this version ({LEGAL_AUDIENCES[d.audience]?.toLowerCase()})
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Text (Markdown)
                  <textarea
                    name="body"
                    required
                    rows={28}
                    maxLength={100_000}
                    defaultValue={d.body}
                    spellCheck
                    className={`${inputClass} h-auto py-2 font-mono text-[13px] leading-relaxed`}
                  />
                  <span className="text-xs font-normal text-muted">
                    # for the title, ## for headings, - for lists, **bold**. Replace every{' '}
                    {'{{placeholder}}'} before publishing.
                  </span>
                </label>
                <div>
                  <SubmitButton>Save draft</SubmitButton>
                </div>
              </InlineForm>
            </Panel>
          ) : null}
          {editable && (
            <Panel title="Preview (as last saved)">
              <div className="max-h-[75vh] overflow-y-auto px-4 py-4">
                <Markdown source={d.body} />
              </div>
            </Panel>
          )}
          {!editable && (
            <Panel title="Text">
              <div className="max-h-[75vh] overflow-y-auto px-4 py-4">
                <Markdown source={d.body} />
              </div>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {d.status === 'DRAFT' && (
            <Panel title="Publish">
              <div className="flex flex-col gap-3 px-4 py-4 text-sm">
                {d.placeholders.length > 0 ? (
                  <>
                    <p className="text-warn">
                      {d.placeholders.length} placeholder{d.placeholders.length === 1 ? '' : 's'}{' '}
                      still to fill in:
                    </p>
                    <ul className="list-disc pl-5 text-muted">
                      {d.placeholders.map((p) => (
                        <li key={p}>
                          <code>{p}</code>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted">
                    Ready to publish.{' '}
                    {current
                      ? `It replaces version ${current.version}${d.requiresAcceptance ? ', and people are asked to accept it again' : ''}.`
                      : 'It becomes visible in the apps and on the website.'}
                  </p>
                )}
                {manage && (
                  <div className="flex flex-wrap gap-2">
                    <ActionDialog
                      label="Publish…"
                      title={`Publish version ${d.version}`}
                      description="Save your edits first. Publishing can’t be undone; to change it later, start a new version."
                      action={publishDraft.bind(null, d.id)}
                      submitLabel="Publish"
                      variant="primary"
                    >
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Takes effect on (optional)
                        <input name="effectiveAt" type="date" className={inputClass} />
                        <span className="text-xs font-normal text-muted">
                          Leave empty for today. Give notice of important changes ahead of time.
                        </span>
                      </label>
                    </ActionDialog>
                    {d.version > 1 && (
                      <ActionDialog
                        label="Delete draft"
                        title="Delete this draft?"
                        description="The current version stays as it is."
                        action={deleteDraft.bind(null, d.id)}
                        submitLabel="Delete"
                        variant="quiet"
                        danger
                      />
                    )}
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Details">
            <dl className="flex flex-col gap-3 px-4 py-4 text-sm">
              {d.publishedAt && (
                <div>
                  <dt className="text-xs text-muted">Published</dt>
                  <dd>{formatDateTime(d.publishedAt)}</dd>
                </div>
              )}
              {d.effectiveAt && (
                <div>
                  <dt className="text-xs text-muted">In effect from</dt>
                  <dd>{formatDate(d.effectiveAt)}</dd>
                </div>
              )}
              {d.requiresAcceptance && d.status !== 'DRAFT' && (
                <div>
                  <dt className="text-xs text-muted">Accepted by</dt>
                  <dd className="tabular-nums">{formatNumber(d.acceptances)} people</dd>
                </div>
              )}
              {d.changeSummary && (
                <div>
                  <dt className="text-xs text-muted">What changed</dt>
                  <dd>{d.changeSummary}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Public address</dt>
                <dd>
                  <code>/api/v1/legal/{d.slug}</code>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Versions">
            <ul className="flex flex-col">
              {d.history.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-0"
                >
                  {h.id === d.id ? (
                    <span className="font-medium">Version {h.version}</span>
                  ) : (
                    <Link href={`/legal/${h.id}`} className="text-teal hover:underline">
                      Version {h.version}
                    </Link>
                  )}
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {h.publishedAt ? formatDate(h.publishedAt) : ''}
                    <Tag tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Tag>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
