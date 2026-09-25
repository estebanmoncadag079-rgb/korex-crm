# 193 — Supersesión: una sola respuesta por ráfaga (Bug 3)

25-sep-2026. Rama `010-supersesion-respuestas` (tras el merge de PR #17).

## Síntoma

El cliente escribe en ráfaga (varios mensajes seguidos) y el bot contesta **uno
por cada mensaje**: dos saludos ante "hola"+"buenas tardes", o tres respuestas
cuando manda dirección / nombre / teléfono en mensajes separados.

**Caso real (Tatiana, 17-sep, cv_tn9mz1kcqhd4zwjxuzae):**
```
15:52:48  cliente: calle 17a#46a81
15:52:50  cliente: San judas
15:52:51  cliente: Domicilio
15:52:52  cliente: No
15:53:01  cliente: Tatiana Miranda        (9 s después)
15:53:11  BOT: ¿San Judas I o II?         (turno 1: los 4 primeros)
15:53:19  BOT: Mucho gusto Tatiana, ¿San Judas I o II?   (turno 2: DUPLICADO)
```

## Causa (capa: orquestación)

El turno **marca su alcance** (`lastTurnInboundAt`) y arranca la llamada al
modelo tras solo **6 s** de silencio (`AGENT_COALESCE_MS`). El modelo tarda
15-30 s. Cualquier mensaje que llega **después de esos 6 s o mientras el modelo
piensa** cae en un **turno aparte** (la cola crea un `agent_job` nuevo porque el
actual está `corriendo`) y genera una segunda respuesta. El agrupado solo junta
lo que llega ANTES de arrancar; no cubre lo que llega durante la llamada.
Agrava: el primer mensaje salta el agrupado (`immediate`).

## Arreglo — supersesión

Justo antes de enviar, si hay entrantes nuevos sin responder
(`hayEntrantesNuevosDesde`, consulta fresca a la base porque el `history` del
turno es de ANTES de la llamada), esta respuesta ya nació incompleta → **no se
envía** (`debeSuprimirRespuesta`). El turno que la cola ya encoló para esos
mensajes contesta TODO junto, una sola vez, con el historial y el estado
completos.

- Solo se suprime un **`reply`**; las acciones con efecto (`notify_order`,
  `book_appointment`, `handoff`, `move_stage`…) **nunca** se suprimen.
- El **estado es acumulativo**: cada turno guarda las operaciones de SUS
  mensajes antes de suprimir; nada se pierde ni se aplica dos veces.
- **No corre en `is_test`** (el banco de escenarios y el Laboratorio ejecutan
  los turnos en serie: no hay mensajes concurrentes, así que la supersesión no
  aplica ahí).
- **No aumenta el costo:** la misma cantidad de turnos corre; solo se dejan de
  ENVIAR las respuestas redundantes. Termina cuando el cliente deja de escribir
  (el último turno no ve nada nuevo y sí envía); una red de seguridad re-encola
  para garantizar la respuesta.

## No es reproducible en `probar:escenarios`

Es un comportamiento de **concurrencia** (mensajes llegando durante la llamada
al modelo). El banco corre los turnos en serie, así que no puede simularlo. Se
cubre con:
- Unit test de la decisión pura (`debeSuprimirRespuesta`).
- La consulta `hayEntrantesNuevosDesde` (comparación directa de `created_at`).
- La suite completa en verde (el enganche no rompe ningún turno existente).

## Cómo revertir

Revertir el merge de la rama. El único cambio de comportamiento es que un `reply`
no se envía cuando ya hay mensajes nuevos sin contestar; sin él, se vuelve a las
respuestas duplicadas. Ningún dato de producción se toca.
