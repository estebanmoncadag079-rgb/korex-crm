-- Paso 4b · Recursos y reservas: un profesional deja de ser el único recurso
-- posible (docs/korexia/83-RECURSOS-Y-RESERVAS.md).
--
--   1. staff_member -> resource, con "type" libre (no enum). Las 5 filas
--      existentes nacen type='persona' por el DEFAULT.
--   2. staff_service -> resource_service (staff_id -> resource_id).
--   3. appointment_resource: tabla nueva. Une una reserva con sus recursos,
--      con starts_at/ends_at/status DUPLICADOS porque un EXCLUDE USING gist
--      solo puede referenciar columnas de su propia tabla. Un TRIGGER los
--      mantiene sincronizados en cada UPDATE de appointment: primer trigger
--      del proyecto, por la misma razón que ya justificó el EXCLUDE de la
--      0018 -- esta invariante no puede depender de que nadie se acuerde.
--   4. Migra las 17 citas vivas (verificadas el 18-ago-2026): una fila en
--      appointment_resource por cada appointment.staff_id de hoy.
--   5. Mueve la restricción de solape: se arma la nueva y SOLO ENTONCES se
--      retira la vieja -- si algo fallara, la transacción entera se
--      revierte y la vieja restricción sigue protegiendo. Drizzle envuelve
--      TODAS las sentencias de esta migración en una única transacción de
--      Postgres (pg-core/dialect.js, método migrate): no hay ventana en la
--      que el motor deje de proteger contra un doble cupo.
--   6. Retira appointment.staff_id: desde aquí, qué recurso lleva una
--      reserva se decide en appointment_resource, que ya admite más de uno
--      por reserva el día que un negocio lo necesite (una clínica: un
--      especialista y un consultorio a la vez).
--
-- Escrita a mano, como la 0021, la 0022 y la 0023 (ninguna tiene snapshot en
-- drizzle/meta/): drizzle-kit generate diffizaría contra el snapshot
-- desactualizado de la 0020 y volvería a proponer columnas que ya existen.
--
-- NO se ejecutó contra ninguna base al escribirla: sin TEST_DATABASE_URL ni
-- Docker en esta máquina, se revisó a mano, statement por statement, contra
-- schema.ts y el estilo real de drizzle/0009_premium_mauler.sql (donde nació
-- staff_member) y drizzle/0018_citas_sin_solape.sql (donde nació el EXCLUDE
-- que aquí se mueve). Detalle completo en
-- docs/korexia/96-BITACORA-RECURSOS-Y-RESERVAS.md.

-- ── 1. staff_member -> resource ──────────────────────────────────────────
ALTER TABLE "staff_member" RENAME TO "resource";--> statement-breakpoint
ALTER TABLE "resource" RENAME CONSTRAINT "staff_member_organization_id_organization_id_fk" TO "resource_organization_id_organization_id_fk";--> statement-breakpoint
ALTER INDEX "staff_org_idx" RENAME TO "resource_org_idx";--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "type" text DEFAULT 'persona' NOT NULL;--> statement-breakpoint
-- Habilita las FK compuestas de appointment_resource: sin esto, un vínculo
-- podría colgar de un recurso de OTRA organización.
CREATE UNIQUE INDEX "resource_org_id_uq" ON "resource" USING btree ("organization_id","id");--> statement-breakpoint

-- ── 2. staff_service -> resource_service ─────────────────────────────────
ALTER TABLE "staff_service" RENAME TO "resource_service";--> statement-breakpoint
ALTER TABLE "resource_service" RENAME COLUMN "staff_id" TO "resource_id";--> statement-breakpoint
ALTER TABLE "resource_service" RENAME CONSTRAINT "staff_service_organization_id_organization_id_fk" TO "resource_service_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "resource_service" RENAME CONSTRAINT "staff_service_staff_id_staff_member_id_fk" TO "resource_service_resource_id_resource_id_fk";--> statement-breakpoint
ALTER TABLE "resource_service" RENAME CONSTRAINT "staff_service_service_id_service_id_fk" TO "resource_service_service_id_service_id_fk";--> statement-breakpoint
ALTER INDEX "staff_service_uq" RENAME TO "resource_service_uq";--> statement-breakpoint

