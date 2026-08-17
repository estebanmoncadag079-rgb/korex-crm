# El contrato nuevo: un pedido lleva cosas, no una cosa

> **Dentro:** Qué cambió, en código · Por qué `resolverItem` en vez de reescribir ·
> La tolerancia deliberada · El tope · Lo que se le dice al modelo · Las pruebas ·
> Impacto · Reversión

**17-ago-2026. Paso 2 del camino de [88](88-AUDITORIA-SELECCION-MULTIPLE.md).**

Implementa las decisiones **A, B, C y D**: `items[]` con `ofrecible`, opciones y
cantidad **por ítem**, `datos` en la raíz, y el tope de 40.

---

## Qué cambió

### Antes (v3) — un pedido era un producto

```ts
EstadoDelPedido = {
  producto: { id, nombre, cantidad };   // ← UNO
  seleccion: OpcionElegida[];           // ← del PEDIDO, sin saber de quién
  datos; totalCents; paso; confirmado;
}
```

### Ahora (v4)

```ts
EstadoDelPedido = {
  items: ItemDelPedido[];               // ← en el orden en que se pidió
  datos; totalCents; paso; confirmado;
}

ItemDelPedido = {
  ofrecible: { id, nombre };            // producto O servicio
  cantidad;
  seleccion: OpcionElegida[];           // ← SUYAS
  totalCents;                           // el de este ítem, con su cantidad
}
```

Y en el mismo movimiento, el nombre: **`ofrecible`, no `producto`**. Un servicio
de un salón entra por aquí exactamente igual, y el tipo `Ofrecible` ya existía
desde el paso 3a. Llamarlo «producto» era pedirle al vertical de citas que
usara una palabra que no es la suya.

| | Hoy | Por qué |
|---|---|---|
| `ofrecible` | **en el ítem** | Un pedido tiene cosas, no *una* cosa |
| `cantidad` | **en el ítem** | *«una torta y dos cafés»* no es «cantidad 3» de nada |
| `seleccion` | **en el ítem** | Es lo que resuelve de quién es cada salsa |
| `datos` | **en la raíz** | Son del cliente. El nombre se pide una vez, lleve una cosa o cinco |
| `totalCents` | **en los dos** | El del ítem para poder leerlo; el del pedido porque se paga uno |

---

## Cómo se hizo: `resolverItem`, no una reescritura

Lo que hacía `normalizarPedido` —resolver nombres, corregir ortografía, detectar
la trampa de las unidades, validar cada grupo, sumar— **se movió tal cual** a
`resolverItem`, y `normalizarPedido` la llama una vez por ítem.

> **La prueba de que fue la decisión correcta**: las **34 pruebas** de
> `normalizar-pedido.test.ts` pasaron **sin cambiar una sola expectativa**. Solo
> cambió cómo se construye la entrada. Si hubiera hecho falta tocar lo que
> afirman, el refactor habría estado cambiando el comportamiento sin querer.

---

## La tolerancia, y por qué es deliberada

`itemsDe()` acepta también el formato viejo —un producto suelto en la raíz— y lo
convierte en un ítem:

```ts
if (propuesta.items?.length) return propuesta.items;
const suelto = propuesta.ofrecible ?? propuesta.producto;
if (suelto || …) return [{ ofrecible: suelto ?? null, … }];
```

**No es deuda.** El modelo es un modelo: por bien que se le explique el esquema,
alguna vez devolverá lo que le parezca más natural para un pedido de una sola
cosa. Convertirlo cuesta tres líneas; rechazarlo cuesta el turno de un cliente.

Y se refleja en los tipos, que aquí dicen la verdad:

```ts
EstadoPropuesto     → items: ItemPropuesto[]      // el contrato interno EXIGE la lista
PropuestaDelModelo  → items?: ItemPropuesto[]     // lo que llega de un modelo, no
```

`itemsDe` es la frontera entre las dos cosas.

---

## El tope: 40, y no recorta en silencio

```ts
export const MAX_ITEMS = 40;
```

🔒 Decisión del dueño. **Límite técnico, no regla de negocio** — por eso vive en
el núcleo y no en la ficha: 40 ítems caben de sobra en un `jsonb` y no caben en
un prompt. Un negocio no elige su límite técnico, igual que no elige el tamaño
máximo de una foto. El día que alguien necesite 41, **eso sí es una conversación
de negocio** y el número se muda a la ficha.

Y pasarse **no se recorta callando**:

```
"el pedido trae 43 elementos y el máximo es 40"
→ "Solo puedo tomar 40 cosas en un mismo pedido. ¿Lo dividimos en dos?"
```

Tirar tres cosas sin decir nada es la peor forma de respetar un límite: el
cliente creería que va completo. Es la misma regla que ya gobierna las opciones
—*repetir donde no se puede se pregunta, no se recorta*—, aplicada un nivel más
arriba.

---

## Lo que ve el modelo, y lo que ve el prompt

**Al modelo** se le pide `items[]` con un ejemplo insistente… **sin nombres de
ningún negocio**:

