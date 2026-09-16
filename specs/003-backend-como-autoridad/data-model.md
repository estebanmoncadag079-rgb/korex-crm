# Modelo de datos: operaciones cerradas sobre el estado

**Feature**: 003-backend-como-autoridad · **Fase**: 1 (diseño, sin código)

Este documento fija la forma exacta de lo único genuinamente nuevo de esta feature: el
contrato que reemplaza al "estado completo" que hoy propone el modelo
(`pipeline.ts:4785`, `esquemaDelEstado`). Todo lo demás (`EstadoDelPedido`, las cuatro
consultas verificadas, `order_confirmation`) se reutiliza sin cambios de forma.

---

## 1. `Operacion` — lo único que el modelo puede emitir sobre el estado

Unión discriminada, en el mismo estilo que `AgentAction` (`actions.ts:12`). Reemplaza
al bloque `estado` de `chatJsonConEstado` (`pipeline.ts:4884`).

**Corrección de diseño (15-sep-2026, encontrada al empezar T002, decidida por
Esteban): ninguna operación referencia por id.** El diseño original asumía que el
backend le entregaba ids al modelo (de `consultar_producto`, `consult_availability`)
para que los citara después. Es un patrón que **no existe en ningún lugar del
código real**: `buscarProductos`, `resolverZonaDeEntrega`, `resolverMetodoDePago` y
`buscarServicio` resuelven TODOS por nombre, con búsqueda difusa, cada vez —
`normalizar.ts:26` lo dice explícito: *"El LLM no ha visto un id en su vida y no debe
verlo."* Las operaciones siguen esa misma regla: **referencian por nombre, y el
backend las resuelve de nuevo contra datos reales en cada turno**, con los mismos
resolvedores que ya existen — ninguno se crea ni se modifica.

| Vertical | `tipo` | Parámetros | Referencia por |
|---|---|---|---|
| Pedidos | `agregar_item` | `ofrecible` (nombre), `opciones?`, `cantidad` | nombre resuelto con `buscarProductos` |
| Pedidos | `cambiar_cantidad` | `ofrecible` (nombre), `opciones?`, `cantidad` | nombre (+ opciones si hace falta desambiguar) contra `estado.items` |
| Pedidos | `quitar_item` | `ofrecible` (nombre), `opciones?` | nombre (+ opciones si hace falta desambiguar) contra `estado.items` |
| Pedidos | `elegir_opcion` | `ofrecible` (nombre), `opciones?`, `grupo` (nombre), `opcion` (nombre) | nombres resueltos con `buscarOpciones` |
| Pedidos | `declinar_grupo` | `ofrecible` (nombre), `opciones?`, `grupo` (nombre) | nombre de grupo opcional del catálogo |
| Ambos | `fijar_dato` | `requisitoId`, `valor` | clave de campo que el propio esquema JSON le inyecta fresca cada turno — no un id que el modelo deba recordar de un turno anterior; sin cambio |
| Ambos | `fijar_modalidad` | `modalidad` | valor de `modalidadesOfrecidas`, ya cerrado por `enum` en el esquema de ESTE turno (`pipeline.ts:4843-4849`); sin cambio |
| Citas | `fijar_servicio` | `servicio` (nombre) | nombre resuelto con `buscarServicio` |
| Citas | `fijar_horario` | `fecha`, `hora`, `especialista?` | la tupla que el backend acaba de ofrecer, re-verificada contra `disponibilidadRealMultiple` — nunca un id de `offered_slot` |
| Citas | `fijar_especialista` | `especialista` (nombre) | nombre resuelto contra los recursos reales |
| Ambos | `confirmar` | — | — |

