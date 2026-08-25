-- Interruptor del menú guiado de WhatsApp (listas/botones interactivos),
-- mismo patrón que `catalog_source`/`payment_source`: nace en 'texto'
-- (apagado, sin tocar a ningún cliente) y se enciende negocio por negocio
-- con `pnpm migrar:menu <org> --encender` una vez que su catálogo esté en
-- tablas y pase la validación de límites. Rollback: UPDATE de una fila.
--
-- Escrita a mano, mismo motivo que 0028_formas_de_pago_estructuradas.sql.

ALTER TABLE "agent_profile" ADD COLUMN "menu_mode" text DEFAULT 'texto' NOT NULL;
