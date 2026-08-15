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
| De esos, **el backend reconstruye el pedido** | **24 — 75 %** |
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
