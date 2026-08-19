# Auditoría: dos productos en un pedido, y la salsa repetida

> **Dentro:** Lo que pasó de verdad · 🔴 La Fase 2 estaba apagada · El recorrido
> real del mensaje · Por qué preguntó dos veces el recubierto · 🔴 El estado no
> sabe representar dos productos · 🔴 Los nombres de la tabla y los del prompt no
> coinciden · Las pruebas que pasan mientras producción falla · Riesgos ·
> Cambios recomendados

**17-ago-2026. Auditoría, sin una línea de código nuevo.**

Prueba real por WhatsApp con La Churra:

```
Cliente:  Churrita arequipe
          Besties chocolate y chocolate
```

---

## Lo que contestó el agente, entero

> ¡Perfecto, Churr@! Anotado tu Churrita con arequipe. Para tu Besties, me
> confirmas si te gustaría chocolate y chocolate, o si prefieres alguna otra
> combinación de las dos salsitas que puedes elegir. 😊
>
> **¿QUÉ SALSA DESEAS PARA TU CHURRITA?** · AREQUIPE · CHOCOLATE · LECHERA · CHOCOLATE BLANCO
> **¿CÓMO QUIERES TU RECUBIERTO?** · Azúcar-canela · Azúcar sola · Ambas · Sin azúcar
> **¿QUÉ SALSAS DESEAS PARA TU BESTIES?** (2 salsas) · AREQUIPE · CHOCOLATE · …
> **¿CÓMO QUIERES EL RECUBIERTO DE TU BESTIES?** · Azúcar-canela · …
> **¿ALGUNA ADICIÓN?** (opcional) · …

**Cinco preguntas en un mensaje, y dos de ellas por datos que el cliente ya
había dado.** El agente escribe *«Anotado tu Churrita con arequipe»* y **tres
líneas después pregunta qué salsa quiere para la Churrita**. Se contradice
dentro del mismo mensaje.

Eso es más grave que lo reportado, y conviene decirlo con precisión: el problema
de fondo **no es la repetición**. Es que **pregunta lo que ya le dijeron** — que
es exactamente el problema para el que existe la Fase 2.

---

## 🔴 Hallazgo 0: nada de esto pasó por el código de la Fase 2

Medido en producción hoy:

```
La Churra → state_source = prompt      catalog_source = tabla
```

Y en `pipeline.ts:547`:

```ts
const estadoEstructurado = !profile.appointmentsEnabled && profile.stateSource === "backend";
```

Con la bandera en `prompt`, **el bloque entero se salta**: no se lee estado, no
se valida, no se guarda, y el prompt no lleva el bloque del pedido.
`normalizarPedido()` **no se ejecutó ni una vez** en esa conversación.

> **Consecuencia para la auditoría:** buscar la causa en `normalizar.ts` sería
> auditar código que no corrió. Lo que se vio es, al 100%, **el modelo siguiendo
> el prompt**. Lo cual no lo deja fuera: lo interesante es qué haría el código
> nuevo con esta misma entrada — y la respuesta, más abajo, es **fallaría
> también, por dos razones distintas**.

---

## 1. El recorrido real del mensaje

| # | Dónde | Qué pasa |
|---|---|---|
| 1 | `api/webhooks/ycloud` | Entra el texto, se encola por conversación |
| 2 | `pipeline.ts:~520` | `catalog_source='tabla'` → `catalogoDePedidosQuery()` lee producto, grupos y opciones |
| 3 | `catalog/render.ts:17` | `renderCatalogoDePedidos()` lo escribe como texto |
| 4 | `prompts.ts:601` | Se pega bajo *CATÁLOGO DEL NEGOCIO* |
| 5 | `pipeline.ts:547` | **`estadoEstructurado === false`** → se salta toda la Fase 2 |
| 6 | `pipeline.ts:~617` | `chatJson(AgentAction, messages)` — la rama **sin** propuesta de estado |
| 7 | — | **No hay normalización, ni validación, ni estado.** La respuesta del modelo se manda tal cual |

