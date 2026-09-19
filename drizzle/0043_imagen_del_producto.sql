-- Fase 3 (imágenes de productos del catálogo) — media_asset gana una
-- relación real con product, sin perder la resolución por etiqueta que ya
-- usa `elegirFoto` (queda como respaldo, ver src/server/ai/fotos.ts).
--
-- Escrita a mano, como el resto de las migraciones desde la 0021: el
-- snapshot de drizzle/meta/ sigue congelado en la 0020 (deuda técnica
-- documentada aparte, fuera de alcance de esta migración). Revisada
-- statement por statement contra schema.ts.
--
-- `product_id` nullable: media_asset representa productos, cartas y otros
-- recursos (columna `kind`), y solo los de kind='producto' tendrán este
-- campo poblado — los demás (`carta`, `otro`) siguen usando
-- exclusivamente `etiqueta`, exactamente como hoy.
--
-- FK COMPUESTA (organization_id, product_id) -> product(organization_id, id),
-- nunca una FK simple sobre product_id suelto: mismo patrón que ya usa
-- "product_option_group_fk" (0020_catalogo_de_pedidos.sql) y
-- "appointment_resource_resource_fk" (0024_recursos_y_reservas.sql) — la
-- base rechaza de raíz que un recurso apunte al producto de OTRA
-- organización, sin depender de que el código lo recuerde comprobar.
-- El índice único que esto necesita en el lado de "product"
-- (organization_id, id) YA EXISTE ("product_org_id_uq", creado en la
-- 0020): no hace falta crearlo de nuevo aquí.
--
-- ON DELETE SET NULL, nunca CASCADE: si se borra el producto, el recurso
-- no debe desaparecer en silencio — queda huérfano y visible para que
-- alguien decida, no perdido.
--
-- No se ejecutó contra ninguna base real (no hay TEST_DATABASE_URL en este
-- entorno): verificada solo de forma estática, statement por statement,
-- contra schema.ts y contra el estilo de 0020_catalogo_de_pedidos.sql y
-- 0024_recursos_y_reservas.sql.
--
-- No toca ninguna otra tabla. No modifica datos existentes. Sin backfill:
-- toda fila existente de media_asset nace con product_id NULL y sigue
-- resolviéndose exactamente igual que antes de esta migración.

ALTER TABLE "media_asset" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."product"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_product_idx" ON "media_asset" USING btree ("product_id");
