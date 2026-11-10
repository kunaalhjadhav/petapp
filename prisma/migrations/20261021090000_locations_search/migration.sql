-- Phase 9c: the location database, delivery zones, nearby pets, and indexes for global search

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── locations ──
CREATE TABLE "Country" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Country_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "State" (
    "id" UUID NOT NULL,
    "countryCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isUnionTerritory" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "State_countryCode_code_key" ON "State"("countryCode", "code");
ALTER TABLE "State" ADD CONSTRAINT "State_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "City" (
    "id" UUID NOT NULL,
    "stateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geography(Point, 4326),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "servicesLive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "City_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "City_coordinates" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)
);
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");
CREATE INDEX "City_stateId_idx" ON "City"("stateId");
CREATE INDEX "City_location_idx" ON "City" USING GIST ("location");
ALTER TABLE "City" ADD CONSTRAINT "City_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Locality" (
    "id" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "location" geography(Point, 4326),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Locality_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Locality_coordinates" CHECK (("lat" IS NULL) = ("lng" IS NULL) AND ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180)))
);
CREATE UNIQUE INDEX "Locality_cityId_slug_key" ON "Locality"("cityId", "slug");
CREATE INDEX "Locality_location_idx" ON "Locality" USING GIST ("location");
ALTER TABLE "Locality" ADD CONSTRAINT "Locality_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Pincode" (
    "code" TEXT NOT NULL,
    "cityId" UUID NOT NULL,
    "localityId" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Pincode_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "Pincode_format" CHECK ("code" ~ '^[1-9][0-9]{5}$')
);
CREATE INDEX "Pincode_cityId_idx" ON "Pincode"("cityId");
CREATE INDEX "Pincode_localityId_idx" ON "Pincode"("localityId");
ALTER TABLE "Pincode" ADD CONSTRAINT "Pincode_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pincode" ADD CONSTRAINT "Pincode_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DeliveryZone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pincodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stateCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverable" BOOLEAN NOT NULL DEFAULT true,
    "shippingFlatPaise" INTEGER,
    "freeAbovePaise" INTEGER,
    "minDays" INTEGER NOT NULL DEFAULT 2,
    "maxDays" INTEGER NOT NULL DEFAULT 5,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeliveryZone_days" CHECK ("minDays" >= 0 AND "maxDays" >= "minDays"),
    CONSTRAINT "DeliveryZone_money" CHECK (("shippingFlatPaise" IS NULL OR "shippingFlatPaise" >= 0) AND ("freeAbovePaise" IS NULL OR "freeAbovePaise" >= 0))
);

-- Raw: keep geography points in step with lat/lng (Prisma can't write geography values).
CREATE OR REPLACE FUNCTION lat_lng_location() RETURNS trigger AS $$
BEGIN
  IF NEW."lat" IS NULL OR NEW."lng" IS NULL THEN
    NEW."location" := NULL;
  ELSE
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."lng", NEW."lat"), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER city_location BEFORE INSERT OR UPDATE OF "lat", "lng" ON "City" FOR EACH ROW EXECUTE FUNCTION lat_lng_location();
CREATE TRIGGER locality_location BEFORE INSERT OR UPDATE OF "lat", "lng" ON "Locality" FOR EACH ROW EXECUTE FUNCTION lat_lng_location();

-- ── nearby pets (opt-in) ──
ALTER TABLE "Pet" ADD COLUMN "location" geography(Point, 4326),
                  ADD COLUMN "discoverable" BOOLEAN NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION pet_location() RETURNS trigger AS $$
BEGIN
  IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
    NEW."location" := NULL;
  ELSE
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude"::float8, NEW."latitude"::float8), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER pet_location BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "Pet" FOR EACH ROW EXECUTE FUNCTION pet_location();
UPDATE "Pet" SET "location" = ST_SetSRID(ST_MakePoint("longitude"::float8, "latitude"::float8), 4326)::geography WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
CREATE INDEX "Pet_location_idx" ON "Pet" USING GIST ("location");

-- ── global search: trigram indexes for "contains" matching ──
CREATE INDEX "Pet_name_idx" ON "Pet" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Pet_handle_idx" ON "Pet" USING GIN ("handle" gin_trgm_ops);
CREATE INDEX "User_name_idx" ON "User" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Product_title_idx" ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ServicePartner_businessName_idx" ON "ServicePartner" USING GIN ("businessName" gin_trgm_ops);
CREATE INDEX "PartnerService_name_idx" ON "PartnerService" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Contest_title_idx" ON "Contest" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Challenge_title_idx" ON "Challenge" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Post_caption_idx" ON "Post" USING GIN ("caption" gin_trgm_ops);
