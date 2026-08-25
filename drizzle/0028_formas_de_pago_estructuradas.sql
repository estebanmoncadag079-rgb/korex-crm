-- Interruptor de la sección de pago de PEDIDOS, mismo patrón que
-- `catalog_source` (0020_catalogo_de_pedidos.sql): nace en 'prompt' (apagado,
-- sin tocar a ningún cliente) y se enciende cliente por cliente cuando su
-- ficha.pago esté revisada. Rollback: UPDATE de una fila, sin desplegar.
--
-- ⚠️ Escrita A MANO, no con `drizzle-kit generate`: el snapshot de este
-- proyecto ya arrastra una deriva conocida (ver la nota de cabecera de
-- 0020_catalogo_de_pedidos.sql) que hace que el generador pregunte por un
-- renombre de tabla ajeno a este cambio (`appointment_resource`). Es un solo
-- ALTER TABLE con DEFAULT, de riesgo mínimo, y sigue el mismo formato que
-- drizzle-kit ya generó para catalog_source.

ALTER TABLE "agent_profile" ADD COLUMN "payment_source" text DEFAULT 'prompt' NOT NULL;
