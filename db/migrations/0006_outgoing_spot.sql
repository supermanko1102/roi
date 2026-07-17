CREATE TABLE "community_cases" (
	"case_no" text PRIMARY KEY NOT NULL,
	"community_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_communities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"district" text NOT NULL,
	"permit_no" text,
	"build_year" integer,
	"lat" numeric,
	"lng" numeric
);
--> statement-breakpoint
CREATE TABLE "rent_benchmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" date NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"rental_type" text NOT NULL,
	"age_group" text NOT NULL,
	"samples" integer NOT NULL,
	"q25" numeric NOT NULL,
	"median" numeric NOT NULL,
	"q75" numeric NOT NULL,
	"source_url" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "rent_benchmarks_grain_key" UNIQUE("period","city","district","rental_type","age_group")
);
--> statement-breakpoint
ALTER TABLE "building_community" ADD COLUMN "community_id" integer;--> statement-breakpoint
ALTER TABLE "building_community" ADD COLUMN "match_method" text DEFAULT 'parcel';--> statement-breakpoint
ALTER TABLE "building_community" ADD COLUMN "confidence" integer DEFAULT 100;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "housing_rent" numeric;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "parking_rent" numeric DEFAULT 0;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "parking_area_ping" numeric DEFAULT 0;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "rental_type" text;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "rooms" integer;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "halls" integer;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "baths" integer;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "floor_no" integer;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "total_floors" integer;--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "service_type" text;--> statement-breakpoint
CREATE INDEX "idx_community_cases_community" ON "community_cases" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "idx_physical_communities_district" ON "physical_communities" USING btree ("district");--> statement-breakpoint
CREATE INDEX "idx_rent_benchmarks_district" ON "rent_benchmarks" USING btree ("city","district");--> statement-breakpoint
CREATE INDEX "idx_building_community_entity" ON "building_community" USING btree ("community_id");