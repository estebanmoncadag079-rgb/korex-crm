-- Programa de mejora integral, Prioridad 5 (4-sep-2026) — idempotencia real
-- de book_appointment, a nivel de Postgres. Mismo diseño que
-- order_confirmation (Fase 10N-A), clonado en su propia tabla. Ver el
-- comentario de `appointmentBookingConfirmation` en schema.ts.
--
-- Fase 6B (8-sep-2026, sin comitear todavía en ningún entorno cuando se
-- amplió) — se agregan aquí mismo, en la misma migración de creación, las
-- columnas de registro/aviso/reintento (mismo patrón que
-- order_confirmation.notify_status, Fase 11-B / migración 0041): la tabla
-- nunca existió en ningún entorno real, así que no hace falta una segunda
-- migración de ALTER — se define completa de una vez.
--
-- Rollback:
--   DROP TABLE "appointment_booking_confirmation";
CREATE TABLE "appointment_booking_confirmation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"notify_status" text DEFAULT 'pendiente' NOT NULL,
	"notify_attempts" integer DEFAULT 0 NOT NULL,
	"notify_detail" text,
	"notified_at" timestamp,
	"summary" text,
	"customer_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_booking_confirmation" ADD CONSTRAINT "appointment_booking_confirmation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_booking_confirmation" ADD CONSTRAINT "appointment_booking_confirmation_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_booking_confirmation_uq" ON "appointment_booking_confirmation" USING btree ("conversation_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "appointment_booking_confirmation_retry_idx" ON "appointment_booking_confirmation" USING btree ("notify_status","updated_at");
