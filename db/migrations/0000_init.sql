CREATE TABLE IF NOT EXISTS "buildings" (
	"addr_key" text PRIMARY KEY NOT NULL,
	"district" text NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"deal_count" integer,
	"median_unit_price" numeric,
	"median_total" numeric,
	"building_type" text,
	"build_year" integer,
	"last_deal" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "district_stats" (
	"district" text PRIMARY KEY NOT NULL,
	"median_unit_price" numeric,
	"median_rent_ping" numeric,
	"est_roi" numeric,
	"median_rent_ping_market" numeric,
	"est_roi_market" numeric,
	"median_unit_price_resale" numeric,
	"est_roi_resale" numeric,
	"est_roi_resale_market" numeric,
	"resale_count" integer DEFAULT 0,
	"presale_premium" numeric,
	"presale_count" integer DEFAULT 0,
	"rent_samples" integer DEFAULT 0,
	"rent_samples_market" integer DEFAULT 0,
	"is_demo" boolean DEFAULT false,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geocode_cache" (
	"addr_key" text PRIMARY KEY NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"precision" text,
	"queried_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "presale_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"district" text NOT NULL,
	"project_name" text,
	"address" text,
	"deal_date" date,
	"total_price" numeric,
	"parking_price" numeric DEFAULT 0,
	"area_ping" numeric,
	"unit_price" numeric,
	"raw_season" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"district" text NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"median_total" numeric,
	"median_area" numeric,
	"unit_price" numeric,
	"est_rent" numeric,
	"est_roi" numeric,
	"est_rent_market" numeric,
	"est_roi_market" numeric,
	"rent_samples" integer DEFAULT 0,
	"rent_samples_market" integer DEFAULT 0,
	"deal_count" integer DEFAULT 0,
	"is_demo" boolean DEFAULT false,
	CONSTRAINT "projects_name_district_key" UNIQUE("name","district")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rent_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"district" text NOT NULL,
	"address" text,
	"deal_date" date,
	"monthly_rent" numeric,
	"area_ping" numeric,
	"rent_per_ping" numeric,
	"build_year" integer,
	"building_type" text,
	"is_social" boolean DEFAULT false,
	"raw_season" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"district" text NOT NULL,
	"address" text,
	"deal_date" date,
	"total_price" numeric,
	"parking_price" numeric DEFAULT 0,
	"area_ping" numeric,
	"parking_area_ping" numeric DEFAULT 0,
	"main_area_ping" numeric,
	"unit_price" numeric,
	"unit_price_main" numeric,
	"building_type" text,
	"build_year" integer,
	"addr_key" text,
	"raw_season" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_buildings_district" ON "buildings" USING btree ("district");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_presale_district" ON "presale_deals" USING btree ("district");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_presale_project" ON "presale_deals" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rent_district" ON "rent_deals" USING btree ("district");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_district" ON "sale_deals" USING btree ("district");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_addr_key" ON "sale_deals" USING btree ("addr_key");