**No existe el paso «se extrae la información» hoy.** El texto del cliente no se
convierte en ninguna estructura: viaja como historial y el modelo contesta.

### Y si la bandera estuviera en `backend`

Entonces sí: `chatJsonConEstado()` pediría una propuesta, y
`validarPropuesta()` → `normalizarPedido()` la resolvería contra el catálogo.
Ahí aparecen los dos fallos de los hallazgos 2 y 3.

---

## 2. ¿Hay algo que elimine duplicados?

**Auditados `Set`, `Map`, `unique`, `distinct`, `filter`, `includes` y las
comparaciones por igualdad en `normalizar.ts`. Ninguno deduplica selecciones.**

| Línea | Qué es | ¿Deduplica? |
|---|---|---|
| 174 | `new Map(catalogo…)` | Índice de productos por nombre. **No** |
| 175 | `opcionesConocidas` | Índice para adivinar el producto. **No** |
| 372 | `[...new Set(todas)]` | Lista de opciones **para un mensaje de duda**. **No** toca la selección |
| 409 | `seleccion.some(sel => sel.opcionId === o.id)` | **Detecta** la repetición, y decide **según el grupo** |
| 419 | `seleccion.push(...)` | Se añade **siempre**; es una lista, no un conjunto |

`render.ts:62` sí tiene un `Set` (`vistos`), pero es para **no imprimir dos
veces el mismo grupo en el catálogo del prompt** — presentación, no selección.

> **Conclusión:** el mecanismo que borraba duplicados **se eliminó el 17-ago** y
> no ha vuelto. Repetir donde no se puede ya no se recorta en silencio: se
> pregunta (línea 410).

---

## 🔴 3. Hallazgo: BESTIES no admite repetir, en la base de datos

Medido hoy en producción:

| Producto | Grupo | min | max | `permite_repeticion` |
|---|---|---|---|---|
| CHURRITA | SALSA | 1 | 1 | **false** |
| BESTIES | SALSA | 2 | 2 | **false** |
| FAMILY BOX | SALSA | 3 | 3 | **false** |
| MEGA BOX | SALSA | 5 | 5 | ✅ true |

La migración `0023` puso `true` **solo donde `max_select > COUNT(opciones)`**.
BESTIES pide 2 de 4 sabores: aritméticamente **no necesita** repetir para poder
cerrarse, así que quedó en `false`.

**Pero la decisión de negocio del 16-ago fue otra**, y está escrita en el propio
prompt de La Churra:

> *«Salsas: puede repetir la misma, pero nunca más de las que incluye su
> presentación.»*

La aritmética resolvió **el caso incerrable**, no **la regla del negocio**. Son
cosas distintas y las traté como si fueran la misma. Con la Fase 2 encendida
hoy, *«Besties chocolate y chocolate»* daría:

> *«chocolate negro ya está en tu salsa. ¿Querías otra distinta?»*

— es decir, **el agente preguntaría lo mismo que preguntó**, ahora por decisión
del backend.

---

## 🔴 4. Hallazgo: los nombres de la tabla y los del prompt no coinciden

| | AREQUIPE | CHOCOLATE | LECHERA | CH. BLANCO | RECUBIERTO | ADICIONES |
|---|---|---|---|---|---|---|
| **Tabla** (`product_option`) | arequipe | **chocolate negro** | lechera | chocolate blanco | ❌ **no existe** | ❌ **no existe** |
| **`instructions`** (texto libre) | AREQUIPE | **CHOCOLATE** | LECHERA | CHOCOLATE BLANCO | ✅ 4 opciones | ✅ 5, con precio |

En la captura, el agente ofrece **CHOCOLATE** — está leyendo las
`instructions`, no el catálogo de la tabla. **El mismo prompt lleva dos fuentes
que no dicen lo mismo.**

Y `normalizar.ts:363` resuelve por **igualdad exacta**:

```ts
g.opciones.filter((o) => llave(o.nombre) === llave(cruda))
```

