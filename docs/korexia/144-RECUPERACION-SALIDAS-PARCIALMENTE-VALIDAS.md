# 144 — Recuperación de salidas parcialmente válidas del LLM

26-ago-2026.

## El hallazgo que lo motiva

El diagnóstico del [143](143-VERIFICACION-FACTUAL-FORZADA.md) encontró que
"Hola, buenas noches" escalaba a una persona el 71% de las veces contra Lis,
con `handoffReason='error'`. La causa: el modelo elegía correctamente
`send_menu` (el menú de apertura) pero omitía intermitentemente el campo
`reply` — un campo AUXILIAR, no el corazón de la acción — y el validador de
esquema rechazaba la acción entera. El pipeline trataba eso exactamente
igual que un proveedor caído: derivar a una persona.

No era un problema de reglas de negocio ni de escalado: era que el
contrato con el LLM no distinguía "el modelo entendió mal la intención" de
"el modelo acertó la acción pero olvidó un detalle recuperable".

## Auditoría: ¿es un problema aislado o un síntoma general?

Se revisaron las doce acciones de `AgentAction` (`actions.ts`) separando
qué campo es el CORAZÓN de cada una (sin él no hay nada que ejecutar, y no
hay dato real para inventarlo) de qué campo es AUXILIAR (acompaña a la
acción, y puede tener un valor de respaldo seguro sin fabricar contenido
del negocio):

| Acción | Campo(s) corazón | Campo auxiliar con fallback ya existente |
|---|---|---|
| `reply` | `text` | — |
| `send_image` | `etiqueta`/`label` (uno de los dos) | `reply` (ya opcional) |
| `send_menu` | `tipo` | **`reply`** — sin fallback disponible hasta ahora |
| `notify_order` | `summary` | `farewell` (ya opcional) |
| `move_stage` | `stage` (ya degrada solo, `degradeAction`) | `reply` (ya opcional) |
| `consultar_producto`/`consultar_medio_pago` | `consulta`/`metodo` | — (acciones internas) |
| `consult_availability`/`book_appointment`/`reschedule_appointment`/`cancel_appointment` | servicios/fecha/hora | `farewell`/`especialista` (ya opcionales) |

`send_menu.reply` resultó ser el ÚNICO caso real: un campo auxiliar
marcado como obligatorio en el esquema (`superRefine`, agregado el
25-ago-2026 pensando en el turno mudo) que SÍ tenía un dato de respaldo
real disponible — solo que nunca llegaba a usarse, porque Zod rechazaba la
acción antes de que ese respaldo entrara en juego. El resto de los campos
"obligatorios" son corazón de su acción (sin fallback razonable posible) o
ya eran opcionales de fábrica.

## La causa exacta: dos caminos de validación, uno sin red de reintentos

`chatJson` (`lib/ai/index.ts`) ya reintenta hasta 3 veces cuando la
respuesta no cumple el esquema que se le pasó. Pero Lis tiene la Fase 2
encendida (`state_source='backend'`), y ese camino usa
`chatJsonConEstado`: llama a `chatJson` con un esquema **laxo**
(`passthrough`, acepta cualquier cosa) para poder pedir también el estado
del pedido en la misma respuesta, y **valida `AgentAction` de verdad
DESPUÉS**, una capa más arriba. `chatJson` nunca ve el error real — desde
su punto de vista todo salió bien — así que sus 3 reintentos nunca se
activan para este caso. El rechazo posterior no tenía ninguna red debajo:
fallaba a la primera.

Esto explica por qué el 71% observado es tan alto: no es solo "el modelo
omite `reply` a veces" — es que, para Lis específicamente, esa omisión
nunca tenía una segunda oportunidad.

## La solución: tres niveles, todo reutilizando lo que ya existía

**Nivel 1 — Normalización determinista (`actions.ts`)**: se quitó la
regla de `superRefine` que exigía `reply` para `send_menu`. Es seguro
porque el dato YA tenía fallback en cada uno de sus usos reales, escrito
desde el 25-ago y nunca alcanzado en la práctica:
- `armarMenuDeIntenciones(opciones, body = "¿Cómo te ayudo hoy?")`
- `armarMenuDeCatalogo(productos, body = "Nuestro menú 🍰")`
- `armarMenuDeCategorias(productos, body = "¿Qué te gustaría ver?")`
- `armarMenuDeCategoria(productos, categoria, body ?? "Esto tenemos en ${categoria}:")`
- `pipeline.ts`, camino de degradación: `action.reply ?? "¿En qué te puedo ayudar?"`

Ninguno inventa nada del negocio: son textos neutrales o compuestos con
datos reales ya conocidos (el nombre de la categoría). `reply` sigue
siendo información real cuando el modelo la da — solo dejó de ser
obligatoria cuando no la da.

**Nivel 2 — Regeneración acotada (`pipeline.ts` + `lib/ai/index.ts`)**:
para el resto de campos (los que SÍ son corazón de su acción, sin
fallback posible), dos mejoras que reutilizan mecanismos ya existentes:

- `chatJsonConEstado` ahora reintenta **una sola vez**, sin estado, con un
  mensaje que incluye el detalle exacto de Zod ("acción X no cumplió: campo
  Y, motivo Z. Repite la MISMA acción corrigiendo solo eso"), cuando antes
  no reintentaba nada. Es el mismo patrón que ya usa el resto de
  `pipeline.ts` (cierre falso, disponibilidad sin verificar, pago sin
  verificar): un reintento acotado con un mensaje de corrección, nunca un
  loop.
- El mensaje de reintento **dentro de `chatJson`** (los 3 intentos que ya
  existían) dejó de ser genérico ("no fue JSON válido") y ahora lleva el
  mismo detalle específico de Zod — mejora la tasa de éxito de una red que
  ya existía, sin agregar ningún intento nuevo.

**Nivel 3 — Fallback seguro (sin tocar)**: si tras el Nivel 2 la acción
sigue sin cumplir el contrato, se cae exactamente al mismo
`derivarAUnaPersona` / `handoff reason='error'` de siempre. El log ahora
distingue la causa (`invalid_output` vs `provider_error` vs
`not_configured`) para quien lea el error — `handoffReason` en el CRM
sigue siendo `"error"` sin cambios, para no romper nada que ya cuente por
ese valor.

## Archivos modificados

- `src/server/ai/actions.ts` — se quita el `superRefine` de
  `send_menu.reply` (el de `send_image` etiqueta/label se conserva:
  campo corazón, sin fallback real posible).
- `src/server/ai/pipeline.ts` — el reintento acotado en
  `chatJsonConEstado`; el comentario del camino de degradación de
  `send_menu` actualizado; el log de `runAgentTurn` distingue la causa del
  fallo final.
- `src/lib/ai/index.ts` — el mensaje de reintento usa el detalle real de
  Zod en vez de un texto genérico.
- `tests/unit/send-menu-sin-reply.test.ts` — reescrito: `send_menu` sin
  `reply` ahora es una acción VÁLIDA (antes probaba lo contrario).
- `tests/unit/recuperacion-salida-parcial.test.ts` (nuevo) — los 8 casos
  de esta ronda.

## Pruebas

**Automatizadas**: 7 pruebas nuevas de integración (`send_menu` con/sin
`reply`, reintento exitoso sobre un campo corazón faltante, reintento que
también falla → handoff con el límite respetado, acción desconocida, error
real del proveedor, regresión de la verificación factual del [143](143-VERIFICACION-FACTUAL-FORZADA.md)
con Fase 2 encendida), más 4 pruebas reescritas de `send_menu`. `tsc
--noEmit` y `eslint` limpios. Suite completa: **1075 pruebas, 0 fallos**,
sin regresiones sobre `consult_availability` ni el resto del vertical de
citas.

**Controlada, contra la base real de Lis** (mismo mecanismo que 142/143):
"Hola, buenas noches" repetido **8 de 8 veces sin handoff** — todas
ejecutaron `send_menu` con el texto de respaldo "¿Cómo te ayudo hoy?"
(confirma que el modelo, sin la presión del esquema, de hecho sigue
omitiendo `reply` para esta acción casi siempre — y ahora eso ya no
importa). `consultar_producto` y `consultar_medio_pago` se reconfirmaron
funcionando sin cambios sobre el mismo código.

## Veredicto

**Una respuesta parcialmente válida del LLM ya NO puede causar handoff por
sí sola cuando el campo faltante es auxiliar con fallback conocido
(`send_menu.reply`, el único caso real encontrado).** Para un campo
CORAZÓN de la acción (`reply.text`, `notify_order.summary`,
`consult_availability.servicios`, etc.) sigue existiendo la posibilidad de
handoff — y debe seguir existiendo: no hay ningún dato real con el que
completar "qué le quiso decir al cliente" o "qué servicio pidió" sin
inventarlo, y eso sí sería el problema que el guardarraíl de esta sesión
existe para evitar en otro sentido (el LLM no debe decidir hechos que el
backend no puede verificar). Lo que cambió es que ahora ese caso pasa por
un reintento con la corrección exacta antes de rendirse — antes no pasaba
por ninguno en el camino de Lis.

## Lo que NO cambió (preservado a propósito)

- La verificación factual forzada del 143: sin cambios, reconfirmada con
  Fase 2 encendida.
- `consult_availability` y el vertical de citas: cero líneas tocadas.
- `send_image` sigue exigiendo `etiqueta` o `label`: es el corazón de esa
  acción, no hay fallback real.
- `handoffReason` sigue siendo `"error"` para cualquier fallo final, sin
  distinguir públicamente la causa — solo el log interno la distingue.
- Ningún límite de reintentos se relajó ni se agregó un loop nuevo: el
  Nivel 2 es exactamente UN intento adicional, una sola vez.
