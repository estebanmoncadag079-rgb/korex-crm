# 192 — El resumen no se aplaza, y el pedido abandonado se reinicia

25-sep-2026. Dos arreglos de la misma tanda de infraestructura de pedidos (el
backend conduce el ciclo de vida del pedido; profundiza el Principio 7, no lo
cambia). Rama `009-resumen-no-se-aplaza`. Medidos contra MALIA (auditoría del
24-sep, 40 conversaciones).

## Bug 5 — el resumen APLAZADO

**Síntoma (producción, MALIA):** con el pedido completo, el agente decía "ahora
preparo el resumen" y **se quedaba** (Diana Manrique, cv_29uwlk2qobe4uv5sj4lg:
la clienta no volvió a escribir → venta perdida) o cerraba sobre un "está bien"
a un resumen **que la clienta nunca vio** (aymara cruz, cv_z8utc3enge1gzn3q1j0v).

**Causa (capa: orquestación).** Ningún guardarraíl cubría "la hoja está lista
pero el modelo aplazó el resumen". Los ocho guardarraíles de resumen existentes
cubren otras formas (cerrar sin resumen, resumen mal armado, no dar el total…).

**Arreglo.** Guardarraíl nuevo (noveno), misma familia y mismo mecanismo
(rehacer el turno), en `pipeline.ts`:
- `resumenAplazado(texto)` (`anuncio-de-cierre.ts`) — la mitad de TEXTO: el
  mensaje promete "preparar el resumen" sin mostrarlo (sin `TIENE_TOTAL`).
- `hojaListaParaResumen({...})` (`orders/extraer.ts`) — la mitad de BACKEND: el
  ESTADO decide si la hoja está lista (ítems resueltos, subtotal calculado,
  requisitos completos, y total CALCULABLE — domicilio verificado si aplica).
- En `pipeline.ts` (solo pedidos, solo `reply`): si la hoja está lista Y el
  modelo aplazó → se rehace el turno con `CORRECCION_DE_RESUMEN_APLAZADO` para
  que muestre el resumen con su total AHORA. No deriva a una persona si insiste.

El backend nunca redacta el resumen ni relee el texto para decidir: decide
"lista" desde el estado, y el modelo redacta.

## Bug 2 — reinicio del pedido ABANDONADO

**Contexto.** PR #15 ya reinicia el pedido cuando el **bot** cerró el anterior
(`confirmado=true`, `pipeline.ts` `guardarEstadoPropuesto`). Faltaba el pedido
**abandonado**: uno de otro día que quedó pegado y sobre el que se apila el
siguiente (totales inflados; caso Natalia, 5 ítems/$52.000).

**Decisión del dueño (25-sep):** reiniciar SOLO si se dan las dos cosas juntas —
es de **otro día** (hora de Colombia) **Y** lleva **≥6 h sin actividad**
(`HORAS_PARA_DAR_POR_ABANDONADO`). El día por sí solo borraría el carrito de
quien pide a las 11:50pm y sigue a las 12:10am; el mismo día tampoco reinicia,
para que el cliente pueda retomar su pedido dentro de la jornada.

**Arreglo.**
- `pedidoQuedoAbandonado(ultimaActividad, ahora)` (`orders/intencion.ts`).
- `leerEstadoConVersion` expone ahora `updatedAt` (la última escritura del
  pedido = su última actividad).
- En `pipeline.ts`, al leer el estado: si hay un pedido con ítems abandonado, se
  reinicia con `estadoParaNuevoPedido` (conserva nombre/teléfono del cliente),
  persistido con `versionEsperada` y su versión incrementada — la guarda
  posterior del turno usa la versión nueva, sin carrera perdida.

## Verificación

- TDD: 21 unit tests nuevos (RED→GREEN) — `resumen-aplazado`,
  `hoja-lista-para-resumen`, `pedido-abandonado`.
- Escenario de regresión MALIA (Bug 5) contra el modelo real, en verde.
- Gate: `tsc` · `lint` · 2968 pruebas · `build`, todo en verde.

## Cómo revertir

Revertir el merge de la rama. No hay migración ni dato de producción tocado. Los
guardarraíles, si algo falla, dejan salir el turno como está (no derivan); el
reinicio por abandono solo actúa sobre un pedido de otro día ≥6 h inactivo.

## Pendiente relacionado

- Despacho **manual del mismo día** (el equipo cierra sin que el bot confirme):
  necesita una señal LIMPIA (marcar "despachado" en el CRM), no un heurístico de
  texto — decisión de producto abierta.
