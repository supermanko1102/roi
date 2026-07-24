CREATE TABLE "project_location_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"candidate_kind" text NOT NULL,
	"candidate_value" text NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" text NOT NULL,
	"rationale" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lat" numeric,
	"lng" numeric,
	"precision" text,
	"status" text NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_location_candidates_value_key" UNIQUE("case_id","candidate_kind","candidate_value")
);
--> statement-breakpoint
CREATE TABLE "project_location_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"project_name" text NOT NULL,
	"failure_reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"active_deals" integer DEFAULT 0 NOT NULL,
	"cancelled_deals" integer DEFAULT 0 NOT NULL,
	"raw_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_audited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_location_cases_project_key" UNIQUE("city","district","project_name")
);
--> statement-breakpoint
ALTER TABLE "project_location_candidates" ADD CONSTRAINT "project_location_candidates_case_id_project_location_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."project_location_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_location_candidates_status" ON "project_location_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_project_location_cases_status" ON "project_location_cases" USING btree ("status","failure_reason");