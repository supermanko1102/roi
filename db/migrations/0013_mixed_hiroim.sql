ALTER TABLE "presale_deals" ADD COLUMN "parking_count" integer;--> statement-breakpoint
ALTER TABLE "presale_deals" ADD COLUMN "parking_type" text;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "parking_count" integer;--> statement-breakpoint
ALTER TABLE "sale_deals" ADD COLUMN "parking_type" text;