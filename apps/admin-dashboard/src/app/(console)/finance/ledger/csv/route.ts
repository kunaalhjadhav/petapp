import { ApiError, api } from '@/lib/api';
import { ACCOUNT_TYPE, isDay, rupees, toCsv, type TrialBalance } from '@/lib/finance';

/** The trial balance as a spreadsheet (amounts in rupees). */
export async function GET(req: Request) {
  const asOf = new URL(req.url).searchParams.get('asOf') ?? undefined;
  if (asOf !== undefined && !isDay(asOf))
    return new Response('Use a date like 2026-10-31', { status: 400 });
  let tb: TrialBalance;
  try {
    tb = await api<TrialBalance>('/admin/finance/trial-balance', { query: { asOf } });
  } catch (e) {
    if (e instanceof ApiError)
      return new Response(e.message, { status: e.status === 403 ? 403 : 502 });
    throw e;
  }
  const rows = [
    ['Code', 'Account', 'Type', 'Debits (Rs)', 'Credits (Rs)', 'Balance (Rs)'],
    ...tb.accounts.map((a) => [
      a.code,
      a.name,
      ACCOUNT_TYPE[a.type],
      rupees(a.debitPaise),
      rupees(a.creditPaise),
      rupees(a.balancePaise),
    ]),
    ['', 'Total', '', rupees(tb.totals.debitPaise), rupees(tb.totals.creditPaise), ''],
  ];
  return new Response('﻿' + toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="petapp-trial-balance-${asOf ?? 'now'}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
