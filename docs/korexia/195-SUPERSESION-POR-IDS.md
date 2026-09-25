# 195 — Supersesión v2: una sola respuesta por ráfaga, decidida por ID (Bug 3)

25-sep-2026. Rama `013-supersesion-por-ids`. Reemplaza al doc 193 (versión 1,
revertida).

## El problema que resuelve

El cliente escribe en ráfaga y el modelo tarda 15-30 s. Un mensaje que llega
MIENTRAS el turno piensa se vuelve un turno aparte → segunda respuesta casi
idéntica. Caso real Tatiana (17-sep, cv_tn9mz1kcqhd4zwjxuzae): dos "¿San Judas
I o II?" con 8 s de diferencia.

## Incidente de la versión 1 (PR #18 → revertida en PR #20)

La v1 decidía "llegó un mensaje nuevo" con `created_at > hastaAqui`. Postgres
guarda microsegundos (`.420650`); `hastaAqui` es un Date de JS (milisegundos,
`.420`). **El propio mensaje procesado salía "más nuevo" que la marca**: cada
`reply` se suprimía a sí mismo y el turno siguiente ya no veía pendientes. El
bot quedó **mudo en todos los negocios** ~14:02–17:33 UTC del 25-sep (solo
salían handoffs y cierres). Lo detectó Esteban (Marian, MALIA).

No lo cazó ninguna prueba porque la v1 **no corría en `is_test`** (el banco de
escenarios) y el unit test cubría solo la decisión pura, no la consulta real.

## La versión 2

- **"Nuevo" se decide por IDENTIDAD, nunca por hora.**
  `entrantesDesde(conv, hastaAqui)` trae los entrantes con `created_at >=
  hastaAqui` (INCLUSIVO: la truncación a ms no puede dejar fuera un mensaje
  real) y `entrantesNoProcesados` descarta por ID los que el turno ya procesó
  (`pendientesIds`). La hora solo acota; nunca decide.
- **Corre también en `is_test`.** En el banco los turnos van en serie, así que
  ahí nunca hay nuevos y no debe suprimir. Que corra allí es la red: si esto
  volviera a silenciar al bot, cualquier escenario fallaría con "se quedó mudo".
- Solo suprime un `reply`; nunca una acción con efecto. Re-encola como red de
  seguridad. No aumenta el costo (misma cantidad de turnos; solo deja de enviar
  respuestas redundantes).

## Verificación (por el camino real)

- Unit tests (`supersesion-de-respuesta.test.ts`), incluido el caso exacto del
  silencio: el propio mensaje devuelto "con microsegundos después" NO es nuevo.
- **Funciones reales del pipeline, por drizzle, contra filas reales en su
  momento exacto:** Marian (1 mensaje) → la base devuelve el propio mensaje,
  el filtro por ID lo descarta → `suprime=false` ✅. Tatiana (ráfaga) →
  detecta "Tatiana Miranda" → `suprime=true` ✅.
- Escenarios contra el modelo real con la supersesión activa: MALIA 3/3 y Lis
  "solo saluda" ✅ — ningún "se quedó mudo". (Lis "pedido completo a domicilio"
  falla igual en `main` sin este cambio: comprobación de contenido preexistente,
  ajena a esto.)
- Gate completo (`tsc`/`lint`/tests/`build`).
- **Tras el deploy:** confirmar en producción que siguen saliendo respuestas del
  bot (`out` + `ai_generated`) a clientes reales. Sin eso no está verificado.

## Cómo revertir

Revertir el merge. Sin datos tocados.
