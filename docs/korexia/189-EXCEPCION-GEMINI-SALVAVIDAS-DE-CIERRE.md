# 189 — Excepción autorizada: Gemini como salvavidas de cierre

21-sep-2026. **Decisión del dueño, tomada con conocimiento del choque.**
Este documento no reemplaza ni invalida
[156](156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md) — lo enmienda para
UN caso concreto, con evidencia nueva que doc 156 no tenía el 7-sep-2026.

## El choque, documentado explícitamente

Doc 156 auditó 10 incidentes reales y concluyó, por escrito:

> *"Ningún incidente de los 10 se explica por 'falta un orquestador que
> decida qué intención tiene el mensaje'... Se descartan explícitamente...
> multi-agente: ningún incidente de los 10 la necesita, y comparte el mismo
> defecto — alto riesgo de regresión, alta complejidad de migración, y
> ninguna evidencia de que resuelva una categoría de error que el patrón ya
> usado no resuelva igual de bien con muchísimo menos riesgo."*

Lo que se implementa en este documento —un segundo modelo que reinterpreta un
turno que el principal no resolvió— es, en su forma general, exactamente esa
alternativa (7, "Multi-agente") que doc 156 rechazó.

**La diferencia que justifica la excepción**: doc 156 no tenía el 21-sep-2026
evidencia de que el modelo PRINCIPAL en sí pudiera fallar por RAZONES DE
CALIDAD DEL MODELO en la categoría "confirmación" (fila "Alto riesgo" de su
propia sección 2.2). Esa evidencia llegó hoy: `openai/gpt-5-mini`, medido
contra las mismas 325 entradas que `google/gemini-3.7-flash`, cerró **0 de 6**
pedidos donde el cliente confirmó con frases coloquiales ("Listo", "Sip",
"Siii", "Si correcto") — ver
[specs/004-separacion-conversacion-transcripcion/spec.md §7](../../specs/004-separacion-conversacion-transcripcion/spec.md).
Doc 156 evaluaba si Korex necesitaba un orquestador para el flujo GENERAL con
el modelo que YA funcionaba bien (Gemini); no evaluaba qué hacer si se decide
cambiar a un modelo con una debilidad medida y específica.

## Decisión del dueño

Con el choque señalado y entendido, el dueño decide avanzar: **GPT-5 Mini
como principal, para el ahorro de costo, con Gemini como salvavidas acotado a
la recuperación de turno** — no una medición adicional, implementación
completa.

## Los principios que gobiernan esta arquitectura, fijados aquí

1. **GPT-5 Mini es el modelo conversacional principal.** Interpreta,
   redacta, decide la acción del contrato (`AgentAction`).
2. **Gemini 3.8 Flash es el salvavidas de recuperación de turno** — no un
   segundo modelo conversacional en paralelo. Solo entra cuando GPT-5 Mini no
   resolvió, nunca por preferencia de calidad.
3. **Gemini no reemplaza al backend como autoridad.** No decide precios,
   estados, disponibilidad ni condiciones comerciales — recibe esos hechos
   YA verificados por el backend, igual que GPT.
4. **Gemini no responde directamente al cliente como segundo cerebro
   independiente.** Cuando resuelve, el backend ejecuta y GPT-5 Mini redacta
   el mensaje final — Gemini nunca es la voz que llega al cliente en el flujo
   de recuperación semántica (sí lo es, sin este tercer salto, en el fallback
   puramente TÉCNICO — ver más abajo la distinción, porque ahí GPT nunca
   produjo nada que "comunicar").
