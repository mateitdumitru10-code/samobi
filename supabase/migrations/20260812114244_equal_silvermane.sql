CREATE TABLE "saga_credential" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cheie" text NOT NULL,
	"rotita_la" timestamp with time zone DEFAULT now() NOT NULL,
	"rotiri" integer DEFAULT 0 NOT NULL,
	"rezervata_pana" timestamp with time zone,
	"rezervata_de" text,
	"invalida" boolean DEFAULT false NOT NULL,
	"motiv_invalida" text,
	CONSTRAINT "saga_credential_un_singur_rand" CHECK ("saga_credential"."id" = 1),
	CONSTRAINT "saga_credential_invalida_motivata" CHECK ("saga_credential"."invalida" = false or "saga_credential"."motiv_invalida" is not null),
	CONSTRAINT "saga_credential_rotiri_pozitive" CHECK ("saga_credential"."rotiri" >= 0)
);
--> statement-breakpoint
ALTER TABLE "saga_credential" ENABLE ROW LEVEL SECURITY;