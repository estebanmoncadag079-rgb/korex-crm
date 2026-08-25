# "Datos que debe pedir el agente", como paso 8 del alta

**25-ago-2026.** El dueño, viendo "Datos que deben solicitarse antes de
confirmar" dentro de "Agente de IA", pidió que en vez de vivir solo ahí (una
pantalla que se visita después de terminar el alta), fuera un paso más del
mismo cuestionario que ya recorre el cliente al darse de alta — la
"configuración 8 de 8".

## Qué se hizo

Se agregó un paso nuevo al final del wizard de onboarding
(`onboarding-wizard.tsx`), con los mismos checkboxes que ya existían en
`RequisitosSection` (Agente de IA) — esa pantalla **no se tocó ni se quitó**,
sigue siendo el lugar para ajustarlo después de terminada el alta.

## El guardarraíl que había que respetar

`cierre.requisitos` vive en la sección `flujo` de la ficha, **junto con**
`pagoAntesDeLaCita` (que edita la pantalla de Pago de Citas). `fusionarFicha`
fusiona por sección completa, no campo a campo dentro de `cierre`: mandar
solo `{ requisitos }` desde este paso nuevo habría reemplazado `cierre`
entero y borrado silenciosamente `pagoAntesDeLaCita` de cualquier negocio de
citas que ya lo tuviera configurado — el mismo tipo de pérdida silenciosa que
ya documentó el incidente del 15-ago con las reglas de flujo.

Se preserva explícitamente en el `POST /api/onboarding`, leyendo la ficha
guardada antes de aplicar y conservando `pagoAntesDeLaCita`, mismo patrón que
ya usa `/api/agent/requisitos` (`{ ...fichaActual.cierre, requisitos }`).

El cliente solo manda el id de lo que marca (`nombre`, `telefono`, `email`,
`documento`); el servidor completa `tipo`/`etiqueta`/`obligatorio` desde
`REQUISITOS_DISPONIBLES` al aplicar — no puede inventar un id que
`server/contacts.ts` no sepa capturar.

## Verificación

`tsc --noEmit` y `eslint` limpios. 982 pruebas, 0 fallos (ninguna se rompió).

**Lo que NO se hizo, con honestidad:** no se agregó una prueba de
integración específica para el escenario "guardar requisitos desde este
paso nuevo no borra `pagoAntesDeLaCita`" — se verificó por lectura cuidadosa
de `fusionarFicha` y replicando el patrón ya probado del otro endpoint, no
con un test nuevo contra Postgres real. Tampoco se probó la pantalla en un
navegador real en esta sesión. Antes de confiar en esto con un cliente de
citas real, vale la pena una prueba manual: marcar un requisito en este
paso nuevo y confirmar que "Pago de Citas" sigue mostrando su configuración
intacta después.

## Cómo revertir

`git revert` del commit `dc1d383`. No toca datos de producción — el revert
solo quita el paso del wizard y la lógica de preservación del endpoint;
`RequisitosSection` en Agente de IA sigue funcionando exactamente igual.