5. **Máximo un fallback por turno.** Ni ciclos, ni reintentos encadenados.
6. **El detector de "cuándo" NO es una heurística sobre el texto de GPT.**
   Es la exigencia explícita de la tarea (sección 5: *"no reglas ingenuas...
   diseñar un detector explícito"*), y es la pieza donde doc 156 tiene razón
   en su advertencia: sin un hecho backend que respalde el detector, sería
   exactamente el "problema C" que causó el incidente 1 de esa auditoría
   ("inferencia confundida con confirmación"). Por eso el alcance de esta
   implementación es acotado a lo único que SÍ tiene una fuente
   backend-autoritativa hoy: **el pedido/cierre de `notify_order`**, usando
   la comprobación de "hoja completa" que ya vive en
   `puedeConfirmarPedido` (`orders/policy.ts`) — ítems resueltos, total
   calculado, mínimo cubierto, requisitos obligatorios completos. Ver
   `src/server/ai/recuperacion-de-turno.ts` para el detalle técnico y por qué
   NO se generaliza a "cualquier handoff" (eso sí sería la heurística que la
   propia tarea prohíbe).

## Qué queda explícitamente FUERA de esta excepción (versión original, 21-sep-2026 mañana)

- Citas (`book_appointment`/`reschedule`/`cancel`): no hay evidencia medida
  de que GPT-5 Mini falle ahí, y aunque existe un mecanismo análogo
  (`appointment_booking_confirmation`, doc 156 Fase 2-3), extender el
  salvavidas sin medición sería exactamente "generalizar antes de tener 3+
  casos reales" — el riesgo que doc 156 nombra en su sección 14.
- Cualquier "handoff evitable" que NO tenga detrás una hoja de pedido
  completa verificada por el backend. Para esos casos, un handoff sigue
  siendo un handoff legítimo, sin segundo intento.
- Lashes Valen (`catalog_source='prompt'`, sin `state_source=backend`): sin
  la señal backend, el detector no puede activarse ahí. Queda documentado
  como hallazgo, no resuelto por esta excepción.

## Adenda — 21-sep-2026, tarde: alcance ampliado a citas

El dueño pidió, explícitamente y con la decisión de arquitectura ya tomada
(no una medición adicional), generalizar el mecanismo a los cuatro casos de
la arquitectura ("intención conocida no resuelta", "handoff evitable",
"acción ejecutable no identificada", "cierre que el backend puede validar")
en vez de dejarlo acotado solo a `notify_order`.

**Lo que cambió**: los cuatro casos, en este código, son la MISMA condición
—hoja backend-completa, acción de cierre no elegida— aplicada ahora a DOS
acciones en vez de una:

| Acción de cierre | Autoridad backend reutilizada | Estado |
|---|---|---|
| `notify_order` (pedidos) | `puedeConfirmarPedido` | ya cubierto por la mañana |
| `book_appointment` (citas) | `puedeConfirmarCita` | **añadido aquí** |

**Lo que NO cambió, y sigue fuera a propósito** — porque generalizar más allá
sería exactamente la heurística sin respaldo backend que este documento
existe para evitar:

- `reschedule_appointment`/`cancel_appointment`: su Policy (doc 156, Fase 3)
  cubre idempotencia, no una noción de "¿está listo?" que invertir. No hay
  hecho backend que active el detector ahí.
- Cualquier handoff sin un pedido O una cita backend-completos detrás. Sigue
  siendo, siempre, legítimo.
- Lashes Valen: sigue sin señal backend, sin cambios.

El resto de los principios (1-6 de arriba) se aplican igual a ambas acciones:
Gemini solo emite el juicio de confirmación, nunca los datos; el backend
valida con la MISMA función que ya usaba para rechazar; GPT redacta el
mensaje final; máximo un fallback por turno, ahora enforced por un único
punto de entrada (`intentarRescatarTurno`) que prueba pedido y cita en
secuencia, nunca las dos.

**Modelo actualizado**: `OPENROUTER_FALLBACK_MODEL=google/gemini-3.8-flash`
(antes 3.7 — mismo precio, misma capacidad de audio/imagen; los 6 casos
medidos que motivaron todo esto se midieron contra 3.7, no 3.8. El mecanismo
es 100% configurable por variable de entorno, así que el cambio de versión
no tocó una sola línea de código).

## Vigencia

Esta excepción es válida mientras `openai/gpt-5-mini` sea el modelo principal
configurado. Si el modelo principal cambia a uno sin la debilidad medida de
confirmación (o si se demuestra que la debilidad no era del modelo sino de
otra causa), doc 156 vuelve a ser la referencia sin excepciones, y este
mecanismo puede desactivarse por configuración (ver rollback en
`specs/005-gemini-salvavidas-de-cierre/spec.md`).
