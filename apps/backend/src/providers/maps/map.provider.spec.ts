import { GoogleMapProvider } from './google.provider';
import { MapProviderError, NoMapProvider } from './map.provider';

const bandra = {
  formatted_address: 'Bandra West, Mumbai, Maharashtra 400050, India',
  geometry: { location: { lat: 19.0596, lng: 72.8295 } },
  address_components: [
    { long_name: 'Bandra West', types: ['sublocality_level_1', 'sublocality', 'political'] },
    { long_name: 'Mumbai', types: ['locality', 'political'] },
    { long_name: 'Maharashtra', types: ['administrative_area_level_1', 'political'] },
    { long_name: '400050', types: ['postal_code'] },
  ],
};

describe('maps providers', () => {
  const calls: string[] = [];
  const fetchFn = (body: unknown, status = 200) =>
    (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  beforeEach(() => (calls.length = 0));

  it('Google: searches India only and reads area, city and PIN', async () => {
    const g = new GoogleMapProvider('key-1', fetchFn({ status: 'OK', results: [bandra] }));
    expect(await g.search('bandra')).toEqual([{ label: 'Bandra West', detail: 'Mumbai, Maharashtra, 400050', lat: 19.0596, lng: 72.8295, pincode: '400050', city: 'Mumbai' }]);
    const u = new URL(calls[0]);
    expect(u.host).toBe('maps.googleapis.com');
    expect(u.searchParams.get('components')).toBe('country:IN');
    expect(u.searchParams.get('key')).toBe('key-1');
  });

  it('Google: a position becomes a place; nothing found is not an error; failures are', async () => {
    expect((await new GoogleMapProvider('k', fetchFn({ status: 'OK', results: [bandra] })).reverse(19.06, 72.83))?.label).toBe('Bandra West');
    expect(new URL(calls[0]).searchParams.get('latlng')).toBe('19.06,72.83');
    expect(await new GoogleMapProvider('k', fetchFn({ status: 'ZERO_RESULTS', results: [] })).search('zzzz')).toEqual([]);
    await expect(new GoogleMapProvider('k', fetchFn({ status: 'REQUEST_DENIED', error_message: 'bad key' }, 200)).search('x')).rejects.toBeInstanceOf(MapProviderError);
    await expect(new GoogleMapProvider('k', fetchFn({}, 500)).search('x')).rejects.toBeInstanceOf(MapProviderError);
  });

  it('none: looks nothing up', async () => {
    const n = new NoMapProvider();
    expect(n.configured).toBe(false);
    expect(await n.search()).toEqual([]);
    expect(await n.reverse()).toBeNull();
  });
});
