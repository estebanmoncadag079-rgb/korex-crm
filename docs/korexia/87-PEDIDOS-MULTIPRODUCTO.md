# Pedidos multiproducto: el carrito que nunca existió

> **Dentro:** La regla nueva · El modelo actual, en código · El inventario
> contado · El catálogo, el CRM, el prompt y las pruebas · El estado propuesto ·
> Archivos afectados · Riesgos · Migración · Reversión · Las cuatro respuestas

**17-ago-2026. Auditoría, sin una línea de código.**

Una conversación real con La Churra pidió dos productos en un mensaje y el
agente se contradijo dentro de su propia respuesta. La auditoría de
[86](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md) explicó **por qué contestó así**. Esta
responde a la pregunta siguiente: **¿qué haría falta para que no volviera a
pasar?**

---

## ⛔ Regla nueva del proyecto

> **Ningún flujo del CRM puede asumir que un pedido contiene un único producto.**

Aplica al núcleo, al prompt, a la ficha, al cuestionario, a las pruebas y a los
escenarios. Un flujo que solo sepa sostener un producto **no está terminado**,
aunque funcione para el negocio que lo pidió. Es la regla 8 aplicada a un caso
concreto: *«¿puede usarlo cualquier negocio de VOCERO sin modificar el núcleo?»*.

Y conviene decir de dónde sale: **no la pidió un cliente**. La pidió una
conversación real en la que **el cliente hizo lo más normal del mundo** — pedir
dos cosas de una vez.

---

## 1. El modelo actual, en código

### `estado.ts:42` — lo que se persiste

```ts
export type EstadoDelPedido = {
  schema_version: number;
  producto: {
    id: string | null;      // ← UNO
    nombre: string | null;
    cantidad: number;       // ← la cantidad es DEL producto
  };
  seleccion: OpcionElegida[];          // ← del PEDIDO, no del producto
  datos: Record<string, string | null>;
  totalCents: number | null;
  paso: string;
  confirmado: boolean;
};
```

### `normalizar.ts:60` — lo que propone el modelo

```ts
export type EstadoPropuesto = {
  producto: string | null;             // ← UNO, por nombre
  cantidad: number | null;
  opciones: OpcionPropuesta[];         // ← del PEDIDO
  datos: Record<string, string | null>;
};
```

### `normalizar.ts:52` — lo que resuelve el backend

```ts
export type OpcionElegida = {
  grupoId: string;
  grupoNombre: string;
  opcionId: string;
  nombre: string;
  precioDeltaCents: number;
  // ← NO hay productoId
};
```

### `extraer.ts:94` y `:128` — lo que se le dice al modelo

```ts
export function loQueFalta(estado, producto?: ProductoDelCatalogo, requisitos)
export function comoTexto(estado, producto?: ProductoDelCatalogo, requisitos)
```

Un `producto`, singular, en la firma.

### `pipeline.ts:~573` — dónde se junta todo

```ts
const delPedido = productos.find((p) => p.id === estadoGuardado?.producto.id);
bloqueDeEstado = comoTexto(estadoGuardado, delPedido, requisitos ?? []);
```

`.find()`, no `.filter()`. **Un producto entra en el prompt.**

### Las cuatro respuestas directas

| Pregunta | Respuesta |
|---|---|
| ¿Existe un único producto? | **Sí.** Un objeto, no una lista |
| ¿Existe una lista de productos? | **No.** En ninguna capa: ni propuesta, ni estado, ni prompt |
| ¿Las opciones pertenecen al pedido o al producto? | **Al pedido.** `seleccion` cuelga de la raíz y `OpcionElegida` **no tiene `productoId`** |
| ¿La cantidad pertenece al producto o al pedido? | **Al producto** — el único que hay. Con dos, no habría dónde poner la segunda |

> 🔑 **El desajuste está en la tercera fila.** La opción sabe de qué **grupo** es
> —eso se arregló el 17-ago— pero no de qué **producto**. Con Churrita y Besties
> a la vez, `[arequipe, chocolate, chocolate]` es una lista en la que ya no se
> puede saber de quién es cada salsa. **La información no se pierde al guardar:
> nunca llegó a existir.**

---

## 2. Inventario contado

