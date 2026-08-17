# Auditoría universal: varios elementos en una conversación

> **Dentro:** La pregunta y la respuesta corta · 🔴 El hallazgo de fondo: no
> existe la entidad Pedido · Los dos motores que no comparten nada · El estado ·
> La selección · El catálogo · El flujo · Los tres escenarios · Comida en el
> núcleo · El inventario contado · Riesgos · Recomendación · Camino ·
> Decisiones pendientes

**17-ago-2026. Auditoría, sin una línea de código.**

La pregunta, literal:

> ¿La arquitectura actual representa correctamente varios elementos
> seleccionados dentro de una misma conversación, **independientemente del
> vertical**?

**No.** Y la razón no es la que buscábamos.

---

## La respuesta corta

| Vertical | ¿Sostiene varios elementos? | Dónde vive lo seleccionado |
|---|---|---|
| **Pedidos** | ❌ No | `conversation_state.estado` — **un borrador que se borra** |
| **Citas** | ❌ No | `appointment` — una fila con **un** `service_id` |

Dos verticales, el mismo defecto, **en dos sitios que no comparten una sola
línea de código**. Arreglar uno no arregla el otro, y arreglar solo pedidos
—que es lo que proponía [87](87-PEDIDOS-MULTIPRODUCTO.md)— dejaría el trabajo
hecho a medias y habría que repetirlo entero para citas.

---

## 🔴 Hallazgo 1 — No existe la entidad Pedido

**33 tablas en el esquema. Ninguna es un pedido.**

```
user · session · account · verification · organization · member · invitation
contact · pipelineStage · lead · conversation · message · metaCredentials
agentProfile · kbEntry · product · productOptionGroup · productOption
service · staffMember · staffService · appointment · offeredSlot · template
agentTestRun · agentTestCase · usageEvent · learningProposal · webhookEvent
agentJob · rateLimitHit · mediaAsset · conversationState
```

Cuando un pedido se confirma (`pipeline.ts:1073`, acción `notify_order`):

```ts
await notifyTeam({ organizationId, summary: action.summary, … });
await appendLeadNote(
  organizationId, conversation.contactId,
  `Pedido confirmado: ${action.summary}\n[aviso al equipo: ${result.detail}]`
);
```

**El pedido se convierte en una cadena de texto** escrita por el modelo, se manda
al equipo por WhatsApp y se guarda como **nota en el lead**. Después,
`conversation_state` se borra.

> **La pregunta de esta auditoría era si el modelo representa VARIOS elementos.
> En el vertical de pedidos no representa NI UNO**: lo que hay es un borrador
> temporal y, al final, prosa. No se puede consultar qué pidió alguien, ni
> sumarlo, ni facturarlo, ni compararlo con lo que se entregó.

Y la asimetría con el otro vertical es total:

| | Pedidos | Citas |
|---|---|---|
| ¿Entidad persistente? | ❌ texto en una nota | ✅ `appointment` |
| ¿Integridad garantizada? | ❌ nada | ✅ `EXCLUDE USING gist` — dos citas no se pueden solapar |
| ¿Consultable? | ❌ | ✅ ocho rutas de API |
| ¿Varios elementos? | ❌ | ❌ |

---

## 🔴 Hallazgo 2 — Dos motores de estado sin nada en común

`pipeline.ts:547`:

```ts
const estadoEstructurado = !profile.appointmentsEnabled && profile.stateSource === "backend";
//                          ↑ las citas quedan FUERA por diseño
```

**La Fase 2 excluye el vertical de citas explícitamente.** Existen dos maneras
distintas de sostener lo que un cliente va eligiendo:

- **Pedidos** → `conversation_state`, un `jsonb` validado por `normalizar.ts`
- **Citas** → directo a `appointment`, sin borrador, sin validación semántica
  común, sin `seleccion`

Esto contradice la **decisión 1** de [79](79-ARQUITECTURA-MULTIEMPRESA.md), que
está escrita desde el principio:

> *«La Fase 2 es un componente COMÚN, no del vertical de pedidos. Hoy el pipeline
> la excluye de citas por diseño. **Deja de ser aceptable.**»*

