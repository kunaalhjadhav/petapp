import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@petapp/types';
import { AdminOnly, CurrentUser, Public, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { Principal } from '../../common/principal';
import { LocationsService } from './locations.service';
import {
  AdminCitiesQuery, CitiesQuery, CityDto, DeliveryZoneDto, ImportPlacesDto, LocalityDto, PartnerLocationDto, PartnerLocationsQuery, PincodeDto, PincodesQuery,
  PlaceSearchQuery, PointQuery, UpdateCityDto, UpdateDeliveryZoneDto, UpdateLocalityDto, UpdatePincodeDto, ZoneCheckQuery,
} from './locations.dto';

/** Public lookups: states, cities and areas, PIN codes, the nearest city to a point, and service coverage. */
@ApiTags('Locations')
@Public()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('states') states() {
    return this.locations.states();
  }

  @Get('cities') cities(@Query() q: CitiesQuery) {
    return this.locations.cities(q);
  }

  @Get('cities/:slug') city(@Param('slug') slug: string) {
    return this.locations.city(slug);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('pincodes/:code') pincode(@Param('code') code: string) {
    return this.locations.pincode(code);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('search') search(@Query() q: PlaceSearchQuery) {
    return this.locations.searchPlaces(q.q);
  }

  @Get('resolve') resolve(@Query() q: PointQuery) {
    return this.locations.resolve(q.lat, q.lng);
  }

  @Get('coverage') coverage(@Query() q: PointQuery) {
    return this.locations.coverage(q.lat, q.lng);
  }
}

@ApiTags('Admin · Locations')
@ApiBearerAuth()
@AdminOnly()
@Controller('admin/locations')
export class AdminLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('states') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) states() {
    return this.locations.states();
  }

  // ── cities ──
  @Get('cities') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) cities(@Query() q: AdminCitiesQuery) {
    return this.locations.adminCities(q);
  }
  @Get('cities/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) city(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.adminCity(id);
  }
  @Post('cities') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) createCity(@CurrentUser() me: Principal, @Body() dto: CityDto) {
    return this.locations.createCity(me.userId, dto);
  }
  @Patch('cities/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) updateCity(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCityDto) {
    return this.locations.updateCity(me.userId, id, dto);
  }
  @Delete('cities/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) deleteCity(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.locations.deleteCity(me.userId, id);
  }

  // ── areas ──
  @Post('cities/:id/localities') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) createLocality(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LocalityDto) {
    return this.locations.createLocality(me.userId, id, dto);
  }
  @Patch('localities/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) updateLocality(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocalityDto) {
    return this.locations.updateLocality(me.userId, id, dto);
  }
  @Delete('localities/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) deleteLocality(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.locations.deleteLocality(me.userId, id);
  }

  // ── PIN codes ──
  @Get('cities/:id/pincodes') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) pincodes(@Param('id', ParseUUIDPipe) id: string, @Query() q: PincodesQuery) {
    return this.locations.pincodes(id, q);
  }
  @Post('cities/:id/pincodes') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) createPincode(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PincodeDto) {
    return this.locations.createPincode(me.userId, id, dto);
  }
  @Patch('pincodes/:code') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) updatePincode(@CurrentUser() me: Principal, @Param('code') code: string, @Body() dto: UpdatePincodeDto) {
    return this.locations.updatePincode(me.userId, code, dto);
  }
  @Delete('pincodes/:code') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) deletePincode(@CurrentUser() me: Principal, @Param('code') code: string) {
    return this.locations.deletePincode(me.userId, code);
  }
  @Post('cities/:id/import') @HttpCode(200) @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) importPlaces(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportPlacesDto) {
    return this.locations.importPlaces(me.userId, id, dto);
  }

  // ── delivery zones ──
  @Get('zones') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) zones() {
    return this.locations.zones();
  }
  @Get('zones/check') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) check(@Query() q: ZoneCheckQuery) {
    return this.locations.checkPincode(q.pincode);
  }
  @Post('zones') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) createZone(@CurrentUser() me: Principal, @Body() dto: DeliveryZoneDto) {
    return this.locations.createZone(me.userId, dto);
  }
  @Patch('zones/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) updateZone(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryZoneDto) {
    return this.locations.updateZone(me.userId, id, dto);
  }
  @Delete('zones/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) deleteZone(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.locations.deleteZone(me.userId, id);
  }

  // ── service coverage and partner locations ──
  @Get('coverage') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) coverage() {
    return this.locations.coverageOverview();
  }
  @Get('partners') @RequirePermissions(PERMISSIONS.LOCATIONS_READ) partners(@Query() q: PartnerLocationsQuery) {
    return this.locations.partnerLocations(q);
  }
  @Patch('partners/:id') @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE) updatePartner(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnerLocationDto) {
    return this.locations.updatePartnerLocation(me.userId, id, dto);
  }
}
