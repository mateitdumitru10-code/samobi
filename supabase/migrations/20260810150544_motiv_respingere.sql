ALTER TABLE "recipe" ADD COLUMN "motiv_respingere" text;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "respins_de" uuid;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "respins_la" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_respins_de_profile_id_fk" FOREIGN KEY ("respins_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;