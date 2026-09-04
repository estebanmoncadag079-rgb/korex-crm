-- Fase 10N-A (3-sep-2026) — idempotencia real de notify_order, a nivel de
-- Postgres. Ver el comentario de `orderConfirmation` en schema.ts.
--
-- Rollback:
--   DROP TABLE "order_confirmation";
CREATE TABLE "order_confirmation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD CONSTRAINT "order_confirmation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD CONSTRAINT "order_confirmation_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "order_confirmation_uq" ON "order_confirmation" USING btree ("conversation_id","idempotency_key");
