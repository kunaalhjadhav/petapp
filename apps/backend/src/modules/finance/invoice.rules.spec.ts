import { INVOICE_LINK_TTL_SECONDS, financialYear, inr, invoiceLink, invoiceLinkKey, invoiceNumber, parcelLines, prefixFrom, splitGst, totals, verifyInvoiceLink } from './invoice.rules';

describe('invoice rules', () => {
  it('uses the Indian financial year in India time', () => {
    expect(financialYear(new Date('2026-03-31T18:29:00Z'))).toEqual({ long: '2025-26', short: '2526' }); // 23:59 IST, 31 Mar
    expect(financialYear(new Date('2026-03-31T18:31:00Z'))).toEqual({ long: '2026-27', short: '2627' }); // 00:01 IST, 1 Apr
    expect(financialYear(new Date('2099-12-01T00:00:00Z')).long).toBe('2099-00');
  });

  it('numbers invoices within the 16-character limit', () => {
    expect(invoiceNumber('WAGC', '2627', 42)).toBe('WAGC/2627/00042');
    expect(invoiceNumber('WAGC', '2627', 123456)).toHaveLength(16);
    expect(() => invoiceNumber('WAGC', '2627', 1234567)).toThrow(/too long/);
    expect(prefixFrom('Wag & Co', 'I')).toBe('WAGI');
    expect(prefixFrom('Wag & Co', 'C')).toBe('WAGC');
    expect(prefixFrom('Ü', 'S')).toBe('XXXS');
  });

  it('splits GST into CGST + SGST within a state, IGST across states', () => {
    expect(splitGst(4561, true)).toEqual({ cgstPaise: 2280, sgstPaise: 2281, igstPaise: 0 });
    expect(splitGst(4561, false)).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 4561 });
  });

  it('builds parcel lines that add up exactly to what the customer paid', () => {
    const items = [
      { description: 'Jerky', qty: 2, unitPaise: 29900, lineTotalPaise: 59800, rateBps: 1800 },
      { description: 'Bowl', qty: 1, unitPaise: 19900, lineTotalPaise: 19900, rateBps: 1200 },
    ];
    const lines = parcelLines(items, 7970, 4900, true, true);
    const t = totals(lines);
    expect(t.totalPaise).toBe(59800 + 19900 - 7970 + 4900);
    expect(t.taxablePaise + t.cgstPaise + t.sgstPaise + t.igstPaise).toBe(t.totalPaise);
    expect(lines.map((l) => l.totalPaise)).toEqual([53820, 17910, 4900]); // 10% off each, by value
    expect(lines[2]).toMatchObject({ description: 'Shipping charges', rateBps: 1800 }); // follows the principal item
    const bos = parcelLines(items, 0, 0, false, true);
    expect(bos.every((l) => l.cgstPaise + l.sgstPaise + l.igstPaise === 0 && l.taxablePaise === l.totalPaise)).toBe(true);
  });

  it('formats amounts the Indian way, always with paise', () => {
    expect(inr(12345678)).toBe('₹1,23,456.78');
    expect(inr(34800, 'Rs. ')).toBe('Rs. 348.00');
    expect(inr(-5)).toBe('-₹0.05');
  });

  describe('download links', () => {
    const key = invoiceLinkKey('x'.repeat(40));
    const id = '3f0c8a52-1b7e-4d2a-9c11-0a9b8c7d6e5f';
    const now = Date.UTC(2026, 9, 11, 6, 0, 0);
    const parts = (path: string) => Object.fromEntries(new URL(`http://x${path}`).searchParams);

    it('works for that invoice until it expires, then never again', () => {
      const l = invoiceLink(key, id, now);
      const { expires, sig } = parts(l.path);
      expect(l.path.startsWith(`/invoices/${id}/file?`)).toBe(true);
      expect(Date.parse(l.expiresAt)).toBe(now + INVOICE_LINK_TTL_SECONDS * 1000);
      expect(verifyInvoiceLink(key, id, expires, sig, now)).toBe(true);
      expect(verifyInvoiceLink(key, id, expires, sig, now + INVOICE_LINK_TTL_SECONDS * 1000)).toBe(true);
      expect(verifyInvoiceLink(key, id, expires, sig, now + INVOICE_LINK_TTL_SECONDS * 1000 + 1000)).toBe(false);
    });

    it('rejects another invoice, another key, an edited expiry, and junk', () => {
      const { expires, sig } = parts(invoiceLink(key, id, now).path);
      expect(verifyInvoiceLink(key, id.replace('3f', '4f'), expires, sig, now)).toBe(false);
      expect(verifyInvoiceLink(invoiceLinkKey('y'.repeat(40)), id, expires, sig, now)).toBe(false);
      expect(verifyInvoiceLink(key, id, String(Number(expires) + 60), sig, now)).toBe(false);
      // A far-future expiry is refused even before the signature is checked.
      expect(verifyInvoiceLink(key, id, String(Number(expires) + 86_400), sig, now)).toBe(false);
      for (const [e, s] of [[undefined, sig], [expires, undefined], ['12x', sig], [expires, 'zz'], [[expires], sig]] as Array<[unknown, unknown]>) {
        expect(verifyInvoiceLink(key, id, e, s, now)).toBe(false);
      }
    });

    it('uses its own key, not the server secret itself', () => {
      expect(invoiceLinkKey('x'.repeat(40))).not.toBe('x'.repeat(40));
      expect(invoiceLinkKey('x'.repeat(40))).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
