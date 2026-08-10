ALTER TABLE "production_order" ALTER COLUMN "dimension_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "lungime_min" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "lungime_max" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "latime_min" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "latime_max" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "inaltime_min" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "inaltime_max" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "cod_saga_produs_comanda" text;--> statement-breakpoint
-- Snapshot of the size a bon was computed at. Added nullable, filled from the
-- dimension each existing bon points at, then made mandatory: the table has
-- rows, and there is no reset on this project.
ALTER TABLE "production_order" ADD COLUMN "lungime" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "production_order" ADD COLUMN "latime" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "production_order" ADD COLUMN "inaltime" numeric(18, 6);--> statement-breakpoint
UPDATE "production_order" o
   SET "lungime" = d."lungime", "latime" = d."latime", "inaltime" = d."inaltime"
  FROM "dimension" d
 WHERE d."id" = o."dimension_id" AND o."lungime" IS NULL;--> statement-breakpoint
ALTER TABLE "production_order" ALTER COLUMN "lungime" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order" ALTER COLUMN "latime" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "production_order" ADD COLUMN "motor_calcul" text NOT NULL DEFAULT 'calcul/1';--> statement-breakpoint
ALTER TABLE "production_order" ALTER COLUMN "motor_calcul" SET DEFAULT 'calcul/2';--> statement-breakpoint
ALTER TABLE "production_order_line" ADD COLUMN "contributii" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_cod_saga_produs_comanda_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga_produs_comanda") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_interval_lungime" CHECK (("model"."lungime_min" is null and "model"."lungime_max" is null)
          or ("model"."lungime_min" > 0 and "model"."lungime_max" >= "model"."lungime_min"));--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_interval_latime" CHECK (("model"."latime_min" is null and "model"."latime_max" is null)
          or ("model"."latime_min" > 0 and "model"."latime_max" >= "model"."latime_min"));--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_interval_inaltime" CHECK (("model"."inaltime_min" is null and "model"."inaltime_max" is null)
          or ("model"."inaltime_min" > 0 and "model"."inaltime_max" >= "model"."inaltime_min"));--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_la_comanda_coerent" CHECK (("model"."lungime_min" is null) = ("model"."latime_min" is null));--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_dimensiuni_pozitive" CHECK ("production_order"."lungime" > 0 and "production_order"."latime" > 0 and ("production_order"."inaltime" is null or "production_order"."inaltime" > 0));