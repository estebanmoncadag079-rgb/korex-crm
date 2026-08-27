# 149 — Confirmación por servicio antes de `book_appointment`

27-ago-2026.

## El incidente real

Lashes Valen, conversación con "Lau", 26/27-ago-2026. La clienta pidió una
visita de dos servicios ("manos y pies"):

```
BOT: ¡Te entiendo perfecto, hermosa! El Baño de acrílico o poligel ($85.000)
     es ideal... ¿Nos vamos con ese para tus manos? Y para los pies, ¿te
     gustaría tradicional ($20.000) o semipermanente ($45.000)?
CLIENTA: Sii tradicional
BOT: [ofrece horarios con Geimar]
CLIENTA: 9:30 porfa
BOT: ✅ Quedaste agendada: Baño de acrílico o poligel + Tradicionales...
```

Esteban preguntó por qué se agendaron los dos servicios cuando la clienta
"solo confirmó uno". **No es necesariamente una mala interpretación**: "Sii
tradicional" contesta razonablemente las dos preguntas de la misma frase del
bot ("Sii" → manos, "tradicional" → pies), y en una reproducción de sandbox
el modelo sí vuelve a preguntar cuando su propia pregunta previa no ata tan
claramente cada servicio a una parte del cuerpo. El punto real, confirmado al
auditar, es estructural: **no existía ninguna verificación independiente de
que cada servicio de una visita múltiple hubiera pasado por una consulta de
disponibilidad real antes de agendarlo** — todo dependía de que el modelo
recordara bien su propia conversación.

## Por qué NO se usó `conversation_state` (Fase 2)

El campo obvio para "¿qué servicios están resueltos?" parecía ser
`items[].ofrecible.id` de `server/orders/estado.ts` — el mismo sistema que ya
calcula `confirmado`/`items`/`reserva` para las 3 organizaciones reales, con
un chequeo genérico ya escrito: *"confirmado sin producto resuelto"* si algún
ítem no tiene `ofrecible.id`.

Se descartó a propósito. `pipeline.ts` es explícito sobre esto:

> "Se hace DESPUÉS de la respuesta y FUERA de su camino: si la propuesta no
> vale, se registra y se descarta, pero el cliente ya tiene su contestación.
> **Un estado que no valida no puede convertirse en un turno perdido.**"

Ese es un principio de diseño ya establecido y deliberado: la Fase 2 calcula
y registra para diagnóstico, pero **nunca bloquea un turno real** — así se
protege de que un fallo de extracción (una llamada aparte a un modelo más
barato, con su propia tasa de error) tumbe una reserva que sí era válida.
Usarlo como candado para `book_appointment` habría invertido esa garantía
para las tres organizaciones reales a la vez — exactamente el tipo de
rediseño que este trabajo tenía prohibido.

(De paso: el comentario del código que dice "hoy los cuatro clientes están en
`state_source='prompt'`" está desactualizado — los tres clientes reales ya
están en `'backend'`. No cambia la conclusión de arriba, solo confirma que el
sistema de verdad corre hoy, calculando pero sin bloquear nada.)

## El mecanismo usado: `offered_slot`, extendido

El único mecanismo estructurado que **sí es bloqueante hoy** para citas es
`offered_slot` (`estaEntreLosOfrecidos`): solo se agenda un horario que el
agente haya ofrecido realmente, para no dejar que una fecha relativa mal
entendida ("el miércoles") caiga por casualidad en un hueco libre.

Ese mecanismo ya sabe resolver una visita de varios servicios juntos —
`resolverConsultaDisponibilidad` calcula la disponibilidad de la combinación
completa (`serviceIds`, el arreglo entero) — pero al guardar lo ofrecido solo
anotaba el **primer** servicio (`serviceIds[0]!`), no la combinación
completa. Es decir: el sistema ya sabía qué combinación se había consultado
junta, simplemente no la recordaba entera.

Se extendió, sin crear ninguna fuente de estado nueva ni tocar la lógica de
decisión de `consult_availability`:

- `registrarOfrecidos` pasa de `serviceId: string` a `serviceIds: string[]` —
  guarda una fila por cada combinación (horario × servicio) en vez de una
  fila por horario con un solo servicio.
