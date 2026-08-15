-- FASE 2 · El estado de la conversación deja de vivir en el prompt.
--
-- ADITIVA y APAGADA: crea la tabla vacía y una bandera por cliente que nace en
-- 'prompt'. Con la bandera así, el pipeline corre exactamente como hoy y
-- `conversation_state` no se lee ni se escribe. Encenderla es un acto aparte,
-- cliente por cliente, y el rollback es un UPDATE sin desplegar.
--
-- Escrita A MANO, como la 0021: `drizzle-kit generate` ya propuso una vez
-- recrear una columna existente y habría fallado a media migración.

-- 1:1 con la conversación. El backend REEMPLAZA la fila entera en cada turno:
-- sin deltas ni merges, que es de donde salen los bugs de estado (regla 7).
-- Es seguro porque la cola garantiza un solo turno por conversación a la vez.
CREATE TABLE IF NOT EXISTS "conversation_state" (
  "conversation_id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  -- El estado propuesto por el modelo y YA validado por el backend.
  "estado" jsonb NOT NULL,
  -- Sin esto, el día que cambie la forma del JSON habrá conversaciones vivas
  -- con la forma vieja y ninguna manera de saber cuál es cuál.
  "schema_version" integer DEFAULT 1 NOT NULL,
  -- En qué punto va. Existe para que "¿dónde se cae la gente?" sea un GROUP BY
  -- y no una arqueología del historial.
  "paso" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- FK compuesta contra la conversación, y con la organización dentro: el motor
-- impide colgar un estado de la conversación de otro cliente. Ya hubo una fuga
-- entre tenants por un WHERE sin organization_id (10-SEGURIDAD.md).
ALTER TABLE "conversation_state"
  ADD CONSTRAINT "conversation_state_conversation_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "conversation_state"
  ADD CONSTRAINT "conversation_state_organization_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade;
--> statement-breakpoint
-- La bandera por cliente, apagada. Mismo patrón que `catalog_source`, que ya
-- funcionó en la Fase 1: encender es deliberado y volver atrás es un UPDATE.
ALTER TABLE "agent_profile"
  ADD COLUMN IF NOT EXISTS "state_source" text DEFAULT 'prompt' NOT NULL;
