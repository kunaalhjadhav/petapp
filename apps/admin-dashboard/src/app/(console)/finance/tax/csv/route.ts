import { ApiError, api } from '@/lib/api';
import { PAYEE_TYPE, isMonth, rupees, toCsv, type TaxReport } from '@/lib/finance';

/** The month's tax report as a spreadsheet (amounts in rupees). */
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!isMonth(month)) return new Response('Use a month like 2026-10', { status: 400 });
  let r: TaxReport;
  try {
    r = await api<TaxReport>('/admin/finance/tax-report', { query: { month } });
  } catch (e) {
    if (e instanceof ApiError)
      return new Response(e.message, { status: e.status === 403 ? 403 : 502 });
    throw e;
  }
  const rows = [
    [
      'Month',
      'Payee type',
      'Payee',
      'GSTIN',
      'PAN',
      'Taxable value (Rs)',
      'TCS (Rs)',
      'TDS (Rs)',
      'PetApp fees incl. GST (Rs)',
      'GST on fees (Rs)',
      'Net to payee (Rs)',
      'Lines',
    ],
    ...r.payees.map((p) => [
      r.month,
      PAYEE_TYPE[p.payeeType],
      p.name,
      p.gstin,
      p.pan,
      rupees(p.taxableValuePaise),
      rupees(p.tcsPaise),
      rupees(p.tdsPaise),
      rupees(p.feesPaise),
      rupees(p.gstOnFeesPaise),
      rupees(p.netPaidToPayeePaise),
      p.transactions,
    ]),
    [
      r.month,
      'Total',
      '',
      '',
      '',
      rupees(r.totals.taxableValuePaise),
      rupees(r.totals.tcsPaise),
      rupees(r.totals.tdsPaise),
      rupees(r.totals.feesPaise),
      rupees(r.totals.gstOnFeesPaise),
      '',
      '',
    ],
  ];
  return new Response('﻿' + toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="petapp-tax-${month}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
