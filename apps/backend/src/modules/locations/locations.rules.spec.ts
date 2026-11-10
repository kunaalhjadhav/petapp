import { deliveryLine, distanceKm, mergePlaces, normalizePincode, parsePlacesCsv, petDistanceKm, pickZone, placeQuery, placeSlug, validPinPattern, zoneScore, type PlaceHit } from './locations.rules';

const zone = (id: string, over: Partial<{ pincodes: string[]; cityIds: string[]; stateCodes: string[]; isActive: boolean }> = {}) => ({
  id, name: id, isActive: true, pincodes: [], cityIds: [], stateCodes: [], ...over,
});

describe('location rules', () => {
  it('reads PIN codes and slugs', () => {
    expect(normalizePincode(' 411 001 ')).toBe('411001');
    expect(normalizePincode('011001')).toBeNull();
    expect(normalizePincode('41100')).toBeNull();
    expect(placeSlug('Koregaon Park (East)')).toBe('koregaon-park-east');
    expect(validPinPattern('4110*')).toBe(true);
    expect(validPinPattern('411001')).toBe(true);
    expect(validPinPattern('41100')).toBe(false);
    expect(validPinPattern('*')).toBe(false);
  });

  it('picks the most specific zone', () => {
    const at = { pincode: '411001', cityId: 'pune', stateCode: 'MH' };
    const state = zone('Maharashtra', { stateCodes: ['MH'] });
    const city = zone('Pune city', { cityIds: ['pune'] });
    const prefix = zone('Pune 4110', { pincodes: ['4110*'] });
    const wide = zone('Pune 41', { pincodes: ['41*'] });
    const exact = zone('Camp', { pincodes: ['411001'] });
    expect(zoneScore(state, at)).toBe(1);
    expect(zoneScore(city, at)).toBe(5);
    expect(zoneScore(prefix, at)).toBe(14);
    expect(zoneScore(wide, at)).toBe(12);
    expect(zoneScore(exact, at)).toBe(100);
    expect(pickZone([state, city, wide, prefix], at)?.id).toBe('Pune 4110');
    expect(pickZone([state, exact, prefix], at)?.id).toBe('Camp');
    expect(pickZone([zone('off', { stateCodes: ['MH'], isActive: false })], at)).toBeNull();
    expect(pickZone([state], { pincode: '560001', cityId: 'blr', stateCode: 'KA' })).toBeNull();
    // Ties don't depend on order.
    const a = zone('A', { stateCodes: ['MH'] });
    const b = zone('B', { stateCodes: ['MH'] });
    expect(pickZone([b, a], at)?.id).toBe('A');
    expect(pickZone([a, b], at)?.id).toBe('A');
  });

  it('words delivery times', () => {
    expect(deliveryLine(2, 4)).toBe('Delivery in 2–4 days');
    expect(deliveryLine(1, 1)).toBe('Delivery tomorrow');
    expect(deliveryLine(0, 0)).toBe('Delivery today');
    expect(deliveryLine(3, 3)).toBe('Delivery in 3 days');
  });

  it('imports PIN codes and areas, reporting bad lines', () => {
    const csv = 'pincode,locality,lat,lng\n411001,Camp,18.51,73.88\n\n411036,"Mundhwa, East",,\n41100x,Bad\n411001,Again\n411014,Viman Nagar,18.56\n';
    const { rows, errors } = parsePlacesCsv(csv);
    expect(rows).toEqual([
      { line: 2, pincode: '411001', locality: 'Camp', lat: 18.51, lng: 73.88 },
      { line: 4, pincode: '411036', locality: 'Mundhwa, East', lat: null, lng: null },
    ]);
    expect(errors).toEqual([
      'Line 5: “41100x” isn’t a 6-digit PIN code.',
      'Line 6: 411001 appears twice.',
      'Line 7: give both latitude and longitude, as numbers.',
    ]);
    expect(parsePlacesCsv('411001\n411002', 1).errors).toEqual(['Line 2: only 1 rows can be imported at once.']);
  });

  it('rounds pet distances up to whole kilometres', () => {
    expect(petDistanceKm(120)).toBe(1);
    expect(petDistanceKm(1001)).toBe(2);
    expect(petDistanceKm(5000)).toBe(5);
  });
});

describe('place search', () => {
  const hit = (label: string, lat: number, lng: number, source: PlaceHit['source'] = 'petapp'): PlaceHit => ({ kind: source === 'maps' ? 'PLACE' : 'LOCALITY', label, detail: '', lat, lng, pincode: null, city: null, citySlug: null, source });
  it('measures distance', () => {
    expect(Math.round(distanceKm(19.0596, 72.8295, 19.1197, 72.8468))).toBe(7); // Bandra to Andheri
    expect(distanceKm(1, 1, 1, 1)).toBe(0);
  });
  it('tidies what was typed', () => {
    expect(placeQuery('  bandra   west ')).toBe('bandra west');
    expect(placeQuery('b')).toBeNull();
    expect(placeQuery(undefined)).toBeNull();
    expect(placeQuery('x'.repeat(100))?.length).toBe(80);
  });
  it('lists PetApp places first and leaves out map duplicates', () => {
    const own = [hit('Bandra West', 19.0596, 72.8295)];
    const maps = [hit('bandra west', 19.06, 72.83, 'maps'), hit('Bandra Kurla Complex', 19.065, 72.865, 'maps'), hit('Bandra West', 26.0, 80.0, 'maps')];
    const r = mergePlaces(own, maps);
    expect(r.map((x) => [x.label, x.source])).toEqual([['Bandra West', 'petapp'], ['Bandra Kurla Complex', 'maps'], ['Bandra West', 'maps']]);
    expect(mergePlaces(own, maps, 2)).toHaveLength(2);
  });
});

