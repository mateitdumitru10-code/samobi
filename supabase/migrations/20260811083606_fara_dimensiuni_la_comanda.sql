ALTER TABLE "model" DROP CONSTRAINT "model_interval_lungime";--> statement-breakpoint
ALTER TABLE "model" DROP CONSTRAINT "model_interval_latime";--> statement-breakpoint
ALTER TABLE "model" DROP CONSTRAINT "model_interval_inaltime";--> statement-breakpoint
ALTER TABLE "model" DROP CONSTRAINT "model_la_comanda_coerent";--> statement-breakpoint
ALTER TABLE "model" DROP CONSTRAINT "model_cod_saga_produs_comanda_saga_article_cod_saga_fk";
--> statement-breakpoint
ALTER TABLE "production_order" ALTER COLUMN "dimension_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "lungime_min";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "lungime_max";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "latime_min";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "latime_max";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "inaltime_min";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "inaltime_max";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "cod_saga_produs_comanda";