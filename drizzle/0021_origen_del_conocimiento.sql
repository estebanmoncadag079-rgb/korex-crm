-- Fase D de "un dueño por dato": cada entrada de conocimiento sabe quién la puso.
--
-- ADITIVA y con DEFAULT: las 33 filas existentes quedan como 'cliente', que es
-- lo que son y lo más restrictivo. Nada se reescribe, nada se borra.
--
-- Escrita A MANO a propósito: `drizzle-kit generate` ya propuso una vez recrear
-- una columna que existía (la 0019 no estaba en el snapshot) y habría fallado a
-- media migración. Ver 63-CATALOGO-DE-PEDIDOS-EN-TABLAS.md.
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "origen" text DEFAULT 'cliente' NOT NULL;
