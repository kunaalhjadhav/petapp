// Pure rules for admin analytics (spec §55): India-time days, date ranges and the report shape. No I/O; unit-tested.

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;

/** The India-time calendar day of an instant, as YYYY-MM-DD. */
export const istDay = (at: Date = new Date()): string => new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);

/** The instant an India-time day starts. */
export const istStart = (day: string): Date => new Date(Date.parse(`${day}T00:00:00.000Z`) - IST_MS);

export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);

export interface Range {
  /** First day, India time, inclusive */
  from: string;
  /** Last day, inclusive */
  to: string;
  days: number;
  /** [start, end) as instants */
  start: Date;
  end: Date;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00.000Z`)) && new Date(`${d}T00:00:00.000Z`).toISOString().startsWith(d);

/**
 * A report range from optional YYYY-MM-DD bounds. Defaults to the last 30 days up to today; never past today;
 * at most a year. Returns a problem in words instead of throwing, so the caller picks the error.
 */
export function parseRange(from: string | undefined, to: string | undefined, now: Date = new Date()): Range | { problem: string } {
  const today = istDay(now);
  if (from !== undefined && !valid(from)) return { problem: 'Use a start date like 2026-10-01.' };
  if (to !== undefined && !valid(to)) return { problem: 'Use an end date like 2026-10-31.' };
  let end = to ?? today;
  if (end > today) end = today;
  const start = from ?? addDays(end, -(DEFAULT_RANGE_DAYS - 1));
  if (start > end) return { problem: 'The start date is after the end date.' };
  const days = daysBetween(start, end) + 1;
  if (days > MAX_RANGE_DAYS) return { problem: `Choose at most ${MAX_RANGE_DAYS} days.` };
  return { from: start, to: end, days, start: istStart(start), end: istStart(addDays(end, 1)) };
}

/** The same number of days just before a range, for comparison. */
export function previousRange(r: Range): Range {
  const to = addDays(r.from, -1);
  const from = addDays(to, -(r.days - 1));
  return { from, to, days: r.days, start: istStart(from), end: istStart(addDays(to, 1)) };
}

/** Every day of a range, in order. */
export function eachDay(r: Pick<Range, 'from' | 'days'>): string[] {
  return Array.from({ length: r.days }, (_, i) => addDays(r.from, i));
}

/** A daily series with a zero for every day nothing happened. */
export function fillSeries(r: Pick<Range, 'from' | 'days'>, rows: Array<{ day: string | Date; value: number | bigint | null }>): Array<{ day: string; value: number }> {
  const by = new Map(rows.map((x) => [typeof x.day === 'string' ? x.day.slice(0, 10) : x.day.toISOString().slice(0, 10), Number(x.value ?? 0)]));
  return eachDay(r).map((day) => ({ day, value: by.get(day) ?? 0 }));
}

/** a as a percentage of b, to one decimal place; null when b is 0 (shown as "–", not 0%). */
export const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** a / b rounded to a whole number; null when b is 0. */
export const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round(a / b) : null);

export type Format = 'count' | 'paise' | 'pct';
export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  format: Format;
  /** The same figure for the period just before, when it compares */
  previous?: number | null;
  hint?: string;
}
export interface Series {
  key: string;
  label: string;
  format: Format;
  points: Array<{ day: string; value: number }>;
}
export interface Table {
  key: string;
  label: string;
  columns: Array<{ key: string; label: string; format: Format | 'text' }>;
  rows: Array<Record<string, string | number | null>>;
}
export interface Report {
  tab: string;
  from: string;
  to: string;
  days: number;
  generatedAt: string;
  kpis: Kpi[];
  series: Series[];
  tables: Table[];
  notes: string[];
}

/** Change from the previous period as a percentage, for the dashboard's arrows; null when it can't compare. */
export const change = (now: number | null, before: number | null | undefined): number | null =>
  now === null || before === null || before === undefined || before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10;

/** Retention: of the people who joined on a day, the share active again exactly n days later. Only cohorts old enough count. */
export function retention(cohorts: Array<{ day: string; joined: number; back: Record<number, number> }>, n: number, lastDay: string): number | null {
  let joined = 0;
  let back = 0;
  for (const c of cohorts) {
    if (addDays(c.day, n) > lastDay) continue;
    joined += c.joined;
    back += c.back[n] ?? 0;
  }
  return pct(back, joined);
}