> *«En "items" va UNA ENTRADA POR CADA COSA que pida, con sus propias opciones:
> si pide dos cosas distintas en el mismo mensaje, son DOS entradas, cada una con
> lo suyo. Nunca juntes las opciones de dos cosas distintas en la misma
> entrada.»*

De paso desaparecen los ejemplos `(SALSAS, TAMAÑO, ADICIONES…)` que llevaba el
contrato: eran de un negocio de comida en el prompt que comparten todos
(hallazgo 3 de [88](88-AUDITORIA-SELECCION-MULTIPLE.md)). El catálogo de cada
negocio va aparte, y de ahí saca los suyos.

**Y el bloque de estado** ahora agrupa por ítem:

```
PEDIDO EN CURSO — no vuelvas a preguntar nada de esto:
1 × CHURRITA (salsa: arequipe) · 1 × BESTIES (salsa: chocolate, chocolate)
TOTAL (lo calculó el sistema, úsalo tal cual): $30.000
TE FALTA, en este orden: el nombre, el celular, la dirección
```

Antes, con dos productos, el modelo leía `salsa: arequipe, chocolate, chocolate`
**sin saber de quién era cada una** — que es exactamente lo que le hacía
preguntar dos veces.

Y cuando falta algo, se dice **de cuál**: `salsa de CHURRITA`, `salsa de
BESTIES`. Con un solo ítem no se repite el nombre, que sería ruido.

---

## En el pipeline

```diff
- const delPedido = productos.find((p) => p.id === estadoGuardado?.producto.id);
- bloqueDeEstado = comoTexto(estadoGuardado, delPedido, requisitos ?? []);
+ bloqueDeEstado = comoTexto(estadoGuardado, productos, requisitos ?? []);
```

Un `.find()` con dos productos resolvía el primero y **el segundo se quedaba sin
grupos**, así que el modelo no veía que le faltaban sus opciones.

---

## Los logs

Las claves llevan la posición: `items.0.nombre`, `items.1.seleccion`. Se
clasifican **por prefijo** (`items: "negocio"`), igual que `datos`, así que un
pedido de cinco cosas no obliga a escribir veinticinco líneas en
`registro-de-cambios` y el ítem nº 6 no sale `<sin clasificar>` el día que
alguien pida uno más.

> Una prueba cambió su expectativa: `clasificar("conversation_state",
> "items.0.id")` devuelve ahora `"negocio"` en vez de `"tecnico"`. **No hay
> riesgo**: las dos clases se vuelcan igual en el log; solo cambia la etiqueta.
> Lo que se oculta es `personal` y `secreto`, y ninguno de esos toca `items`.

---

## Las pruebas

**770 en verde** (+9), `tsc` y `eslint` limpios.

Las nueve nuevas están en `normalizar-pedido.test.ts`, bloque *«un pedido lleva
varias cosas»*, y la primera es el caso real:

| Prueba | Qué fija |
|---|---|
| **EL CASO REAL: los dos productos caben** | Lo que no cabía el 17-ago |
| las opciones NO se mezclan | Cada salsa sabe de quién es |
| el total es la SUMA, no el del primero | |
| cada uno con su cantidad | 1 torta y 2 cafés no son 3 de nada |
| lo que falta dice DE CUÁL | `salsa de CHURRITA`, no `salsa` dos veces |
| con un solo ítem no se repite el nombre | Que la mejora no ensucie el caso simple |
| un ítem malo no tumba a los demás | Se pregunta por ese y el resto sigue; sin total |
| un pedido sin nada pide presentación | Como siempre |
| **el tope NO recorta en silencio** | 43 ítems → 40 y una pregunta |

Y en `probar:estado`, un criterio nuevo (**A9**) que hace el caso real **contra
la base de producción**: dos ítems, se confirma, se guarda y **vuelve con sus dos
ítems**.

---

## Impacto en producción

**Ninguno.** Las cuatro banderas siguen en `'prompt'`, así que este código no
corre para ningún cliente. `conversation_state` tenía **0 filas** al hacer el
cambio, de modo que no hay ningún pedido vivo que migrar: un estado de otra
versión **se descarta solo** y la conversación empieza limpia.

**Sin migración de esquema**: `conversation_state.estado` es `jsonb`; la forma
del JSON no está en el esquema.

---

## Reversión

`git revert` del commit. No hay migración que deshacer, ni datos que restaurar,
ni bandera que apagar. Vuelve el contrato v3 y con él la imposibilidad de
sostener dos cosas en un pedido.

**Es reversible en un comando hoy. Con el primer cliente encendido, no.**

---

## Lo que NO entra aquí

- **Paso 3** — pluralizar la conducta común (`conducta.ts` sigue diciendo *«el
  producto elegido»* y *«el servicio»*). **El backend ya sostiene el pedido; el
  agente todavía no sabe preguntarlo.** Hasta que se haga, el modelo puede seguir
  preguntando de una en una.
- **Paso 4** — `reserva` en el ítem y las citas dentro del mismo motor.
- **Paso 5** — los bloqueantes de La Churra: los nombres del catálogo y la
  repetición.
