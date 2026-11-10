import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlatformService } from '../platform/platform.service';
import { RedisService } from '../../redis/redis.service';
import { MAP_PROVIDER, type MapPlace, type MapProvider } from '../../providers/maps/map.provider';
import { Paged } from '../../common/dto/pagination.dto';
import { likeText } from '../../common/utils/search';
import { Prisma } from '../../generated/prisma/client';
import type {
  AdminCitiesQuery, CitiesQuery, CityDto, DeliveryZoneDto, ImportPlacesDto, LocalityDto, PartnerLocationDto, PartnerLocationsQuery, PincodeDto, PincodesQuery,
  UpdateCityDto, UpdateDeliveryZoneDto, UpdateLocalityDto, UpdatePincodeDto,
} from './locations.dto';
import { deliveryLine, mergePlaces, normalizePincode, parsePlacesCsv, pickZone, placeQuery, placeSlug, type PlaceHit, type PlaceKey } from './locations.rules';

const point = (lat: number, lng: number) => Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
const km = (m: number) => Math.round(m / 100) / 10;

export interface Delivery {
  deliverable: boolean;
  zone: { id: string; name: string } | null;
  /** "Delivery in 2–4 days"; null with no zone */
  line: string | null;
  minDays: number | null;
  maxDays: number | null;
  /** The shipping rule for this place: the zone's, or null for the standard settings. */
  shipping: { flatPaise: number | null; freeAbovePaise: number | null } | null;
  /** Why it can't be delivered */
  problem: string | null;
}