`"chocolate"` **no encuentra** `"chocolate negro"`. Con la Fase 2 encendida, la
propuesta del modelo se rechazaría con *«"chocolate" no está entre las opciones
de BESTIES»*.

> **Esto bloquea el encendido de La Churra.** Es el primer trabajo real de la
> lista, por delante de cargar RECUBIERTO y ADICIONES — porque no es cargar
> datos nuevos, es que los que hay **se contradicen**.

---

## 5. Por qué preguntó dos veces por el recubierto

**No hay ninguna lógica de agrupación de preguntas en el código. Ninguna.** La
decisión de qué se pregunta y en qué orden vive **entera en el prompt del
negocio**, y el prompt dice:

> *«Un pedido completo son CINCO mensajes tuyos… (2) Celebras la elección, dices
> cuántos churros trae, y pides EN EL MISMO MENSAJE salsa, recubierto y
> adiciones.»*

**Está escrito para UN producto.** «Celebras **la** elección», singular. No
existe la frase que diga qué hacer con dos.

Ante dos productos, el modelo hizo lo razonable con lo que tenía: **replicar el
bloque por producto**. No es un bug del modelo; es un flujo que no contempla el
caso. Y encaja con lo que ya sabíamos:
[flujo-por-cliente](81-REQUISITOS-DECLARATIVOS.md) dejó el **orden** de las
preguntas en la ficha de cada negocio — pero la ficha tampoco dice nada de
varios productos.

**¿Es intencional?** El comportamiento observado, no. La ausencia de agrupación,
sí: nunca se diseñó.

---

## 🔴 6. Hallazgo: el estado no sabe representar dos productos

Esto es lo más importante de la auditoría.

```ts
// src/server/orders/estado.ts:42
export type EstadoDelPedido = {
  schema_version: number;
  producto: { id: string | null; nombre: string | null; cantidad: number };  // ← UNO
  seleccion: OpcionElegida[];      // ← sin decir de QUÉ producto es cada una
  datos: Record<string, string | null>;
  totalCents: number | null;
  paso: string;
  confirmado: boolean;
};
```

**Un pedido es un producto.** Y `OpcionElegida` lleva `grupoId` y `grupoNombre`,
pero **no `productoId`**: puesta la Churrita y el Besties en la misma lista, no
hay forma de saber que el arequipe es de la primera y los chocolates del segundo.

### El estado esperado para esta entrada, hoy

*«Churrita arequipe. Besties chocolate y chocolate»* — con el catálogo actual:

```jsonc
{
  "schema_version": 3,
  "producto": { "id": "prod_…", "nombre": "CHURRITA", "cantidad": 1 },
  "seleccion": [
    { "grupoId": "…", "grupoNombre": "SALSA", "opcionId": "…",
      "nombre": "arequipe", "precioDeltaCents": 0 }
  ],
  "datos": {},
  "totalCents": 1000000,
  "paso": "eligiendo_opciones",
  "confirmado": false
}
```

**El Besties no aparece por ninguna parte.** No hay dónde ponerlo. El modelo
tendría que elegir uno de los dos productos y el otro se perdería — o quedaría
solo en el historial del chat, que es justo de lo que la Fase 2 quería salir.

> **Encender la Fase 2 no arregla el caso de esta prueba. Lo cambia de sitio:**
> de un agente que pregunta de más, a un backend que **no puede sostener la
> mitad del pedido**.

---

## 7. Las pruebas

### Lo que existe

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `normalizar-pedido.test.ts` | 34 | Resolución de producto, opciones, precios, **repetición** |
| `estado-del-pedido.test.ts` | 29 | Validación, rechazos, persistencia, métricas |
| `catalogo-a-texto.test.ts` · `catalogo-texto.test.ts` | — | El render del catálogo |
| `producto-olvidado.test.ts` | — | Avisa si se pierde un producto **mencionado** |
| `resumen-mal-armado.test.ts` | — | Un caso real con dos productos… **en el detector de resúmenes**, no en el estado |

### La que cubre el caso… y por qué no sirvió

