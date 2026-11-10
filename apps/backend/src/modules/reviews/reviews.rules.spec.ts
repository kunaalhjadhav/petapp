import { needsAiCheck, parcelReceived, ratingSummary, reviewOrder, reviewerName, roundRating } from './reviews.rules';

describe('review rules', () => {
  it('only received parcels prove a purchase', () => {
    const at = new Date();
    expect(parcelReceived('DELIVERED', at)).toBe(true);
    expect(parcelReceived('RETURNED', at)).toBe(true);
    expect(parcelReceived('RETURN_REQUESTED', at)).toBe(true);
    expect(parcelReceived('SHIPPED', null)).toBe(false);
    expect(parcelReceived('CANCELLED', null)).toBe(false);
    expect(parcelReceived('DELIVERED', null)).toBe(false);
  });

  it('summarises ratings with five rows and a one-decimal average', () => {
    const s = ratingSummary([{ rating: 5, count: 2 }, { rating: 4, count: 1 }]);
    expect(s).toEqual({ avg: 4.7, count: 3, stars: [{ stars: 5, count: 2 }, { stars: 4, count: 1 }, { stars: 3, count: 0 }, { stars: 2, count: 0 }, { stars: 1, count: 0 }] });
    expect(ratingSummary([])).toMatchObject({ avg: 0, count: 0 });
    expect(roundRating(4.25)).toBe(4.3);
    expect(roundRating(null)).toBe(0);
  });

  it('orders reviews', () => {
    expect(reviewOrder(undefined)).toEqual([{ createdAt: 'desc' }]);
    expect(reviewOrder('lowest')[0]).toEqual({ rating: 'asc' });
    expect(reviewOrder('highest')[0]).toEqual({ rating: 'desc' });
  });

  it('checks text or photos with AI, not bare ratings', () => {
    expect(needsAiCheck('  ', [])).toBe(false);
    expect(needsAiCheck(null, ['x'])).toBe(true);
    expect(needsAiCheck('Great', [])).toBe(true);
  });

  it('shows a first name and initial', () => {
    expect(reviewerName('Riya Sharma')).toBe('Riya S.');
    expect(reviewerName('Anil Kumar varma')).toBe('Anil V.');
    expect(reviewerName('Meera')).toBe('Meera');
    expect(reviewerName('  ')).toBe('PetApp user');
  });
});
