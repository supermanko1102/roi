CREATE TABLE "room_stats" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"room_band" text NOT NULL,
	"deal_count" integer DEFAULT 0,
	"median_unit_price" numeric,
	"median_total" numeric,
	CONSTRAINT "room_stats_pk" UNIQUE("kind","key","room_band")
);
--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "rooms" integer;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "halls" integer;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "baths" integer;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "floor_no" integer;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "total_floors" integer;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "is_cancelled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "cancel_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cancel_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "rooms" integer;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "halls" integer;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "baths" integer;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "floor_no" integer;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "total_floors" integer;--> statement-breakpoint
CREATE INDEX "idx_room_stats_band" ON "room_stats" USING btree ("room_band");