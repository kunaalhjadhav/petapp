import { MapProviderError, type MapPlace, type MapProvider } from './map.provider';

interface GeocodeResult {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components: Array<{ long_name: string; types: string[] }>;
}

const PICK = ['sublocality_level_1', 'sublocality', 'neighborhood', 'locality', 'administrative_area_level_2'];

/** Google Geocoding API, limited to India. The key needs only the Geocoding API enabled. */
export class GoogleMapProvider implements MapProvider {
  readonly name = 'google';
  readonly configured = true;
  constructor(
    private readonly key: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async search(query: string): Promise<MapPlace[]> {
    const r = await this.call({ address: query, components: 'country:IN' });
    return r.slice(0, 5).map(toPlace);
  }

  async reverse(lat: number, lng: number): Promise<MapPlace | null> {
    const r = await this.call({ latlng: `${lat},${lng}`, result_type: PICK.slice(0, 4).join('|') });
    return r.length ? toPlace(r[0]) : null;
  }

  private async call(params: Record<string, string>): Promise<GeocodeResult[]> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    for (const [k, v] of Object.entries({ ...params, region: 'in', language: 'en', key: this.key })) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new MapProviderError(`maps request failed: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { status?: string; results?: GeocodeResult[]; error_message?: string };
    if (body.status === 'ZERO_RESULTS') return [];
    if (!res.ok || body.status !== 'OK') throw new MapProviderError(`maps answered ${res.status} ${body.status ?? ''} ${body.error_message ?? ''}`.trim());
    return body.results ?? [];
  }
}

function part(r: GeocodeResult, type: string) {
  return r.address_components.find((c) => c.types.includes(type))?.long_name ?? null;
}

export function toPlace(r: GeocodeResult): MapPlace {
  const label = PICK.map((t) => part(r, t)).find(Boolean) ?? r.formatted_address.split(',')[0].trim();
  const city = part(r, 'locality') ?? part(r, 'administrative_area_level_2');
  const pincode = part(r, 'postal_code');
  const detail = [city !== label ? city : null, part(r, 'administrative_area_level_1'), pincode].filter(Boolean).join(', ');
  return { label, detail, lat: r.geometry.location.lat, lng: r.geometry.location.lng, pincode: pincode && /^\d{6}$/.test(pincode) ? pincode : null, city };
}
