import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import {
  ISSUE_KIND,
  RUN_STATUS,
  SEVERITY,
  label,
  paymentIdOf,
  referenceHref,
  type ReconIssue,
  type ReconRun,
} from '@/lib/finance';
import { Empty, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton } from '@/components/forms';
import { StatusOf, Tabs } from '@/components/finance';
import { Pagination, Table, Td } from '@/components/table';
import { recoverPayment, resolveIssue, runReconciliation } from '../actions';

export const metadata: Metadata = { title: 'Reconciliation' };
const STATES = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];
/** Counts in a run's summary that aren't issue kinds. */
const SUMMARY_LABEL: Record<string, string> = {
  repaired: 'postings repaired',
  gatewayChecked: 'payments checked with the gateway',
  newIssues: 'new issues',
};

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="reconciliation" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const state = STATES.some((s) => s.key === sp.state) ? sp.state! : 'open';
  const severity = sp.severity === 'ERROR' || sp.severity === 'WARNING' ? sp.severity : undefined;
  const [{ items, meta }, runs] = await Promise.all([
    apiPage<ReconIssue>('/admin/finance/reconciliation/issues', {
      state,
      severity,
      page: sp.page,
      limit: 25,
    }),
    api<ReconRun[]>('/admin/finance/reconciliation/runs'),
  ]);
  const tabHref = (s: string) =>
    `/finance/reconciliation?state=${s}${severity ? `&severity=${severity}` : ''}`;

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Every night at 2:30 am PetApp’s books are checked against themselves and against the payment gateway. Missing ledger postings are repaired automatically; anything else is listed here for a finance person."
        actions={
          manage && (
            <InlineForm action={runReconciliation} className="flex items-center gap-3">
              <SubmitButton>Run now</SubmitButton>
            </InlineForm>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Panel>
          <Tabs label="Issues" tabs={STATES} current={state} href={tabHref} />
          <div className="flex gap-3 border-b border-line-soft px-4 py-2 text-sm">
            <span className="text-muted">Show:</span>
            {[undefined, 'ERROR', 'WARNING'].map((s) => (
              <Link
                key={s ?? 'any'}
                href={`/finance/reconciliation?state=${state}${s ? `&severity=${s}` : ''}`}
                aria-current={severity === s ? 'true' : undefined}
                className={severity === s ? 'font-medium text-teal' : 'text-muted hover:text-ink'}
              >
                {s ? SEVERITY[s].label : 'Everything'}
              </Link>
            ))}
          </div>
          {items.length === 0 ? (
            <Empty title={state === 'open' ? 'Nothing needs attention' : 'No issues here'}>
              {state === 'open' && 'The books matched the last time reconciliation ran.'}
            </Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {items.map((i) => {
                const href = referenceHref(i.reference);
                const paymentId = i.kind === 'MISSED_CAPTURE' ? paymentIdOf(i.reference) : null;
                return (
                  <li key={i.id} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusOf map={SEVERITY} status={i.severity} />
                      <span className="font-medium">{label(ISSUE_KIND, i.kind)}</span>
                      <span className="text-xs text-muted" title={formatDateTime(i.createdAt)}>
                        {timeAgo(i.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm">{i.detail}</p>
                    <p className="font-mono text-xs text-muted">
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {i.reference}
                        </Link>
                      ) : (
                        i.reference
                      )}
                    </p>
                    {i.resolvedAt ? (
                      <p className="text-sm text-muted">
                        <Tag tone={i.repaired ? 'good' : 'neutral'}>
                          {i.repaired ? 'Repaired automatically' : 'Resolved'}
                        </Tag>{' '}
                        {i.resolution} · {formatDateTime(i.resolvedAt)}
                      </p>
                    ) : (
                      manage && (
                        <div className="flex flex-wrap gap-2">
                          {paymentId && (
                            <ActionDialog
                              label="Recover payment"
                              size="sm"
                              variant="primary"
                              title="Recover this payment?"
                              description="PetApp asks the gateway whether the customer really paid. If they did, the payment is completed as if it had been confirmed normally: the order or entry goes ahead, or the money is refunded if it can no longer be honoured."
                              submitLabel="Check and recover"
                              action={recoverPayment.bind(null, paymentId)}
                            />
                          )}
                          <ActionDialog
                            label="Mark resolved"
                            size="sm"
                            title="Mark this issue resolved"
                            description="Say what was done. This is kept with the issue and in the audit log. The same finding won’t be raised again."
                            submitLabel="Mark resolved"
                            action={resolveIssue.bind(null, i.id)}
                          >
                            <label htmlFor={`res-${i.id}`} className="text-sm font-medium">
                              What was done
                            </label>
                            <textarea
                              id={`res-${i.id}`}
                              name="resolution"
                              required
                              minLength={3}
                              maxLength={500}
                              rows={3}
                              className={`${inputClass} h-auto py-2`}
                            />
                          </ActionDialog>
                        </div>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination
            meta={meta}
            basePath="/finance/reconciliation"
            params={{ ...sp, state, severity }}
          />
        </Panel>

        <Panel title="Recent runs">
          {runs.length === 0 ? (
            <Empty title="Never run" />
          ) : (
            <Table head={['When', 'Result']}>
              {runs.map((r) => (
                <tr key={r.id} className="align-top">
                  <Td className="whitespace-nowrap">
                    <span title={formatDateTime(r.startedAt)}>{timeAgo(r.startedAt)}</span>
                    <p className="text-xs text-muted">
                      {r.trigger === 'MANUAL' ? 'Run by staff' : 'Nightly'}
                    </p>
                  </Td>
                  <Td>
                    <StatusOf map={RUN_STATUS} status={r.status} />
                    {r.error && <p className="mt-1 text-xs text-danger">{r.error}</p>}
                    {r.summary && (
                      <ul className="mt-1 text-xs text-muted">
                        {Object.entries(r.summary)
                          .filter(
                            ([k, v]) =>
                              v &&
                              // Repaired postings are already counted as "repaired".
                              !(k === 'MISSING_POSTING' && v <= (r.summary?.repaired ?? 0)),
                          )
                          .map(([k, v]) => (
                            <li key={k}>
                              {formatNumber(v)}{' '}
                              {SUMMARY_LABEL[k] ?? label(ISSUE_KIND, k).toLowerCase()}
                            </li>
                          ))}
                      </ul>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
