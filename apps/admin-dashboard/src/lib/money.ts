const whole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1000000 → "₹10,000"; 19950 → "₹199.50". Amounts are always integer paise. */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  return paise % 100 === 0 ? whole.format(paise / 100) : exact.format(paise / 100);
}

/** "199" or "199.50" (rupees) → 19950 paise; null if not a valid amount. */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim().replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}
