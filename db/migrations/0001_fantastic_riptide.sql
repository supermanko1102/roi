CREATE TABLE "building_community" (
	"addr_key" text PRIMARY KEY NOT NULL,
	"case_no" text NOT NULL,
	"matched_parcels" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"case_no" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"district" text NOT NULL,
	"households" integer,
	"street" text,
	"permit_no" text,
	"first_reg" date,
	"declare_date" date
);
--> statement-breakpoint
CREATE INDEX "idx_communities_district" ON "communities" USING btree ("district");