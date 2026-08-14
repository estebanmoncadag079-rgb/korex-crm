-- La ficha con la que se generó cada prompt, para poder regenerarlo.
--
-- Hasta ahora una lección nueva en `conducta.ts` solo llegaba a los clientes
-- dados de alta DESPUÉS: el prompt queda materializado en `instructions` y la
-- ficha se perdía al terminar el alta. Sin ella, "esto lo heredan todos" era
-- verdad solo para los que aún no existían.
ALTER TABLE "agent_profile" ADD COLUMN "ficha" text;
