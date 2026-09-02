-- Fase 3C — modelo de datos de campañas de marketing (auditoría 1-sep-2026,
-- Fase 3B). SOLO tablas y columnas: nada de esto envía un mensaje, no hay
-- worker leyendo estas tablas todavía. Clona el patrón ya probado de
-- `agent_job` en vez de inventar uno nuevo — ver la auditoría de Fase 3B
-- para la justificación campo a campo.
--
-- Rollback (orden inverso por las FK):
--   DROP TABLE "campaign_send_job";
--   DROP TABLE "campaign_recipient";
--   DROP TABLE "campaign";
--   ALTER TABLE "contact" DROP COLUMN "marketing_opt_out_at";
--   ALTER TABLE "contact" DROP COLUMN "marketing_opt_out";
--
-- Escrita a mano, mismo motivo que 0028/0029/0030: `drizzle-kit generate`
-- se cuelga en un prompt interactivo de renombrado ambiguo sobre
-- appointment_resource/staff_member/staff_service, no relacionado con este
-- cambio.

ALTER TABLE "contact" ADD COLUMN "marketing_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "marketing_opt_out_at" timestamp;--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"template_id" text,
	"template_snapshot" jsonb,
	"media_asset_id" text,
	"audience_type" text DEFAULT 'todos_los_contactos' NOT NULL,
	"scheduled_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"sent_at" timestamp,
	"failed_at" timestamp,
	"error" text,
	"message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_send_job" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_job" ADD CONSTRAINT "campaign_send_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_job" ADD CONSTRAINT "campaign_send_job_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_job" ADD CONSTRAINT "campaign_send_job_recipient_id_campaign_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_org_idx" ON "campaign" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "campaign_org_status_idx" ON "campaign" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipient_campaign_contact_uq" ON "campaign_recipient" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipient_campaign_status_idx" ON "campaign_recipient" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipient_org_idx" ON "campaign_recipient" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_send_job_recipient_uq" ON "campaign_send_job" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "campaign_send_job_listos_idx" ON "campaign_send_job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "campaign_send_job_org_idx" ON "campaign_send_job" USING btree ("organization_id");