Sigue siendo así. **Y es la causa estructural de que el mismo defecto haya que
arreglarlo dos veces.**

---

## El estado: las seis respuestas

| Pregunta | Respuesta |
|---|---|
| ¿Admite varios elementos? | **No** |
| ¿Existe una única entidad `producto`? | **Sí** — `estado.ts:44`, un objeto |
| ¿Existe `items[]`? | **No.** 0 apariciones de `item`, `carrito`, `pedido_item`, `orderItem` en todo el repositorio |
| ¿Las opciones son del pedido o del elemento? | **Del pedido.** `seleccion` cuelga de la raíz |
| ¿La cantidad? | **Del elemento** — el único que hay. En citas **no existe**: una cita es una |
| ¿Los datos del cliente? | **Del pedido**, y **es lo único que está bien**. `datos` no se duplica por elemento, que es exactamente lo correcto |

---

## La selección: las cuatro respuestas

```ts
// normalizar.ts:52
export type OpcionElegida = {
  grupoId: string; grupoNombre: string;
  opcionId: string; nombre: string; precioDeltaCents: number;
  // ← no hay productoId
};
```

| Pregunta | Respuesta |
|---|---|
| ¿Una selección conoce su elemento? | **No.** Conoce su **grupo** —eso se arregló el 17-ago— pero no su producto |
| ¿Dos productos pueden tener opciones con el mismo nombre? | **Sí, y ya ocurre**: `arequipe` está en `SALSA` de los cuatro productos de La Churra, y en `ADICIONES` a $1.500 |
| ¿Es posible distinguirlas? | **Por grupo sí. Por elemento no.** Y con dos productos del mismo tipo, los grupos también coinciden |
| ¿Se mezclan? | **Sí.** Con Churrita + Besties, `[arequipe, chocolate, chocolate]` es una lista plana donde ya no se sabe de quién es cada una |

> 🔑 **El punto exacto del fallo**: `grupoId` identifica el grupo **del
> catálogo**, no la instancia elegida. Dos Churritas del mismo pedido comparten
> `grupoId`. No es que la información se pierda al guardar: **nunca llega a
> existir**.

---

## El catálogo: limpio, salvo una cosa

| Pregunta | Respuesta |
|---|---|
| ¿Limita el número de productos por pedido? | **No.** `product`/`product_option_group`/`product_option` describen **la carta**, no lo que alguien pide |
| ¿Supuestos ocultos de producto único? | **No** en las tablas. `catalogoDe()` devuelve una lista y `Ofrecible` unifica producto y servicio |
| ¿Dependencias catálogo → estado? | **Una, y sana**: `normalizar` resuelve contra el catálogo. El catálogo no sabe nada del estado |
| ¿Código específico de comida? | 🔴 **Sí. Ver el hallazgo 3** |

---

## 🔴 Hallazgo 3 — Comida en el núcleo, todavía

`src/server/catalog/sembrar.ts`, que es **el sembrador de catálogos de toda la
plataforma**:

```ts
// :115
if (/^adiciones?\s*:/i.test(linea)) { … }
// :221
const esRecubierto = /recubiert|azucar|azúcar|cobertura/i.test(nombre);
// :222
const esAdicion = opcional || /adicion|adición|extra/i.test(nombre);
// :226-227
minimo: esAdicion ? 0 : 1,
maximo: esRecubierto ? 1 : opciones.length,
```

**«azúcar», «cobertura», «recubierto», «adición» deciden el `minimo` y el
`maximo` de los grupos de cualquier negocio que se dé de alta.** Un taller que
escriba «Cobertura del seguro» recibe un grupo de máximo 1 sin que nadie se lo
haya pedido.

Viola las reglas **1**, **2** y **8** de [79](79-ARQUITECTURA-MULTIEMPRESA.md).
Es el mismo patrón que se sacó de `normalizar.ts` el 17-ago —las salsas dentro
del núcleo— **sobreviviendo en el archivo de al lado**, que nadie miró porque la
auditoría iba del estado y no del alta.

Y una segunda, menor, en `pipeline.ts:1719`, dentro del contrato con el modelo:

```ts
'"grupo" es el título bajo el que aparece en el catálogo (SALSAS, TAMAÑO, ADICIONES…)'
```