Sin estimaciones.

### Archivos que conocen los tipos del estado: **6**

| Archivo | Papel |
|---|---|
| `src/server/orders/estado.ts` | Define, valida y persiste |
| `src/server/orders/normalizar.ts` | Resuelve contra el catálogo |
| `src/server/orders/extraer.ts` | Escribe lo que falta y el resumen |
| `src/server/ai/pipeline.ts` | Lo enchufa al turno |
| `scripts/probar-estado.ts` | La prueba de extremo a extremo |
| `tests/unit/estado-del-pedido.test.ts` | Las pruebas del contrato |

### Accesos que asumen **un solo producto**: **21**

`.producto.id` · `.producto.nombre` · `.producto.cantidad`

| Archivo | Accesos |
|---|---|
| `src/server/orders/extraer.ts` | **6** |
| `src/server/orders/estado.ts` | **5** |
| `tests/unit/estado-del-pedido.test.ts` | **5** |
| `scripts/probar-estado.ts` | **4** |
| `src/server/ai/pipeline.ts` | **1** |

### Usos de `seleccion`: **39** en 8 archivos

| Archivo | Usos |
|---|---|
| `tests/unit/normalizar-pedido.test.ts` | 13 |
| `tests/unit/estado-del-pedido.test.ts` | 7 |
| `tests/unit/tercer-vertical.test.ts` | 5 |
| `src/server/orders/extraer.ts` | 4 |
| `src/server/orders/estado.ts` | 4 |
| `scripts/probar-estado.ts` | 3 |
| `src/server/orders/normalizar.ts` | 2 |
| `src/server/registro-de-cambios.ts` | 1 |

### `item`, `carrito`, `pedido_item`, `orderItem`: **0 apariciones**

No existe el concepto en ninguna parte del código.

### Total de archivos a cambiar: **10**

**4 de producción** (`estado.ts`, `normalizar.ts`, `extraer.ts`, `pipeline.ts`) ·
**1 de instrumentación** (`registro-de-cambios.ts`, la clasificación de campos) ·
**1 script** (`probar-estado.ts`) · **4 de pruebas**
(`estado-del-pedido`, `normalizar-pedido`, `tercer-vertical`, y el banco de
escenarios).

> **Es menos de lo que parece, y por una razón concreta:** la Fase 2 está
> apagada, el estado vive en **un `jsonb`** y el concepto no se ha filtrado a la
> interfaz, ni a las rutas de la API, ni al CRM. **Nadie más depende de esto
> todavía.** Es el momento más barato en el que se puede hacer este cambio, y
> cada cliente que se encienda lo encarece.

---

## 3. El catálogo: no impide nada

**No hay ninguna restricción.** `product`, `product_option_group` y
`product_option` describen **la carta**, no lo que un cliente pide. Un contacto
puede pedir Churrita, Besties y Family Box a la vez sin violar ninguna tabla,
ningún índice y ninguna clave.

**El catálogo ya está listo para el carrito.** El que no lo está es el estado.

---

## 4. El CRM y la ficha: no lo contemplan

| | ¿Lo contempla? |
|---|---|
| **La ficha** | ❌ Ningún campo. `SECCIONES.negocio` tiene 14 campos y ninguno habla de cuántos productos lleva un pedido |
| **El flujo** | ❌ `flujo` son `reglasPropias`, `saludoInicial` y `cierre`. Ninguno dice cómo tratar dos productos |
| **El cuestionario** | ❌ No se le pregunta al negocio |
| **El cierre** | 🟡 **A medias, y es lo interesante**: `cierre.requisitos` son datos del **cliente** —nombre, teléfono, dirección—, que **no se duplican por producto**. Esa parte ya está bien: los datos son del pedido, no del ítem |

> Lo único que la conducta universal contempla es que el cliente **mande varios
> datos juntos** (`conducta.ts:86`). Varios **productos** juntos, no.

---

## 5. El prompt de La Churra: escrito para un producto

El fragmento que lo demuestra, literal:

