# 197 — PENDIENTE: el pedido siempre avanza hasta cerrarse

Estado: **aparcado por decisión del dueño (25-sep-2026)**. En las demás
conversaciones el bot avanza bien; se retoma si vuelve a aparecer.

## El caso

MALIA, `cv_zjqnven23xp2i6jiwd05`, 16:26 (Bogotá): el cliente mandó
"esteban , 3155136091" y el bot contestó "Perfecto Esteban, ya lo anoté 🙂" sin
pedir la dirección que faltaba. El cliente tuvo que escribir "gracias" para que
siguiera.

## Causa (anclada a código)

El detector de "turno sin avance" (`turnoSinAvance`, doc 196) solo actúa con la
hoja del pedido LISTA (`hojaListaParaResumen`). A mitad del pedido nada vigila
un mensaje que no pide nada.

## Diseño ya escrito y probado en unidad (sin desplegar)

- `pedidoAbierto(estado)`: con productos y sin confirmar.
- A mitad del pedido, si el mensaje no trae resumen ni pregunta: se rehace con
  `correccionDeTurnoSinAvance(loQueFalta(...))`; si insiste, el backend agrega
  `preguntaDeLoQueFalta(falta)`.
- No actúa si el barrio está pendiente (lo cubre `faltaPedirElBarrio`).

El código está en `197-pedido-siempre-avanza.patch` (aplicable sobre `68c0a3f`)
y su prueba en `197-pedido-siempre-avanza.test.ts.txt`. Faltaba: suite completa,
escenario real del caso Esteban, doc y deploy.

⚠️ Antes de retomarlo: revisar que siga siendo el backend decidiendo sobre el
ESTADO (lo que falta), no interpretando al cliente (doc 198).