Ejemplos de comida en el texto que se le manda a **todos** los verticales.

---

## El flujo: el singular está en la conducta COMÚN

No solo en el prompt de La Churra. En `conducta.ts`, que es **universal**:

```
:309  «con el producto elegido, pídele las opciones y si es regalo en el MISMO mensaje»
:112  «Necesitas el servicio, el día, la hora y el nombre de quien viene»   ← CIERRE_CITAS
```

**Los dos verticales, en singular, en el archivo que comparte toda la
plataforma.** Tres ocurrencias de producto/elección en singular.

| Pregunta | Respuesta |
|---|---|
| ¿El flujo asume el singular? | **Sí, en la conducta común**, no solo en el prompt de un cliente |
| ¿Mensajes como «¿Qué salsa deseas?» | En el prompt del cliente sí; en la conducta, su equivalente: *«el producto elegido»*, *«el servicio»* |
| ¿La ficha está preparada? | **No.** `SECCIONES.negocio` tiene 14 campos y ninguno habla de cuántos elementos lleva un pedido. `flujo` son 3 campos y ninguno tampoco |

---

## Los tres escenarios

### La Churra — Churrita + Besties + Family Box

```
items: [
  { producto: CHURRITA,   cantidad: 1, seleccion: [arequipe] },
  { producto: BESTIES,    cantidad: 1, seleccion: [chocolate, chocolate] },
  { producto: FAMILY BOX, cantidad: 1, seleccion: [s1, s2, s3] },
]
```

**Hoy: imposible.** Solo cabe el primero. Y aunque cupieran, las nueve salsas
caerían en una lista plana.

### Lis Pastelería — torta + 2 cafés + galletas

```
items: [
  { producto: TORTA CHOCOLATE, cantidad: 1, seleccion: [] },
  { producto: CAFÉ,            cantidad: 2, seleccion: [mediano] },
  { producto: CAJA GALLETAS,   cantidad: 1, seleccion: [] },
]
```

**Hoy: imposible**, y añade un requisito que el caso de La Churra no enseña: **la
cantidad tiene que ser por elemento**. Dos cafés y una torta no es «cantidad 3»
de nada.

### Lashes Valen — extensiones + diseño de cejas

```
items: [
  { servicio: EXTENSIONES CLÁSICAS, duracion: 90, recurso: ?, inicio: ? },
  { servicio: DISEÑO DE CEJAS,      duracion: 30, recurso: ?, inicio: ? },
]
```

**Hoy: imposible**, y por un camino distinto — `appointment.service_id` es
`NOT NULL` y único. Habría que crear **dos citas sueltas** que el sistema no sabe
que van juntas: si la clienta cancela, se cancela una.

> 🔑 **Y aquí está la lección que ninguno de los otros dos escenarios enseña:**
> un elemento de citas necesita **más campos** que uno de pedidos — inicio, fin y
> recurso. Un `items[]` diseñado solo con lo que pedidos necesita **no le sirve a
> citas**, y volveríamos a tener dos motores.
>
> Ese es exactamente el error que la regla 8 existe para evitar, y es el que
> estábamos a punto de cometer en el paso 3.6.

---

## Inventario contado

**Sin estimaciones.**

### Tipos y contratos

| Tipo | Archivo | ¿Asume uno? |
|---|---|---|
| `EstadoDelPedido` | `estado.ts:42` | 🔴 sí |
| `EstadoPropuesto` | `normalizar.ts:60` | 🔴 sí |
| `EstadoNormalizado` | `normalizar.ts:102` | 🔴 sí |
| `OpcionElegida` | `normalizar.ts:52` | 🔴 sí (sin `productoId`) |
| `OpcionPropuesta` | `normalizar.ts:34` | 🔴 sí |
| `PropuestaDelModelo` | `estado.ts:88` | 🔴 sí |
| `Validacion` · `Resultado` | `estado.ts:93` · `normalizar.ts:112` | 🟠 heredan |
| `Aporte` · `Lectura` | `extraer.ts:20` · `:27` | 🟠 heredan |
| `Ofrecible` · `ProductoDelCatalogo` | `catalog/queries.ts` | 🟢 **no** — ya son listas |
| `Requisito` | `ficha.ts` | 🟢 **no** — son del cliente |

