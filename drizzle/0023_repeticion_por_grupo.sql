-- PASO 3A · La repetición deja de ser una regla del núcleo y pasa al catálogo.
--
-- Hasta el 16-ago-2026 las opciones NO se podían repetir: `normalizarPedido`
-- deduplicaba, y un Mega Box —cinco salsas de cuatro sabores— no se podía
-- completar jamás. Se abrió la repetición para todos, y con eso una regla de UN
-- negocio se convirtió en regla de la plataforma: en un salón, "esmaltado
-- tradicional + tradicional" no significa nada.
--
-- Ahora lo declara cada grupo, y el valor por defecto es NO: repetir es la
-- excepción.
--
-- Escrita A MANO, como la 0021 y la 0022: `drizzle-kit generate` ya propuso una
-- vez recrear una columna existente y habría fallado a media migración.

ALTER TABLE "product_option_group"
  ADD COLUMN IF NOT EXISTS "permite_repeticion" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- Y la corrección ARITMÉTICA, en la misma operación.
--
-- Sin esto, el valor por defecto `false` reintroduce exactamente el bug que se
-- corrigió el 16-ago: un grupo que exige MÁS opciones de las que tiene solo se
-- puede completar repitiendo. No es una preferencia del negocio, es aritmética
-- —`max_select > COUNT(opciones)` no admite otra lectura—, así que se resuelve
-- aquí y no se le pregunta a nadie.
--
-- ⚠️ Deliberadamente SIN nombres: ni de producto, ni de grupo, ni de negocio.
-- Esta migración no sabe qué es una salsa ni qué es La Churra. Vale igual para
-- el catálogo que se cargue mañana.
--
-- Va en la MISMA migración a propósito: separarlas dejaría una ventana en la
-- que el pedido más caro de un cliente vivo no se puede cerrar.
UPDATE "product_option_group" g
SET "permite_repeticion" = true
WHERE g."max_select" > (
  SELECT COUNT(*) FROM "product_option" o WHERE o."group_id" = g."id"
);
