// Pure invoice rules: financial year, numbering, GST split and line building. No I/O; unit-tested.
import { createHmac, timingSafeEqual } from 'crypto';
import { allocate, gstIncluded } from '../marketplace/marketplace.rules';

export interface InvoiceLine {
  description: string;
  hsnSac: string | null;
  qty: number;
  /** GST-inclusive price per unit (before any discount). */
  unitPaise: number;
  taxablePaise: number;
  rateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** What the customer paid for the line, GST included. */
  totalPaise: number;
}

export interface Party {
  name: string;
  gstin: string | null;
  pan?: string | null;
  address: string;
  state: string;
}

const IST = 330 * 60_000;

/** Indian financial year (April–March) of an instant, India time: "2026-27", and its short form "2627". */
export function financialYear(at: Date): { long: string; short: string } {
  const d = new Date(at.getTime() + IST);
  const start = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const end = (start + 1) % 100;
  return { long: `${start}-${String(end).padStart(2, '0')}`, short: `${String(start % 100).padStart(2, '0')}${String(end).padStart(2, '0')}` };
}

/** "WAGC/2627/00042": at most 16 characters, as GST rules require. */
export function invoiceNumber(prefix: string, fyShort: string, seq: number): string {
  const n = `${prefix}/${fyShort}/${String(seq).padStart(5, '0')}`;
  if (n.length > 16) throw new Error(`invoice number too long: ${n}`);
  return n;
}

/**
 * A series prefix: three characters from the supplier's name plus a letter for the document — I (goods invoice),
 * C (credit note), S (service invoice) — so one business selling both goods and services under one GSTIN never
 * repeats a number. "Wag & Co" → "WAGI".
 */
export function prefixFrom(name: string, kind: 'I' | 'C' | 'S'): string {
  const p = `${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}XXX`.slice(0, 3);
  return `${p}${kind}`;
}

/** Same state: CGST + SGST (halves; any odd paisa to SGST). Different states: IGST. */
export function splitGst(gstPaise: number, sameState: boolean) {
  if (!sameState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  const cgstPaise = Math.floor(gstPaise / 2);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 };
}

export const sameState = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Lines for a parcel's invoice. The parcel's discount is spread over its items in proportion to their value, so the
 * lines add up exactly to what the customer paid. Shipping follows the principal item's GST rate (composite supply).
 * A supplier without GST registration issues a bill of supply: no GST lines.
 */
export function parcelLines(
  items: Array<{ description: string; qty: number; unitPaise: number; lineTotalPaise: number; rateBps: number }>,
  discountPaise: number,
  shippingPaise: number,
  registered: boolean,
  intra: boolean,
): InvoiceLine[] {
  const nets = allocate(discountPaise, items.map((i) => i.lineTotalPaise)).map((d, k) => items[k].lineTotalPaise - d);
  const line = (description: string, qty: number, unitPaise: number, total: number, rateBps: number): InvoiceLine => {
    const gst = registered ? gstIncluded(total, rateBps) : 0;
    return { description, hsnSac: null, qty, unitPaise, taxablePaise: total - gst, rateBps: registered ? rateBps : 0, ...splitGst(gst, intra), totalPaise: total };
  };
  const out = items.map((i, k) => line(i.description, i.qty, i.unitPaise, nets[k], i.rateBps));
  if (shippingPaise > 0) {
    const principal = items.reduce((best, i, k) => (nets[k] > nets[best] ? k : best), 0);
    out.push(line('Shipping charges', 1, shippingPaise, shippingPaise, items[principal]?.rateBps ?? 0));
  }
  return out;
}

export function totals(lines: InvoiceLine[]) {
  const s = (k: 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise') => lines.reduce((a, l) => a + l[k], 0);
  return { taxablePaise: s('taxablePaise'), cgstPaise: s('cgstPaise'), sgstPaise: s('sgstPaise'), igstPaise: s('igstPaise'), totalPaise: s('totalPaise') };
}

/** 1,23,456.78 with a currency mark — amounts on invoices always show paise. PDFs use "Rs." (built-in fonts lack ₹). */
export function inr(paise: number, mark = '₹'): string {
  const neg = paise < 0;
  const a = Math.abs(paise);
  const r = String(Math.floor(a / 100));
  const head = r.length > 3 ? r.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '';
  return `${neg ? '-' : ''}${mark}${head}${r.slice(-3)}.${String(a % 100).padStart(2, '0')}`;
}

// ── download links ──
// The apps open invoice PDFs in the phone's browser, which can't send the app's sign-in token. Instead the app asks
// for a link signed for that one invoice, valid for a few minutes.

/** How long a download link works. */
export const INVOICE_LINK_TTL_SECONDS = 300;

const linkMessage = (invoiceId: string, expires: number) => `invoice-file:${invoiceId}:${expires}`;

/** A key used only for invoice links, derived from a server secret (so the secret itself never signs anything else). */
export const invoiceLinkKey = (serverSecret: string) => createHmac('sha256', serverSecret).update('petapp:invoice-links:v1').digest('hex');

/** Path under /api/v1 that downloads the PDF without a sign-in token until `expiresAt`. */
export function invoiceLink(key: string, invoiceId: string, now = Date.now()): { path: string; expiresAt: string } {
  const expires = Math.floor(now / 1000) + INVOICE_LINK_TTL_SECONDS;
  const sig = createHmac('sha256', key).update(linkMessage(invoiceId, expires)).digest('hex');
  return { path: `/invoices/${invoiceId}/file?expires=${expires}&sig=${sig}`, expiresAt: new Date(expires * 1000).toISOString() };
}

/** True only for an unexpired link signed for this invoice. Constant-time comparison. */
export function verifyInvoiceLink(key: string, invoiceId: string, expires: unknown, sig: unknown, now = Date.now()): boolean {
  if (typeof expires !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(expires) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const exp = Number(expires);
  if (exp * 1000 < now || exp * 1000 > now + (INVOICE_LINK_TTL_SECONDS + 60) * 1000) return false;
  const want = Buffer.from(createHmac('sha256', key).update(linkMessage(invoiceId, exp)).digest('hex'), 'hex');
  const got = Buffer.from(sig, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}
