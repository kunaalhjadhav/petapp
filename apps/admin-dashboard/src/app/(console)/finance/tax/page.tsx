import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber } from '@/lib/format';
import { PAYEE_TYPE, isMonth, monthName, thisMonth, type TaxReport } from '@/lib/finance';
import { Empty, Input, NoAccess, PageHeader, Panel, buttonClass } from '@/components/ui';
import { Amount, Stat, Stats } from '@/components/finance';
import { Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Tax report' };

export default async function TaxReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="tax reports" />;
  const month = isMonth(sp.month) ? sp.month : thisMonth();
  const r = await api<TaxReport>('/admin/finance/tax-report', { query: { month } });

  return (
    <>
      <PageHeader
        title="Tax report"
        description="TCS collected from sellers (for GSTR-8) and TDS deducted from partners (for Form 26Q), by payee, for one month in India time. Worked out from the ledger."
        actions={
          <>
            <form className="flex items-end gap-2" aria-label="Choose a month">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Month
                <Input type="month" name="month" defaultValue={month} className="w-44" />
              </label>
              <button className={buttonClass('secondary')}>Show</button>
            </form>
            <a
              href={`/finance/tax/csv?month=${month}`}
              className={buttonClass('secondary')}
              download
            >
              Download CSV
            </a>
          </>
        }
      />
      <div className="mb-6">
        <Stats>
          <Stat
            label="Taxable value"
            paise={r.totals.taxableValuePaise}
            hint="Sales and visits, before GST"
          />
          <Stat label="TCS collected" paise={r.totals.tcsPaise} />
          <Stat label="TDS deducted" paise={r.totals.tdsPaise} />
          <Stat
            label="PetApp fees"
            paise={r.totals.feesPaise}
            hint={
              <>
                Includes GST <Amount paise={r.totals.gstOnFeesPaise} />
              </>
            }
          />
        </Stats>
      </div>
      <Panel title={monthName(r.month)}>
        {r.payees.length === 0 ? (
          <Empty title="Nothing in this month">No deliveries, returns or completed visits.</Empty>
        ) : (
          <Table
            head={['Payee', 'GSTIN', 'PAN', 'Taxable value', 'TCS', 'TDS', 'Fees', 'Net to payee']}
            numeric={[3, 4, 5, 6, 7]}
          >
            {r.payees.map((p) => (
              <tr key={`${p.payeeType}:${p.payeeId}`}>
                <Td>
                  <Link
                    href={
                      p.payeeType === 'VENDOR'
                        ? `/shop/vendors/${p.payeeId}`
                        : `/partners/${p.payeeId}`
                    }
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {PAYEE_TYPE[p.payeeType]} · {formatNumber(p.transactions)} line
                    {p.transactions === 1 ? '' : 's'}
                  </p>
                </Td>
                <Td className="font-mono text-xs">{p.gstin ?? '—'}</Td>
                <Td className="font-mono text-xs">
                  {p.pan ?? <span className="text-warn">Missing</span>}
                </Td>
                <Td className="text-right">
                  <Amount paise={p.taxableValuePaise} />
                </Td>
                <Td className="text-right">
                  <Amount paise={p.tcsPaise} />
                </Td>
                <Td className="text-right">
                  <Amount paise={p.tdsPaise} />
                </Td>
                <Td className="text-right">
                  <Amount paise={p.feesPaise} />
                </Td>
                <Td className="text-right">
                  <Amount paise={p.netPaidToPayeePaise} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">{r.note}</p>
      </Panel>
    </>
  );
}
