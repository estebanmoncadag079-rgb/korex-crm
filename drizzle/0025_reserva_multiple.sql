-- Paso 4 (cierre) · Selección múltiple en citas: una reserva admite varios
-- servicios (docs/korexia/88-AUDITORIA-SELECCION-MULTIPLE.md,
-- docs/korexia/97-BITACORA-RESERVA-MULTIPLE.md).
--
--   1. service_org_id_uq: falta desde siempre -- lo necesita la FK compuesta
--      de appointment_service (mismo patrón que resource_org_id_uq y
--      appointment_org_id_uq, nacidas en la 0024).
--   2. appointment_service: tabla nueva. Une una reserva con TODOS sus
--      servicios, en el orden pedido ("position") y con la duración de cada
--      uno espejada al momento de agendar ("duration_min").
--      appointment.service_id SE CONSERVA: pasa a significar "el primero de
--      la visita", así que ningún innerJoin existente (agendaDelDia,
--      listAppointments, citasDelDia, la UI de /appointments) necesita
--      tocarse. Esta tabla es aditiva, no un reemplazo.
--
-- Escrita a mano, como la 0021, la 0022, la 0023 y la 0024 (ninguna tiene
-- snapshot en drizzle/meta/): drizzle-kit generate diffizaría contra el
-- snapshot desactualizado de la 0020.
--
-- NO se ejecutó contra ninguna base al escribirla: sin TEST_DATABASE_URL ni
-- Docker en esta máquina, se revisó a mano, statement por statement, contra
-- schema.ts y el estilo real de la 0024 (donde nació appointment_resource,
-- la tabla hermana de esta). Detalle completo en
-- docs/korexia/97-BITACORA-RESERVA-MULTIPLE.md.

-- ── 1. Falta desde siempre: la habilita la FK compuesta de abajo ─────────
CREATE UNIQUE INDEX "service_org_id_uq" ON "service" USING btree ("organization_id","id");--> statement-breakpoint

-- ── 2. appointment_service: la tabla que hoy no existe ───────────────────
CREATE TABLE "appointment_service" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"service_id" text NOT NULL,
	"position" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "appointment_service_appointment_idx" ON "appointment_service" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_service_position_uq" ON "appointment_service" USING btree ("appointment_id","position");--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Aislamiento estructural, igual que "appointment_resource_appointment_fk":
-- el motor impide colgar un servicio de reserva de OTRA organización.
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_appointment_fk" FOREIGN KEY ("organization_id","appointment_id") REFERENCES "public"."appointment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."service"("organization_id","id") ON DELETE no action ON UPDATE no action;
