CREATE TABLE "district_band_stats" (
	"city" text NOT NULL,
	"district" text NOT NULL,
	"band" text NOT NULL,
	"median_unit_price" numeric,
	"samples" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "district_band_stats_city_district_band_pk" PRIMARY KEY("city","district","band")
);
--> statement-breakpoint
CREATE TABLE "etl_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow" text NOT NULL,
	"status" text NOT NULL,
	"git_sha" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metrics" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "zone_band_stats" (
	"city" text NOT NULL,
	"zone" text NOT NULL,
	"band" text NOT NULL,
	"median_unit_price" numeric,
	"samples" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_band_stats_city_zone_band_pk" PRIMARY KEY("city","zone","band")
);
--> statement-breakpoint
CREATE INDEX "idx_etl_runs_status_completed" ON "etl_runs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "idx_buildings_lng_lat" ON "buildings" USING btree ("lng","lat");--> statement-breakpoint
CREATE INDEX "idx_communities_lookup" ON "communities" USING btree ("city","district","name");--> statement-breakpoint
CREATE INDEX "idx_presale_project_lookup" ON "presale_deals" USING btree ("city","district","project_name");--> statement-breakpoint
CREATE INDEX "idx_presale_season_city" ON "presale_deals" USING btree ("raw_season","city");--> statement-breakpoint
CREATE INDEX "idx_projects_lng_lat" ON "projects" USING btree ("lng","lat");--> statement-breakpoint
CREATE INDEX "idx_rent_season_city" ON "rent_deals" USING btree ("raw_season","city");--> statement-breakpoint
CREATE INDEX "idx_rent_build_year" ON "rent_deals" USING btree ("build_year");--> statement-breakpoint
CREATE INDEX "idx_sale_season_city" ON "sale_deals" USING btree ("raw_season","city");