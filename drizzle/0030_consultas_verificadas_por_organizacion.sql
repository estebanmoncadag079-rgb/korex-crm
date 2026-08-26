-- Interruptor por organización para forzar la verificación backend de
-- `consultar_producto` en preguntas factuales concretas, en vez de dejar
-- que el modelo decida por su cuenta si consulta o responde directo con el
-- catálogo en prosa. Mismo patrón que `catalog_source`/`payment_source`:
-- nace en `false` (apagado, sin tocar a ningún cliente) y se enciende
-- negocio por negocio con un UPDATE de una fila. Rollback: el mismo UPDATE
-- al revés.
--
-- Escrita a mano, mismo motivo que 0028/0029.

ALTER TABLE "agent_profile" ADD COLUMN "consultas_verificadas_enabled" boolean DEFAULT false NOT NULL;
