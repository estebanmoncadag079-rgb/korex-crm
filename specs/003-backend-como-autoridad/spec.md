# Feature Specification: El estado como autoridad y las operaciones cerradas (003-backend-como-autoridad)

**Feature Branch**: `003-backend-como-autoridad`

**Created**: 2026-09-15

**Status**: Draft — pendiente de aprobación del dueño

**Input**: Paso 2 del plan aprobado el 15-sep-2026. Aplicar el Principio 7 de
`REGLAS-DE-ARQUITECTURA.md` ("El backend es la autoridad") al pedido en curso y a la
reserva de cita: que el estado guardado decida, y que el modelo proponga operaciones
validadas en vez de reescribir el estado entero.

---

## Contexto

Korex atiende hoy a dos clientes de alto flujo con 10-15 fallos diarios. Los dos
síntomas que más cuestan son: un cliente que queda **a la mitad del pedido** porque el
agente mezcló o perdió datos, y un cliente que escribe algo trivial y **acaba derivado a
una persona**.

La causa está verificada en el código, no supuesta:

1. **El pedido no existe como dato.** Lo que se guarda al cerrar es `summary`, un texto
   libre que redacta el modelo (`actions.ts:109`, `schema.ts:305`). No hay tabla de
   pedidos con líneas.
2. **El estado que sí existe no manda.** `EstadoDelPedido` (`orders/estado.ts:154`) es
   deliberadamente no bloqueante, y el pipeline nunca lo consulta para decidir si
   ejecuta el cierre — auto-diagnosticado en `docs/korexia/156:102`.
3. **El modelo reconstruye, no modifica.** El esquema le pide "una entrada por CADA cosa
   que pida el cliente" (`pipeline.ts:4785`) y el backend reemplaza la hoja completa
   (`estado.ts:370`). Si el modelo omite un ítem al reescribir, el ítem desaparece —
   por eso existe el guardarraíl `producto-olvidado` (`anuncio-de-cierre.ts:283`).

Resultado: Korex funciona como *"el modelo decide, el backend corrige"*, con 24
guardarraíles releyendo con expresiones regulares lo que el modelo escribió.

**Precedente que gobierna este diseño:** las zonas de domicilio nunca entran al prompt y
se consultan (`prompts.ts:796-803`), y `offered_slot` impide agendar un horario que el
backend no ofreció. Las dos piezas cumplen el Principio 7 y **no producen incidentes de
su categoría**. Esta especificación extiende ese molde al estado del pedido y de la cita.

---

## Alcance

**Entra:** el pedido en curso (vertical de pedidos) y la reserva en curso (vertical de
citas) — quién tiene autoridad sobre ellos y cómo se modifican.

**No entra, a propósito:**

- Sacar los catálogos del prompt y crear `consultar_servicio` → Paso 3 del plan, sujeto
  a evidencia posterior.
- Reestructurar el conocimiento del negocio en campos → Paso 4.
- Retirar guardarraíles → Paso 5, y solo cuando el dato ya lo posea el backend.
- Cualquier capa de orquestación nueva. El pipeline sigue conduciendo el turno; se le
  quita responsabilidad, no se le añade una capa encima.
- Cambiar de modelo o tocar el tamaño del prompt.

**Restricción dura:** esta feature **no añade llamadas al modelo por turno**. Las
operaciones viajan en la misma llamada en la que hoy viaja el estado
(`chatJsonConEstado`, `pipeline.ts:4884`), sustituyéndolo.

---

## User Stories

### US1 — El estado guardado decide el cierre (P1)

Como dueño del negocio, quiero que un pedido solo se cierre cuando el backend verifica
—contra el estado que él mismo guarda— que está completo, y no cuando el modelo escribe
un párrafo que lo parece.

**Aceptación:**

1. La decisión de cerrar se toma leyendo el estado guardado: ítems resueltos contra el
   catálogo real, total calculado por el backend, y los requisitos que ese negocio
   declaró en su ficha. Nunca leyendo el texto que redactó el modelo.
2. Un intento de cierre con el estado incompleto **no se ejecuta**, y el backend
   devuelve qué falta. El cliente recibe la pregunta pendiente.
3. El resumen que le llega al equipo se compone **desde el estado**, no desde el texto
   del modelo. El párrafo del modelo pasa a ser el mensaje que lee una persona, no el
   registro del pedido.
4. Lo mismo para citas: una reserva solo se agenda si el backend tiene servicio
   resuelto, horario ofrecido por él, y los requisitos del negocio cubiertos.