**No hay `cancelar` en este conjunto.** Corrección de diseño del 16-sep-2026,
encontrada al investigar antes de T008: "cancelar/empezar de cero" ya existe hoy en
producción, y es **determinístico, nunca una decisión del modelo** —
`matchesReinicio`/`borrarEstado` (`pipeline.ts:4571-4582`, disparado en `:1180` y
`:1235`), por palabra clave configurable por negocio (`"0"` en La Churra), corriendo
**antes** de llamar al modelo. El propio comentario del código explica por qué: *"si
dependiera del LLM, un turno confuso podría arrastrar un pedido que el cliente ya
canceló."* Ese mecanismo es genérico por diseño —`estadoEstructurado =
profile.stateSource === "backend"` no distingue vertical (`pipeline.ts:1090-1098`)—
así que cubre `EstadoDelPedido.reserva` (citas) igual que `items` (pedidos), sin
ningún cambio. No se crea una `Operacion` de cancelación para ningún vertical: el
mecanismo correcto ya existe, ya está probado, y esta feature no lo toca.

La versión anterior de esta sección incluía `cancelar` (vaciando el estado con
`estadoVacio()`), una semántica que nunca estuvo especificada aquí ni en `spec.md` a
nivel de comportamiento — se descarta sin reemplazo.

`opciones?` en `agregar_item`, `cambiar_cantidad`, `quitar_item`, `elegir_opcion` y
`declinar_grupo` es **el tipo `OpcionPropuesta[]` que ya existe**
(`normalizar.ts:34`: `{ grupo?: string | null, opcion: string }`) — no se crea un tipo
paralelo. En `agregar_item` describe lo que el cliente pidió de una vez (*"una
Churrita con arequipe"* en una sola operación); en las demás es opcional y **solo
sirve para desambiguar** cuando el nombre solo no basta (dos líneas del mismo producto
con opciones distintas) — la mayoría de los turnos no la necesitan, porque la mediana
de un pedido real es 1 ítem.

**Por qué no hace falta un id ni siquiera para distinguir dos líneas del mismo
producto** (la pregunta que motivó revisar esto): si dos ítems del estado son
*totalmente* idénticos (mismo `ofrecible`, mismas `opciones`), da igual cuál de los
dos toque una operación — el resultado final es el mismo estado. Si son distintos
(mismas opciones no), el nombre más las opciones ya elegidas los distingue. Y si el
modelo no da suficiente para distinguir dos líneas genuinamente distintas, la
Compuerta 2 devuelve el mismo `multiple_matches` que ya usa `buscarProductos` hoy — se
pregunta al cliente, no se adivina. No es un mecanismo nuevo: es el que ya está
calibrado en producción.

**Reglas de forma, no negociables:**

- `additionalProperties: false` y todos los campos `required`, igual que hoy exige el
  modo estricto del proveedor (`actions.ts:107` y siguientes ya lo hacen).
- **Ningún campo de `Operacion` es un id opaco que el modelo deba recordar de un turno
  anterior.** Todo nombre se resuelve contra datos reales EN EL MOMENTO de aplicar la
  operación, nunca se confía en algo que el modelo memorizó. `requisitoId` no es una
  excepción real: es una clave que el propio esquema JSON define de nuevo en cada
  turno a partir de la ficha del negocio (igual que el `enum` de `fijar_modalidad`),
  no algo que el modelo deba arrastrar de una llamada anterior.
- `valor` en `fijar_dato` es el único texto libre permitido sin resolver contra nada
  (nombre, dirección) — es justo lo que `estructura-vs-prosa` clasifica como dato que
  solo lee una persona después.

## 2. Cómo se aplica un lote — atómico, todo o nada

**Decisión (corregida 15-sep-2026, señalada por Esteban):** el lote es atómico. Si
CUALQUIER operación del lote falla, **no se persiste ninguna** — ni siquiera las que
pasaron antes que ella. Es la lectura correcta de US3 punto 4 del spec ("el estado no
se modifica en absoluto"): esa garantía es sobre el LOTE, no solo sobre la operación
que falló. La versión anterior de este documento describía persistencia parcial
(las operaciones previas se guardaban aunque una posterior fallara); quedaba en
contradicción directa con esa aceptación de US3, y se descarta.

El modelo emite **cero o más** operaciones en un turno (`operaciones: Operacion[]`,
puede ser `[]` si el turno no cambia nada del pedido). El backend las aplica **en
orden**, sobre una copia en memoria a partir del último estado guardado
(`leerEstadoConVersion`, `estado.ts:536`) — nunca escribe en la base hasta el final:

```
estado_0 = estado guardado (SOLO en memoria, sin escribir)
para cada operación i en la lista, en orden:
    resultado = aplicarOperacion(estado_(i-1), operación_i, contexto)
    si resultado.ok:
        estado_i = resultado.estado
    si NO resultado.ok:
        DETENER el lote — descartar TODO lo calculado en memoria
        devolver { persistido: false, rechazo: resultado, operacionFallida: i }
