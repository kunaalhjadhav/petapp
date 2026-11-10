import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import {
  ANALYTICS_TABS,
  changeText,
  formatMetric,
  isTab,
  istToday,
  presetRange,
} from '@/lib/analytics';
import type { AnalyticsReport } from '@/lib/types';
import { Empty, ErrorNote, Input, NoAccess, PageHeader, Panel, buttonClass } from '@/components/ui';
import { Tabs } from '@/components/finance';
import { Table, Td } from '@/components/table';
import { LineChart } from '@/components/line-chart';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

/** Admin analytics (spec §55): totals and trends for users, reels, contests, the shop and services. */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.ANALYTICS_READ)) return <NoAccess what="analytics" />;
  const tab = isTab(sp.tab) ? sp.tab : 'users';
  const today = istToday();
  let report: AnalyticsReport | null = null;
  let problem: string | null = null;
  try {
    report = await api<AnalyticsReport>(`/admin/analytics/${tab}`, {
      query: { from: sp.from || undefined, to: sp.to || undefined },
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) problem = e.message;
    else throw e;
  }
  const q = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      tab,
      ...(sp.from ? { from: sp.from } : {}),
      ...(sp.to ? { to: sp.to } : {}),
      ...over,
    });
    return `/analytics?${p.toString()}`;
  };
  const presets = [7, 30, 90].map((d) => ({ d, ...presetRange(d, today) }));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Totals and averages across PetApp, by India-time day. Figures are compared with the same number of days just before."
      />
      <Panel>
        <Tabs label="Report" tabs={[...ANALYTICS_TABS]} current={tab} href={(k) => q({ tab: k })} />
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-soft px-4 py-3">
          <form className="flex flex-wrap items-end gap-2" aria-label="Choose dates">
            <input type="hidden" name="tab" value={tab} />
            <label className="text-xs text-muted">
              From
              <Input
                type="date"
                name="from"
                defaultValue={report?.from ?? sp.from ?? ''}
                max={today}
                className="mt-1 w-40"
              />
            </label>
            <label className="text-xs text-muted">
              To
              <Input
                type="date"
                name="to"
                defaultValue={report?.to ?? sp.to ?? ''}
                max={today}
                className="mt-1 w-40"
              />
            </label>
            <button className={buttonClass('secondary')}>Show</button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {presets.map((p) => (
              <Link
                key={p.d}
                href={q({ from: p.from, to: p.to })}
                className={buttonClass(
                  report?.from === p.from && report?.to === p.to ? 'primary' : 'quiet',
                  'sm',
                )}
              >
                Last {p.d} days
              </Link>
            ))}
            {report && (
              <a
                href={`/analytics/csv?tab=${tab}&from=${report.from}&to=${report.to}`}
                className={buttonClass('secondary', 'sm')}
              >
                Download CSV
              </a>
            )}
          </div>
        </div>
        {problem && (
          <div className="px-4 py-3">
            <ErrorNote>{problem}</ErrorNote>
          </div>
        )}
        {report && (
          <div className="space-y-6 p-4">
            <p className="text-xs text-muted">
              {report.from} to {report.to} ({report.days} {report.days === 1 ? 'day' : 'days'}) ·
              worked out {formatDateTime(report.generatedAt)}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {report.kpis.map((k) => {
                const c = changeText(k.value, k.previous, k.format);
                return (
                  <div
                    key={k.key}
                    className="rounded-lg border border-line bg-panel px-4 py-3"
                    data-kpi={k.key}
                  >
                    <p className="text-xs text-muted">{k.label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {formatMetric(k.value, k.format)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {c ? (
                        <>
                          <span aria-hidden>
                            {c.text === 'no change' ? '' : c.up ? '▲ ' : '▼ '}
                          </span>
                          {c.text} vs previous
                        </>
                      ) : (
                        (k.hint ?? 'Nothing to compare')
                      )}
                    </p>
                    {c && k.hint && <p className="mt-0.5 text-xs text-faint">{k.hint}</p>}
                  </div>
                );
              })}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {report.series.map((s) => (
                <LineChart key={s.key} label={s.label} format={s.format} points={s.points} />
              ))}
            </div>
            {report.tables.map((t) => (
              <section
                key={t.key}
                aria-labelledby={`t-${t.key}`}
                className="rounded-lg border border-line"
              >
                <h2
                  id={`t-${t.key}`}
                  className="border-b border-line-soft px-4 py-2.5 text-sm font-medium"
                >
                  {t.label}
                </h2>
                {t.rows.length === 0 ? (
                  <Empty title="Nothing in these dates" />
                ) : (
                  <Table
                    head={t.columns.map((c) => c.label)}
                    numeric={t.columns.flatMap((c, i) => (c.format === 'text' ? [] : [i]))}
                  >
                    {t.rows.map((row, i) => (
                      <tr key={String(row.id ?? i)}>
                        {t.columns.map((c) => (
                          <Td
                            key={c.key}
                            className={c.format === 'text' ? '' : 'text-right tabular-nums'}
                          >
                            {c.format === 'text'
                              ? String(row[c.key] ?? '')
                              : formatMetric(row[c.key] as number | null, c.format)}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </Table>
                )}
              </section>
            ))}
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </>
  );
}