> «Un pedido completo son CINCO mensajes tuyos, ni uno más. (1) Las CUATRO
> presentaciones y «*¿Cuál te provoca?* 💛». **(2) Celebras la elección**, dices
> cuántos churros trae, y **pides EN EL MISMO MENSAJE salsa, recubierto y
> adiciones**. (3) Pides EN EL MISMO MENSAJE nombre, teléfono y dirección. (4) El
> resumen con el total y la confirmación… (5) Ya confirmado: los datos de pago y
> el cierre. **Nunca partas uno de estos en dos mensajes ni mandes uno suelto
> entre medias.**»

**«Celebras *la* elección»**, singular. El guion entero cuenta **un** producto
elegido en el mensaje (1) y **sus** opciones en el (2).

Y el resumen, igual:

> «• Salsa(s): [EN MAYÚSCULAS] · • Recubierto: [recubierto]»

**Una línea de salsas y una de recubierto para todo el pedido.** No hay dónde
escribir «las de la Churrita» y «las del Besties».

Sobre las salsas, el prompt **sí** declara la regla correcta:

> «Salsas: puede repetir la misma, pero nunca más de las que incluye su
> presentación.»

— y la base de datos dice lo contrario para tres de los cuatro productos
(ver [86](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md)).

**Conclusión: el prompt está escrito para un único producto, y el agente hizo lo
único razonable con ese guion: repetirlo por producto.**

---

## 6. Las pruebas

| Pregunta | Respuesta |
|---|---|
| ¿Alguna prueba con varios productos? | **No**, en el núcleo de pedidos. Existe `producto-olvidado.test.ts` (avisa si se pierde un producto *mencionado*) y un caso en `resumen-mal-armado.test.ts:228`, pero **ninguno construye un estado con dos productos**: son detectores de texto |
| ¿Alguna con varios productos **y** varias opciones? | **No. Cero.** |
| ¿Alguna equivalente al caso real? | **No.** Los 26 escenarios del banco piden **un** producto. El más cercano, *«manda todos los datos juntos»*, es sobre datos personales; *«pide descuento por cantidad»*, sobre varias unidades **del mismo** producto |

> Y el detalle que más incomoda: **las 755 pruebas están en verde**. Ninguna
> falla, porque ninguna preguntó. Un modelo que no puede representar la mitad de
> un pedido real pasa el gate entero sin despeinarse.

---

## 7. Migración

| Pregunta | Respuesta |
|---|---|
| ¿Hay migraciones de esquema? | **No.** `conversation_state.estado` es `jsonb`: la forma del JSON no está en el esquema |
| ¿Hay datos vivos afectados? | **No.** `conversation_state`: **0 filas**, medido hoy en producción |
| ¿`conversation_state` está vacía? | **Sí.** 0 filas, 4 organizaciones, las 4 banderas en `prompt` |
| ¿La migración es gratuita? | **Sí, hoy.** Basta subir `SCHEMA_VERSION` a 4: un estado de la versión anterior **no se usa a medias, se descarta y se empieza limpio** (`estado.ts`, probado) |

> ⚠️ **Y es gratuita exactamente hasta que se encienda el primer cliente.** Con
> un pedido vivo a mitad de camino, este mismo cambio significa perderlo. Es la
> tercera vez que este proyecto cambia la forma del estado gratis por estar la
> tabla vacía (v2 y v3 el 17-ago); **es la última vez que se puede contar con
> eso.**

---

## El estado propuesto

```
pedido
 ├── items[]
 │    ├── producto  { id, nombre }
 │    ├── cantidad
 │    └── seleccion[]  { grupoId, grupoNombre, opcionId, nombre, precioDeltaCents }
 │
 ├── datos          { …los requisitos que declara la ficha }
 ├── totalCents     ← del pedido entero, sumando los ítems
 ├── paso
 └── confirmado
```

Lo que cambia de sitio, y por qué:

| | Hoy | Propuesto | Por qué |
|---|---|---|---|
| `producto` | En la raíz | **Dentro del ítem** | Un pedido tiene productos, no *un* producto |
| `cantidad` | En la raíz | **Dentro del ítem** | Dos Churritas y un Besties es una frase normal |
| `seleccion` | En la raíz | **Dentro del ítem** | Es lo que resuelve de quién es cada salsa |
| `datos` | En la raíz | **Se queda** | Son del cliente, no del producto. No se duplican |
| `totalCents` | En la raíz | **Se queda** | Se paga un total, no uno por ítem |
| `confirmado` | En la raíz | **Se queda** | Se confirma el pedido entero |

