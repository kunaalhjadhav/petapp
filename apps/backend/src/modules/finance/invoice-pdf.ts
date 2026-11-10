import PDFDocument from 'pdfkit';
import type { Invoice } from '../../generated/prisma/client';
import { inr, type InvoiceLine, type Party } from './invoice.rules';

const TITLES: Record<string, string> = { TAX_INVOICE: 'Tax Invoice', BILL_OF_SUPPLY: 'Bill of Supply', CREDIT_NOTE: 'Credit Note' };
const rs = (p: number) => inr(p, 'Rs. ');
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

/** Renders an issued invoice as an A4 PDF. Pure: the same invoice always renders the same content. */
export function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  const issuer = inv.issuer as unknown as Party;
  const recipient = inv.recipient as unknown as Party & { orderCode?: string; parcelCode?: string; bookingCode?: string; againstInvoice?: string };
  const lines = inv.lines as unknown as InvoiceLine[];
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${TITLES[inv.title] ?? inv.title} ${inv.number}`, Author: issuer.name, CreationDate: inv.issuedAt } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 80;
  const date = new Date(inv.issuedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10).split('-').reverse().join('-');
  doc.font('Helvetica-Bold').fontSize(16).text(TITLES[inv.title] ?? inv.title, 40, 40);
  doc.font('Helvetica').fontSize(9).text(`No. ${inv.number}`, { align: 'right' }).text(`Date ${date}`, { align: 'right' });
  if (recipient.againstInvoice) doc.text(`Against invoice ${recipient.againstInvoice}`, { align: 'right' });
  doc.moveDown();

  const party = (label: string, p: Party, x: number, y: number) => {
    doc.font('Helvetica-Bold').fontSize(9).text(label, x, y, { width: W / 2 - 10 });
    doc.font('Helvetica').text(p.name, { width: W / 2 - 10 }).text(p.address, { width: W / 2 - 10 }).text(`State: ${p.state}`, { width: W / 2 - 10 });
    if (p.gstin) doc.text(`GSTIN: ${p.gstin}`, { width: W / 2 - 10 });
    if (p.pan) doc.text(`PAN: ${p.pan}`, { width: W / 2 - 10 });
    return doc.y;
  };
  const top = doc.y;
  const y1 = party(inv.kind === 'COMMISSION' ? 'From' : 'Sold by', issuer, 40, top);
  const y2 = party('Bill to', recipient, 40 + W / 2, top);
  doc.y = Math.max(y1, y2) + 8;
  const refs = [recipient.orderCode && `Order ${recipient.orderCode}`, recipient.parcelCode && `Parcel ${recipient.parcelCode}`, recipient.bookingCode && `Booking ${recipient.bookingCode}`, `Place of supply: ${inv.placeOfSupply}`].filter(Boolean).join('   ');
  doc.font('Helvetica').fontSize(8).text(refs, 40, doc.y, { width: W });
  doc.moveDown(0.8);

  const taxed = inv.title !== 'BILL_OF_SUPPLY';
  const igst = inv.igstPaise > 0;
  const cols = taxed
    ? [['Item', 0.34], ['Qty', 0.06], ['Taxable', 0.15], ['Rate', 0.07], [igst ? 'IGST' : 'CGST', 0.12], [igst ? '' : 'SGST', 0.12], ['Amount', 0.14]]
    : [['Item', 0.6], ['Qty', 0.1], ['Amount', 0.3]];
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    let x = 40;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let h = 0;
    cells.forEach((c, i) => {
      const w = W * (cols[i][1] as number);
      doc.text(c, x + 2, y, { width: w - 4, align: i === 0 ? 'left' : 'right' });
      h = Math.max(h, doc.y - y);
      x += w;
    });
    doc.y = y + h + 4;
    doc.moveTo(40, doc.y - 2).lineTo(40 + W, doc.y - 2).strokeColor('#dddddd').stroke();
  };
  row(cols.map((c) => c[0] as string), true);
  for (const l of lines) {
    const name = l.hsnSac ? `${l.description} (SAC/HSN ${l.hsnSac})` : l.description;
    row(taxed
      ? [name, String(l.qty), rs(l.taxablePaise), pct(l.rateBps), rs(igst ? l.igstPaise : l.cgstPaise), igst ? '' : rs(l.sgstPaise), rs(l.totalPaise)]
      : [name, String(l.qty), rs(l.totalPaise)]);
  }
  doc.moveDown(0.5);
  const sum = (label: string, v: number, bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(`${label}  ${rs(v)}`, { align: 'right' });
  if (taxed) {
    sum('Taxable value', inv.taxablePaise);
    if (igst) sum('IGST', inv.igstPaise);
    else {
      sum('CGST', inv.cgstPaise);
      sum('SGST', inv.sgstPaise);
    }
  }
  sum(inv.kind === 'CREDIT_NOTE' ? 'Credit total' : 'Total', inv.totalPaise, true);
  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(7).fillColor('#555555');
  if (inv.kind !== 'COMMISSION') doc.text('Issued by PetApp on behalf of the seller named above, who is the supplier. Prices include GST where the supplier is registered.', { width: W });
  if (!taxed) doc.text('The supplier is not registered for GST; no GST is charged.', { width: W });
  doc.text('This is a computer-generated document and needs no signature.', { width: W });
  doc.end();
  return done;
}
