-- Programa de mejora integral, Prioridad 3 (4-sep-2026) — token de
-- concurrencia optimista para conversation_state. Ver el comentario de
-- `version` en schema.ts: mismo principio que `generation` en agent_job
-- (Fase 10Q). Sin cliente real expuesto hoy (state_source='backend' esta
-- apagado para los 4 clientes) — se cierra antes de encenderlo para
-- cualquiera.
--
-- Rollback:
--   ALTER TABLE "conversation_state" DROP COLUMN "version";
ALTER TABLE "conversation_state" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