5. La idempotencia actual se conserva intacta: `order_confirmation` y
   `appointment_booking_confirmation` siguen siendo la barrera contra el cierre
   duplicado.

### US2 — El modelo propone operaciones, no estados (P1)

Como operador, quiero que cuando un cliente cambie de opinión a mitad de conversación,
no se pierda nada de lo que ya había dicho.

El modelo deja de emitir el pedido completo y pasa a emitir **cero o más operaciones**
de un conjunto cerrado. El backend las aplica **en orden** sobre el estado guardado.

**Conjunto de operaciones.** Son los verbos que el núcleo ya tiene permitido conocer
según `REGLAS-DE-ARQUITECTURA.md` (catálogo, selección, datos, estado, confirmación), y
por eso sirven a cualquier negocio sin tocar el núcleo:

| Familia | Operaciones | Vertical |
|---|---|---|
| Selección | agregar ítem · cambiar cantidad · quitar ítem · elegir opción · declinar grupo opcional | pedidos |
| Datos | fijar dato de cierre · fijar modalidad de entrega | ambos |
| Reserva | fijar servicio · fijar horario ofrecido · fijar especialista | citas |
| Cierre | confirmar | ambos |

**No incluye `cancelar`, a propósito (corregido 16-sep-2026).** "Cancelar/empezar de
cero" ya existe en producción como mecanismo determinístico —
`matchesReinicio`/`borrarEstado`, por palabra clave configurable por negocio, corriendo
ANTES de llamar al modelo— precisamente para que un turno confuso nunca pueda arrastrar
un pedido que el cliente ya canceló. Esta feature no lo toca ni lo convierte en algo que
el modelo decida: ver `data-model.md` sección 1.

**Aceptación:**

1. Cada operación referencia **por nombre**, nunca por id — mismo patrón que ya usan
   `consultar_producto`, `consultar_medio_pago`, `consultar_domicilio` y
   `consult_availability`: el modelo escribe el nombre tal como lo dijo el cliente
   (o como lo ofreció el backend, para un horario), y el backend lo resuelve de nuevo
   contra datos reales en el momento de aplicar la operación — nunca contra un id que
   el modelo deba recordar de un turno anterior (corregido 15-sep-2026: la versión
   original de este criterio pedía justo lo contrario, un patrón que no existe en
   ningún resolvedor real del proyecto — ver `data-model.md` sección 1).
2. **Lo que no se menciona, no se toca.** Un turno que solo cambia la dirección no
   altera los ítems.
3. El modelo no puede emitir una operación que no esté en el conjunto: el contrato la
   rechaza.
4. El modelo no puede escribir un total, un precio ni una tarifa en ninguna operación.
   Esos valores los calcula el backend a partir del estado.
5. El guardarraíl `producto-olvidado` deja de dispararse en conversaciones reales.

### US3 — Toda operación pasa por tres compuertas (P1)

Como responsable de que no se registren pedidos imposibles, quiero que ninguna operación
toque el estado sin validarse antes.

**Aceptación:**

1. **¿Existe la operación?** Fuera del conjunto cerrado, se rechaza.
2. **¿Resuelven sus parámetros contra datos reales?** El producto, la opción, el
   servicio o el horario se resuelven contra el catálogo y la agenda reales, con los
   mismos buscadores que ya usan las consultas verificadas.
3. **¿El estado actual la permite?** Elegir una opción de un grupo que ese producto no
   tiene, o confirmar sin requisitos cubiertos, se rechaza.
4. Si **cualquiera** de las tres falla para una operación, esa operación no cambia el
   estado. Y a nivel del turno completo, **el lote es atómico**: si una operación de
   varias falla, **ninguna del lote se persiste**, ni siquiera las que sí pasaron sus
   propias tres compuertas antes que ella (decisión del 15-sep-2026, ver
   `data-model.md` sección 2 — se descartó la persistencia parcial por dejar al
   backend adivinando qué parte del mensaje el cliente quiso mantener). El backend
   devuelve el motivo del fallo en forma de dato, no de prosa.
5. El conjunto de operaciones y sus compuertas se pueden probar **sin encender el
   modelo**: entra un estado y una operación, sale un estado nuevo o un rechazo.

### US4 — Un rechazo se conversa, no se deriva (P1)

Como dueño, quiero que cuando el sistema no pueda hacer algo, el cliente reciba una
explicación y pueda seguir — no un "te comunico con una persona".

**Aceptación:**

1. El rechazo de una operación **nunca** produce una derivación automática. El motivo se
   le entrega al modelo para que lo explique con las palabras del negocio.
