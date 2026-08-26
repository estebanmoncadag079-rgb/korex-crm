# 143 — Verificación factual forzada, por organización

26-ago-2026.

## El hallazgo que lo motiva

La prueba controlada con Lis ([142](142-CONSULTAR-PRODUCTO-Y-MEDIO-DE-PAGO.md))
demostró que `consultar_producto` funciona, pero encontró un límite honesto:
el modelo no siempre decide usarla. Con "¿Tienen torta de chocolate?" a veces
resolvía directo con el catálogo en prosa que sigue en el prompt (Fase 6 del
diseño anterior: deliberadamente no se retiró) — una respuesta correcta esa
vez, pero por la misma ruta probabilística que causó el incidente original.
La decisión de verificar no puede depender únicamente de que el modelo
quiera.

## La arquitectura: precheck determinista, no un clasificador nuevo

**Punto de intervención elegido**: justo después de armar `messages` (system
prompt + historial) y **antes** de la primera llamada al modelo, en
`runAgentTurn` (`pipeline.ts`). Se descartó:

- Un clasificador LLM aparte: sería un segundo modelo, más costo, más
  latencia, y el propio riesgo que se quiere evitar (que decida mal) solo
  que en un lugar distinto.
- Un orquestador nuevo: el flujo `ingest → runAgentTurn → prompt → LLM →
  AgentAction → guardarraíles → respuesta` no cambia; solo se añade un paso
  determinista **antes** del primer tramo.
- Forzar la acción `consultar_producto` desde el esquema: no hay forma de
  obligar a un modelo a emitir una acción concreta sin arriesgar romper
  turnos donde de verdad no aplica.

En vez de eso: `detectarConsultaFactualDeProducto` (nuevo,
`src/server/catalog/deteccion.ts`) — reglas de texto conservadoras, sin IA,
que deciden si el ÚLTIMO mensaje del cliente es una pregunta factual
concreta. Si lo es, el servidor llama a `buscarProductos` **antes** de que
el modelo diga una sola palabra, y le entrega el hecho verificado ya en el
array de mensajes — la primera respuesta del modelo nace con el dato
correcto, sin depender de que decida consultarlo.

### Qué cuenta como factual concreta (TIPO A) y qué no (TIPO B)

| Se fuerza (TIPO A) | No se fuerza (TIPO B) |
|---|---|
| "¿Tienen torta de chocolate?" | "¿Qué tienen de chocolate?" (categoría) |
| "¿Tienen disponible X?" | "¿Tienen algo de X?" (categoría) |
| "¿Venden/hay/manejan X?" | "¿Qué me recomiendas?" |
| "¿Cuánto cuesta/vale X?" | "Quiero algo para 15 personas" |
| | "Busco algo no tan dulce" |
| | "Algo para el cumpleaños de mi mamá" |

Las señales abiertas se comprueban PRIMERO: si aparece cualquiera, la
función devuelve `null` de inmediato y el turno sigue exactamente como
antes — catálogo completo, razonamiento del modelo, sin ninguna búsqueda
forzada. Es deliberadamente conservador: ante la duda, no fuerza nada.

### Reutilización, no duplicación

- `buscarProductos`/`textoDeResultadoProducto`: sin cambios, es el mismo
  camino de `consultar_producto` (142). El mensaje `[SISTEMA]` que recibe el
  modelo es idéntico venga de una consulta explícita o del precheck.
- El guardarraíl de contradicción (`contradiceProductoEncontrado`) ahora
  cubre AMBOS orígenes: la variable `resultadoProducto` se declara una sola
  vez, antes de la primera llamada, y tanto el precheck como el bucle
  explícito de `consultar_producto` la actualizan — el guardarraíl no sabe
  ni le importa de cuál de los dos vino el hecho.
- **Una sola consulta a la base de datos por turno.** `productosDelPedido`
  (el catálogo real) se carga una vez, al principio, para armar el catálogo
  en prosa del prompt — y esa misma lista en memoria la usan tanto el
  precheck como el bucle de `consultar_producto` si el modelo igual decide
  llamarlo. Antes, el bucle repetía la consulta a la base cada vez que se
  entraba a él; ahora no repite ninguna, sin importar cuántas veces se pase
  por ahí en el mismo turno.

## El flag: `consultas_verificadas_enabled`

Booleano en `agent_profile`, mismo patrón que `catalog_source`/
`payment_source`: nace en `false` (cero efecto en nadie) y se enciende
organización por organización. Solo tiene efecto si `catalog_source =
'tabla'` — sin catálogo real no hay contra qué verificar.

```
Lis Pastelería:                true   ← única encendida
korex.ia (agencia):            false
Lashes Valen:                  false  (vertical de citas, no aplica igual)
PRUEBA pedidos:                false
La Churra:                     false  (aunque catalog_source='tabla')
```

