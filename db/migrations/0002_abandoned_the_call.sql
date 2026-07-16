CREATE TABLE "zone_stats" (
	"zone" text PRIMARY KEY NOT NULL,
	"median_rent_ping_market" numeric,
	"rent_samples_market" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "rent_deals" ADD COLUMN "addr_key" text;--> statement-breakpoint
CREATE INDEX "idx_rent_addr_key" ON "rent_deals" USING btree ("addr_key");