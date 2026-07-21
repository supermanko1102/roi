ALTER TABLE "projects" DROP CONSTRAINT "projects_name_district_key";--> statement-breakpoint
DROP INDEX "idx_buildings_district";--> statement-breakpoint
DROP INDEX "idx_communities_district";--> statement-breakpoint
DROP INDEX "idx_physical_communities_district";--> statement-breakpoint
DROP INDEX "idx_presale_district";--> statement-breakpoint
DROP INDEX "idx_rent_district";--> statement-breakpoint
DROP INDEX "idx_sale_district";--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "district_stats" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "physical_communities" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "zone_stats" ADD COLUMN "city" text NOT NULL DEFAULT '桃園市';--> statement-breakpoint
ALTER TABLE "buildings" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "communities" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "district_stats" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "physical_communities" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "presale_deals" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rent_deals" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sale_deals" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "zone_stats" ALTER COLUMN "city" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "district_stats" DROP CONSTRAINT "district_stats_pkey";--> statement-breakpoint
ALTER TABLE "zone_stats" DROP CONSTRAINT "zone_stats_pkey";--> statement-breakpoint
ALTER TABLE "district_stats" ADD CONSTRAINT "district_stats_city_district_pk" PRIMARY KEY("city","district");--> statement-breakpoint
ALTER TABLE "zone_stats" ADD CONSTRAINT "zone_stats_city_zone_pk" PRIMARY KEY("city","zone");--> statement-breakpoint
CREATE INDEX "idx_buildings_district" ON "buildings" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "idx_communities_district" ON "communities" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "idx_physical_communities_district" ON "physical_communities" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "idx_presale_district" ON "presale_deals" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "idx_rent_district" ON "rent_deals" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "idx_sale_district" ON "sale_deals" USING btree ("city","district");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_name_district_key" UNIQUE("city","name","district");--> statement-breakpoint
UPDATE "sale_deals" SET "addr_key" = '桃園市' || "district" || "addr_key" WHERE "addr_key" IS NOT NULL AND "addr_key" NOT LIKE '桃園市%';--> statement-breakpoint
UPDATE "rent_deals" SET "addr_key" = '桃園市' || "district" || "addr_key" WHERE "addr_key" IS NOT NULL AND "addr_key" NOT LIKE '桃園市%';--> statement-breakpoint
DELETE FROM "geocode_cache" WHERE "addr_key" NOT LIKE '桃園市%' AND "addr_key" NOT LIKE 'proj|%';--> statement-breakpoint
UPDATE "geocode_cache" SET "addr_key" = 'proj|桃園市|' || substr("addr_key", 6) WHERE "addr_key" LIKE 'proj|%';