```ts
it("dos de arequipe en una Besties: se conservan las DOS", () => { … })
```

**Existe. Y pasa.** Porque su catálogo lo construye la propia prueba:

```ts
// tests/unit/normalizar-pedido.test.ts:38
permiteRepeticion: true,
```

**En producción, BESTIES tiene `false`.** La prueba y la realidad describen dos
negocios distintos con el mismo nombre.

> 🔑 **Esta es la lección transferible:** una prueba con catálogo inventado
> demuestra que **el código sabe repetir**, no que **este cliente pueda**. Es la
> tercera vez que el proyecto se encuentra lo mismo por caminos distintos —
> documentación, banderas y ahora datos— y el patrón es siempre el que dice
> [un-dueño-por-dato](84-EL-MODELO-DE-LA-FICHA.md): **la base manda**.

### Lo que falta

1. **Dos productos en un pedido.** Cero pruebas en `normalizar`/`estado`.
2. **Un escenario con el catálogo REAL de un cliente**, no uno inventado.
3. **Nombres que no coinciden** entre el prompt y la tabla.
4. **La contradicción interna**: *«anotado X»* y preguntar X en el mismo mensaje.

---

## Riesgos

| | Riesgo | |
|---|---|---|
| 🔴 | **Encender La Churra hoy rompe pedidos de dos productos** | El estado no los representa. Y son frecuentes: la prueba real fue una |
| 🔴 | **Los nombres no coinciden** | Toda propuesta con `"chocolate"` se rechaza. El agente quedaría preguntando en bucle |
| 🟠 | **BESTIES/CHURRITA/FAMILY no repiten** | Contradice la decisión del 16-ago y el propio prompt del negocio |
| 🟠 | **Las pruebas dan una seguridad que no corresponde** | 755 en verde con un catálogo que no es el de nadie |
| 🟢 | **No hay deduplicación oculta** | Confirmado: se eliminó y no volvió |

---

## Archivos afectados

| Archivo | Por qué aparece |
|---|---|
| `src/server/orders/estado.ts:42` | `producto` es uno solo — el cambio de fondo |
| `src/server/orders/normalizar.ts:363` | Igualdad exacta al resolver el nombre |
| `src/server/orders/normalizar.ts:409` | La repetición, decidida por el grupo |
| `src/server/ai/pipeline.ts:547` | La bandera que apaga todo |
| `src/server/catalog/render.ts` | El catálogo del prompt |
| `agent_profile.instructions` (**datos**) | La segunda fuente que contradice a la tabla |
| `product_option` (**datos**) | `chocolate negro`, y sin RECUBIERTO ni ADICIONES |

---

## Cambios recomendados, en orden

**No implementados.** Puestos por lo que desbloquean, no por tamaño.

| | Qué | Coste | Desbloquea |
|---|---|---|---|
| **1** | **Alinear los nombres**: que la tabla y las `instructions` digan lo mismo, y cargar RECUBIERTO y ADICIONES | Datos, sin código | El encendido. Sin esto, nada más importa |
| **2** | **`permite_repeticion = true` en los cuatro grupos SALSA** de La Churra | Un `UPDATE` — desde el 17-ago, **un interruptor en el CRM** ([94](94-BITACORA-PERMITE-REPETICION-CRM.md)) | Que el negocio se comporte como decidió su dueño |
| **3** | **Decidir si un pedido lleva varios productos** | Decisión, luego migración de `EstadoDelPedido` | El caso de la prueba real |
| **4** | Un escenario del banco con el **catálogo real** | Prueba | Que 755 en verde signifique algo |
| **5** | Que el flujo de preguntas de la ficha contemple **varios productos** | Ficha + prompt | Que deje de preguntar dos veces |

> **La decisión 3 es del dueño y no la puede tomar el código.** «Un pedido = un
> producto» es defendible —se cierra uno y se empieza otro— pero hay que decirlo
> a propósito, porque hoy está decidido **por omisión** y el cliente ya pidió dos
> cosas en un mensaje.