// solo si TODAS las operaciones pasaron:
devolver { persistido: true, estadoFinal: estado_N }
```

**Si una falla, es como si el turno no hubiera propuesto ningún cambio.** Si el
cliente dice "agrega dos pavés y confirma" y agregar pasa pero confirmar falla (faltan
datos), **el pavé NO queda en el carrito** — el estado guardado sigue siendo
exactamente el de antes del turno. El motivo del rechazo se le da al modelo para que
lo explique y el cliente lo repita en el turno siguiente (US4: nunca deriva por esto).

**Por qué atómico y no parcial:** un lote parcialmente aplicado deja al backend
"adivinando" cuál de las operaciones de un mensaje el cliente realmente quiso mantener
cuando otra falló en la misma frase — exactamente el tipo de estado ambiguo que este
diseño existe para evitar. Todo-o-nada es más simple de razonar, de probar, y de
explicarle al cliente ("no pude hacer eso, ¿lo intentamos de nuevo?" es más claro que
un carrito a medio actualizar).

`guardarEstado` (`estado.ts:564`) se llama **una sola vez, y solo si el lote entero
tuvo éxito**, con `estado_N`. Si el lote falla en cualquier punto, `guardarEstado` NO
se invoca — el estado en la base queda intacto, con la misma versión de antes.

## 3. Las tres compuertas — `aplicarOperacion`

Firma (a nivel de diseño, no de código):

```
aplicarOperacion(estadoActual, operacion, contexto) → 
    { ok: true, estado: EstadoDelPedido }
  | { ok: false, motivo: string, correccion: string }
