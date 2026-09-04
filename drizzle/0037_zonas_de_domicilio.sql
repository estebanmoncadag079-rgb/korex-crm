-- Fase 10N-J (4-sep-2026) — fuente unica de verdad para la tarifa de
-- domicilio por zona. Ver el comentario de `deliveryZone` en schema.ts.
--
-- Rollback:
--   ALTER TABLE "agent_profile" DROP COLUMN "delivery_source";
--   DROP TABLE "delivery_zone";
CREATE TABLE "delivery_zone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"fee_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_zone" ADD CONSTRAINT "delivery_zone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "delivery_zone_org_idx" ON "delivery_zone" USING btree ("organization_id","active");
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "delivery_source" text DEFAULT 'prompt' NOT NULL;
