CREATE TABLE "contract_material_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"project_name" text NOT NULL,
	"kitchen_brands" text,
	"bath_brands" text,
	"floor_materials" text,
	"kitchen_tier" integer,
	"bath_tier" integer,
	"floor_tier" integer,
	"unknown_brands" text,
	"extracted_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contract_material_facts_project_key" UNIQUE("city","district","project_name")
);