```

`contexto` trae lo que la operación necesita para resolver contra datos reales:
`organizationId` (Principio III, no negociable), el catálogo o la agenda ya
consultados, y los requisitos de la ficha del negocio.

**Compuerta 1 — ¿existe la operación?** El `tipo` está en la lista cerrada de la
sección 1, y aplica al vertical de este negocio (`fijar_servicio` no existe para un
negocio de pedidos). Fuera de eso, Zod ya la rechaza antes de llegar aquí — el
contrato mismo es la primera compuerta.

**Compuerta 2 — ¿resuelven sus parámetros contra datos reales?** El nombre
referenciado (`ofrecible`, `servicio`, `especialista`, `grupo`/`opcion`) se resuelve
de nuevo, en este mismo instante, contra el catálogo o la agenda de ESTA
organización — reutiliza los mismos buscadores que ya usan las consultas verificadas
(`buscarProductos`, `buscarOpciones`, `buscarServicio`, `resolverZonaDeEntrega`) y las
operaciones que mutan una línea existente (`cambiar_cantidad`, `quitar_item`,
`elegir_opcion`, `declinar_grupo`) contra `estado.items` — nunca un buscador nuevo.
Un nombre que no resuelve (`not_found`) o que resuelve a más de una línea sin
suficiente detalle para distinguirlas (`multiple_matches`, mismo criterio que ya usan
los buscadores hoy) rechaza aquí. Como el catálogo/agenda que se le pasa a estos
buscadores ya viene filtrado por organización (Principio III), no existe la categoría
"id de otra organización" que sí habría hecho falta vigilar con ids — resolver por
nombre contra una lista ya acotada es, por construcción, imposible de escapar del
tenant.

**Compuerta 3 — ¿el estado actual la permite?** Reglas de negocio sobre el estado, no
sobre el catálogo: elegir una opción de un grupo que ese producto no tiene, declinar un
grupo obligatorio, confirmar con un requisito sin cubrir. Esta compuerta reutiliza las
validaciones que hoy vivan en
`validarPropuesta`/`normalizarPedido` (`estado.ts:304`, `normalizar.ts:751`) — se
adaptan a validar UNA operación contra el estado, no un estado completo contra el
catálogo.

Si cualquiera falla: **el estado no cambia, ni parcialmente**, para esa operación
individual. El `motivo` es para la traza (`traza.ts`); la `correccion` es lo que se le
da al modelo, mismo patrón que usan hoy los 24 guardarraíles (`anuncio-de-cierre.ts`)
para pedir un reintento.

**Dos niveles de atomicidad, no uno solo.** `aplicarOperacion` (esta sección) es
atómica para UNA operación: pasa las tres compuertas o no cambia nada. `aplicarOperaciones`
(plural, sección 2) es atómica para el LOTE completo: si la operación 3 de 5 falla, ni
siquiera las operaciones 1 y 2 —que sí pasaron sus propias tres compuertas— quedan
guardadas. El primer nivel protege una operación de sí misma; el segundo protege el
turno completo de quedar a medias.

## 4. `confirmar` — dónde vive `puedeConfirmarPedido`

`confirmar` no es una operación como las demás: además de sus tres compuertas, pasa
por la Policy ya existente (`orders/policy.ts:93`, `puedeConfirmarPedido`), que hoy
solo verifica idempotencia. Esta feature la **amplía** —no la reemplaza— para que
también lea el estado guardado: sin ítems resueltos, sin total calculado, o con un
requisito obligatorio sin cubrir, `confirmar` falla en la Policy antes de llegar a
`ejecutarConfirmacionDePedido`. Mismo patrón para citas contra
`appointment_booking_confirmation`.

## 5. Qué NO cambia de forma

- `EstadoDelPedido` (`estado.ts:154`): mismos campos. Las operaciones lo modifican
  parcialmente; nadie más lo reemplaza entero.
- `order_confirmation` / `appointment_booking_confirmation`: mismo esquema, misma
  idempotencia.
- `AgentAction` (`actions.ts:12`): sigue existiendo para `reply`, `send_image`,
  `send_menu`, `handoff`, las cuatro consultas verificadas. Lo único que cambia es qué
  viaja en el bloque de estado de `chatJsonConEstado`.

## 6. Ejemplo end-to-end

Cliente: *"agrégame otro pavé y cámbialo a Ciudad 2000"*.

```
operaciones: [
  { tipo: "agregar_item", ofrecible: "pavé chocolate", opciones: [], cantidad: 1 },
  { tipo: "fijar_dato", requisitoId: "direccion", valor: "Ciudad 2000" }
]
```

1. `agregar_item` → Compuerta 2 resuelve `"pavé chocolate"` contra el catálogo real
   con `buscarProductos` (un solo resultado, sin ambigüedad) → pasa → estado con
   2 ítems.
2. `fijar_dato` → sin catálogo que resolver (es texto libre permitido) → Compuerta 3
   verifica que "dirección" es un requisito declarado por este negocio → pasa → estado
   con la dirección puesta.
3. Las dos pasaron → se llama `guardarEstado` UNA vez con el resultado final. El
   modelo redacta el mensaje al cliente usando el total que YA calculó el backend al
   aplicar `agregar_item` — nunca lo calcula él.

### El mismo ejemplo, con la tercera operación fallando

**Corrección del 16-sep-2026:** la versión anterior de este ejemplo describía a
`cambiar_cantidad` verificando "disponibilidad real" de un producto ("solo hay 3
pavés disponibles hoy"). Encontrada como contradicción al llegar a T011: el catálogo
de pedidos (`ProductoDelCatalogo`) **no tiene ningún concepto de stock o unidades
disponibles** —es un menú, no un inventario— y la Compuerta 3 de `cambiar_cantidad`
que de verdad implementa T006 (`orders/operaciones.ts`) solo verifica que la
cantidad sea un entero de 1 o más. Documentar una capacidad que el sistema no tiene
habría cristalizado esa invención en los tests de T011. Se reemplaza el disparador
de la falla por uno que sí existe hoy — la propiedad que este ejemplo demuestra
(atomicidad del lote) no cambia con el reemplazo.

Cliente: *"agrégame otro pavé, cambia la cantidad a 0, y confirma"*.

```
operaciones: [
  { tipo: "agregar_item", ofrecible: "pavé chocolate", opciones: [], cantidad: 1 },
  { tipo: "cambiar_cantidad", ofrecible: "pavé chocolate", cantidad: 0 },
  { tipo: "confirmar" }
]
```

1. `agregar_item` → pasa → estado en memoria con 2 ítems.
2. `cambiar_cantidad` a 0 → Compuerta 2 resuelve `"pavé chocolate"` contra
   `estado.items` (una sola línea, sin ambigüedad) → Compuerta 3 verifica que la
   cantidad sea un entero de 1 o más → **falla** (0 no es una cantidad válida).
3. **Se detiene aquí. `confirmar` ni siquiera se evalúa.** `guardarEstado` **no se
   llama**. El estado en la base sigue exactamente como estaba ANTES de este turno —
   el pavé agregado en el paso 1 no queda guardado, aunque esa operación sí había
   pasado sus propias tres compuertas.
4. El modelo recibe la `correccion` de la operación 2 ("la cantidad debe ser un
   número entero de 1 o más") y se lo explica al cliente. El cliente puede repetir
   el pedido completo, o ajustarlo, en el turno siguiente — no queda un carrito a
   medias con solo una parte de lo que dijo.
