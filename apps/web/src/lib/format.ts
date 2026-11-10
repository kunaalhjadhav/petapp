// Formatting for the public pages. Pure functions, unit-tested.

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/** 49900 → "₹499" */
export const rupees = (paise: number) => `₹${inr.format(paise / 100)}`;
export const formatDate = (iso: string | null | undefined) =>
  iso ? dateFmt.format(new Date(iso)) : '';
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? `${dateTimeFmt.format(new Date(iso))} IST` : '';

/** Minutes after midnight → "9:00 am" */
export function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Minutes after midnight → "09:00" (schema.org opening hours). */
export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Months → "4 years", "7 months", "1 year 2 months" */
export function age(months: number | null | undefined): string {
  if (months == null || months < 0) return '';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n: number, w: string) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  if (!y) return part(m, 'month') || 'Under a month';
  return [part(y, 'year'), part(m, 'month')].filter(Boolean).join(' ');
}

/** Shortens text for meta descriptions at a word boundary. */
export function clip(text: string | null | undefined, max = 155): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:!?-]+$/, '')}…`;
}

/** Milliseconds → ISO 8601 duration, e.g. 75000 → "PT1M15S" */
export function isoDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `PT${m ? `${m}M` : ''}${s % 60 || !m ? `${s % 60}S` : ''}`;
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
