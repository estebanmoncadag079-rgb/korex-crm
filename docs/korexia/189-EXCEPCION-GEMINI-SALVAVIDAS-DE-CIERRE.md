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
- ~~Lashes Valen (`catalog_source='prompt'`, sin `state_source=backend`): sin
  la señal backend, el detector no puede activarse ahí. Queda documentado
  como hallazgo, no resuelto por esta excepción.~~ **Corregido en la segunda
  Adenda, más abajo: esta afirmación es falsa.** `catalog_source='prompt'`
  es el valor *esperado y correcto* para el vertical `citas`
  (`server/auth/arquitectura.ts`) — no una señal de que falte autoridad
  backend. Lashes Valen sí tiene `state_source=backend`. Se deja tachado, no
  borrado, para que quede constancia del error.

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
- ~~Lashes Valen: sigue sin señal backend, sin cambios.~~ **Falso — ver la
  segunda Adenda.** Lashes Valen SÍ tiene `state_source=backend` (es el
  valor aprobado para `citas`), y el salvavidas de citas SÍ puede activarse
  ahí si su hoja está completa.

El resto de los principios (1-6 de arriba) se aplican igual a ambas acciones:
Gemini solo emite el juicio de confirmación, nunca los datos; el backend
valida con la MISMA función que ya usaba para rechazar; GPT redacta el
mensaje final; máximo un fallback por turno, ahora enforced por un único
punto de entrada (`intentarRescatarTurno`) que prueba pedido y cita en
secuencia, nunca las dos.

**Modelo, en esta versión**: `OPENROUTER_FALLBACK_MODEL=google/gemini-3.8-flash`
(antes 3.7 — mismo precio, misma capacidad de audio/imagen; los 6 casos
medidos que motivaron todo esto se midieron contra 3.7, no 3.8). **Esta
variable se separó en la tercera Adenda** — ver más abajo.

## Adenda — 21-sep-2026, tarde/noche: auditoría independiente y tres correcciones

Auditoría independiente del commit `26bf657` (el que contiene las dos
Adendas de arriba), con veredicto **REQUIERE CORRECCIÓN**. Tres hallazgos
reales, verificados contra el código y contra producción (solo lectura), y
las tres correcciones aplicadas — sin ampliar el mecanismo más allá de lo ya
descrito, sin tocar doc 156.

### Hallazgo 1 — la acción rescatada tenía MENOS validación que un cierre normal

El enganche en `pipeline.ts` vivía DESPUÉS de dos guardarraíles de texto que
solo se evaluaban cuando `action.action === "notify_order"` **en ese punto
del código**: `inconsistenciaFinancieraDePedido` (candado del incidente de
Kachipay: `deliveryFeeCents` debe cuadrar con la tarifa verificada) y
`bloqueDeDomicilioPendiente` (avisa cuando el domicilio aún no tiene tarifa
confirmada). Como el rescate convertía la acción a `notify_order` **después**
de que esos dos ya se habían evaluado (y no habían hecho nada, porque en ese
momento la acción todavía no era `notify_order`), un cierre rescatado nunca
pasaba por ellos.

**Corrección**: se movió el bloque completo del salvavidas a ANTES del primer
`if (action.action === "notify_order")` del pipeline (que es donde viven
esos dos candados) y DESPUÉS de los guardarraíles que no dependen de si la
acción es un cierre (disponibilidad, producto, domicilio contradicho). Cero
lógica duplicada: son los mismos `if` de siempre, ahora viendo también el
caso rescatado, porque el rescate ocurre antes en la secuencia. Ver el
comentario en `pipeline.ts` en el nuevo punto de enganche para el detalle
completo.

**Hallazgo relacionado, no corregido (fuera del alcance de esta corrección)**:
el rescate de PEDIDO no puebla `deliveryFeeCents` — construye
`subtotalCents`/`totalCents` como el mismo número
(`estadoGuardado.totalCents`, que es la suma de los ítems, sin domicilio).
Con esto, `bloqueDeDomicilioPendiente` ahora sí corre, pero un domicilio YA
verificado con tarifa distinta de cero no se refleja en los montos
estructurados del cierre rescatado. Es un hallazgo de la auditoría, anotado
aquí para que no se pierda — no se resolvió porque el encargo pidió
únicamente enrutar por los guardarraíles existentes, no rediseñar el cálculo
de montos.

### Hallazgo 2 — `OPENROUTER_FALLBACK_MODEL` compartía responsabilidad con más de 30 sitios ajenos

Cambiar esa variable para ajustar el salvavidas semántico cambiaba, sin
aviso, el fallback TÉCNICO de `chatJson` en más de 30 llamadas de
`pipeline.ts`, más `aprendizaje.ts` (el análisis de aprendizaje del agente) y
`lab/judge.ts` (el juez del Laboratorio).

**Corrección**: variable propia, `OPENROUTER_RECOVERY_MODEL`. La lee
únicamente `modeloDeRescate()` (`lib/ai/modelos.ts`), y ningún otro
consumidor del proyecto la conoce — verificado por grep, no solo por diseño.
`OPENROUTER_FALLBACK_MODEL` conserva exclusivamente su responsabilidad de
siempre. Sin caída automática de una variable a la otra: si
`OPENROUTER_RECOVERY_MODEL` falta, el salvavidas semántico queda apagado,
punto — no se reacopla por la puerta de atrás leyendo la otra variable.

Efecto colateral positivo, no buscado: la ineficiencia detectada en la
implementación original (una llamada fallida a Gemini se reintentaba 6 veces
en vez de 3, porque el modelo pedido explícitamente coincidía con el
"siguiente salvavidas" de su propia cadena técnica) desaparece por
construcción: ahora, salvo que alguien configure las dos variables con el
mismo valor a propósito, no hay coincidencia que duplicar.

### Hallazgo 3 — esta misma documentación afirmaba algo falso sobre Lashes Valen

Verificado contra `server/auth/arquitectura.ts` y contra producción (solo
lectura, vía el túnel): para el vertical `citas`, `stateSource: {esperado:
"backend"}` es la arquitectura APROBADA — no un extra. `catalog_source
='prompt'` en citas es el valor esperado y correcto (los servicios de citas
viven en `resourceService`/`service`, no en el catálogo de pedidos), nunca
una señal de que falte autoridad backend. Lashes Valen tiene
`state_source=backend`, confirmado en la auditoría de arquitectura
(🟢 alineada), y tiene 66 estados reales con `reserva.fecha` poblada.

**El salvavidas de citas SÍ puede activarse para Lashes Valen** cuando su
hoja de reserva esté completa y el modelo no llame a `book_appointment`. Las
dos afirmaciones contrarias, arriba en este documento, quedan tachadas —no
borradas— para que el error quede a la vista.

**Lo que NO cambia por esto**: el alcance del mecanismo sigue siendo
exactamente el descrito (pedidos vía `puedeConfirmarPedido`, citas vía
`puedeConfirmarCita`, nada más). Lo único que cambió es a CUÁLES
organizaciones les aplica — y siempre les aplicó a las que cumplen la
condición real, esta documentación simplemente lo describía mal.

## Vigencia

Esta excepción es válida mientras `openai/gpt-5-mini` sea el modelo principal
configurado. Si el modelo principal cambia a uno sin la debilidad medida de
confirmación (o si se demuestra que la debilidad no era del modelo sino de
otra causa), doc 156 vuelve a ser la referencia sin excepciones, y este
mecanismo puede desactivarse por configuración (ver rollback en
`specs/005-gemini-salvavidas-de-cierre/spec.md`).
