ALTER TABLE "recipe" DROP CONSTRAINT "recipe_aprobare_nu_de_autor";--> statement-breakpoint
ALTER TABLE "recipe" DROP CONSTRAINT "recipe_aprobare_coerenta";--> statement-breakpoint
ALTER TABLE "recipe" DROP CONSTRAINT "recipe_status_valid";--> statement-breakpoint
ALTER TABLE "recipe" DROP CONSTRAINT "recipe_aprobat_de_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "recipe" DROP CONSTRAINT "recipe_respins_de_profile_id_fk";
--> statement-breakpoint
DROP INDEX "one_active_recipe_per_model";--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "valabil_de_la";--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "aprobat_de";--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "aprobat_la";--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "motiv_respingere";--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "respins_de";--> statement-breakpoint
ALTER TABLE "recipe" DROP COLUMN "respins_la";--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_status_valid" CHECK ("recipe"."status" = 'draft');