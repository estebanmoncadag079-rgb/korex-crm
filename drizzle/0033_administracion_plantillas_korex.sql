-- Fase 9B — administración centralizada de plantillas desde Korex (Fase
-- 9A, diseño). Agrega los 3 campos mínimos para separar el estado INTERNO
-- de una plantilla (`status`, sin cambios) del estado que el proveedor
-- real (YCloud/Meta) reporta.
--
-- Solo columnas nullable, sin backfill: filas existentes quedan con estos
-- 3 campos en NULL (correcto — nunca se sincronizaron contra un proveedor
-- por esta vía todavía). No se toca `status`, `waTemplateId`,
-- `rejectionReason` ni ninguna otra tabla.

ALTER TABLE "template" ADD COLUMN "provider" text;
ALTER TABLE "template" ADD COLUMN "provider_status" text;
ALTER TABLE "template" ADD COLUMN "provider_last_sync_at" timestamp;