### Ocurrencias

| Qué | Cuántas |
|---|---|
| Archivos que conocen los tipos del estado | **6** |
| Accesos `.producto.{id,nombre,cantidad}` | **21** |
| Usos de `seleccion` | **39** en 8 archivos |
| `item` / `carrito` / `pedido_item` / `orderItem` | **0** |
| Ocurrencias de `serviceId` | **59** (44 en `appointments/queries.ts`) |
| Ocurrencias de `staffId` | **90** |
| Tablas en el esquema | **33** — **0** son un pedido |
| Migraciones existentes | **24** |
| Escenarios en el banco | **26** — **0** con varios elementos |
| Pruebas con varios elementos | **0** |
| Pruebas en verde | **755** — ninguna falla porque ninguna preguntó |

### Archivos

| Archivo | Papel | |
|---|---|---|
| `src/server/orders/estado.ts` | El contrato y la persistencia | 🔴 |
| `src/server/orders/normalizar.ts` | La resolución contra el catálogo | 🔴 |
| `src/server/orders/extraer.ts` | Qué falta y el resumen | 🔴 |
| `src/server/ai/pipeline.ts` | El enchufe, y la exclusión de citas (`:547`) | 🔴 |
| `src/server/catalog/sembrar.ts` | 🔴 **lógica de comida en el núcleo** | 🔴 |
| `src/lib/db/schema.ts` | `appointment.service_id` único; **no hay tabla de pedido** | 🔴 |
| `src/server/appointments/queries.ts` | 44 `serviceId`; 1.258 líneas | 🟠 |
| `src/server/ai/generador/conducta.ts` | El singular en la conducta común | 🟠 |
| `src/server/registro-de-cambios.ts` | Clasificación de campos del estado | 🟠 |
| `scripts/probar-estado.ts` · `scripts/probar-escenarios.ts` | Las dos pruebas de integración | 🟠 |
| `tests/unit/{estado-del-pedido,normalizar-pedido,tercer-vertical}.test.ts` | 25 usos entre las tres | 🟢 |

### Supuestos implícitos encontrados

1. **Un pedido = un producto** (`estado.ts:44`)
2. **Una cita = un servicio** (`appointment.service_id NOT NULL`)
3. **Una cita = un recurso** (`appointment.staff_id NOT NULL`)
4. **Una selección pertenece al pedido**, no a un elemento (`seleccion` en la raíz)
5. **Un pedido no necesita existir después de confirmarse** (se vuelve texto)
6. **El estado estructurado es de pedidos** (`pipeline.ts:547`)
7. **Los grupos que suenan a azúcar son de elección única** (`sembrar.ts:221`)
8. **`appointment.status` es un enum cerrado en la tabla** — contra la regla del
   proyecto de no cerrar enums (`paso` sí es texto libre, y por eso mismo)
9. **El horario es del negocio, nunca del recurso** ([83](83-RECURSOS-Y-RESERVAS.md))

---

## Riesgos

| | Riesgo | Por qué |
|---|---|---|
| 🔴 | **Arreglar solo pedidos** | Duplica el trabajo y consolida los dos motores. Es lo que proponía el paso 3.6 |
| 🔴 | **Diseñar `items[]` sin citas delante** | Un ítem de citas necesita inicio, fin y recurso. Si no están, citas no lo puede usar |
| 🔴 | **El pedido no existe como entidad** | Sin ella no hay historial, ni facturación, ni «¿qué pidió esta señora el mes pasado?». Y **no lo arregla `items[]`** |
| 🔴 | **`sembrar.ts` decide con palabras de comida** | Cualquier alta futura hereda las reglas de un churro |
| 🟠 | **La conducta común está en singular** | El backend podrá sostener tres elementos y el agente seguirá preguntando de uno en uno |
| 🟠 | **Las 755 pruebas dan seguridad falsa** | Verdes con cero casos multielemento |
| 🟠 | **`appointments/queries.ts`, 1.258 líneas y 44 `serviceId`** | Es donde más cuesta cualquier cambio de citas |
| 🟢 | **El catálogo** | Ya está listo: no impide nada y `Ofrecible` ya unifica los dos verticales |
| 🟢 | **`datos` / `Requisito`** | Ya están en el sitio correcto: son del cliente, no del elemento |
| 🟢 | **Datos vivos** | `conversation_state`: 0 filas. `appointment`: 4 citas |

