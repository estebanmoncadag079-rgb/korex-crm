# Fase 1.5 — validar antes de persistir

> **Dentro:** Por qué 1.5 y no 2 · Tarea 1: validación semántica · Tarea 2:
> métricas · El criterio de aprobación · Las prohibiciones · La pregunta
> obligatoria

**Dictada por el dueño el 15-ago-2026, después de la regla 13.**

> **La Fase 2 no está autorizada para escribir en la base de datos.**

## Por qué 1.5 y no 2

Porque todavía se está validando **el comportamiento del sistema**, no
construyendo la arquitectura definitiva. En una sola tarde este proyecto evitó
**tres errores** por medir antes de persistir:

| Lo que parecía | Lo que era |
|---|---|
| La extracción falla el 75 % | El enum cerrado de `paso` lo rechazaba |
| B rompe el contrato del agente (16 de 20) | El modelo devolvía `paso` como número |
| El estado en la misma llamada cuesta un tercio más | Cuesta **menos**, y va más rápido |

Los tres se habrían descubierto igual… pero con tablas escritas, migraciones
aplicadas y clientes encima. **Esa disciplina se mantiene hasta el final.**

---

## Tarea 1 — Validación semántica

**Objetivo**: detectar cuándo una extracción es **sintácticamente válida pero
semánticamente incorrecta**.

Casos reales:

- *«Quiero 6 churros»*
- *«Quiero una caja de 6»*
- *«Dame dos Family Box»*
- *«Ponme una churrita con chocolate»*

El sistema debe distinguir entre **unidades · presentaciones · cantidades ·
opciones**.

**Entregables**: catálogo de casos ambiguos · reglas de normalización · banco de
conversaciones reales · informe con los errores detectados.

**Restricción**: no persistir ningún estado. Trabajar **únicamente en memoria**.

---

## Tarea 2 — Las métricas de la regla 10

Registrar: **estado propuesto** por el modelo · **estado normalizado** por el
backend · **estado final** · las **diferencias** entre ellos.

Y medir: errores de interpretación · correcciones automáticas · tiempo de
extracción · coste por conversación.

**Restricción**: no escribir en `conversation_state`. Los datos se registran
**únicamente como telemetría**.

---

## Criterio de aprobación

La siguiente fase solo puede empezar cuando haya **evidencia** de que:

1. La validación semántica funciona.
2. Las métricas funcionan.
3. El backend puede **reconstruir un pedido completo** usando únicamente el
   estado extraído.

---

## Prohibiciones

No implementar todavía: persistencia automática · escritura en
`conversation_state` · actualizaciones parciales · deltas · **nuevas
migraciones** · **nuevas tablas**.

---

## La pregunta obligatoria antes del siguiente commit

> **¿El backend puede reconstruir el pedido exactamente igual que lo haría un
> humano?**

Si la respuesta es «no», **se detiene el desarrollo**.

---

# Informe de la Tarea 1 (15-ago-2026)

**Qué se construyó**: `src/server/orders/normalizar.ts`, funciones puras que
reciben el estado propuesto y el catálogo y devuelven el estado normalizado, las
correcciones aplicadas y **las dudas que el backend no puede resolver solo**.
Ni una escritura, ni una tabla, ni una migración. El banco de casos ambiguos son
13 pruebas en `tests/unit/normalizar-pedido.test.ts`.

## Sobre conversaciones reales: 60 turnos de La Churra

| | Resultado |
|---|---|
| Turnos donde el cliente **ya eligió** presentación | 32 |
| De esos, **el backend reconstruye el pedido** | **24 — 75 %** ⚠️ ver la corrección más abajo: esta muestra venía casi toda de una sola conversación |
| De los 8 restantes, motivo | **los 8: falta la salsa** (*"CHURRITA lleva 1 y hay 0"*) |
| Casos en que el backend no sabe qué le falta | **0** |

**Los 8 no son errores**: son pedidos genuinamente a medias, y el backend
identifica el campo exacto y la pregunta exacta. Nunca inventa.

Correcciones automáticas aplicadas: **25 de nombre** (mayúsculas, tildes,
plural: `"Churritas"` → `CHURRITA`) y **2 de cantidad** (una presentación sin
número es una). Ninguna conversación se rechazó por una etiqueta —regla 3
cumplida.

## El hallazgo que ahorra una migración

`product.description` está **vacío** en los cuatro productos, así que el backend
**no sabe que una Churrita son 6 churros**. La reacción natural era añadir una
columna `unidades`. Antes de proponerla, se midió con el dato inyectado a mano:

```
SIN el dato de unidades : 23 de 60 reconstruibles (38,3 %)
CON el dato de unidades : 24 de 60 reconstruibles (40,0 %)
```

**Un caso de sesenta.** El *"quiero 6 churros"* existe y es caro cuando ocurre
—$60.000 en vez de $10.000—, pero es **raro**, y no justifica por sí solo tocar
el esquema. Queda cubierto igual: sin el dato, el normalizador **pregunta en vez
de multiplicar por seis**, que era todo el objetivo.

> 🔑 Es el mismo patrón que la Fase 0: la corazonada pedía una columna nueva, y
> el número dice que la columna habría arreglado un caso de sesenta.

## ⚠️ Corrección: la primera muestra no valía

Al pasar los casos a revisión humana, el dueño vio que **todos tenían casi el
mismo error**. Tenía razón, y por dos motivos distintos:

**1. La muestra era una sola conversación.** Los 31 casos volcados salieron
íntegros de la charla más reciente: el mismo pedido, 31 veces, con un turno más
cada vez. `cargarTurnos()` recorría las conversaciones en orden y la primera
—larga— se comió el presupuesto de llamadas. Arreglado con un tope por
conversación (`--por-conversacion`, 3 por defecto).

