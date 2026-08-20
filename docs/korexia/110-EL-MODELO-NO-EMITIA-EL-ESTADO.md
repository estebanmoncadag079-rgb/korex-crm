# El modelo no emitía el estado — la Fase 2 nunca estuvo encendida

> **Dentro:** El síntoma · Las cinco hipótesis que se cayeron · La causa · El
> arreglo · Cómo revertir · Lo que queda

**19–20 de agosto de 2026.** Al encender `state_source='backend'` en Lis
—primera vez en cualquier cliente de la flota— se descubrió que **el modelo
nunca devuelve la clave `estado`** que toda la Fase 2 necesita. El pedido se
seguía armando por el camino viejo, con el modelo calculando el total,
**aparentando estar validado por el servidor sin estarlo**.

Es el peor tipo de fallo: no rompe nada visible. Ninguna alarma, ninguna
excepción, ningún cliente quejándose. Solo un mecanismo de seguridad que no
existía.

---

## Cómo se vio

`probar:agente` contra Lis, con la bandera encendida. Cada turno dejaba esta
línea:

```
[metrica] evento=estado ... resultado=sin_propuesta paso=- items=- total_cents=-
```

`sin_propuesta` significa "el modelo no mandó estado". En **todos** los turnos,
incluido el de confirmación. La conversación salía perfecta, el pedido se
cerraba bien, y en `conversation_state` no se guardaba jamás una fila.

---

## Las cinco hipótesis que se cayeron

Se probaron una por una con llamadas reales al modelo (30 en total,
`gemini-2.5-flash`, prompt real de Lis, tres rondas por variante). **Ninguna era
la causa** — y conviene dejarlas escritas para que nadie las vuelva a perseguir:

| Hipótesis | Cómo se probó | Resultado |
|---|---|---|
| La instrucción va en un **2.º mensaje de sistema** (`pipeline.ts`), mientras que el banco que midió la estrategia B la **concatenaba** (`medir-extraccion.ts`) | Las dos formas | 0/3 las dos |
| El historial como mensajes `assistant` **enseña a omitirla** (ninguno la lleva) | Historial como texto plano, igual que el banco | 0/3 |
| Está **lejos del final** y pierde peso | La instrucción como último mensaje | 0/3 |
| El esquema la tiene **opcional**, así que nadie reintenta | Esquema con `estado` obligatorio | 0/3 — **falla los 3 reintentos** |
| El contrato de acciones dice *"respondes **ÚNICAMENTE** un objeto JSON con UNA acción"* (`prompts.ts`) y la contradice | Contrato reescrito para admitirla | 0/3 |
| Los 19.000 caracteres del prompt del negocio la ahogan | Prompt corto de tres líneas | 0/3 |

Y entonces, cambiando **solo el modelo**, con el prompt completo y el código de
producción sin tocar:

| Modelo | `estado` presente |
|---|---|
| `google/gemini-2.5-flash` | **0 / 3** |
| `openai/gpt-4.1-mini` | **2 / 3** |

---

## La causa

**El código estaba bien. El JSON se pedía por escrito y se esperaba
obediencia.**

`callProvider` mandaba al proveedor `{model, messages}` y nada más — sin
`response_format`, sin esquema. Zod validaba *después*, cuando ya era tarde:
como `estado` era opcional, una respuesta sin él **pasaba a la primera**. Sin
reintento, sin aviso, sin rastro.

`gemini-2.5-flash` no añade una clave extra de nivel superior junto a la acción.
Ni pidiéndoselo bien, ni pidiéndoselo tres veces.

> ⚠️ **La medición del 15-ago que "validó" la estrategia B no probaba
> producción.** Se hizo con `medir-extraccion.ts`, otro camino de código, y con
> el esquema **exigiendo** `estado` — por eso dio "0 JSON inválidos": reintentaba
> hasta lograrlo. `chatJsonConEstado` nunca se midió así. Es la cuarta vez que un
> banco de pruebas mide algo distinto de lo que corre en producción.

---

## El arreglo: salidas estructuradas

Se le exige el esquema **al proveedor** (`response_format: json_schema`), en vez
de rogarlo en el prompt. Pasó de **0/3 a 3/3**.

