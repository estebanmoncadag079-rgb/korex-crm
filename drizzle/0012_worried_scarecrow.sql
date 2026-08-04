CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"raw_body" text NOT NULL,
	"payload" jsonb,
	"headers" jsonb NOT NULL,
	"signature" text,
	"organization_id" text,
	"status" text DEFAULT 'recibido' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_event_status_idx" ON "webhook_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_event_org_idx" ON "webhook_event" USING btree ("organization_id");