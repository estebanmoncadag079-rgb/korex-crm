-- Fase 11-B (4-sep-2026) — separa "el pedido quedó registrado" (la fila de
-- order_confirmation ya existía) de "el aviso al equipo se entregó de
-- verdad" (estas columnas nuevas). Antes, si notifyTeam fallaba después de
-- registrar la confirmación, la idempotencia ya impedía cualquier
-- reintento — el pedido quedaba registrado, pero el equipo nunca se
-- enteraba, y nada en el sistema lo sabía. Ver el comentario de
-- `orderConfirmation` en schema.ts y `src/server/ai/confirmacion-de-pedido.ts`
-- para las transiciones exactas.
--
-- Puramente aditiva: columnas nuevas, todas con default o nullable — no
-- rompe ninguna fila existente ni ningún lector viejo del esquema.
--
-- Rollback:
--   DROP INDEX "order_confirmation_retry_idx";
--   ALTER TABLE "order_confirmation" DROP COLUMN "notify_status";
--   ALTER TABLE "order_confirmation" DROP COLUMN "notify_attempts";
--   ALTER TABLE "order_confirmation" DROP COLUMN "notify_detail";
--   ALTER TABLE "order_confirmation" DROP COLUMN "notified_at";
--   ALTER TABLE "order_confirmation" DROP COLUMN "summary";
--   ALTER TABLE "order_confirmation" DROP COLUMN "customer_phone";
--   ALTER TABLE "order_confirmation" DROP COLUMN "updated_at";
ALTER TABLE "order_confirmation" ADD COLUMN "notify_status" text DEFAULT 'pendiente' NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD COLUMN "notify_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD COLUMN "notify_detail" text;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD COLUMN "notified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD COLUMN "summary" text;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD COLUMN "customer_phone" text;
--> statement-breakpoint
ALTER TABLE "order_confirmation" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX "order_confirmation_retry_idx" ON "order_confirmation" USING btree ("notify_status","updated_at");
