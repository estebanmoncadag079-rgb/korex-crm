-- Recursos compartibles: un recurso del negocio puede entregarse como ARCHIVO,
-- como ENLACE o como ambos (docs/korexia/47-FOTOS-DEL-AGENTE.md).
--
-- Nace de una petición real del 18-ago-2026: el agente mandaba el catálogo en
-- PDF y el negocio prefería un enlace, para que la clienta lo abra sin
-- descargar nada. La capacidad NO se construye para ese negocio — cualquier
-- cliente del CRM puede querer compartir un menú, un tarifario o una guía por
-- enlace en vez de por archivo (regla: capacidad global del CRM, ver
-- REGLAS-DE-ARQUITECTURA.md).
--
--   1. entrega: 'archivo' (por defecto) | 'enlace' | 'ambos'. El default hace
--      que TODAS las filas existentes se comporten exactamente igual que antes
--      y que ningún negocio note que esta columna apareció.
--   2. url: el enlace externo. Nulo cuando el recurso es solo archivo.
--   3. mime_type / datos / tamano dejan de ser NOT NULL: un recurso que solo
--      es un enlace no tiene bytes ni tipo de archivo. Relajar un NOT NULL no
--      invalida ninguna fila existente (todas los tienen).
--   4. media_entrega_coherente: la restricción que impide declarar algo que
--      no se puede entregar — un 'enlace' sin url, o un 'archivo' sin datos.
--      Es el mismo defecto que tenía send_image al aceptar una acción sin
--      etiqueta, y aquí se cierra en la base, no en el código.
--
-- Escrita a mano, como la 0021 a la 0025 (ninguna tiene snapshot en
-- drizzle/meta/): drizzle-kit generate diffizaría contra el snapshot
-- desactualizado de la 0020.
--
-- NO se ejecutó contra ninguna base al escribirla. Revisada statement por
-- statement contra schema.ts y contra la única fila real que hoy existe en
-- media_asset (entrega='archivo', datos y mime_type presentes → cumple el
-- CHECK).
--
-- REVERTIR:
--   ALTER TABLE "media_asset" DROP CONSTRAINT "media_entrega_coherente";
--   ALTER TABLE "media_asset" DROP COLUMN "url";
--   ALTER TABLE "media_asset" DROP COLUMN "entrega";
--   ALTER TABLE "media_asset" ALTER COLUMN "mime_type" SET NOT NULL;
--   ALTER TABLE "media_asset" ALTER COLUMN "datos" SET NOT NULL;
--   ALTER TABLE "media_asset" ALTER COLUMN "tamano" SET NOT NULL;
--   (los SET NOT NULL fallan si para entonces existe algún recurso solo-enlace:
--    hay que borrarlo o darle datos antes.)

ALTER TABLE "media_asset" ADD COLUMN "entrega" text DEFAULT 'archivo' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "url" text;
--> statement-breakpoint
ALTER TABLE "media_asset" ALTER COLUMN "mime_type" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_asset" ALTER COLUMN "datos" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_asset" ALTER COLUMN "tamano" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_entrega_coherente" CHECK (
  ("entrega" = 'archivo' AND "datos" IS NOT NULL AND "mime_type" IS NOT NULL)
  OR ("entrega" = 'enlace' AND "url" IS NOT NULL)
  OR ("entrega" = 'ambos' AND "datos" IS NOT NULL AND "mime_type" IS NOT NULL AND "url" IS NOT NULL)
);
