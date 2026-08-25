# 138 — Las preguntas frecuentes no se vuelcan de golpe

25-ago-2026.

## El incidente

Esteban revisó un chat real de Lis. La clienta tocó la opción **"Preguntas
frecuentes"** del menú de bienvenida, y el agente respondió mandando **todo**
su conocimiento guardado de una sola vez — cada pregunta con su respuesta,
una tras otra — y cerró pidiéndole a la clienta que le dijera **cuál** de esas
quería que le respondiera.

Nadie preguntó qué quería saber. El agente asumió que "preguntas frecuentes"
significa "entregar el catálogo completo de preguntas", cuando la intención
real de esa opción de menú es invitar a la clienta a preguntar lo que tenga en
mente.

## Por qué pasa

El saludo de Lis (`ficha.flujo.saludoInicial`, dato propio del negocio, ver
[45](45-GENERADOR-DE-PROMPTS.md)) ofrece "Preguntas frecuentes" como una de
las opciones del menú inicial. Pero **ninguna instrucción del prompt le decía
al modelo qué hacer cuando el cliente elige esa opción** — ni en la ficha de
Lis, ni en la conducta universal (`conducta.ts`) que comparten los tres
negocios.

Sin instrucción, el modelo hizo lo más literal con la Knowledge Base que tenía
disponible: la tiene completa en el prompt (ver el acordeón del panel,
[137](137-REQUISITOS-COMO-PASO-DEL-ALTA.md) documentó su UI, no este
comportamiento), y ante "preguntas frecuentes" la entregó entera. Es la misma
familia de fallo que ya resolvieron `NO_ENCAJA` y `FUERA_DE_HORARIO`: un hueco
de conducta, no un dato faltante ni un bug de código.

## Por qué es conducta, no guardarraíl

Antes de escribir una sola línea, Esteban interrumpió con la pregunta correcta:
*"no re saltes los validadores y los orquestadores, recuerda siempre mantener
la arquitectura del proyecto"* — exigiendo pensar explícitamente si esto
necesitaba un guardarraíl nuevo (Validation Engine, ver
[128](128-COHERENCIA-ARQUITECTURA-PROMPT-MAESTRO.md) y
[130](130-ORQUESTADOR-FORMALIZADO-Y-GUARDARRAIL-EXTENDIDO.md)) antes de tocar
`conducta.ts`.

Un guardarraíl del servidor solo puede admitirse cuando hay **algo de forma
inconfundible** que comparar contra el texto de salida — un enlace, un correo,
un teléfono, la ausencia de una acción. Aquí no lo hay: "volcar todas las
preguntas" y "responder bien una pregunta puntual" no se distinguen por forma,
solo por criterio — exactamente el mismo límite que ya trazó el guardarraíl 7
([125](125-CONTENIDO-OBLIGATORIO-VERIFICADO-POR-CODIGO.md)) para no intentar
verificar tono o intención. Por eso la solución vive **solo como conducta**,
igual que `NO_ENCAJA` y `FUERA_DE_HORARIO`: el orquestador (`pipeline.ts`) y
los guardarraíles existentes quedan intactos, sin ninguno nuevo.

## La solución

Nueva constante `PREGUNTAS_FRECUENTES` en
[conducta.ts](../../src/server/ai/generador/conducta.ts), en el bloque
universal que comparten los tres negocios:

> No es una lista que se entrega: es una invitación a que pregunten. Si el
> cliente dice algo como "preguntas frecuentes", "quiero ver las FAQ", o elige
> esa opción de un menú, no le mandes tu conocimiento completo de una vez ni
> le pidas que elija cuál quiere de una lista. Pregúntale con calidez qué le
> gustaría saber, y espera su pregunta.
>
> Cuando la haga, respóndela con lo que tengas en tu conocimiento — igual que
> cualquier otra pregunta, en el momento en que la haga. Si no la tienes, no
> inventes: dile que lo confirmas con el equipo y sigue.

Insertada en [generar.ts](../../src/server/ai/generador/generar.ts) justo
después de `NO_ENCAJA`, en el mismo bloque de lecciones universales
(`bloques(...)`).

La última línea — "si no la tienes, no inventes: dile que lo confirmas con el
equipo y sigue" — traduce el pedido exacto de Esteban ("si no la tiene en el
CRM, deriva a un asesor") con el vocabulario que ya usa el resto de
`conducta.ts` (ver `NUNCA` y el patrón de handoff que ya usan otras reglas),
sin inventar una acción nueva ni un caso especial de handoff.

## Verificado

- `tsc --noEmit`: limpio.
- `eslint` sobre `conducta.ts`, `generar.ts` y el test: limpio.
- Prueba nueva en
  [generador-de-prompt.test.ts](../../tests/unit/generador-de-prompt.test.ts),
  dentro del mismo `describe` que agrupa "las lecciones de todos" —
  comprueba que el prompt generado contiene el fragmento distintivo de la
  regla.
- Suite completa (`vitest run tests/unit tests/integration`): **983
  pruebas, 0 fallos**, sin regresiones.

**Lo que NO se verificó**: no se probó en vivo contra el pipeline real con una
conversación de prueba (requiere túnel SSH a producción y créditos de
OpenRouter). La prueba unitaria confirma que la regla llega al *texto del
prompt generado* — no que el modelo la obedezca siempre, igual que ninguna
otra regla de conducta tiene esa garantía.

## Lo que falta — decisión del dueño, no tarea de limpieza

Este cambio es universal (vive en `conducta.ts`, lo heredan los tres
negocios), pero **como ya pasó con el doc [54](54-UN-ARREGLO-PARA-TODA-LA-FLOTA.md)**,
no tiene efecto automático en los prompts que Lis, La Churra y Lashes Valen
ya tienen guardados. Hace falta correr `pnpm regenerar:flota` para que la
regla llegue al prompt real que usa cada bot en producción — y qué clientes
regenerar (¿todos? ¿solo Lis, donde ocurrió el incidente?) es una decisión de
Esteban, no algo que se ejecute sin que él lo pida.