---

## Recomendación arquitectónica

**La unidad universal no es el producto, ni el servicio: es la línea de
selección.** Y tiene que vivir **una sola vez**, para los dos verticales.

```
conversación
 └── seleccionEnCurso
      ├── items[]
      │    ├── ofrecibleId          ← producto O servicio: ya existe `Ofrecible`
      │    ├── nombre               ← redundante a propósito
      │    ├── cantidad
      │    ├── opciones[]           ← lo que hoy es `seleccion`, por ítem
      │    └── reserva?             ← SOLO citas: { inicio, fin, recursoIds[] }
      │
      ├── datos                     ← del cliente. NO se duplica
      ├── totalCents
      ├── paso
      └── confirmado
```

Cada recomendación, contra la pregunta obligatoria — *¿funcionaría igual en
pedidos, citas y futuros verticales?*:

| | Recomendación | ¿Universal? |
|---|---|---|
| **A** | `items[]` con `ofrecibleId`, en vez de `producto` | ✅ `Ofrecible` ya cubre producto y servicio |
| **B** | Las opciones, **dentro del ítem** | ✅ Un salón elige tono por servicio; un taller, repuesto por reparación |
| **C** | `cantidad` **por ítem** | ✅ 2 cafés. En citas es 1 y no estorba |
| **D** | `datos` **se queda en la raíz** | ✅ El cliente es uno en los tres verticales |
| **E** | `reserva` **opcional en el ítem** | ✅ Los verticales sin tiempo lo omiten; no obliga a nadie |
| **F** | **Quitar la exclusión de citas** de `pipeline.ts:547` | ✅ Es la decisión 1 de `79`, aún sin cumplir |
| **G** | **Sacar las palabras de comida de `sembrar.ts`** | ✅ Regla 1. No requiere decidir nada |
| **H** | **Pluralizar la conducta común** | ✅ Los dos verticales la comparten |
| **I** | Una **entidad de pedido persistente** | 🟡 **Universal, pero es otro proyecto.** `appointment` ya es su equivalente en citas; unificarlas es más grande que esta auditoría |

**Descartadas por no pasar la pregunta:**

- ❌ Una tabla `order_item` **específica de pedidos** — dejaría citas fuera otra
  vez, que es el error que estamos auditando.
- ❌ Meter `duracionMin` en todos los ítems — obligaría a un vertical sin tiempo
  a llevar un campo que no significa nada.
- ❌ Un enum de tipos de ítem (`producto | servicio`) — es `vertical` otra vez,
  y ya tiene un dueño único (`vertical.ts`).

---

## Camino propuesto

| | Paso | Coste | ¿Decide alguien? |
|---|---|---|---|
| **0** | ✅ **G**: limpiar `sembrar.ts` — **hecho el 17-ago**, ver abajo | Bajo, sin migración | No. Es una regla ya escrita |
| **1** | **Decidir el alcance**: ¿`items[]` en los dos verticales a la vez, o solo pedidos? | — | 🔴 **El dueño** |
| **2** | **A + B + C + D**: el contrato nuevo, `SCHEMA_VERSION 4`, sin tocar tablas | Medio | No, si el paso 1 está decidido |
| **3** | **H**: pluralizar la conducta y el flujo de la ficha | Bajo | No |
| **4** | **E + F**: el ítem con reserva y las citas dentro del mismo motor | Alto | 🔴 **El dueño** |
| **5** | **I**: la entidad de pedido | Alto, con migración | 🔴 **El dueño** |

**El paso 0 se puede hacer hoy sin decidir nada.** Del 1 en adelante, hace falta
una decisión.

---

## ✅ Paso 0, hecho: el sembrador ya no sabe de comida

**17-ago-2026.** Lo único del camino que no necesitaba una decisión.

### Lo que decidía por palabras, y lo que decide ahora

