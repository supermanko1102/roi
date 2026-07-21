CREATE TABLE "use_permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"license_no" text NOT NULL,
	"permit_no_norm" text,
	"issue_date" date,
	"complete_date" date,
	"address" text,
	"source" text,
	CONSTRAINT "use_permits_city_license_key" UNIQUE("city","license_no")
);
--> statement-breakpoint
CREATE INDEX "idx_use_permits_permit" ON "use_permits" USING btree ("city","permit_no_norm");