2. Un fallo de formato del proveedor tampoco deriva: se reintenta con el mecanismo
   existente, y si se agota, se responde algo seguro. Derivar sigue siendo una decisión
   del negocio (el cliente lo pide, o una regla del negocio lo exige), nunca la salida
   de un error técnico.
3. El caso medido en `docs/korexia/144` —"Hola, buenas noches" derivando el 71% de las
   veces— no vuelve a ocurrir.

---

## Qué NO cambia

- El prompt y su tamaño (Pasos 3 y 4 del plan).
- Las cuatro consultas verificadas (`consultar_producto`, `consultar_medio_pago`,
  `consultar_domicilio`, `consult_availability`) — se reutilizan tal cual, y son las que
  entregan los identificadores que usan las operaciones.
- `cola.ts`, la ingesta, el envío, la ventana de 24 h.
- Los 24 guardarraíles: **ninguno se retira en esta feature**. Se observan; su tasa de
  disparo es la métrica de éxito.
- Las acciones que no tocan el estado (`reply`, `send_image`, `send_menu`, `handoff`)
  conservan su contrato actual.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo emite operaciones incoherentes entre sí | Lote atómico: si una falla, no se persiste ninguna del lote (ni las previas que sí pasaron); se reintenta con el mecanismo de corrección ya existente |
| Un modelo económico maneja peor una lista de operaciones | Es menos exigente que reconstruir el pedido entero, pero **se mide** con los números del Paso 1 antes de extender a los dos clientes |
| Divergencia entre el estado y lo que el cliente cree | El resumen al cliente se compone desde el estado; si no cuadran, manda el estado |
| Regresión silenciosa al mover la decisión de cierre | La suite existente (2.075 pruebas, 32 de pipeline) corre antes y después de cada cambio |
| Que esto se convierta en un motor genérico de reglas | Prohibido por el alcance: es un conjunto cerrado y corto, una función por operación |

---

## Cómo se prueba

- **Sin modelo:** el conjunto de operaciones como funciones puras — estado + operación →
  estado o rechazo. Cubre las tres compuertas de US3.
- **Con el pipeline mockeado:** los casos de US1, US2 y US4, sumados a
  `tests/unit/pipeline-*.test.ts`.
- **Contra datos reales:** `pnpm probar:estado` (46 comprobaciones), `probar:escenarios`
  (24 clientes simulados), `probar:citas`.
- **Regla de `CLAUDE.md`:** cada queja nueva del dueño entra como escenario en
  `probar:escenarios` **antes** de arreglarse.
- Los tres números del Paso 1 (llamadas al modelo por turno, latencia, y proporción de
  decisiones con origen `llm` frente a `backend`), comparados antes y después.

## Cómo se revierte

Interruptor por organización, como todos los mecanismos de fase de este proyecto: al
apagarlo, esa organización vuelve al comportamiento actual sin migración de datos.

**Decisión del dueño (15-sep-2026): se activa en los 4 negocios y los 2 verticales
a la vez, sin fase de observación previa con uno solo.** Advertido el riesgo —el
precedente de MALIA (`auth/arquitectura.ts:6-12`), donde un interruptor mal alineado
en un solo cliente pasó semanas sin detectarse— y reafirmada la decisión, aplica el
criterio de "Corrections" del proyecto: se sigue tal cual, y se compensa con:

1. **La suite completa (`probar:estado`, `probar:escenarios`, `probar:citas`) corre
   contra los 4 negocios reales, en verde, ANTES de activar el interruptor en
   cualquiera.**
2. El apagado por organización se prueba explícitamente ANTES de activar nada — no
   basta con que exista el campo `state_source`/`catalog_source`: hay que confirmar
   que apagarlo en UNA organización no afecta a las otras tres mientras el resto
   sigue con el interruptor encendido.
3. Instrumentación de traza y guardarraíles queda **activa desde el primer minuto**
   en los 4 — es lo único que compensa no tener ventana de observación con uno solo.

---

## Decisiones (resueltas 15-sep-2026)

1. **Cliente de arranque: todos.** Los 4 negocios (La Churra, Lis, Lashes Valen,
   MALIA) reciben el cambio en el mismo despliegue.
2. **Los dos verticales a la vez.** Pedidos y citas se activan juntos, sin fase
   pedidos-primero.
3. **El resumen al equipo se deja como está.** Mismo formato de mensaje de WhatsApp
   que hoy; el cambio es de dónde salen las cifras (del estado, no del texto del
   modelo), no de cómo se ve el mensaje.
