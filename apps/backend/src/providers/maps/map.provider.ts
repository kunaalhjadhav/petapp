/**
 * Maps (spec §19, "Google Maps or another configurable map provider"): turning what people type into places,
 * and a position into a place name. PetApp's own location database (cities, areas, PIN codes) answers first; a
 * map provider fills in streets, landmarks and areas the database doesn't have yet. Chosen by MAP_PROVIDER.
 */
export const MAP_PROVIDER = Symbol('MAP_PROVIDER');

export interface MapPlace {
  /** "Bandra West" */
  label: string;
  /** "Mumbai, Maharashtra 400050" */
  detail: string;
  lat: number;
  lng: number;
  pincode: string | null;
  city: string | null;
}

export interface MapProvider {
  readonly name: string;
  /** False: nothing is looked up outside PetApp's own database. */
  readonly configured: boolean;
  /** Places matching what someone typed, in India, best first. */
  search(query: string): Promise<MapPlace[]>;
  /** The place at a point, for "Near Bandra West". */
  reverse(lat: number, lng: number): Promise<MapPlace | null>;
}

/** MAP_PROVIDER=none: only PetApp's location database is searched. */
export class NoMapProvider implements MapProvider {
  readonly name = 'none';
  readonly configured = false;
  search(): Promise<MapPlace[]> {
    return Promise.resolve([]);
  }
  reverse(): Promise<MapPlace | null> {
    return Promise.resolve(null);
  }
}

export class MapProviderError extends Error {}