> **`datos` quedándose donde está es la señal de que el modelo del paso 1.5 era
> el correcto.** Los requisitos declarativos ya distinguían lo que es del cliente
> de lo que es del producto; solo faltaba aplicar la misma distinción al catálogo.

---

## Archivos afectados

| Archivo | Qué cambia | |
|---|---|---|
| `src/server/orders/estado.ts` | `EstadoDelPedido`, `estadoVacio`, `validarPropuesta`, `SCHEMA_VERSION → 4` | 🔴 |
| `src/server/orders/normalizar.ts` | `EstadoPropuesto`, `EstadoNormalizado`, `normalizarPedido` resolviendo por ítem | 🔴 |
| `src/server/orders/extraer.ts` | `loQueFalta` y `comoTexto` reciben **los productos**, no *el* producto | 🔴 |
| `src/server/ai/pipeline.ts` | `.find()` → resolver todos los ítems (1 línea) | 🟠 |
| `src/server/registro-de-cambios.ts` | Clasificar `items.*` como hoy se clasifica `datos.*` | 🟠 |
| `scripts/probar-estado.ts` | Los criterios de salida, con un pedido de dos productos | 🟠 |
| `tests/unit/estado-del-pedido.test.ts` | 5 accesos + casos nuevos | 🟢 |
| `tests/unit/normalizar-pedido.test.ts` | 13 usos de `seleccion` | 🟢 |
| `tests/unit/tercer-vertical.test.ts` | 5 usos | 🟢 |
| `scripts/probar-escenarios.ts` | **El escenario que falta**: el caso real | 🟢 |

**10 archivos. 4 de producción.**

---

## Riesgos

| | Riesgo | |
|---|---|---|
| 🟢 | **Datos vivos** | Ninguno: 0 filas. **El único momento en que este cambio es gratis** |
| 🟢 | **Esquema** | No se toca: es `jsonb` |
| 🟢 | **Los otros clientes** | Lis y el salón no dependen del estado. El vertical de citas, intacto |
| 🟠 | **El prompt hay que reescribirlo** | El guion de los cinco mensajes es de La Churra y está escrito para un producto. Es trabajo de ficha, no de código, y **hay que hacerlo o el modelo seguirá preguntando dos veces** |
| 🟠 | **Más superficie para el modelo** | Proponer `items[]` es más difícil que proponer un producto. Se mide antes de encender, no después |
| 🔴 | **Hacerlo a medias** | Un `items[]` en el estado con `loQueFalta` todavía en singular es peor que hoy: el backend sostendría lo que el prompt no sabe preguntar |

---

## Reversión

`git revert` del commit del cambio, y **nada más**: sin migración que deshacer,
sin datos que restaurar, sin bandera que apagar —ya está apagada—. Un estado
guardado con `schema_version: 4` que se encuentre un código de la v3 **se
descarta solo**, que es lo que ese número existe para hacer.

**Es reversible en un comando, hoy. Después del primer cliente encendido, no.**

---

## Las cuatro respuestas del criterio de aprobación

**1. ¿El cliente puede pedir varios productos en un mismo mensaje?**
**Sí, y ya lo hizo.** No es un caso hipotético: es la primera prueba real de la
Fase 2. El catálogo lo permite sin restricción alguna.

**2. ¿El modelo actual lo soporta?**
**No.** `EstadoDelPedido.producto` es un objeto, no una lista, y `OpcionElegida`
no lleva `productoId`. Con dos productos, la mitad del pedido no tiene dónde
existir — y las opciones de ambos caen en una lista donde ya no se sabe de quién
es cada una.

**3. ¿Cuántos archivos cambian?**
**10.** Cuatro de producción, uno de instrumentación, un script y cuatro de
pruebas. 21 accesos a `.producto.*` y 39 usos de `seleccion`.

**4. ¿La migración es gratuita o toca datos vivos?**
**Gratuita, hoy.** Cero filas en `conversation_state`, esquema sin tocar (es
`jsonb`), reversible con un `git revert`. **Y deja de serlo en cuanto se encienda
el primer cliente.**
