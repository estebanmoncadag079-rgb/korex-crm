-- Catálogo del vertical de PEDIDOS fuera del prompt (Fase 1, 15-ago-2026).
--
-- ⚠️ Este archivo se generó con drizzle-kit y se corrigió A MANO en dos cosas.
-- Si se regenera, hay que volver a aplicarlas:
--
--   1. Se quitó `ALTER TABLE agent_profile ADD COLUMN "ficha" text`. Esa columna
--      YA existe desde `0019_ficha_del_negocio.sql`, que se escribió a mano y no
--      quedó reflejada en el snapshot, así que el diff la volvía a proponer.
--      Aplicarla habría fallado con "column already exists" a mitad de la
--      migración. El snapshot de esta migración sí la incluye, así que la
--      siguiente que se genere ya no la repetirá.
--
--   2. Se movieron los CREATE INDEX ANTES de las FOREIGN KEY. drizzle-kit los
--      pone al final, y una FK compuesta necesita que ya exista el índice único
--      al que apunta: tal cual venía, fallaba con "there is no unique constraint
--      matching given keys for referenced table".

CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"price_cents" integer,
	"description" text,
	"available" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"price_delta_cents" integer DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "catalog_source" text DEFAULT 'prompt' NOT NULL;--> statement-breakpoint

-- Los índices van PRIMERO: las FK compuestas de abajo apuntan a ellos.
CREATE INDEX "product_org_idx" ON "product" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_org_id_uq" ON "product" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "product_option_group_org_idx" ON "product_option_group" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_group_org_id_uq" ON "product_option_group" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "product_option_org_idx" ON "product_option" USING btree ("organization_id");--> statement-breakpoint

ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_group" ADD CONSTRAINT "product_option_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Aislamiento estructural: el motor impide que un grupo o una opción cuelguen de
-- un padre de OTRA organización. Ya hubo una fuga entre clientes por un WHERE
-- sin organization_id (docs/korexia/10-SEGURIDAD.md); esto no depende de que
-- nadie se acuerde de filtrar.
ALTER TABLE "product_option_group" ADD CONSTRAINT "product_option_group_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."product"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."product_option_group"("organization_id","id") ON DELETE cascade ON UPDATE no action;
