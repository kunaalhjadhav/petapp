import { LEGAL_TEMPLATES } from './legal.templates';
import { placeholders } from './legal.service';
import { audienceOf, order } from './consent.service';
import { clean } from './data-export.service';

describe('legal templates', () => {
  it('cover the eight documents, each with a grievance contact', () => {
    expect(LEGAL_TEMPLATES.map((t) => t.slug)).toEqual([
      'terms-of-service', 'privacy-policy', 'contest-terms', 'refund-policy', 'cancellation-policy', 'partner-terms', 'vendor-terms', 'community-guidelines',
    ]);
    for (const t of LEGAL_TEMPLATES) {
      expect(t.body.startsWith(`# ${t.title}`)).toBe(true);
      expect(t.body).toContain('Grievance Officer');
    }
  });

  it('must be filled in before publishing: every template has placeholders', () => {
    for (const t of LEGAL_TEMPLATES) expect(placeholders(t.body).length).toBeGreaterThan(0);
    expect(placeholders('Hello {{Company legal name}}, {{Company legal name}} and {{City}}')).toEqual(['{{Company legal name}}', '{{City}}']);
    expect(placeholders('No gaps here {not one}')).toEqual([]);
  });

  it('asks the right people to accept', () => {
    expect(audienceOf('privacy-policy')).toBe('everyone');
    expect(audienceOf('partner-terms')).toBe('partners');
    expect(audienceOf('vendor-terms')).toBe('sellers');
    expect(audienceOf('contest-terms')).toBe('contestants');
    expect(LEGAL_TEMPLATES.filter((t) => t.requiresAcceptance).map((t) => t.slug)).toEqual(['terms-of-service', 'privacy-policy', 'contest-terms', 'partner-terms', 'vendor-terms']);
    expect(order('terms-of-service')).toBeLessThan(order('privacy-policy'));
    expect(order('unknown')).toBe(99);
  });
});

describe('data export cleaning', () => {
  it('drops secrets at every depth and keeps everything else', () => {
    const out = clean({
      id: 'u1', name: 'Asha', passwordHash: 'x',
      sessions: [{ id: 's1', tokenHash: 'y', familyId: 'f', userAgent: 'app', createdAt: new Date('2026-10-01T00:00:00Z') }],
      payout: { accountLast4: '1234', accountNumberEnc: 'v1:...' },
      media: [{ id: 'm1', storageKey: 'uploads/u1/m1', variants: { images: [] }, kind: 'IMAGE' }],
    });
    expect(out).toEqual({
      id: 'u1', name: 'Asha',
      sessions: [{ id: 's1', userAgent: 'app', createdAt: '2026-10-01T00:00:00.000Z' }],
      payout: { accountLast4: '1234' },
      media: [{ id: 'm1', kind: 'IMAGE' }],
    });
    expect(JSON.stringify(out)).not.toMatch(/Hash|Enc|storageKey/);
  });

  it('turns big integers into numbers and leaves nulls alone', () => {
    expect(clean({ n: BigInt(42), x: null, y: undefined })).toEqual({ n: 42, x: null, y: undefined });
  });
});
