# 151 — Contexto temporal en el historial (evita heredar intención antigua)

27/28-ago-2026.

## Causa aplicada

El historial que ve el modelo (`toChatHistory`, `src/server/ai/pipeline.ts`)
no llevaba ninguna marca de tiempo entre mensajes. Cuando una conversación
se reactiva después de una pausa larga, ahora se inserta un mensaje de
sistema entre el último mensaje viejo y el primero nuevo:

```
[SISTEMA] Pasaron 11 días sin mensajes en esta conversación. Trata lo que
sigue como una interacción NUEVA: no asumas que continúa un pedido, una
cita o un motivo de escalar de antes de la pausa, salvo que el cliente lo
diga.
```

Va como `role: "user"` (nunca como si lo dijera el cliente ni como mensaje
`system` suelto al final) — mismo patrón que ya usan los hechos verificados
de disponibilidad/producto/pago inyectados a mitad de turno, así se evita el
problema ya documentado de Gemini con mensajes de rol `system` al final sin
un turno de usuario después.

**No es una regla rígida.** Solo avisa que hubo una pausa larga y pide no
asumir continuidad — el modelo sigue libre de conectar el mensaje nuevo con
lo anterior si el propio cliente lo dice explícitamente ("Hola, ¿ya llegó mi
pedido?"). No existe ninguna regla tipo `"Hola" = siempre conversación
nueva`.

## Umbral: 24 horas — reutilizado, no inventado

Se usa `WINDOW_MS` (`src/server/inbox/window.ts`), la ventana de servicio de
24h de WhatsApp que el propio sistema ya usa para decidir si se puede mandar
texto libre sin plantilla. No es un número elegido para este caso: es la
misma frontera que WhatsApp le impone al negocio — pasadas 24h sin que el
cliente escriba, WhatsApp mismo ya no deja responder con texto libre. Por
eso es la frontera natural entre "la misma conversación" y "una nueva".

- **Por debajo de 24h** (una pausa de horas dentro del mismo día, alguien
  que responde después de salir a almorzar): sin marcador, tratado como
  continuidad — es el silencio normal de cualquier chat.
- **En 24h o más**: aparece el marcador.

Un caso real de "pedido reciente con pausa corta" (ej. 20 minutos después de
confirmar un pedido) queda muy por debajo del umbral: el contexto se
mantiene intacto, tal como debe ser.

## Archivos modificados

- `src/server/ai/pipeline.ts`:
  - `toChatHistory` ahora acepta `createdAt?: Date` por mensaje (opcional —
    sin él, el comportamiento es idéntico al de siempre) e inserta el
    marcador cuando el salto entre dos mensajes consecutivos con texto llega
    al umbral.
  - Nueva `mayorSaltoDeHistorial(history)`: el mayor salto (en días) del
    historial de este turno, o `null`. Solo para la traza — nunca decide
    nada del turno.
  - `runAgentTurn` calcula ese salto y lo anota en la traza justo donde ya
    se crea (`crearTraza`), antes de la primera llamada al modelo.
- `src/server/ai/traza.ts`:
  - Campo nuevo `historialSaltoDias: number | null` en `TrazaDelTurno`.
  - Categoría nueva `"history_gap"` en `CategoriaDeTraza`.
  - Nueva `registrarSaltoDeHistorial(t, dias)`.
  - La línea `[traza]` ahora incluye `historial_salto=no` o `historial_saltoNd`
    (ej. `historial_salto=11d`) — nunca el texto de los mensajes.

Nada de esto tocó `consult_availability`, `conducta.ts`, `generar.ts`, el
prompt maestro, la lógica de productos/pagos, ni ninguna ficha de negocio.

## Pruebas

- `tests/unit/salto-de-historial.test.ts` (13 casos): sin ruptura, pausa de
  4h (por debajo del umbral, sin marcador), ruptura de 11 días (con
  marcador, en la posición correcta), pedido reciente con pausa corta,
  umbral exacto (24h marca, un milisegundo antes no), retrocompatibilidad
  total sin `createdAt` (20 mensajes, mismo límite/orden/roles de siempre),
  y que la curación de cierre falso / mensajes de una persona del negocio
  sigue intacta.
- `tests/unit/pipeline-salto-de-historial.test.ts` (2 casos): reproduce el
  incidente real de extremo a extremo contra `runAgentTurn` — confirma que
  el `[SISTEMA]` de ruptura llega de verdad a la llamada real del modelo, en
  la posición correcta, y que la traza queda `historial_salto=11d`; y que
  sin ruptura no aparece nada.
- Suite completa: **1137 pruebas en verde, cero fallos, cero regresiones**
  (incluye toda la familia de citas, disponibilidad, y verificación factual
  de producto/pago intacta). `tsc --noEmit` y `eslint` limpios.

## Prueba controlada real: antes vs. ahora

Reproducido contra la base real de Lis Pastelería (conversación de prueba
`is_test=true`, nunca tocó WhatsApp), con el historial exacto del pedido
cerrado de Laura Stefanny retro-fechado 11 días, seguido de un "Hola" real
contra el LLM real:

**ANTES** (el incidente real, sin este cambio):

```
Hola → [contexto: pedido reciente, sin marca de tiempo] →
"¡Hola! Te comunico con alguien del equipo para verificar el estado de tu pedido 😊💗"
```

**AHORA** (mismo historial, con el cambio):

```
[traza] ... historial_salto=11d ... categorias=history_gap|... accion=send_menu ...
AGENTE: ¿Cómo te ayudo hoy?
• 🛍️ Ver menú y precios
• 📦 Hacer un pedido
• ❓ Preguntas frecuentes
• Hablar con un asesor

handoffReason=(ninguno)  handoffAt=(ninguno)
```

El bot saluda con normalidad, no asume que hay un pedido en curso y no
promete transferir a nadie — exactamente el comportamiento esperado.

## Hallazgo separado — promesa de handoff sin handoff real (NO corregido en esta tarea)

Durante la investigación del incidente de Laura Stefanny (Lis Pastelería,
27-ago-2026: un "Hola" tras 11 días de silencio, respondido con "te comunico
con alguien del equipo") se confirmó que el turno original ejecutó `reply`
(no `handoff`): el texto
prometía "te comunico con alguien del equipo", pero `handoffAt`/`aiEnabled`
nunca cambiaron en ese momento — la IA seguía técnicamente activa. Punto
exacto: `src/server/ai/pipeline.ts`, el `case "reply":` del switch de
ejecución (~línea 2000) simplemente entrega `action.text` tal cual con
`deliverReply`, sin ninguna verificación de que el TEXTO de una respuesta
normal no esté prometiendo una transferencia que la ACCIÓN no ejecutó.

Se confirmó que **no existe ningún guardarraíl hoy** que detecte frases de
transferencia humana dentro de una acción `reply` (se revisó
`handoff-policy.ts`: solo cubre lo contrario — reconocer cuándo un cliente
pide volver a hablar con el bot tras un handoff ya hecho, o cuándo reanudar
por inactividad — nada sobre validar el contenido de un `reply`). Queda
como hallazgo para una fase separada, sin modificarlo aquí.