La Churra fue el caso que obligó a este diseño en primer lugar: como ya
tenía `catalog_source='tabla'` desde una fase anterior, un simple deploy del
código de `consultar_producto` (142) le habría activado esa acción sin
pedirlo. Con el flag nuevo, activar Lis no toca a La Churra ni a nadie más
— verificado con una consulta real: la tabla de arriba es la fila completa
de las 5 organizaciones existentes.

Migración `0030_consultas_verificadas_por_organizacion.sql`, aplicada en
producción a mano (mismo procedimiento que 0028/0029) y encendida solo para
`org_lispasteleria0001` con un `UPDATE` de una fila.

## Pruebas ejecutadas

**Automatizadas**: 25 pruebas nuevas — `tests/unit/deteccion-consulta-factual.test.ts`
(17, todos los patrones de la tabla de arriba) y
`tests/unit/pipeline-forzar-consulta-factual.test.ts` (8: flag encendido con
verificación en la primera llamada, precio, pregunta abierta que NO fuerza,
consulta interpretativa que NO fuerza, producto inexistente, flag apagado
sin cambios, aislamiento multi-tenant, y que no se repite la consulta a la
base de datos si el modelo igual llama a `consultar_producto` tras el
precheck). `tsc --noEmit` y `eslint` limpios. Suite completa: **1068
pruebas, 0 fallos**, sin regresiones sobre `consult_availability` ni el
resto del vertical de citas.

**Controladas, contra la base real de Lis** (mismo mecanismo que 142: local,
sin desplegar, `pnpm probar:agente <org> "mensaje"`, sandbox `is_test`):

| Mensaje | Detección | Backend | Respuesta | Resultado |
|---|---|---|---|---|
| "¿Tienen torta de chocolate?" | factual → "torta de chocolate" | found, $12.500 | confirma correctamente | PASS |
| "¿Tienen disponible torta de chocolate?" | factual → "torta de chocolate" | found, $12.500 | confirma correctamente | PASS |
| "¿Cuánto cuesta la torta de chocolate?" | factual → "torta de chocolate" | found, $12.500 | precio exacto | PASS |
| "¿Qué tienen de chocolate?" | abierta, no forzada | — | remite al catálogo completo | PASS |
| "Quiero algo para 15 personas, no tan dulce" | interpretativa, no forzada | — | recomienda Mini Box / Cremoso Familiar | PASS |
| "¿Tienen cupcakes de vainilla?" | factual → "cupcakes de vainilla" | not_found | no inventa, ofrece lo real | PASS |
| (La Churra, flag apagado) "¿Tienen disponible la Churrita?" | — | — | responde con el catálogo en prosa, sin cambios | PASS (comportamiento intacto) |

Las dos primeras filas son, en particular, la reproducción exacta del
mensaje que en la ronda anterior a veces NO activaba `consultar_producto` —
con el precheck, **ahora lo hace siempre**, sin depender del modelo.

## Diagnóstico del handoff (sin modificarlo)

Se registró, sin tocar ni una línea del código de handoff, el comportamiento
de "Hola, buenas noches" contra Lis: en **5 de 7 repeticiones** (71%), la
conversación escaló con `handoffReason = 'error'`. La causa es trazable y
distinta de la del [doc 127](127-ESCALADA-SIN-CAUSA-ENCONTRADA.md) (que
seguía sin causa encontrada):

```
[agente] fallo del proveedor (raw): la acción no cumple el contrato:
reply send_menu necesita "reply" con lo que le dirías al cliente si el
menú no se pudiera armar [...] · acción recibida: send_menu
```

El modelo, en el turno de apertura, elige correctamente `send_menu` (el
menú guiado) pero **omite el campo `reply` obligatorio** de forma
intermitente — probablemente porque el saludo ya vive en las opciones del
menú y el modelo no ve la necesidad de repetirlo aparte. El validador de
esquema (correcto: `reply` es obligatorio ahí, doc 141, para que degradar a
texto no deje al cliente sin respuesta) rechaza la acción entera, y el
pipeline trata cualquier salida que no cumple el esquema como fallo del
proveedor → handoff. No se investiga ni se corrige en esta ronda — queda
anotado con su causa exacta para una siguiente, con la ventaja de que **acá
sí hay un patrón reproducible** (a diferencia del 127).

## Lo que NO cambió (preservado a propósito)

- `consult_availability`, su bucle, su guardarraíl y el vertical de citas:
  cero líneas tocadas.
- El catálogo completo en prosa: sigue en el prompt para preguntas abiertas
  y de recomendación — no se retiró nada.
- `conducta.ts`, `generar.ts`, el modelo de fichas: sin cambios.
- El handoff y `send_menu`: diagnosticados, no modificados.
- Ninguna otra organización además de Lis tiene el flag encendido.