> Una muestra que repite un caso no mide nada, por muchos turnos que traiga. Y
> el sesgo no se ve en ninguna cifra agregada: el 75 % de arriba salía de ahí.

**2. Estaba extraída sin las reglas del negocio.** Se usó el extractor de la
estrategia A —el que la regla 13 ya había descartado—, así que en 8 de los 31
casos el cliente escribía `0` (que en La Churra **reinicia el pedido**) y el
estado seguía diciendo CHURRITA. Con el prompt real del agente, eso no pasa.

### La segunda muestra, y lo que encontró

48 turnos de **18 conversaciones distintas**, extraídos con el prompt real:

| | |
|---|---|
| JSON inválido | **0 de 48** |
| Turnos con pedido en marcha | **6** |
| Turnos sin pedido (horarios, domicilios, devoluciones) | **42** |

**El dato que la primera muestra escondía**: en La Churra **la mayoría de las
conversaciones no son pedidos**. Que el estado vaya vacío en esos turnos es lo
correcto, no un fallo — pero cualquier métrica de *"% reconstruible"* calculada
sobre todos los turnos sale baja por eso, no por mala extracción. El 8,3 % de
esta muestra y el 75 % de la anterior **miden cosas distintas**, y ninguno de
los dos es "la" tasa.

### Y un cuarto contrato demasiado rígido

Exigir `estado` en toda respuesta rechazó **4 de 36** en la primera pasada de la
muestra nueva. El motivo: cuando el agente decide `handoff` (*"quiero hablar con
Alejandra"*, *"quiero una devolución"*) o `none`, **no hay pedido que extraer** y
no emite estado. El rechazo caía justo en las conversaciones más delicadas, las
que ya iban camino de una persona. Con `estado` opcional: **0 fallos**.

Van cuatro. La regla 3 se ha cobrado, en una sola tarde: el enum de `paso`, el
esquema que el prompt no describía, el tipo de `paso`, y ahora un campo exigido
donde no aplica.

---

# Tarea 3 (nueva, del 15-ago): intención antes que estado

Al revisar las extracciones, el dueño encontró el problema de fondo:

> **El estado del pedido no puede tener prioridad absoluta sobre la intención
> más reciente del cliente.**

El caso vivo, de una conversación real:

```
Cliente: «seria el besties cuanto sale el domi?»
Sistema: «¿Cuáles salsas desea?»
```

El modelo hizo bien su parte —extrajo Besties, que es correcto—. **La culpa era
de `normalizarPedido`**, que decidía qué preguntar mirando solo qué falta en el
pedido, sin mirar qué acaba de decir el cliente.

**Y su instrucción**: no pasar a la persistencia hasta resolver este conflicto.

## Lo construido: `src/server/orders/intencion.ts`

`leerIntencion()` clasifica el turno —reinicio · saludo · consulta (horario,
entrega, precio) · pedido · opción · otra— y marca si el cliente **espera
respuesta** antes de que se le sigan pidiendo datos. No decide la respuesta ni
toca el flujo conversacional (regla 12).

Con su prueba obligatoria, tal cual la escribió:

| Mensaje | Esperado | ✓ |
|---|---|---|
| `0` | Reiniciar | ✅ |
| `Hola` | No reactivar pedidos anteriores | ✅ |
| `¿Qué horario tienen?` | Responder el horario | ✅ |
| `¿Me entregan mañana a las 8?` | Responder sobre la entrega | ✅ |
| `Quiero una churrita` | Reactivar el flujo de compra | ✅ |
| `Chocolate` | Añadir la salsa | ✅ |

Más cinco casos de cómo escribe la gente de verdad: pedir y preguntar en el
mismo mensaje, saludar antes de consultar, sin tildes y en plural, preguntar el
precio sin elegir, y lo que no encaja marcado como tal en vez de forzado.

## Dos reglas de negocio que faltaban, resueltas por el dueño

Ninguna estaba escrita en ningún sitio, y sin ellas la capa no se puede
implementar bien:

| Duda | Decisión (15-ago-2026) |
|---|---|
| Con pedido a medias, el cliente pregunta el horario o el domicilio | **Responder y retomar en el MISMO mensaje.** Ni callarse ni preguntar *"¿seguimos?"*: cada saliente se paga desde el 1-oct-2026 |
| El cliente deja un pedido a medias y vuelve más tarde | **Se retoma solo el mismo día.** Al día siguiente empieza limpio |

`pedidoSigueVigente()` calcula ese día en **`America/Bogota`, no en UTC**: a las
22:00 en Colombia ya es el día siguiente en UTC, y esa es justo la franja de más
pedidos de una churrería.

## Lo que este informe NO dice

Mide que el backend reconstruye el pedido **a partir del estado que el modelo
extrajo**. **No** prueba que ese estado sea fiel a lo que el cliente dijo — eso
solo lo dice una persona mirando, y para eso está el volcado de la regla 11.

## Respuesta a la pregunta obligatoria

> **¿El backend puede reconstruir el pedido exactamente igual que lo haría un
> humano?**

**Sí para los pedidos completos** (75 % de los turnos con producto elegido), y
en el resto **sabe exactamente qué le falta y qué preguntar**. No hay ningún
caso de silencio ni de invención.

**La Tarea 2 queda a medias a propósito**: la telemetría existe y funciona
(`telemetria-<org>.json`: propuesto → normalizado → diferencias, con tiempos y
coste), pero **se emite desde el script de medición, no desde el pipeline**.
Instrumentar el pipeline es tocar producción, y eso no entra hasta que estas
cifras se revisen a ojo.
