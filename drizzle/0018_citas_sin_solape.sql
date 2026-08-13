-- Dos clientas no pueden ocupar a la misma especialista a la misma hora.
--
-- Hasta ahora la única defensa vivía en la aplicación: `crearCita` consultaba
-- la disponibilidad y después insertaba. Entre esas dos cosas hay una base de
-- datos, y los webhooks de WhatsApp llegan en paralelo: dos turnos podían
-- consultar el mismo hueco libre antes de que ninguno hubiera insertado.
-- Reproducido contra Postgres real, 4 de 4 intentos: dos citas encima.
--
-- El rango es SEMIABIERTO `[)` a propósito: el motor ofrece el slot que empieza
-- justo cuando termina la cita anterior (11:30 tras una que acaba a las 11:30),
-- y con un rango cerrado esa reserva legítima quedaría bloqueada.
--
-- El WHERE parcial deja fuera las canceladas y las ya cumplidas: una cita
-- cancelada no debe reservar nada.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_sin_solape" EXCLUDE USING gist ("staff_id" WITH =, tsrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" IN ('pendiente', 'confirmada', 'reagendada'));
