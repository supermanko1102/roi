CREATE TABLE "contract_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"project_name" text NOT NULL,
	"mlvr_case_no" text,
	"pdf_url" text,
	"version_note" text,
	"declare_date" text,
	"materials_text" text,
	"sections" text,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contract_materials_project_key" UNIQUE("city","district","project_name")
);
