-- Fase 10B-10I — módulo de campañas completo (2-sep/3-sep-2026):
-- pricing_rate versionado, costo real en usage_event, segmentación de
-- audiencia, y flujo de aprobación cliente→superadmin.
--
-- Escrita a mano, mismo motivo que 0028-0034: `drizzle-kit generate` se
-- cuelga en un prompt interactivo de renombrado ambiguo sobre
-- appointment_resource/staff_member/staff_service, no relacionado con este
-- cambio.
--
-- SIN ALTER de enums de texto (campaign.status, campaign.audience_type):
-- mismo motivo que 0032 — `text(col, {enum:[...]})` de Drizzle no genera
-- CHECK CONSTRAINT en Postgres, así que ampliar los valores válidos es
-- puramente un cambio de TypeScript, sin DDL.
--
-- Rollback (orden inverso por las FK):
--   ALTER TABLE "campaign_recipient" DROP COLUMN "read_at";
--   ALTER TABLE "campaign_recipient" DROP COLUMN "delivered_at";
--   ALTER TABLE "usage_event" DROP COLUMN "pricing_rate_id";
--   ALTER TABLE "usage_event" DROP COLUMN "margin_usd";
--   ALTER TABLE "usage_event" DROP COLUMN "korex_price_usd";
--   ALTER TABLE "usage_event" DROP COLUMN "country";
--   ALTER TABLE "usage_event" DROP COLUMN "category";
--   ALTER TABLE "usage_event" DROP COLUMN "provider";
--   ALTER TABLE "usage_event" DROP COLUMN "recipient_id";
--   ALTER TABLE "usage_event" DROP COLUMN "campaign_id";
--   ALTER TABLE "campaign" DROP COLUMN "rejection_reason";
--   ALTER TABLE "campaign" DROP COLUMN "approved_at";
--   ALTER TABLE "campaign" DROP COLUMN "approved_by";
--   ALTER TABLE "campaign" DROP COLUMN "requested_at";
--   ALTER TABLE "campaign" DROP COLUMN "requested_by";
--   ALTER TABLE "campaign" DROP COLUMN "rate_snapshot";
--   ALTER TABLE "campaign" DROP COLUMN "currency";
--   ALTER TABLE "campaign" DROP COLUMN "estimated_cost_usd";
--   ALTER TABLE "campaign" DROP COLUMN "estimated_recipients";
--   ALTER TABLE "campaign" DROP COLUMN "audience_filter";
--   DROP TABLE "pricing_rate";

-- Tarifa versionada por país/categoría/proveedor — fuente única de verdad
-- para costos de WhatsApp, en vez de constantes en src/lib/cotizador.ts
-- (marcadas ahí mismo como "reverificar cuando Meta publique la
-- definitiva"). Tabla GLOBAL, sin organization_id: la tarifa de Meta no
-- depende del cliente de Korex, depende del país/categoría/proveedor.
CREATE TABLE "pricing_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"unit_cost_usd" numeric(14, 10) NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"source" text NOT NULL,
	"source_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pricing_rate_lookup_idx" ON "pricing_rate" USING btree ("country","category","provider","effective_from");
--> statement-breakpoint

-- Segmentación de audiencia (Fase 10E) — "todos_los_contactos" sigue
-- siendo el valor por defecto; audience_filter solo se lee para los modos
-- nuevos (pipeline_stage/selected_contacts/fixed_count/budget).
ALTER TABLE "campaign" ADD COLUMN "audience_filter" jsonb;--> statement-breakpoint

-- Estimación de costo (Fase 10C/10F), congelada al momento de estimar —
-- nunca se recalcula sola con una tarifa futura.
ALTER TABLE "campaign" ADD COLUMN "estimated_recipients" integer;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "estimated_cost_usd" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "rate_snapshot" jsonb;--> statement-breakpoint

-- Aprobación cliente→superadmin (Fase 10I).
ALTER TABLE "campaign" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "rejection_reason" text;--> statement-breakpoint

-- Costo real por evento de WhatsApp (Fase 10C) — extiende usage_event en
-- vez de crear una tabla paralela: sigue siendo la única fuente de verdad
-- de gasto, ahora también trazable hasta la campaña/destinatario/tarifa
-- exactos que lo generaron.
ALTER TABLE "usage_event" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "recipient_id" text;--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "korex_price_usd" numeric(14, 10);--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "margin_usd" numeric(14, 10);--> statement-breakpoint
ALTER TABLE "usage_event" ADD COLUMN "pricing_rate_id" text;--> statement-breakpoint

-- Delivery status (Fase 10H) — timestamps aparte del status principal
-- (sent/failed/...): nunca se toca la máquina de estados ya probada de
-- campaign_recipient, solo se anota CUÁNDO se confirmó delivered/read.
ALTER TABLE "campaign_recipient" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD COLUMN "read_at" timestamp;--> statement-breakpoint

ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_recipient_id_campaign_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipient"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_pricing_rate_id_pricing_rate_id_fk" FOREIGN KEY ("pricing_rate_id") REFERENCES "public"."pricing_rate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_event_campaign_idx" ON "usage_event" USING btree ("campaign_id");
