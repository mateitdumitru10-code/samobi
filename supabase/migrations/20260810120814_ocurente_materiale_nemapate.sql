CREATE TABLE "unmapped_material_ocurenta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unmapped_material_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"nr_linie" integer NOT NULL,
	"grup" text NOT NULL,
	"um" text NOT NULL,
	"cantitate" numeric(18, 6) NOT NULL,
	"aplicat" boolean DEFAULT false NOT NULL,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unmapped_ocurenta_unic" UNIQUE("recipe_id","nr_linie")
);
--> statement-breakpoint
ALTER TABLE "unmapped_material_ocurenta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Deja scos de migrarea 20260810082000; DROP simplu ar cadea la a doua rulare.
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_user_id_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "unmapped_material" ADD COLUMN "sugestii" jsonb;--> statement-breakpoint
ALTER TABLE "unmapped_material_ocurenta" ADD CONSTRAINT "unmapped_material_ocurenta_unmapped_material_id_unmapped_material_id_fk" FOREIGN KEY ("unmapped_material_id") REFERENCES "public"."unmapped_material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmapped_material_ocurenta" ADD CONSTRAINT "unmapped_material_ocurenta_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unmapped_ocurenta_material_idx" ON "unmapped_material_ocurenta" USING btree ("unmapped_material_id");