CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"entitate" text NOT NULL,
	"entitate_id" text NOT NULL,
	"actiune" text NOT NULL,
	"diff" jsonb,
	"ip" "inet",
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dimension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"cod" text NOT NULL,
	"lungime" numeric(18, 6) NOT NULL,
	"latime" numeric(18, 6) NOT NULL,
	"inaltime" numeric(18, 6),
	"cod_saga_produs" text,
	"activ" boolean DEFAULT true NOT NULL,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dimension_model_cod_unic" UNIQUE("model_id","cod"),
	CONSTRAINT "dimension_lungime_pozitiva" CHECK ("dimension"."lungime" > 0),
	CONSTRAINT "dimension_latime_pozitiva" CHECK ("dimension"."latime" > 0),
	CONSTRAINT "dimension_inaltime_pozitiva" CHECK ("dimension"."inaltime" is null or "dimension"."inaltime" > 0)
);
--> statement-breakpoint
ALTER TABLE "dimension" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "export_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generat_de" uuid,
	"generat_la" timestamp with time zone DEFAULT now() NOT NULL,
	"hash_continut" text NOT NULL,
	"nr_bonuri" integer NOT NULL,
	"nr_linii" integer NOT NULL,
	"storage_path" text,
	CONSTRAINT "export_batch_nr_bonuri_pozitiv" CHECK ("export_batch"."nr_bonuri" > 0),
	CONSTRAINT "export_batch_nr_linii_pozitiv" CHECK ("export_batch"."nr_linii" > 0)
);
--> statement-breakpoint
ALTER TABLE "export_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cod" text NOT NULL,
	"denumire" text NOT NULL,
	"familie" text NOT NULL,
	"um_produs" text DEFAULT 'BUC' NOT NULL,
	"activ" boolean DEFAULT true NOT NULL,
	"creat_de" uuid,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	"modificat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_cod_unique" UNIQUE("cod"),
	CONSTRAINT "model_familie_valida" CHECK ("model"."familie" in ('PAT', 'CANAPEA', 'COLTAR', 'SALTEA', 'ALTELE')),
	CONSTRAINT "model_cod_nevid" CHECK (length(btrim("model"."cod")) > 0)
);
--> statement-breakpoint
ALTER TABLE "model" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "production_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nr_doc" text,
	"data" date NOT NULL,
	"gestiune_produs" text NOT NULL,
	"model_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"cod_saga_produs" text NOT NULL,
	"cantitate" numeric(18, 6) NOT NULL,
	"pret_prestabilit" numeric(18, 6),
	"status" text DEFAULT 'draft' NOT NULL,
	"export_id" uuid,
	"creat_de" uuid,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_order_status_valid" CHECK ("production_order"."status" in ('draft', 'calculat', 'exportat', 'anulat')),
	CONSTRAINT "production_order_cantitate_pozitiva" CHECK ("production_order"."cantitate" > 0),
	CONSTRAINT "production_order_pret_pozitiv" CHECK ("production_order"."pret_prestabilit" is null or "production_order"."pret_prestabilit" >= 0),
	CONSTRAINT "production_order_export_coerent" CHECK (("production_order"."status" = 'exportat' and "production_order"."export_id" is not null)
          or ("production_order"."status" <> 'exportat' and "production_order"."export_id" is null))
);
--> statement-breakpoint
ALTER TABLE "production_order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "production_order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_order_id" uuid NOT NULL,
	"cod_saga" text NOT NULL,
	"um" text NOT NULL,
	"cantitate_neta" numeric(18, 6) NOT NULL,
	"cantitate_bruta" numeric(18, 6) NOT NULL,
	"sursa" text NOT NULL,
	"formula_evaluata" text,
	"gestiune_descarcare" text,
	CONSTRAINT "production_order_line_articol_unic" UNIQUE("production_order_id","cod_saga"),
	CONSTRAINT "production_order_line_sursa_valida" CHECK ("production_order_line"."sursa" in ('fixa', 'formula', 'tabel', 'override', 'manual', 'agregat')),
	CONSTRAINT "production_order_line_neta_pozitiva" CHECK ("production_order_line"."cantitate_neta" >= 0),
	CONSTRAINT "production_order_line_bruta_peste_neta" CHECK ("production_order_line"."cantitate_bruta" >= "production_order_line"."cantitate_neta")
);
--> statement-breakpoint
ALTER TABLE "production_order_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nume" text NOT NULL,
	"rol" text NOT NULL,
	"activ" boolean DEFAULT true NOT NULL,
	"creat_de" uuid,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_rol_valid" CHECK ("profile"."rol" in ('admin', 'tehnolog', 'operator', 'contabil')),
	CONSTRAINT "profile_nume_nevid" CHECK (length(btrim("profile"."nume")) > 0)
);
--> statement-breakpoint
ALTER TABLE "profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"versiune" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valabil_de_la" date,
	"aprobat_de" uuid,
	"aprobat_la" timestamp with time zone,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"creat_de" uuid,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_model_versiune_unic" UNIQUE("model_id","versiune"),
	CONSTRAINT "recipe_status_valid" CHECK ("recipe"."status" in ('draft', 'in_aprobare', 'activa', 'arhivata')),
	CONSTRAINT "recipe_versiune_pozitiva" CHECK ("recipe"."versiune" > 0),
	CONSTRAINT "recipe_aprobare_nu_de_autor" CHECK ("recipe"."aprobat_de" is null or "recipe"."aprobat_de" <> "recipe"."creat_de"),
	CONSTRAINT "recipe_aprobare_coerenta" CHECK (("recipe"."aprobat_de" is null and "recipe"."aprobat_la" is null) or ("recipe"."aprobat_de" is not null and "recipe"."aprobat_la" is not null))
);
--> statement-breakpoint
ALTER TABLE "recipe" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"nr_linie" integer NOT NULL,
	"grup" text NOT NULL,
	"cod_saga" text,
	"este_variabil" boolean DEFAULT false NOT NULL,
	"categorie_variabila" text,
	"um" text NOT NULL,
	"mod_calcul" text NOT NULL,
	"cantitate_fixa" numeric(18, 6),
	"formula" text,
	"procent_pierderi" numeric(18, 6) DEFAULT '0' NOT NULL,
	"gestiune_descarcare" text,
	"obligatoriu" boolean DEFAULT true NOT NULL,
	"observatii" text,
	CONSTRAINT "recipe_line_nr_unic" UNIQUE("recipe_id","nr_linie"),
	CONSTRAINT "recipe_line_mod_valid" CHECK ("recipe_line"."mod_calcul" in ('fixa', 'formula', 'tabel')),
	CONSTRAINT "recipe_line_nr_pozitiv" CHECK ("recipe_line"."nr_linie" > 0),
	CONSTRAINT "recipe_line_pierderi_valide" CHECK ("recipe_line"."procent_pierderi" >= 0 and "recipe_line"."procent_pierderi" < 100),
	CONSTRAINT "recipe_line_variabil_coerent" CHECK (("recipe_line"."este_variabil" = true and "recipe_line"."cod_saga" is null and "recipe_line"."categorie_variabila" is not null)
          or ("recipe_line"."este_variabil" = false and "recipe_line"."cod_saga" is not null)),
	CONSTRAINT "recipe_line_mod_coerent" CHECK (("recipe_line"."mod_calcul" = 'fixa' and "recipe_line"."cantitate_fixa" is not null)
          or ("recipe_line"."mod_calcul" = 'formula' and "recipe_line"."formula" is not null and length(btrim("recipe_line"."formula")) > 0)
          or "recipe_line"."mod_calcul" = 'tabel'),
	CONSTRAINT "recipe_line_cantitate_fixa_pozitiva" CHECK ("recipe_line"."cantitate_fixa" is null or "recipe_line"."cantitate_fixa" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recipe_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_line_alternative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_line_id" uuid NOT NULL,
	"cod_saga" text NOT NULL,
	"prioritate" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "recipe_line_alternative_unic" UNIQUE("recipe_line_id","cod_saga"),
	CONSTRAINT "recipe_line_alternative_prioritate_pozitiva" CHECK ("recipe_line_alternative"."prioritate" > 0)
);
--> statement-breakpoint
ALTER TABLE "recipe_line_alternative" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_line_dimension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_line_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"cantitate" numeric(18, 6) NOT NULL,
	"este_override" boolean DEFAULT false NOT NULL,
	"motiv" text,
	"setat_de" uuid,
	"setat_la" timestamp with time zone,
	CONSTRAINT "recipe_line_dimension_unic" UNIQUE("recipe_line_id","dimension_id"),
	CONSTRAINT "recipe_line_dimension_cantitate_pozitiva" CHECK ("recipe_line_dimension"."cantitate" >= 0),
	CONSTRAINT "recipe_line_dimension_override_motivat" CHECK ("recipe_line_dimension"."este_override" = false
          or ("recipe_line_dimension"."motiv" is not null and length(btrim("recipe_line_dimension"."motiv")) > 0 and "recipe_line_dimension"."setat_de" is not null and "recipe_line_dimension"."setat_la" is not null))
);
--> statement-breakpoint
ALTER TABLE "recipe_line_dimension" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saga_article" (
	"cod_saga" text PRIMARY KEY NOT NULL,
	"denumire" text NOT NULL,
	"um" text NOT NULL,
	"um_normalizat" text,
	"tip" text NOT NULL,
	"tip_saga" text,
	"cont" text,
	"gestiune_implicita" text,
	"categorie" text,
	"pret_referinta" numeric(18, 6),
	"activ" boolean DEFAULT true NOT NULL,
	"sincronizat_la" timestamp with time zone,
	CONSTRAINT "saga_article_tip_valid" CHECK ("saga_article"."tip" in ('produs', 'materie_prima', 'marfa', 'altele')),
	CONSTRAINT "saga_article_cod_nevid" CHECK (length(btrim("saga_article"."cod_saga")) > 0),
	CONSTRAINT "saga_article_pret_pozitiv" CHECK ("saga_article"."pret_referinta" is null or "saga_article"."pret_referinta" >= 0)
);
--> statement-breakpoint
ALTER TABLE "saga_article" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saga_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rulat_la" timestamp with time zone DEFAULT now() NOT NULL,
	"rulat_de" uuid,
	"articole_noi" integer DEFAULT 0 NOT NULL,
	"articole_modificate" integer DEFAULT 0 NOT NULL,
	"articole_disparute" integer DEFAULT 0 NOT NULL,
	"fisier_nume" text
);
--> statement-breakpoint
ALTER TABLE "saga_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unmapped_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"denumire_externa" text NOT NULL,
	"sugestie_cod_saga" text,
	"rezolvat" boolean DEFAULT false NOT NULL,
	"rezolvat_de" uuid,
	"rezolvat_la" timestamp with time zone,
	"creat_la" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unmapped_material_denumire_unic" UNIQUE("denumire_externa"),
	CONSTRAINT "unmapped_material_rezolvat_coerent" CHECK (("unmapped_material"."rezolvat" = false and "unmapped_material"."rezolvat_la" is null) or ("unmapped_material"."rezolvat" = true and "unmapped_material"."rezolvat_la" is not null))
);
--> statement-breakpoint
ALTER TABLE "unmapped_material" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension" ADD CONSTRAINT "dimension_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension" ADD CONSTRAINT "dimension_cod_saga_produs_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga_produs") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_batch" ADD CONSTRAINT "export_batch_generat_de_profile_id_fk" FOREIGN KEY ("generat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_creat_de_profile_id_fk" FOREIGN KEY ("creat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_dimension_id_dimension_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimension"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_cod_saga_produs_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga_produs") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_export_id_export_batch_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."export_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order" ADD CONSTRAINT "production_order_creat_de_profile_id_fk" FOREIGN KEY ("creat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_line" ADD CONSTRAINT "production_order_line_production_order_id_production_order_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_order_line" ADD CONSTRAINT "production_order_line_cod_saga_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_creat_de_profile_id_fk" FOREIGN KEY ("creat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_aprobat_de_profile_id_fk" FOREIGN KEY ("aprobat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_creat_de_profile_id_fk" FOREIGN KEY ("creat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_cod_saga_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line_alternative" ADD CONSTRAINT "recipe_line_alternative_recipe_line_id_recipe_line_id_fk" FOREIGN KEY ("recipe_line_id") REFERENCES "public"."recipe_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line_alternative" ADD CONSTRAINT "recipe_line_alternative_cod_saga_saga_article_cod_saga_fk" FOREIGN KEY ("cod_saga") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line_dimension" ADD CONSTRAINT "recipe_line_dimension_recipe_line_id_recipe_line_id_fk" FOREIGN KEY ("recipe_line_id") REFERENCES "public"."recipe_line"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line_dimension" ADD CONSTRAINT "recipe_line_dimension_dimension_id_dimension_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."dimension"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line_dimension" ADD CONSTRAINT "recipe_line_dimension_setat_de_profile_id_fk" FOREIGN KEY ("setat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saga_sync" ADD CONSTRAINT "saga_sync_rulat_de_profile_id_fk" FOREIGN KEY ("rulat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmapped_material" ADD CONSTRAINT "unmapped_material_sugestie_cod_saga_saga_article_cod_saga_fk" FOREIGN KEY ("sugestie_cod_saga") REFERENCES "public"."saga_article"("cod_saga") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmapped_material" ADD CONSTRAINT "unmapped_material_rezolvat_de_profile_id_fk" FOREIGN KEY ("rezolvat_de") REFERENCES "public"."profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entitate_idx" ON "audit_log" USING btree ("entitate","entitate_id");--> statement-breakpoint
CREATE INDEX "audit_log_creat_la_idx" ON "audit_log" USING btree ("creat_la");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dimension_model_idx" ON "dimension" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "export_batch_generat_la_idx" ON "export_batch" USING btree ("generat_la");--> statement-breakpoint
CREATE INDEX "production_order_status_idx" ON "production_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "production_order_data_idx" ON "production_order" USING btree ("data");--> statement-breakpoint
CREATE INDEX "production_order_export_idx" ON "production_order" USING btree ("export_id");--> statement-breakpoint
CREATE INDEX "production_order_line_bon_idx" ON "production_order_line" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "profile_rol_idx" ON "profile" USING btree ("rol");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_recipe_per_model" ON "recipe" USING btree ("model_id") WHERE status = 'activa';--> statement-breakpoint
CREATE INDEX "recipe_line_recipe_idx" ON "recipe_line" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_line_dimension_linie_idx" ON "recipe_line_dimension" USING btree ("recipe_line_id");--> statement-breakpoint
CREATE INDEX "saga_article_tip_idx" ON "saga_article" USING btree ("tip");--> statement-breakpoint
CREATE INDEX "saga_article_denumire_idx" ON "saga_article" USING btree ("denumire");--> statement-breakpoint
CREATE INDEX "saga_sync_rulat_la_idx" ON "saga_sync" USING btree ("rulat_la");