| | Antes | Ahora |
|---|---|---|
| **`maximo`** | `1` si el nombre contenía `recubiert\|azucar\|cobertura` | **El número que escriba el negocio** entre paréntesis: `(elige 1)`, `(máximo 2)`, `(hasta 3)`. Si no lo dice, todas |
| **`minimo`** | `0` si contenía `adicion\|extra` **o** decía «opcional» | **`0` solo si dice «opcional»** — que es una palabra del idioma, no de un sector |
| **Lista en el bloque de productos** | Se reconocía por empezar con `adiciones:` | **Por la forma**: `ENCABEZADO: a · b · c`, con varios elementos separados |

### Y lo que no se sabe, se dice

`GrupoLeido` tiene un campo nuevo, `revisar?: string`. Porque la verdad
incómoda es esta: **de `RECUBIERTO: Azúcar-canela · Azúcar sola · Ambas · Sin
azúcar` no se deduce que se elija uno.** Lo sabe quien conoce el negocio. El
lector acertaba **por casualidad de vocabulario**.

Ahora no adivina: marca el grupo y lo imprime donde se ve, en los dos scripts
que escriben catálogos:

```
  RECUBIERTO [todos los productos] elige 4 (obligatorio):
      🟠 REVISAR: no dice cuántas se eligen: queda en 4 (todas)
```

> Y se imprime **a propósito en los dos**. Una marca que se guarda en un campo y
> no se enseña es un guardarraíl invisible — el proyecto ya tiene tres casos de
> eso, todos con el mismo final.

### Pruebas

**761 en verde** (+6), `tsc` y `eslint` limpios. Las nuevas usan negocios que **no
venden nada de comer**, para que la regla se defienda sola:

| Prueba | Qué impide |
|---|---|
| *un taller: «Cobertura del seguro» NO se convierte en elección única* | Que `cobertura` vuelva a decidir |
| *una papelería: «Extras» no queda opcional por llamarse así* | Que `extra` vuelva a decidir |
| *pero «opcional» sí se respeta* | Que la limpieza se pase de frenada |
| *un salón: `TONOS: Rubio · Castaño` no se toma por un producto* | Que solo se reconozca `adiciones:` |
| *un producto con dos puntos en el nombre sigue siendo un producto* | Que la forma nueva se coma un producto real |

Y **una prueba existente cambió de sentido**: la que exigía `RECUBIERTO → max 1`.
Pasaba porque el lector lo daba por hecho. Ahora comprueba que **se marca en vez
de adivinarse**, con el porqué escrito encima para quien la lea dentro de un año.

### Impacto en producción: ninguno

`leerCatalogoDeTexto` la llaman **dos scripts manuales** (`migrar-catalogo` y
`cargar-opciones`) y **nada automático**: ni el alta de clientes, ni el pipeline,
ni ninguna ruta. Los catálogos ya sembrados **no cambian**: La Churra conserva
sus cuatro productos y su grupo `SALSA` tal cual.

Lo que cambia es el resultado de **la próxima siembra**. Si alguien re-sembrara
hoy el catálogo de La Churra, `RECUBIERTO` saldría con máximo 4 y **con la marca
de revisar** — que es justo el momento en que una persona pone el 1 a mano, con
el dato que solo ella tiene.

### Reversión

`git revert` del commit. Sin migración, sin datos que restaurar, sin bandera.
Vuelve la lista de palabras y desaparece el campo `revisar`.

---

## 🔒 Las decisiones, tomadas y congeladas (17-ago-2026)

### 1. `items[]` entra en LOS DOS VERTICALES A LA VEZ

Decisión del dueño. Es más caro ahora y más barato en total, y evita repetir el
trabajo — que es exactamente lo que pasó con `permiteRepeticion`: se arregló para
el producto que no se podía cerrar y hubo que volver por los otros tres.

**Consecuencia:** ningún paso de este camino se da mirando solo a pedidos. Cada
uno se valida contra los dos verticales antes de darse por hecho (regla 9).

### 2. El pedido NO se persiste como entidad. Se queda como está

Decisión del dueño, con su razón:

> *«Los pedidos no quedan registrados, las citas sí porque son programadas.»*

