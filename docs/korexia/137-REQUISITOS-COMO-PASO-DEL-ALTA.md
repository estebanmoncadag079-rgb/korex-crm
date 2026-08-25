# Requisitos y pago de citas, dentro del cuestionario de alta

**25-ago-2026.** El dueño, viendo "Datos que deben solicitarse antes de
confirmar" dentro de "Agente de IA", pidió que en vez de vivir solo ahí (una
pantalla que se visita después de terminar el alta), fuera un paso más del
mismo cuestionario que ya recorre el cliente al darse de alta — la
"configuración 8 de 8". Al revisar el cambio ya aplicado, encontró la misma
duplicación en "Pago al confirmar una cita" y pidió lo mismo para ese dato.

## Qué se hizo

1. **Requisitos** ("Datos que deben solicitarse antes de confirmar"): paso
   nuevo al final del wizard de onboarding (`onboarding-wizard.tsx`), con los
   mismos checkboxes que tenía `RequisitosSection`.
2. **Pago de citas** ("¿cobras por adelantado al confirmar una cita?"):
   checkbox agregado dentro del paso ya existente "Cómo te pagan", visible
   solo cuando `vertical === "citas"` — mismo lugar donde ya se configuran
   las formas de pago generales del negocio, en vez de un paso aparte.

En los dos casos se eliminó la tarjeta que existía en "Agente de IA"
(`RequisitosSection`, `PagoCitasSection`) y su endpoint
(`/api/agent/requisitos`, `/api/agent/pago-citas`): el paso del cuestionario
quedó como la **única** pantalla que edita cada dato. La primera versión de
este cambio dejó la tarjeta de Requisitos sin tocar por si servía para
ajustes posteriores; el dueño señaló que dos lugares editando lo mismo es
el mismo problema que ya se resolvió con el catálogo (136), y se corrigió
el mismo día.

## El guardarraíl que había que respetar

`cierre.requisitos` y `cierre.pagoAntesDeLaCita` viven **en la misma
sección** de la ficha (`flujo`). `fusionarFicha` fusiona por sección
completa, no campo a campo dentro de `cierre`: reconstruir `cierre` a mano
sin partir de lo ya guardado habría borrado silenciosamente el otro campo
cada vez que alguien reenviara el cuestionario — el mismo tipo de pérdida
silenciosa que ya documentó el incidente del 15-ago con las reglas de flujo.

`POST /api/onboarding` arma `cierre` así:

```ts
cierre: {
  ...fichaPrevia.cierre,
  requisitos,
  pagoAntesDeLaCita: body.data.borrador.cierre?.pagoAntesDeLaCita
    ?? fichaPrevia.cierre?.pagoAntesDeLaCita,
}
```

`pagoAntesDeLaCita` es `undefined` cuando el negocio es de pedidos (ese
checkbox ni se muestra en su wizard): el `??` conserva ahí lo que ya
hubiera, en vez de apagarlo por accidente. `requisitos` siempre se manda
(aunque sea `[]`), porque ese paso es el mismo para los dos verticales.

El cliente solo manda ids/booleanos; el servidor completa
`tipo`/`etiqueta`/`obligatorio` desde `REQUISITOS_DISPONIBLES` al aplicar —
no puede inventar un id que `server/contacts.ts` no sepa capturar.

## Verificación

`tsc --noEmit` y `eslint` limpios en cada uno de los tres commits. 982
pruebas, 0 fallos (ninguna se rompió en ningún paso).

**Lo que NO se hizo, con honestidad:** no se agregó una prueba de
integración específica para estos dos escenarios de preservación cruzada
(guardar requisitos no borra el pago de citas, y viceversa) — se verificó
por lectura cuidadosa de `fusionarFicha` y replicando el patrón ya probado
de los endpoints que existían antes. Tampoco se probó ninguna de las dos
pantallas en un navegador real en esta sesión. Antes de confiar en esto del
todo con Lashes Valen (el único cliente de citas), vale la pena una prueba
manual: marcar un requisito y el pago por adelantado en el mismo recorrido
del wizard, y confirmar que las dos configuraciones quedan guardadas juntas.

## Cómo revertir

`git revert` de los commits `dc1d383`, `9d60feb` y `6e5cfb6`. No toca datos
de producción — el revert solo quita los pasos del wizard y la lógica de
preservación, y devuelve `RequisitosSection`/`PagoCitasSection` a Agente de
IA.