-- Habilita la FK compuesta de appointment_resource hacia appointment.
CREATE UNIQUE INDEX "appointment_org_id_uq" ON "appointment" USING btree ("organization_id","id");--> statement-breakpoint

-- ── 3. appointment_resource: la tabla que hoy no existe ─────────────────
CREATE TABLE "appointment_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"resource_id" text NOT NULL,
	-- Duplicados de appointment a propósito: ver la nota de cabecera sobre
	-- el EXCLUDE y el trigger que los mantiene al día.
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "appointment_resource_org_resource_starts_idx" ON "appointment_resource" USING btree ("organization_id","resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointment_resource_appointment_idx" ON "appointment_resource" USING btree ("appointment_id");--> statement-breakpoint
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Aislamiento estructural, igual que "product_option_group_product_fk": el
-- motor impide colgar un vínculo de una reserva o un recurso de OTRA
-- organización (docs/korexia/10-SEGURIDAD.md).
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_appointment_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."appointment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_resource_fk" FOREIGN KEY ("organization_id","resource_id") REFERENCES "public"."resource"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── 4. Migrar las citas vivas ─────────────────────────────────────────────
-- El id no sigue el alfabeto de newId() (eso solo lo genera la app): es
-- opaco igual, y es la única tanda que nace así. Desde aquí, todo lo nuevo
-- lo crea crearCita() con newId("appointmentResource").
INSERT INTO "appointment_resource"
  ("id","organization_id","appointment_id","resource_id","starts_at","ends_at","status","created_at")
SELECT 'aptr_' || substr(md5(a."id" || clock_timestamp()::text), 1, 20),
       a."organization_id", a."id", a."staff_id", a."starts_at", a."ends_at", a."status", now()
FROM "appointment" a;--> statement-breakpoint

-- ── 5. Mover la restricción de solape ────────────────────────────────────
-- Se arma la NUEVA antes de tocar la vieja: es la misma pareja (recurso,
-- rango) que la 0018 ya validaba sobre estos mismos datos, así que no
-- debería fallar -- y si lo hiciera, la transacción se revierte entera y la
-- vieja restricción sobre appointment sigue protegiendo.
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_sin_solape"
  EXCLUDE USING gist ("resource_id" WITH =, tsrange("starts_at","ends_at",'[)') WITH &&)
  WHERE ("status" IN ('pendiente', 'confirmada', 'reagendada'));--> statement-breakpoint

ALTER TABLE "appointment" DROP CONSTRAINT "appointment_sin_solape";--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_staff_id_staff_member_id_fk";--> statement-breakpoint
DROP INDEX "appointment_org_staff_starts_idx";--> statement-breakpoint
ALTER TABLE "appointment" DROP COLUMN "staff_id";--> statement-breakpoint

-- ── 6. Mantener starts_at/ends_at/status sincronizados ───────────────────
-- El único trigger de este proyecto. Sin él, cada función que actualiza
-- appointment (reprogramar, cancelar, marcar no-show…) tendría que
-- acordarse de tocar también appointment_resource -- el mismo "que nadie se
-- le olvide" que la 0018 vino a eliminar para el solape. queries.ts sigue
-- siendo el único lugar desde donde se escribe; esto es la red debajo, no
-- un reemplazo de esa disciplina.
CREATE OR REPLACE FUNCTION sincronizar_appointment_resource() RETURNS trigger AS $$
BEGIN
  UPDATE "appointment_resource"
  SET "starts_at" = NEW."starts_at", "ends_at" = NEW."ends_at", "status" = NEW."status"
  WHERE "appointment_id" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "appointment_sincroniza_recursos"
AFTER UPDATE OF "starts_at", "ends_at", "status" ON "appointment"
FOR EACH ROW
EXECUTE FUNCTION sincronizar_appointment_resource();
