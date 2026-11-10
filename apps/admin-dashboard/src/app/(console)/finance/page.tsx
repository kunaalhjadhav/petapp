import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatNumber, timeAgo } from '@/lib/format';
import { REFUND_STATUS, RUN_STATUS, isDay, type FinanceOverview } from '@/lib/finance';
import { ErrorNote, Input, NoAccess, PageHeader, Panel, Tag, buttonClass } from '@/components/ui';
import { Amount, Stat, Stats, StatusOf } from '@/components/finance';
import { Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Money overview' };

export default async function FinanceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="finance" />;
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) ? sp.to : undefined;
  let o: FinanceOverview;
  try {
    o = await api<FinanceOverview>('/admin/finance/overview', { query: { from, to } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 400)
      return (
        <>
          <PageHeader title="Money overview" />
          <ErrorNote>
            {e.message}{' '}
            <Link href="/finance" className="underline">
              Show the last 30 days
            </Link>
          </ErrorNote>
        </>
      );
    throw e;
  }
  const n = o.now;
  const f = o.flows;
  const errors = o.reconciliation.openIssues.ERROR ?? 0;
  const warnings = o.reconciliation.openIssues.WARNING ?? 0;
  const failed = o.refunds.FAILED?.count ?? 0;
  const run = o.reconciliation.lastRun;

  return (
    <>
      <PageHeader
        title="Money overview"
        description="Where customers’ money is right now, what came in and went out in the period, and what needs a finance person’s attention. All amounts include GST unless they say otherwise."
      />

      {(errors > 0 || failed > 0) && (
        <div className="mb-6 flex flex-col gap-2" role="alert">
          {errors > 0 && (
            <ErrorNote>
              Reconciliation found {errors} problem{errors === 1 ? '' : 's'} where money may be
              wrong.{' '}
              <Link href="/finance/reconciliation?severity=ERROR" className="font-medium underline">
                Review
              </Link>
            </ErrorNote>
          )}
          {failed > 0 && (
            <ErrorNote>
              {failed} refund{failed === 1 ? '' : 's'} couldn’t be sent to customers.{' '}
              <Link href="/finance/refunds?status=FAILED" className="font-medium underline">
                Retry or record them
              </Link>
            </ErrorNote>
          )}
        </div>
      )}

      <h2 className="mb-3 text-[15px] font-semibold">Right now</h2>
      <Stats>
        <Stat
          label="Held by the payment gateway"
          paise={n.heldByGatewayPaise}
          hint="Paid by customers, not yet settled to PetApp’s bank"
          href="/finance/settlements"
        />
        <Stat
          label="Customer money held"
          paise={n.customerFundsPaise}
          hint="Orders not yet delivered, visits not yet done, contest fees"
        />
        <Stat
          label="Refunds owed"
          paise={n.refundsDuePaise}
          hint="Not yet paid back to customers"
          href="/finance/refunds?status=PENDING"
          tone={n.refundsDuePaise > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Owed to sellers and partners"
          paise={n.owedToSellersPaise + n.owedToPartnersPaise}
          hint={
            <>
              Sellers <Amount paise={n.owedToSellersPaise} /> · Partners{' '}
              <Amount paise={n.owedToPartnersPaise} />
            </>
          }
          href="/finance/payouts"
        />
        <Stat label="GST to pay" paise={n.gstPayablePaise} hint="On PetApp’s fees and entry fees" />
        <Stat
          label="TCS to deposit"
          paise={n.tcsPayablePaise}
          hint="Collected from sellers"
          href="/finance/tax"
        />
        <Stat
          label="TDS to deposit"
          paise={n.tdsPayablePaise}
          hint="On partner earnings and prizes"
          href="/finance/tax"
        />
        <Stat
          label="Reconciliation"
          value={
            run ? (
              <span className="flex items-center gap-2 text-base">
                <StatusOf map={RUN_STATUS} status={run.status} />
                <span className="text-sm font-normal text-muted">{timeAgo(run.startedAt)}</span>
              </span>
            ) : (
              <span className="text-base text-muted">Never run</span>
            )
          }
          hint={
            errors || warnings
              ? `${formatNumber(errors + warnings)} open issue${errors + warnings === 1 ? '' : 's'}`
              : 'No open issues'
          }
          href="/finance/reconciliation"
          tone={errors ? 'danger' : undefined}
        />
      </Stats>

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[15px] font-semibold">
          {formatDate(`${o.period.from}T00:00:00+05:30`)} to{' '}
          {formatDate(`${o.period.to}T00:00:00+05:30`)}
        </h2>
        <form className="flex flex-wrap items-end gap-2" aria-label="Choose a period">
          <label className="flex flex-col gap-1 text-xs text-muted">
            From
            <Input type="date" name="from" defaultValue={o.period.from} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            To
            <Input type="date" name="to" defaultValue={o.period.to} className="w-40" />
          </label>
          <button className={buttonClass('secondary')}>Show</button>
        </form>
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Panel title="Money in the period">
          <Table head={['', 'Amount']} numeric={[1]}>
            <Row
              label={`Collected from customers (${formatNumber(f.payments)} payment${f.payments === 1 ? '' : 's'})`}
              paise={f.collectedPaise}
            />
            <Row label="Refunds owed to customers" paise={-f.refundsOwedPaise} />
            <Row label="Refunds paid out" paise={f.refundsPaidPaise} muted />
            <Row label="Earned by sellers and partners" paise={f.earnedByPayeesPaise} />
            <Row label="PetApp fees (before GST)" paise={f.feeRevenuePaise} strong />
            <Row label="GST on fees" paise={f.gstOnFeesPaise} />
            <Row label="TCS collected" paise={f.tcsPaise} />
            <Row label="TDS deducted" paise={f.tdsPaise} />
            <Row label="Discounts PetApp paid for" paise={-f.platformDiscountsPaise} />
          </Table>
        </Panel>
        <Panel
          title="Refunds"
          actions={
            <Link href="/finance/refunds" className="text-sm text-teal hover:underline">
              All refunds
            </Link>
          }
        >
          <Table head={['Status', 'Count', 'Amount']} numeric={[2]}>
            {Object.keys(REFUND_STATUS).map((s) => (
              <tr key={s}>
                <Td>
                  <Link href={`/finance/refunds?status=${s}`} className="hover:underline">
                    <StatusOf map={REFUND_STATUS} status={s} />
                  </Link>
                </Td>
                <Td className="tabular-nums">{formatNumber(o.refunds[s]?.count ?? 0)}</Td>
                <Td className="text-right">
                  <Amount paise={o.refunds[s]?.amountPaise ?? 0} />
                </Td>
              </tr>
            ))}
          </Table>
          <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
            All time. Refunds are sent automatically every 30 seconds and retried after errors.
          </p>
        </Panel>
      </div>
      {!run && (
        <p className="mt-6 text-sm text-muted">
          <Tag tone="warn">Tip</Tag> Reconciliation runs every night at 2:30 am. You can also{' '}
          <Link href="/finance/reconciliation" className="text-teal hover:underline">
            run it now
          </Link>
          .
        </p>
      )}
    </>
  );
}

function Row({
  label,
  paise,
  strong,
  muted,
}: {
  label: string;
  paise: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <tr>
      <Td className={muted ? 'text-muted' : strong ? 'font-medium' : ''}>{label}</Td>
      <Td className="text-right">
        <Amount paise={paise} strong={strong} />
      </Td>
    </tr>
  );
}