| Archivo | Qué hace |
|---|---|
| `src/lib/ai/index.ts` | `chatJson` acepta `jsonSchema` y lo manda al proveedor. Si el modelo no lo admite, **reintenta sin él** y degrada al comportamiento de siempre |
| `src/server/ai/actions.ts` | El esquema JSON del contrato, pegado a la unión de Zod que describe |
| `src/server/ai/pipeline.ts` | Construye el esquema del estado por negocio (sus requisitos, su vertical) y quita los `null` del modo estricto antes de validar |
| `tests/unit/esquema-json-de-accion.test.ts` | Falla si el esquema y el contrato se separan |

### La trampa que casi cuesta cara

La primera versión del esquema declaraba solo `action` y `estado`, con
`additionalProperties: true`. Devolvió `estado` 3/3… **y la acción perdió el
`text`**:

```json
{"action":"reply"}
```

El cliente se habría quedado sin respuesta. **El modelo emite solo lo
declarado**, aunque el esquema permita más. Por eso ahora se declaran los doce
tipos de acción campo por campo — y por eso existe el test de deriva: un campo
nuevo en la unión que nadie declare aquí **no llegaría nunca**, y se vería como
"el modelo dejó de usar esa acción", no como un esquema incompleto.

### Por qué el modo estricto obliga a limpiar nulos

`strict: true` exige que el modelo emita **todas** las propiedades declaradas,
así que las que no son de esta acción llegan en `null`. Para un
`z.string().optional()`, `reply: null` no es "sin reply" — es un tipo que no
encaja, y rechazaría la acción entera. Se quitan antes de validar (`sinNulos`),
que es la regla 3 de la Fase 2: el backend normaliza, nunca rechaza duro.

---

## Riesgo para la flota: ninguno

El esquema **solo se envía cuando `state_source='backend'`**. Para La Churra,
Lashes Valen y cualquier cliente nuevo, la petición al proveedor es byte a byte
idéntica a la de antes.

Gate: **900 pruebas en verde**, lint y typecheck limpios, `probar:estado` 44/45
(el fallo restante es ajeno, ver abajo).

---

## Cómo revertir

Por cliente, sin desplegar, efecto en el turno siguiente:

```bash
pnpm fase2 <organizationId> --apagar
```

Y si hiciera falta quitar el arreglo entero: `git revert` del commit. Con la
bandera en `'prompt'` el código nuevo no se ejecuta, así que apagar la bandera
ya basta para volver al comportamiento de antes.

---

## Lo que queda

| | Pendiente |
|---|---|
| ✅ | ~~**`calcularDisponibilidad` ofrece huecos con el día entero ocupado**~~ — **FALSA ALARMA, cerrada el 20-ago** ([113](113-CITAS-EN-FASE-2.md)): no había bug ni riesgo de doble reserva. La prueba describía la regla del cierre **anterior** al 18-ago. El único hueco que devuelve es el minuto exacto en que la cita anterior termina, y empezar ahí es legítimo. `probar:estado` pasa 46/46 |
| ✅ | **Faltaba exigir el esquema en UNA llamada más**: la que sigue a `consult_availability`. Era la única del camino de citas sin garantía, y con la Fase 2 encendida tumbaba la conversación a handoff — corregido el 20-ago ([113](113-CITAS-EN-FASE-2.md)) |
| 🟠 | **`direccion` obligatoria en pedidos para recoger.** `soloSi` se evalúa contra la FICHA (¿el negocio hace domicilios?), no contra el pedido concreto. El modelo mete "recoge en el local" en ese campo para cumplir. No ensucia la ficha del contacto (solo `nombre` se escribe ahí) y el resumen sale bien, pero lo correcto es que la condición mire el pedido. Es genérico: le pasa a cualquier negocio con domicilio y recogida |
| ✅ | ~~**Citas con Fase 2 no está probado en vivo**~~ — encendido y verificado en Lashes Valen el 20-ago ([113](113-CITAS-EN-FASE-2.md)). El proveedor acepta el esquema con `reserva` sin problema; lo que falló fue otra cosa (la segunda llamada, arriba) |
| 🟠 | El `paso` llega con valores raros (`"sin pedido"` con pedido en curso). No bloquea — la regla 4 ya dice que el estado es abierto y el backend normaliza |
