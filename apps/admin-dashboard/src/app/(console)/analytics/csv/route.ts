import { ApiError, api } from '@/lib/api';
import { isTab, reportCsv } from '@/lib/analytics';
import { isDay } from '@/lib/finance';
import type { AnalyticsReport } from '@/lib/types';

/** One analytics report as a spreadsheet (amounts in rupees). */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const tab = u.get('tab') ?? 'users';
  const from = u.get('from') ?? undefined;
  const to = u.get('to') ?? undefined;
  if (!isTab(tab)) return new Response('Unknown report', { status: 404 });
  if ((from && !isDay(from)) || (to && !isDay(to)))
    return new Response('Use dates like 2026-10-31', { status: 400 });
  let r: AnalyticsReport;
  try {
    r = await api<AnalyticsReport>(`/admin/analytics/${tab}`, { query: { from, to } });
  } catch (e) {
    if (e instanceof ApiError)
      return new Response(e.message, {
        status: e.status === 403 ? 403 : e.status === 400 ? 400 : 502,
      });
    throw e;
  }
  return new Response('﻿' + reportCsv(r), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="petapp-analytics-${tab}-${r.from}-to-${r.to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