Y es coherente: **una cita hay que recordarla porque va a pasar en el futuro**;
un pedido se despacha hoy y se acabó. La asimetría entre los dos verticales deja
de ser un defecto y pasa a ser una decisión.

**Consecuencia que hay que tener presente:** lo que llega al equipo sigue siendo
el `summary` —texto escrito por el modelo—. El backend sostendrá el pedido
estructurado durante la conversación, pero al confirmar se convierte en prosa.
Si algún día se quiere «cuánto vendió el negocio este mes», esta decisión es la
que habría que revisar. **Hoy no hace falta.**

### 3. Las citas entran en la Fase 2

Se responde sola con la 1. Se levanta la exclusión de `pipeline.ts:547`, que
llevaba desde el 17-ago marcada como *«deja de ser aceptable»* en la decisión 1
de [79](79-ARQUITECTURA-MULTIEMPRESA.md).

### 4. Un pedido lleva 40 elementos como máximo

Decisión del dueño. Cabe en un `jsonb` y no cabe en un prompt, así que el número
existe para proteger la plataforma, no para describir un negocio.

> ⚠️ **Y por eso el tope es del núcleo y no de la ficha, que es la única
> excepción a la regla de «las reglas del negocio se configuran en el CRM».** Se
> deja dicho aquí para que dentro de seis meses nadie lo confunda con una regla
> de negocio que se coló: no lo es. Un negocio no elige su límite técnico, igual
> que no elige el tamaño máximo de una foto.
>
> Si algún día un cliente necesita 41, **eso sí es una conversación de negocio** —
> y entonces el número se mueve a la ficha, no se sube a mano.

---

## El camino, con las decisiones dentro

| | Paso | Qué entra | Estado |
|---|---|---|---|
| **0** | Limpiar `sembrar.ts` | — | ✅ **hecho** (`7b78a56`) |
| **1** | Decidir el alcance | — | ✅ **hecho**: los dos verticales |
| **2** | **El contrato nuevo**: `items[]`, opciones y cantidad por ítem, `datos` en la raíz, tope 40, `SCHEMA_VERSION 4` | A·B·C·D | ✅ **hecho** ([89](89-EL-CONTRATO-DE-LOS-ITEMS.md)) |
| **3** | **Pluralizar la conducta común** y el flujo de la ficha | H | ⬜ |
| **4** | **`reserva` en el ítem** y quitar la exclusión de citas | E·F | ⬜ |
| **5** | Los bloqueantes de La Churra: nombres del catálogo y repetición | — | ⬜ |
| **6** | Medición, banco de escenarios, encendido | — | ⬜ |

**Descartado por decisión 2:** la entidad de pedido persistente (era la
recomendación **I**).

---

## Estado de las pruebas · Impacto · Reversión

**Pruebas: 755 en verde**, `tsc` y `eslint` limpios — **sin significado para lo
auditado aquí**: cero casos con varios elementos, en cualquiera de los dos
verticales.

**Impacto en producción: ninguno.** Esta auditoría no toca código, ni datos, ni
banderas, ni prompt. Medido hoy: `conversation_state` 0 filas · 4 organizaciones
· 4 banderas en `prompt` · `appointment` 4 citas.

**Reversión:** no aplica — solo hay documentos. `git revert` del commit los
retira.

---

## Commits

| | |
|---|---|
| `eeea542` | Auditoría del caso real ([86](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md)) |
| `a0d6423` | Paso 3.6: el pedido multiproducto y la regla 10 ([87](87-PEDIDOS-MULTIPRODUCTO.md)) |
| **este** | Esta auditoría universal |

---

## Lo que corrige de la auditoría anterior

[87](87-PEDIDOS-MULTIPRODUCTO.md) propuso `items[]` **para pedidos**. Contra la
pregunta obligatoria —*¿funcionaría igual en citas?*— la respuesta es **no**: un
ítem de citas necesita inicio, fin y recurso, y `appointment.service_id` seguiría
siendo único.

**Aquella propuesta habría pasado el gate, habría funcionado para La Churra y
habría dejado el vertical de citas exactamente donde está.** Que es, palabra por
palabra, lo que la regla 8 existe para impedir.