- Nueva `serviciosOfrecidosPara(organizationId, conversationId, fecha, hora)`
  devuelve los servicios (ids distintos) registrados para ese horario exacto.
- `anotarOfrecidos` (dentro de `resolverConsultaDisponibilidad`) ahora le pasa
  el arreglo completo en vez de solo el primero — es el único cambio dentro de
  esa función; su lógica de decisión, sus guardarraíles y su contrato de
  prompt quedan intactos.
- `book_appointment`, justo después de que `estaEntreLosOfrecidos` confirma
  que el horario es real, y **solo cuando la visita tiene más de un
  servicio**, compara la combinación que intenta agendar contra la que
  `serviciosOfrecidosPara` tiene registrada para ese horario exacto. Si algún
  servicio pedido no está en la lista consultada, bloquea esa reserva
  (mismo mecanismo de `fallidas` que ya usan "no atiende esa combinación" o
  "no encontré ese servicio"), nombra el servicio sin corroborar en la
  respuesta, y le indica al modelo que vuelva a `consult_availability` con
  todos los servicios juntos.
- Si no hay nada registrado para ese horario (el cliente dio fecha/hora
  directa sin pasar por una consulta), es **permisivo** — mismo criterio que
  ya usa `estaEntreLosOfrecidos`: no se bloquea lo que no se puede corroborar.
- Una visita de un solo servicio nunca entra a este chequeo: cero cambio de
  comportamiento, cero riesgo de regresión.

## Qué SÍ resuelve y qué NO

Resuelve una inconsistencia real y detectable sin leer texto libre: el modelo
consulta disponibilidad para un servicio, y más tarde intenta agendar uno
adicional que nunca pasó por esa consulta — el horario, la duración y la
disponibilidad de la especialista para la combinación completa nunca se
verificaron contra la base real.

**No reinterpreta lenguaje natural.** Si el modelo, como en el incidente
real, decide (bien o mal) incluir ambos servicios desde el momento en que
llama a `consult_availability`, ambos quedan registrados juntos desde ahí, y
el chequeo pasa limpio — porque en ese punto los dos SÍ se consultaron contra
la base real. Este guardarraíl no decide si "Sii tradicional" significaba una
cosa u otra; decide si lo que finalmente se agenda es consistente con lo que
realmente se comprobó.

## Limitación conocida en la traza

El `[traza]` de un turno se emite una sola vez, en un punto único justo antes
de ejecutar la acción final (por seguridad ante caídas — docs/korexia/145).
El nuevo guardarraíl se decide DENTRO de la ejecución de `book_appointment`,
después de ese punto, así que su resultado **no queda reflejado en la línea
`[traza]` del turno** (aparece `guardarrailes=-` aunque haya bloqueado algo).
Su evidencia en vivo es un `console.warn` con prefijo `[citas]`, en el mismo
estilo que ya usa el rechazo de horario no ofrecido, con el detalle de qué se
pidió, qué sí se corroboró y cuál servicio falta. `agregarGuardarrail` igual
anota la decisión en el objeto de traza en memoria, por consistencia, aunque
esa anotación no llegue a imprimirse en la línea de ese turno.

## Pruebas

- `tests/unit/citas-solo-lo-ofrecido.test.ts` — extendido: `registrarOfrecidos`
  guarda una fila por combinación, `serviciosOfrecidosPara` devuelve ids
  distintos y vacío cuando no hay registro.
- `tests/unit/pipeline-servicio-no-corroborado.test.ts` (nuevo, 6 casos):
  un solo servicio (sin cambio), dos servicios consultados juntos (agenda),
  el caso del incidente real mockeado a nivel de lo ya consultado (agenda),
  servicio pendiente (bloquea y lo nombra), servicio nunca consultado
  (bloquea), y el caso permisivo sin registro previo.
- `tests/unit/pipeline-traza-del-turno.test.ts` — Escenario 8: confirma que el
  turno sí deja traza aunque el guardarraíl específico no aparezca en ella
  (limitación de arriba, documentada también ahí).

1125 pruebas en verde, cero regresiones (suite completa, incluyendo toda la
familia de citas y disponibilidad).
