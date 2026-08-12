CREATE TABLE "saga_stock" (
	"cod_saga" text NOT NULL,
	"gestiune" text DEFAULT '' NOT NULL,
	"denumire_gestiune" text,
	"cantitate" numeric(18, 6) NOT NULL,
	"cit_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saga_stock_cod_saga_gestiune_pk" PRIMARY KEY("cod_saga","gestiune")
);
--> statement-breakpoint
ALTER TABLE "saga_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saga_stock_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rulat_la" timestamp with time zone DEFAULT now() NOT NULL,
	"rulat_de" uuid,
	"randuri" integer DEFAULT 0 NOT NULL,
	"articole" integer DEFAULT 0 NOT NULL,
	"necunoscute" integer DEFAULT 0 NOT NULL,
	"epuizate" integer DEFAULT 0 NOT NULL,
	"durata_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saga_stock_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saga_article" ADD COLUMN "stoc_la" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_stock" ADD CONSTRAINT "saga_stock_cod_saga_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saga_stock_sync" ADD CONSTRAINT "saga_stock_sync_rulat_de_profile_id_fk" FOREIGN KEY ("rulat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saga_stock_cod_idx" ON "saga_stock" USING btree ("cod_saga");--> statement-breakpoint
CREATE INDEX "saga_stock_sync_rulat_la_idx" ON "saga_stock_sync" USING btree ("rulat_la");