// Formatting and export for the analytics pages (spec §55). Pure; unit-tested.
import type { AnalyticsReport, MetricFormat } from './types';
import { formatPaise } from './money';
import { rupees, toCsv } from './finance';

export const ANALYTICS_TABS = [
  { key: 'users', label: 'Users' },
  { key: 'reels', label: 'Reels' },
  { key: 'contests', label: 'Contests' },
  { key: 'marketplace', label: 'Shop' },
  { key: 'services', label: 'Services' },
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]['key'];
export const isTab = (t: string | undefined): t is AnalyticsTab =>
  ANALYTICS_TABS.some((x) => x.key === t);

const num = new Intl.NumberFormat('en-IN');

/** A figure as people read it: 1,234 · ₹5,000 · 12.5% · – when there's nothing to compare. */
export function formatMetric(v: number | null | undefined, f: MetricFormat | 'text'): string {
  if (v === null || v === undefined) return '–';
  if (f === 'paise') return formatPaise(v);
  if (f === 'pct') return `${v.toFixed(1).replace(/\.0$/, '')}%`;
  return num.format(v);
}

/** Change from the previous period: "+12%", "−3.5%", or null when it can't compare. Percentages compare in points. */
export function changeText(
  now: number | null,
  before: number | null | undefined,
  f: MetricFormat,
): { text: string; up: boolean } | null {
  if (now === null || before === null || before === undefined) return null;
  if (f === 'pct') {
    const d = Math.round((now - before) * 10) / 10;
    if (d === 0) return { text: 'no change', up: true };
    return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)} pts`, up: d > 0 };
  }
  if (before === 0) return null;
  const p = Math.round(((now - before) / before) * 1000) / 10;
  if (p === 0) return { text: 'no change', up: true };
  return { text: `${p > 0 ? '+' : '−'}${Math.abs(p)}%`, up: p > 0 };
}

/** Quick ranges ending today (India time): last 7, 30 and 90 days. */
export function presetRange(days: number, today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return { from: d.toISOString().slice(0, 10), to: today };
}

export const istToday = (now = new Date()) =>
  new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Nice upper bound for a chart axis: 1, 2 or 5 × a power of ten, at or above the max. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** The whole report as a spreadsheet: figures (with the previous period), each table, then each daily series. */
export function reportCsv(r: AnalyticsReport): string {
  const cell = (v: number | string | null | undefined, f: MetricFormat | 'text') =>
    v === null || v === undefined ? '' : typeof v === 'number' && f === 'paise' ? rupees(v) : v;
  const unit = (f: MetricFormat | 'text') => (f === 'paise' ? ' (Rs)' : f === 'pct' ? ' (%)' : '');
  const rows: Array<Array<string | number | null>> = [
    ['PetApp analytics', r.tab, `${r.from} to ${r.to}`],
    [],
    ['Figure', 'This period', 'Previous period'],
    ...r.kpis.map((k) => [
      k.label + unit(k.format),
      cell(k.value, k.format),
      cell(k.previous, k.format),
    ]),
  ];
  for (const t of r.tables) {
    rows.push(
      [],
      [t.label],
      t.columns.map((c) => c.label + unit(c.format)),
    );
    for (const row of t.rows) rows.push(t.columns.map((c) => cell(row[c.key], c.format)));
  }
  for (const s of r.series) {
    rows.push([], [`${s.label} by day${unit(s.format)}`], ['Day', 'Value']);
    for (const p of s.points) rows.push([p.day, cell(p.value, s.format)]);
  }
  return toCsv(rows);
}