/** The location database (spec §44) and its management (spec §45). */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
    private readonly redis: RedisService,
    @Inject(MAP_PROVIDER) private readonly maps: MapProvider,
  ) {}

  // ══════════════ public lookups ══════════════

  async states() {
    return this.prisma.state.findMany({ where: { country: { isActive: true } }, orderBy: { name: 'asc' }, select: { code: true, name: true, isUnionTerritory: true } });
  }

  private cityView(c: { id: string; slug: string; name: string; lat: number; lng: number; servicesLive: boolean; state: { code: string; name: string } }) {
    return { id: c.id, slug: c.slug, name: c.name, lat: c.lat, lng: c.lng, servicesLive: c.servicesLive, state: { code: c.state.code, name: c.state.name } };
  }

  async cities(q: CitiesQuery) {
    const rows = await this.prisma.city.findMany({
      where: {
        isActive: true,
        ...(q.stateCode ? { state: { code: q.stateCode } } : {}),
        ...(q.servicesLive ? { servicesLive: true } : {}),
        ...(q.q ? { name: { contains: likeText(q.q), mode: 'insensitive' } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 100,
      include: { state: { select: { code: true, name: true } } },
    });
    return rows.map((c) => this.cityView(c));
  }

  async city(slug: string) {
    const c = await this.prisma.city.findFirst({
      where: { slug, isActive: true },
      include: { state: { select: { code: true, name: true } }, localities: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true, lat: true, lng: true } } },
    });
    if (!c) throw new NotFoundException('City not found.');
    return { ...this.cityView(c), localities: c.localities };
  }

  /** What a PIN code is: its city, state, area and point. Used to fill in addresses. */
  async pincode(raw: string) {
    const code = normalizePincode(raw);
    if (!code) throw new BadRequestException('Use a 6-digit PIN code.');
    const p = await this.prisma.pincode.findUnique({
      where: { code },
      include: { city: { include: { state: { select: { code: true, name: true } } } }, locality: { select: { id: true, name: true, lat: true, lng: true } } },
    });
    if (!p || !p.city.isActive) throw new NotFoundException('We don’t know this PIN code yet. Type the city and area instead.');
    return {
      pincode: p.code,
      city: { id: p.city.id, slug: p.city.slug, name: p.city.name },
      state: p.city.state,
      locality: p.locality ? { id: p.locality.id, name: p.locality.name } : null,
      lat: p.lat ?? p.locality?.lat ?? p.city.lat,
      lng: p.lng ?? p.locality?.lng ?? p.city.lng,
    };
  }

  /**
   * "Where?" (spec §19): a 6-digit PIN code, or a city or area by name from PetApp's location database, then
   * streets, landmarks and areas from the map provider (MAP_PROVIDER) when it's set up. A map failure never stops
   * the database answers. Map answers are cached for a day, so the same words aren't looked up twice.
   */
  async searchPlaces(raw: string): Promise<{ places: PlaceHit[]; maps: string }> {
    const q = placeQuery(raw);
    if (!q) throw new BadRequestException('Type at least 2 letters, or a 6-digit PIN code.');
    const pin = normalizePincode(q);
    if (pin) {
      const p = await this.pincode(pin).catch(() => null);
      if (p) {
        return {
          places: [{ kind: 'PINCODE', label: p.locality ? `${p.locality.name}, ${p.city.name}` : p.city.name, detail: `${p.state.name} ${p.pincode}`, lat: p.lat, lng: p.lng, pincode: p.pincode, city: p.city.name, citySlug: p.city.slug, source: 'petapp' }],
          maps: this.maps.name,
        };
      }
    }
    const like = `%${likeText(q)}%`;
    const starts = `${likeText(q)}%`;
    const [cities, areas] = await Promise.all([
      this.prisma.$queryRaw<Array<{ name: string; slug: string; lat: number; lng: number; state: string }>>`
        SELECT c."name", c."slug", c."lat", c."lng", s."name" AS state FROM "City" c JOIN "State" s ON s."id" = c."stateId"
        WHERE c."isActive" AND c."name" ILIKE ${like}
        ORDER BY (c."name" ILIKE ${starts}) DESC, c."servicesLive" DESC, c."sortOrder", c."name" LIMIT 4`,
      this.prisma.$queryRaw<Array<{ name: string; lat: number | null; lng: number | null; city: string; slug: string; clat: number; clng: number; pin: string | null }>>`
        SELECT l."name", l."lat", l."lng", c."name" AS city, c."slug", c."lat" AS clat, c."lng" AS clng,
               (SELECT p."code" FROM "Pincode" p WHERE p."localityId" = l."id" ORDER BY p."code" LIMIT 1) AS pin
        FROM "Locality" l JOIN "City" c ON c."id" = l."cityId"
        WHERE l."isActive" AND c."isActive" AND l."name" ILIKE ${like}
        ORDER BY (l."name" ILIKE ${starts}) DESC, l."name" LIMIT 6`,
    ]);
    const own: PlaceHit[] = [
      ...cities.map((c): PlaceHit => ({ kind: 'CITY', label: c.name, detail: c.state, lat: c.lat, lng: c.lng, pincode: null, city: c.name, citySlug: c.slug, source: 'petapp' })),
      ...areas.map((a): PlaceHit => ({ kind: 'LOCALITY', label: a.name, detail: a.pin ? `${a.city} ${a.pin}` : a.city, lat: a.lat ?? a.clat, lng: a.lng ?? a.clng, pincode: a.pin, city: a.city, citySlug: a.slug, source: 'petapp' })),
    ];
    const fromMaps = own.length >= 6 || !this.maps.configured ? [] : await this.mapSearch(q);
    return { places: mergePlaces(own, fromMaps.map(mapHit)), maps: this.maps.name };
  }

  private async mapSearch(q: string): Promise<MapPlace[]> {
    const key = `maps:search:${createHash('sha256').update(q.toLowerCase()).digest('hex').slice(0, 32)}`;
    const cached = await this.redis.getJson<MapPlace[]>(key);
    if (cached) return cached;
    try {
      const r = await this.maps.search(q);
      await this.redis.setJson(key, r, 86_400);
      return r;
    } catch (e) {
      this.logger.warn(`map search failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** The nearest city (within 60 km) and area (within 5 km) to a point: for labelling where someone is. */
  async resolve(lat: number, lng: number) {
    const at = point(lat, lng);
    const [city] = await this.prisma.$queryRaw<Array<{ id: string; m: number }>>`
      SELECT "id", ST_Distance("location", ${at}) AS m FROM "City"
      WHERE "isActive" AND "location" IS NOT NULL AND ST_DWithin("location", ${at}, 60000)
      ORDER BY "location" <-> ${at} LIMIT 1`;
    if (!city) return { city: null, locality: null, distanceKm: null, place: await this.mapReverse(lat, lng) };
    const [loc] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "Locality"
      WHERE "cityId" = ${city.id}::uuid AND "isActive" AND "location" IS NOT NULL AND ST_DWithin("location", ${at}, 5000)
      ORDER BY "location" <-> ${at} LIMIT 1`;
    const c = await this.prisma.city.findUniqueOrThrow({ where: { id: city.id }, include: { state: { select: { code: true, name: true } } } });
    return { city: this.cityView(c), locality: loc ?? null, distanceKm: km(city.m), place: loc ? null : await this.mapReverse(lat, lng) };
  }

  /** The map provider's name for a point ("Bandra West"), when PetApp's database has no area there. Cached by ~100 m. */
  private async mapReverse(lat: number, lng: number): Promise<{ label: string; detail: string; pincode: string | null } | null> {
    if (!this.maps.configured) return null;
    const key = `maps:reverse:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = await this.redis.getJson<{ p: MapPlace | null }>(key);
    let p = cached?.p;
    if (!cached) {
      try {
        p = await this.maps.reverse(Number(lat.toFixed(3)), Number(lng.toFixed(3)));
        await this.redis.setJson(key, { p }, 86_400);
      } catch (e) {
        this.logger.warn(`map lookup failed: ${(e as Error).message}`);
        return null;
      }
    }
    return p ? { label: p.label, detail: p.detail, pincode: p.pincode } : null;
  }

  /**
   * Is the services marketplace available at a point? Covered when a city with services live is within
   * `locations.coverageRadiusKm`. Until any city is switched on, everywhere counts as covered.
   */
  async coverage(lat: number, lng: number) {
    const live = await this.prisma.city.count({ where: { isActive: true, servicesLive: true } });
    if (!live) return { covered: true, city: null, nearest: null, liveCities: 0 };
    const radius = await this.platform.getSetting<number>('locations.coverageRadiusKm');
    const at = point(lat, lng);
    const [near] = await this.prisma.$queryRaw<Array<{ id: string; name: string; slug: string; m: number }>>`
      SELECT "id", "name", "slug", ST_Distance("location", ${at}) AS m FROM "City"
      WHERE "isActive" AND "servicesLive" AND "location" IS NOT NULL
      ORDER BY "location" <-> ${at} LIMIT 1`;
    const covered = !!near && near.m <= radius * 1000;
    return {
      covered,
      city: covered ? { id: near.id, name: near.name, slug: near.slug } : null,
      nearest: near ? { name: near.name, slug: near.slug, distanceKm: km(near.m) } : null,
      liveCities: live,
    };
  }

  // ══════════════ delivery zones ══════════════

  /** Turns an address into the keys zones match on: its PIN code, its city (from the PIN code, or by name) and state. */
  async placeKey(a: { pincode: string; city: string; state: string }): Promise<PlaceKey> {
    const pincode = normalizePincode(a.pincode);
    const state = await this.prisma.state.findFirst({
      where: { OR: [{ code: a.state.trim().toUpperCase() }, { name: { equals: a.state.trim(), mode: 'insensitive' } }] },
      select: { id: true, code: true },
    });
    const pin = pincode ? await this.prisma.pincode.findUnique({ where: { code: pincode }, select: { cityId: true, city: { select: { state: { select: { code: true } } } } } }) : null;
    const city = pin
      ? { id: pin.cityId }
      : await this.prisma.city.findFirst({ where: { name: { equals: a.city.trim(), mode: 'insensitive' }, ...(state ? { stateId: state.id } : {}) }, select: { id: true } });
    return { pincode, cityId: city?.id ?? null, stateCode: pin?.city.state.code ?? state?.code ?? null };
  }

  /** Whether the shop delivers to an address, how fast, and at what shipping charge. */
  async delivery(a: { pincode: string; city: string; state: string }): Promise<Delivery> {
    const [zones, only] = await Promise.all([
      this.prisma.deliveryZone.findMany({ where: { isActive: true } }),
      this.platform.getSetting<boolean>('marketplace.deliveryZonesOnly'),
    ]);
    const zone = zones.length ? pickZone(zones, await this.placeKey(a)) : null;
    const pin = normalizePincode(a.pincode) ?? a.pincode;
    if (!zone) {
      return only && zones.length
        ? { deliverable: false, zone: null, line: null, minDays: null, maxDays: null, shipping: null, problem: `We don’t deliver to ${pin} yet.` }
        : { deliverable: true, zone: null, line: null, minDays: null, maxDays: null, shipping: null, problem: null };
    }
    if (!zone.deliverable) {
      return { deliverable: false, zone: { id: zone.id, name: zone.name }, line: null, minDays: null, maxDays: null, shipping: null, problem: zone.note || `We don’t deliver to ${pin} yet.` };
    }
    return {
      deliverable: true,
      zone: { id: zone.id, name: zone.name },
      line: deliveryLine(zone.minDays, zone.maxDays),
      minDays: zone.minDays,
      maxDays: zone.maxDays,
      shipping: { flatPaise: zone.shippingFlatPaise, freeAbovePaise: zone.freeAbovePaise },
      problem: null,
    };
  }

  // ══════════════ admin: cities ══════════════

  private async stateId(code: string) {
    const s = await this.prisma.state.findFirst({ where: { code, countryCode: 'IN' }, select: { id: true } });
    if (!s) throw new BadRequestException('Unknown state code.');
    return s.id;
  }

  async adminCities(q: AdminCitiesQuery) {
    const where: Prisma.CityWhereInput = {
      ...(q.show === 'active' ? { isActive: true } : q.show === 'inactive' ? { isActive: false } : q.show === 'live' ? { servicesLive: true } : {}),
      ...(q.stateCode ? { state: { code: q.stateCode } } : {}),
      ...(q.q ? { name: { contains: likeText(q.q), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.city.findMany({
        where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], skip: q.skip, take: q.limit,
        include: { state: { select: { code: true, name: true } }, _count: { select: { localities: true, pincodes: true } } },
      }),
      this.prisma.city.count({ where }),
    ]);
    return Paged.of(rows.map((c) => ({ ...this.cityView(c), isActive: c.isActive, sortOrder: c.sortOrder, localities: c._count.localities, pincodes: c._count.pincodes, updatedAt: c.updatedAt })), total, q);
  }

  async adminCity(id: string) {
    const c = await this.prisma.city.findUnique({
      where: { id },
      include: { state: { select: { code: true, name: true } }, localities: { orderBy: { name: 'asc' }, include: { _count: { select: { pincodes: true } } } }, _count: { select: { pincodes: true } } },
    });
    if (!c) throw new NotFoundException('City not found.');
    const radius = await this.platform.getSetting<number>('locations.coverageRadiusKm');
    const [{ partners }] = await this.prisma.$queryRaw<Array<{ partners: number }>>`
      SELECT COUNT(*)::int AS partners FROM "ServicePartner" p, "City" c
      WHERE c."id" = ${id}::uuid AND p."status" = 'APPROVED' AND ST_DWithin(p."location", c."location", ${radius * 1000})`;
    return {
      ...this.cityView(c), isActive: c.isActive, sortOrder: c.sortOrder, pincodes: c._count.pincodes, partnersNearby: partners, coverageRadiusKm: radius,
      localities: c.localities.map((l) => ({ id: l.id, slug: l.slug, name: l.name, lat: l.lat, lng: l.lng, isActive: l.isActive, pincodes: l._count.pincodes })),
    };
  }

  async createCity(actorId: string, dto: CityDto) {
    const slug = placeSlug(dto.name);
    if (!slug) throw new BadRequestException('Give the city a name.');
    const stateId = await this.stateId(dto.stateCode);
    try {
      const c = await this.prisma.city.create({ data: { name: dto.name, slug, stateId, lat: dto.lat, lng: dto.lng, isActive: dto.isActive ?? true, servicesLive: dto.servicesLive ?? false, sortOrder: dto.sortOrder ?? 0 } });
      await this.audit.log({ actorId, action: 'location.city_create', entityType: 'City', entityId: c.id, after: { ...dto } });
      return this.adminCity(c.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A city with this name already exists.');
      throw e;
    }
  }

  async updateCity(actorId: string, id: string, dto: UpdateCityDto) {
    const before = await this.prisma.city.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('City not found.');
    const data: Prisma.CityUncheckedUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name, slug: placeSlug(dto.name) } : {}),
      ...(dto.stateCode !== undefined ? { stateId: await this.stateId(dto.stateCode) } : {}),
      ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
      ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.servicesLive !== undefined ? { servicesLive: dto.servicesLive } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
    try {
      await this.prisma.city.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A city with this name already exists.');
      throw e;
    }
    await this.audit.log({
      actorId, action: dto.servicesLive !== undefined && dto.servicesLive !== before.servicesLive ? 'location.coverage' : 'location.city_update', entityType: 'City', entityId: id,
      before: { name: before.name, lat: before.lat, lng: before.lng, isActive: before.isActive, servicesLive: before.servicesLive }, after: { ...dto },
    });
    return this.adminCity(id);
  }

  /** Only a city with no areas or PIN codes can be deleted; otherwise switch it off. */
  async deleteCity(actorId: string, id: string) {
    const c = await this.prisma.city.findUnique({ where: { id }, include: { _count: { select: { localities: true, pincodes: true } } } });
    if (!c) throw new NotFoundException('City not found.');
    if (c._count.localities || c._count.pincodes) throw new ConflictException('This city has areas or PIN codes. Switch it off instead.');
    await this.prisma.city.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'location.city_delete', entityType: 'City', entityId: id, before: { name: c.name } });
    return { id, deleted: true };
  }

  // ══════════════ admin: areas and PIN codes ══════════════

  async createLocality(actorId: string, cityId: string, dto: LocalityDto) {
    if (!(await this.prisma.city.count({ where: { id: cityId } }))) throw new NotFoundException('City not found.');
    if ((dto.lat === undefined) !== (dto.lng === undefined)) throw new BadRequestException('Give both latitude and longitude, or neither.');
    try {
      const l = await this.prisma.locality.create({ data: { cityId, name: dto.name, slug: placeSlug(dto.name), lat: dto.lat ?? null, lng: dto.lng ?? null, isActive: dto.isActive ?? true } });
      await this.audit.log({ actorId, action: 'location.area_create', entityType: 'Locality', entityId: l.id, after: { cityId, ...dto } });
      return l;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('This city already has an area with that name.');
      throw e;
    }
  }

  async updateLocality(actorId: string, id: string, dto: UpdateLocalityDto) {
    const before = await this.prisma.locality.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Area not found.');
    const lat = dto.lat !== undefined ? dto.lat : before.lat;
    const lng = dto.lng !== undefined ? dto.lng : before.lng;
    if ((lat === null) !== (lng === null)) throw new BadRequestException('Give both latitude and longitude, or neither.');
    try {
      const l = await this.prisma.locality.update({
        where: { id },
        data: { ...(dto.name !== undefined ? { name: dto.name, slug: placeSlug(dto.name) } : {}), lat, lng, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
      });
      await this.audit.log({ actorId, action: 'location.area_update', entityType: 'Locality', entityId: id, before: { name: before.name, lat: before.lat, lng: before.lng, isActive: before.isActive }, after: { ...dto } });
      return l;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('This city already has an area with that name.');
      throw e;
    }
  }

  async deleteLocality(actorId: string, id: string) {
    const l = await this.prisma.locality.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Area not found.');
    // Its PIN codes stay with the city (their area is cleared).
    await this.prisma.locality.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'location.area_delete', entityType: 'Locality', entityId: id, before: { name: l.name, cityId: l.cityId } });
    return { id, deleted: true };
  }

  async pincodes(cityId: string, q: PincodesQuery) {
    const t = q.q?.trim();
    const where: Prisma.PincodeWhereInput = {
      cityId, localityId: q.localityId,
      ...(t ? (/^\d+$/.test(t) ? { code: { startsWith: t } } : { locality: { name: { contains: likeText(t), mode: 'insensitive' } } }) : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pincode.findMany({ where, orderBy: { code: 'asc' }, skip: q.skip, take: q.limit, include: { locality: { select: { id: true, name: true } } } }),
      this.prisma.pincode.count({ where }),
    ]);
    return Paged.of(rows.map((p) => ({ code: p.code, lat: p.lat, lng: p.lng, locality: p.locality })), total, q);
  }

  private async assertLocalityIn(cityId: string, localityId: string | null | undefined) {
    if (!localityId) return;
    if (!(await this.prisma.locality.count({ where: { id: localityId, cityId } }))) throw new BadRequestException('That area isn’t in this city.');
  }

  async createPincode(actorId: string, cityId: string, dto: PincodeDto) {
    if (!(await this.prisma.city.count({ where: { id: cityId } }))) throw new NotFoundException('City not found.');
    await this.assertLocalityIn(cityId, dto.localityId);
    if ((dto.lat === undefined) !== (dto.lng === undefined)) throw new BadRequestException('Give both latitude and longitude, or neither.');
    const existing = await this.prisma.pincode.findUnique({ where: { code: dto.code }, include: { city: { select: { name: true } } } });
    if (existing) throw new ConflictException(`${dto.code} is already in ${existing.city.name}.`);
    const p = await this.prisma.pincode.create({ data: { code: dto.code, cityId, localityId: dto.localityId ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null } });
    await this.audit.log({ actorId, action: 'location.pincode_create', entityType: 'Pincode', entityId: null, after: { code: p.code, cityId, localityId: p.localityId } });
    return p;
  }

  async updatePincode(actorId: string, code: string, dto: UpdatePincodeDto) {
    const before = await this.prisma.pincode.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('PIN code not found.');
    await this.assertLocalityIn(before.cityId, dto.localityId);
    const lat = dto.lat !== undefined ? dto.lat : before.lat;
    const lng = dto.lng !== undefined ? dto.lng : before.lng;
    if ((lat === null) !== (lng === null)) throw new BadRequestException('Give both latitude and longitude, or neither.');
    const p = await this.prisma.pincode.update({ where: { code }, data: { ...(dto.localityId !== undefined ? { localityId: dto.localityId } : {}), lat, lng } });
    await this.audit.log({ actorId, action: 'location.pincode_update', entityType: 'Pincode', entityId: null, before: { code, localityId: before.localityId, lat: before.lat, lng: before.lng }, after: { code, ...dto } });
    return p;
  }

  async deletePincode(actorId: string, code: string) {
    const p = await this.prisma.pincode.findUnique({ where: { code } });
    if (!p) throw new NotFoundException('PIN code not found.');
    await this.prisma.pincode.delete({ where: { code } });
    await this.audit.log({ actorId, action: 'location.pincode_delete', entityType: 'Pincode', entityId: null, before: { code, cityId: p.cityId } });
    return { code, deleted: true };
  }

  /**
   * Imports "pincode,locality,lat,lng" rows into a city: new areas are created by name, PIN codes are added or
   * updated. A PIN code that belongs to another city is reported, not moved. With dryRun nothing changes.
   */
  async importPlaces(actorId: string, cityId: string, dto: ImportPlacesDto) {
    const city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true } });
    if (!city) throw new NotFoundException('City not found.');
    const { rows, errors } = parsePlacesCsv(dto.csv);
    const existing = await this.prisma.pincode.findMany({ where: { code: { in: rows.map((r) => r.pincode) } }, include: { city: { select: { name: true } } } });
    const byCode = new Map(existing.map((p) => [p.code, p]));
    const usable = rows.filter((r) => {
      const e = byCode.get(r.pincode);
      if (e && e.cityId !== cityId) {
        errors.push(`Line ${r.line}: ${r.pincode} is already in ${e.city.name}.`);
        return false;
      }
      return true;
    });
    const localities = await this.prisma.locality.findMany({ where: { cityId }, select: { id: true, slug: true } });
    const bySlug = new Map(localities.map((l) => [l.slug, l.id]));
    const newAreas = [...new Set(usable.map((r) => r.locality).filter((x): x is string => !!x).filter((n) => !bySlug.has(placeSlug(n))))];
    const summary = {
      dryRun: !!dto.dryRun,
      rows: rows.length,
      areasCreated: newAreas.length,
      pincodesAdded: usable.filter((r) => !byCode.has(r.pincode)).length,
      pincodesUpdated: usable.filter((r) => byCode.has(r.pincode)).length,
      errors,
    };
    if (dto.dryRun || !usable.length) return summary;
    await this.prisma.$transaction(async (tx) => {
      for (const name of newAreas) {
        const l = await tx.locality.create({ data: { cityId, name, slug: placeSlug(name) } });
        bySlug.set(l.slug, l.id);
      }
      for (const r of usable) {
        const localityId = r.locality ? bySlug.get(placeSlug(r.locality)) ?? null : null;
        await tx.pincode.upsert({
          where: { code: r.pincode },
          create: { code: r.pincode, cityId, localityId, lat: r.lat, lng: r.lng },
          update: { localityId: localityId ?? undefined, ...(r.lat !== null ? { lat: r.lat, lng: r.lng } : {}) },
        });
      }
      await this.audit.log({ actorId, action: 'location.import', entityType: 'City', entityId: cityId, after: { ...summary, errors: errors.length } }, tx);
    }, { timeout: 60_000 });
    return summary;
  }

  // ══════════════ admin: delivery zones ══════════════

  private async zoneView(z: Prisma.DeliveryZoneGetPayload<object>) {
    const cities = z.cityIds.length ? await this.prisma.city.findMany({ where: { id: { in: z.cityIds } }, select: { id: true, name: true } }) : [];
    return { ...z, cities };
  }

  async zones() {
    const rows = await this.prisma.deliveryZone.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return Promise.all(rows.map((z) => this.zoneView(z)));
  }

  private checkZone(dto: Partial<DeliveryZoneDto>, current?: { minDays: number; maxDays: number; pincodes: string[]; cityIds: string[]; stateCodes: string[] }) {
    const min = dto.minDays ?? current?.minDays ?? 2;
    const max = dto.maxDays ?? current?.maxDays ?? 5;
    if (max < min) throw new BadRequestException('The latest delivery day must be on or after the earliest.');
    const empty = !(dto.pincodes ?? current?.pincodes ?? []).length && !(dto.cityIds ?? current?.cityIds ?? []).length && !(dto.stateCodes ?? current?.stateCodes ?? []).length;
    if (empty) throw new BadRequestException('Add at least one PIN code, city or state to the zone.');
  }

  async createZone(actorId: string, dto: DeliveryZoneDto) {
    this.checkZone(dto);
    const z = await this.prisma.deliveryZone.create({
      data: {
        name: dto.name, isActive: dto.isActive ?? true, pincodes: [...new Set(dto.pincodes ?? [])], cityIds: [...new Set(dto.cityIds ?? [])], stateCodes: [...new Set(dto.stateCodes ?? [])],
        deliverable: dto.deliverable ?? true, shippingFlatPaise: dto.shippingFlatPaise ?? null, freeAbovePaise: dto.freeAbovePaise ?? null,
        minDays: dto.minDays ?? 2, maxDays: dto.maxDays ?? 5, note: dto.note || null,
      },
    });
    await this.audit.log({ actorId, action: 'location.zone_create', entityType: 'DeliveryZone', entityId: z.id, after: { ...dto } });
    return this.zoneView(z);
  }

  async updateZone(actorId: string, id: string, dto: UpdateDeliveryZoneDto) {
    const before = await this.prisma.deliveryZone.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Delivery zone not found.');
    this.checkZone(dto, before);
    const z = await this.prisma.deliveryZone.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.pincodes ? { pincodes: [...new Set(dto.pincodes)] } : {}),
        ...(dto.cityIds ? { cityIds: [...new Set(dto.cityIds)] } : {}),
        ...(dto.stateCodes ? { stateCodes: [...new Set(dto.stateCodes)] } : {}),
        ...(dto.note !== undefined ? { note: dto.note || null } : {}),
      },
    });
    await this.audit.log({ actorId, action: 'location.zone_update', entityType: 'DeliveryZone', entityId: id, before: { ...before }, after: { ...dto } });
    return this.zoneView(z);
  }

  async deleteZone(actorId: string, id: string) {
    const z = await this.prisma.deliveryZone.findUnique({ where: { id } });
    if (!z) throw new NotFoundException('Delivery zone not found.');
    await this.prisma.deliveryZone.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'location.zone_delete', entityType: 'DeliveryZone', entityId: id, before: { name: z.name } });
    return { id, deleted: true };
  }

  /** Which zone a PIN code falls in, for staff checking their setup. */
  async checkPincode(raw: string) {
    const code = normalizePincode(raw)!;
    const pin = await this.prisma.pincode.findUnique({ where: { code }, include: { city: { include: { state: true } } } });
    const d = await this.delivery({ pincode: code, city: pin?.city.name ?? '', state: pin?.city.state.code ?? '' });
    return { pincode: code, known: !!pin, city: pin ? { id: pin.city.id, name: pin.city.name } : null, state: pin ? { code: pin.city.state.code, name: pin.city.state.name } : null, ...d };
  }

  // ══════════════ admin: service coverage and partner locations ══════════════

  /** Cities with services live, how many approved partners each covers, and partners outside every one. */
  async coverageOverview() {
    const radius = await this.platform.getSetting<number>('locations.coverageRadiusKm');
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; slug: string; servicesLive: boolean; partners: number; homeVisits: number }>>`
      SELECT c."id", c."name", c."slug", c."servicesLive",
        COUNT(p."id")::int AS partners,
        COUNT(p."id") FILTER (WHERE p."homeVisitRadiusKm" > 0)::int AS "homeVisits"
      FROM "City" c
      LEFT JOIN "ServicePartner" p ON p."status" = 'APPROVED' AND ST_DWithin(p."location", c."location", ${radius * 1000})
      WHERE c."isActive"
      GROUP BY c."id"
      ORDER BY c."servicesLive" DESC, partners DESC, c."name"`;
    const [{ outside }] = await this.prisma.$queryRaw<Array<{ outside: number }>>`
      SELECT COUNT(*)::int AS outside FROM "ServicePartner" p
      WHERE p."status" = 'APPROVED' AND NOT EXISTS (
        SELECT 1 FROM "City" c WHERE c."isActive" AND c."servicesLive" AND ST_DWithin(p."location", c."location", ${radius * 1000}))`;
    const live = rows.filter((r) => r.servicesLive).length;
    return { coverageRadiusKm: radius, liveCities: live, partnersOutside: live ? outside : 0, cities: rows };
  }

  async partnerLocations(q: PartnerLocationsQuery) {
    const radius = await this.platform.getSetting<number>('locations.coverageRadiusKm');
    const conds: Prisma.Sql[] = [Prisma.sql`p."status" IN ('APPROVED', 'SUBMITTED', 'SUSPENDED')`];
    if (q.q) conds.push(Prisma.sql`(p."businessName" ILIKE ${'%' + likeText(q.q) + '%'} OR p."area" ILIKE ${'%' + likeText(q.q) + '%'} OR p."pincode" LIKE ${likeText(q.q) + '%'})`);
    if (q.cityId) conds.push(Prisma.sql`ST_DWithin(p."location", (SELECT "location" FROM "City" WHERE "id" = ${q.cityId}::uuid), ${radius * 1000})`);
    if (q.outside) conds.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "City" c WHERE c."isActive" AND c."servicesLive" AND ST_DWithin(p."location", c."location", ${radius * 1000}))`);
    const where = Prisma.join(conds, ' AND ');
    const [{ n }] = await this.prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM "ServicePartner" p WHERE ${where}`;
    return Paged.of(await this.partnerRows(where, radius, q.limit, q.skip), n, q);
  }

  private async partnerRows(where: Prisma.Sql, radius: number, limit: number, skip: number) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; businessName: string; status: string; addressLine: string; area: string | null; city: string; state: string; pincode: string; lat: number; lng: number; homeVisitRadiusKm: number; nearestCity: string | null; nearestM: number | null; covered: boolean }>>`
      SELECT p."id", p."businessName", p."status"::text AS status, p."addressLine", p."area", p."city", p."state", p."pincode", p."lat", p."lng", p."homeVisitRadiusKm",
        n."name" AS "nearestCity", n.m AS "nearestM",
        EXISTS (SELECT 1 FROM "City" c WHERE c."isActive" AND c."servicesLive" AND ST_DWithin(p."location", c."location", ${radius * 1000})) AS covered
      FROM "ServicePartner" p
      LEFT JOIN LATERAL (
        SELECT c."name", ST_Distance(c."location", p."location") AS m FROM "City" c WHERE c."isActive" AND c."location" IS NOT NULL
        ORDER BY c."location" <-> p."location" LIMIT 1
      ) n ON true
      WHERE ${where}
      ORDER BY p."businessName"
      LIMIT ${limit} OFFSET ${skip}`;
    const anyLive = (await this.prisma.city.count({ where: { isActive: true, servicesLive: true } })) > 0;
    return rows.map(({ nearestCity, nearestM, covered, ...r }) => ({
      ...r,
      nearestCity: nearestCity ? { name: nearestCity, distanceKm: km(nearestM ?? 0) } : null,
      // Until a city has services switched on, every partner counts as covered.
      covered: anyLive ? covered : true,
    }));
  }

  /** Staff correct a partner's address, map point or home-visit radius. The partner keeps editing their own too. */
  async updatePartnerLocation(actorId: string, id: string, dto: PartnerLocationDto) {
    const before = await this.prisma.servicePartner.findUnique({ where: { id }, select: { addressLine: true, area: true, city: true, state: true, pincode: true, lat: true, lng: true, homeVisitRadiusKm: true } });
    if (!before) throw new NotFoundException('Partner not found.');
    if ((dto.lat === undefined) !== (dto.lng === undefined)) throw new BadRequestException('Give both latitude and longitude.');
    const { reason, ...changes } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.servicePartner.update({ where: { id }, data: changes });
      await this.audit.log({ actorId, action: 'location.partner_update', entityType: 'ServicePartner', entityId: id, before: { ...before }, after: { ...changes, reason } }, tx);
    });
    const radius = await this.platform.getSetting<number>('locations.coverageRadiusKm');
    const [row] = await this.partnerRows(Prisma.sql`p."id" = ${id}::uuid`, radius, 1, 0);
    return row;
  }
}

const mapHit = (m: MapPlace): PlaceHit => ({ kind: 'PLACE', label: m.label, detail: m.detail, lat: m.lat, lng: m.lng, pincode: m.pincode, city: m.city, citySlug: null, source: 'maps' });
