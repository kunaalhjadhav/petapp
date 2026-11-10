// Locations (spec §44–45): pure rules for PIN codes, place names, delivery zones and imports.

/** "Koregaon Park" → "koregaon-park". */
export function placeSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** An Indian PIN code: six digits, not starting with 0. Spaces are ignored ("411 001"). */
export function normalizePincode(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\s+/g, '');
  return /^[1-9][0-9]{5}$/.test(d) ? d : null;
}

/** A zone entry: a full PIN code, or a prefix of 1–5 digits ending in "*". */
export function validPinPattern(p: string): boolean {
  return /^[1-9][0-9]{5}$/.test(p) || /^[1-9][0-9]{0,4}\*$/.test(p);
}

export interface ZoneLike {
  id: string;
  name: string;
  isActive: boolean;
  pincodes: string[];
  cityIds: string[];
  stateCodes: string[];
}

export interface PlaceKey {
  pincode: string | null;
  cityId: string | null;
  stateCode: string | null;
}

/**
 * How specifically a zone covers a place: 100 for its exact PIN code, 10 + prefix length for a PIN prefix,
 * 5 for its city, 1 for its state, 0 when it doesn't cover it.
 */
export function zoneScore(z: ZoneLike, at: PlaceKey): number {
  if (!z.isActive) return 0;
  let best = 0;
  if (at.pincode) {
    for (const p of z.pincodes) {
      if (p === at.pincode) return 100;
      if (p.endsWith('*') && at.pincode.startsWith(p.slice(0, -1))) best = Math.max(best, 10 + p.length - 1);
    }
  }
  if (!best && at.cityId && z.cityIds.includes(at.cityId)) best = 5;
  if (!best && at.stateCode && z.stateCodes.includes(at.stateCode)) best = 1;
  return best;
}

/** The most specific active zone for a place; ties go to the earlier name, so the result never depends on order. */
export function pickZone<T extends ZoneLike>(zones: T[], at: PlaceKey): T | null {
  let best: T | null = null;
  let score = 0;
  for (const z of zones) {
    const s = zoneScore(z, at);
    if (s > score || (s === score && s > 0 && best && z.name.localeCompare(best.name) < 0)) {
      best = z;
      score = s;
    }
  }
  return best;
}

/** "Delivery in 2–4 days", "Delivery tomorrow", "Delivery today". */
export function deliveryLine(minDays: number, maxDays: number): string {
  if (maxDays <= 0) return 'Delivery today';
  if (minDays === maxDays) return maxDays === 1 ? 'Delivery tomorrow' : `Delivery in ${maxDays} days`;
  return `Delivery in ${minDays}–${maxDays} days`;
}

export interface ImportRow {
  line: number;
  pincode: string;
  locality: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Parses "pincode,locality,lat,lng" lines (a header row and blank lines are skipped; locality and coordinates
 * are optional; quotes are allowed around a locality). Bad lines are reported with their line numbers.
 */
export function parsePlacesCsv(text: string, maxRows = 5000): { rows: ImportRow[]; errors: string[] } {
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t) return;
    const cells = splitCsv(t);
    if (i === 0 && !/^\d/.test(cells[0] ?? '')) return; // header
    const pincode = normalizePincode(cells[0]);
    if (!pincode) return void errors.push(`Line ${line}: “${cells[0] ?? ''}” isn’t a 6-digit PIN code.`);
    if (seen.has(pincode)) return void errors.push(`Line ${line}: ${pincode} appears twice.`);
    const locality = (cells[1] ?? '').trim() || null;
    if (locality && locality.length > 80) return void errors.push(`Line ${line}: the area name is too long.`);
    const hasLat = (cells[2] ?? '').trim() !== '';
    const hasLng = (cells[3] ?? '').trim() !== '';
    let lat: number | null = null;
    let lng: number | null = null;
    if (hasLat || hasLng) {
      lat = Number(cells[2]);
      lng = Number(cells[3]);
      if (!hasLat || !hasLng || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return void errors.push(`Line ${line}: give both latitude and longitude, as numbers.`);
      }
    }
    if (rows.length >= maxRows) return void errors.push(`Line ${line}: only ${maxRows} rows can be imported at once.`);
    seen.add(pincode);
    rows.push({ line, pincode, locality, lat, lng });
  });
  return { rows, errors };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * Distance shown for a nearby pet: whole kilometres, at least 1, so exact homes can't be worked out
 * ("Under 1 km" never appears for pets; it reads "1 km away").
 */
export function petDistanceKm(meters: number): number {
  return Math.max(1, Math.ceil(meters / 1000));
}

// ── place search (spec §19: search city, locality and PIN code) ──

/** One answer to "where?": from PetApp's location database first, then the map provider. */
export interface PlaceHit {
  kind: 'CITY' | 'LOCALITY' | 'PINCODE' | 'PLACE';
  label: string;
  detail: string;
  lat: number;
  lng: number;
  pincode: string | null;
  /** The city's name ("Pune"), when known. */
  city: string | null;
  /** The PetApp city it belongs to, when known (for city-targeted sections). */
  citySlug: string | null;
  source: 'petapp' | 'maps';
}

/** Distance between two points on the earth, in km (haversine). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** What someone typed, ready to search: trimmed, single spaces, at most 80 characters; null when too short. */
export function placeQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return q.length >= 2 ? q : null;
}

/**
 * PetApp's own places first; a map result is added only when it isn't the same place (same name within 2 km)
 * as one already listed. At most `limit`.
 */
export function mergePlaces(own: PlaceHit[], maps: PlaceHit[], limit = 8): PlaceHit[] {
  const out = [...own];
  for (const m of maps) {
    const dup = out.some((o) => o.label.toLowerCase() === m.label.toLowerCase() && distanceKm(o.lat, o.lng, m.lat, m.lng) < 2);
    if (!dup) out.push(m);
  }
  return out.slice(0, limit);
}
