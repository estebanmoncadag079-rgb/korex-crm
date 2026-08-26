# 142 — Consultas verificables: `consultar_producto` y `consultar_medio_pago`

26-ago-2026.

## El incidente que lo motiva

El mismo del [141](141-MENU-GUIADO-DE-WHATSAPP.md): una clienta de Lis
preguntó "¿Tienen disponible torta de chocolate?" y el bot escaló, aunque el
producto real existe como **"Porción Chocolate"**. El menú guiado resuelve la
mitad "el cliente toca en vez de escribir" — pero cuando SÍ escribe (una
pregunta abierta, un nombre parafraseado, "¿cuánto cuesta la X?"), el modelo
seguía decidiendo el hecho leyendo el catálogo como prosa dentro del prompt.

Se pidió una auditoría completa, sin código, de cómo se reparte hoy la
responsabilidad entre CRM (fuente de verdad), backend (motor de decisión) y
LLM (interpretación/redacción). El principio que la guio: **el LLM no debe
decidir hechos que el backend pueda verificar**. La auditoría encontró que el
vertical de **citas** ya resolvió exactamente este problema para
disponibilidad (`consult_availability`, docs
[104](104-ALGORITMO-BUSCAR-SERVICIO-SUBSTRING-AMBIGUO.md) y
[109](109-NIEGA-DISPONIBILIDAD-SIN-VERIFICAR.md)) — y que **pedidos nunca
tuvo su equivalente**. Este documento es clonar ese molde, no inventar una
arquitectura nueva.

Caso hermano, mismo día conceptual: el 24-ago Lis ya había tenido el
[caso Nequi](135-FORMAS-DE-PAGO-DESDE-LA-FICHA-CASO-NEQUI.md) — el negocio
declaraba "transferencia" y el modelo no reconoció que Nequi lo es. Aquel
arreglo fue una instrucción de prompt (`pagoDePedidosParaElPrompt`, que sigue
existiendo tal cual, como respaldo). Esta ronda le agrega la otra mitad: un
hecho verificado, no solo una súplica de texto.

## La arquitectura (idéntica a `consult_availability`, para otro dato)

Dos acciones internas nuevas — nunca le llegan al cliente, el sistema
responde en el mismo turno:

- `{"action":"consultar_producto","consulta":"..."}` — el servidor busca en
  el catálogo real (`buscarProductos`, `src/server/catalog/buscar.ts`, mismo
  algoritmo de `buscarServicio`: exacto → substring único → tokens con
  overlap/ratio, `multiple_matches` si dos candidatos empatan en vez de
  "el primero alfabético") y le devuelve al modelo `found` / `multiple_matches`
  / `not_found` como mensaje `[SISTEMA]`.
- `{"action":"consultar_medio_pago","metodo":"..."}` — el servidor resuelve
  contra `ficha.pago.formas` (`resolverMetodoDePago`,
  `src/server/pagos/metodo.ts`): coincidencia literal, o un diccionario
  mínimo de sinónimos colombianos (Nequi/Daviplata/Bancolombia a la mano →
  "transferencia"). Sin reconocerlo → `unknown`, y el modelo sigue la
  instrucción de siempre.

Ambas se agregan al prompt **solo cuando aplican** (mismo criterio
condicional que ya usa `buildAgentSystemPrompt`): `consultar_producto` con
`catalog_source='tabla'`, `consultar_medio_pago` con `payment_source='ficha'`
— nunca crecen el prompt de un negocio que no las necesita.

**Ejecución** (`pipeline.ts`): dos bucles `while` independientes, después
del de `consult_availability` y entre sí (nunca se activan a la vez:
`consultar_producto`/`consultar_medio_pago` solo en el prompt de pedidos,
`consult_availability` solo en citas). Mismo tope de 2 vueltas, mismo truco
de rol `"user"` con prefijo `[SISTEMA]` en vez de `"system"` al final (bug ya
documentado de Gemini: `content: null` si el último mensaje es de sistema
sin turno de usuario después).

**Guardarraíl de contradicción** (`anuncio-de-cierre.ts`): la mitad
simétrica de "niega disponibilidad sin verificar". Allá el guardarraíl exige
CERO consultas; aquí exige que **sí hubo una consulta real** y que, pese a
eso, la respuesta final niega el hecho que el propio servidor confirmó —
`contradiceProductoEncontrado` / `niegaMetodoDePagoPermitido`, mismo molde de
detección por oraciones (ignora preguntas, exige que la negación mencione el
propio producto/método para no marcar falsos positivos como "no manejamos
domicilios a Bogotá" al preguntar por una torta). Si sigue contradiciendo
tras un reintento, deriva a una persona — igual que el resto de guardarraíles
de este archivo.

## Archivos

**Nuevos**: `src/server/catalog/buscar.ts` (`buscarProductos`),
`src/server/pagos/metodo.ts` (`resolverMetodoDePago`),
`tests/unit/buscar-productos.test.ts`, `tests/unit/metodo-de-pago.test.ts`,
`tests/unit/contradice-hecho.test.ts`, `tests/unit/pipeline-consultar-producto.test.ts`.

**Modificados**: `src/server/ai/actions.ts` (dos acciones en la unión
discriminada + `CAMPOS_DE_ACCION`), `src/server/ai/prompts.ts`
(`CONTRATO_DE_CONSULTA_DE_PRODUCTO`/`CONTRATO_DE_CONSULTA_DE_PAGO`,
insertados condicionalmente), `src/server/ai/pipeline.ts` (los dos bucles y
los dos guardarraíles de contradicción), `src/server/ai/anuncio-de-cierre.ts`
(`contradiceProductoEncontrado`, `niegaMetodoDePagoPermitido` y sus mensajes
de corrección).

## Verificado

- `tsc --noEmit` y `eslint`: limpios en los diez archivos tocados.
- 27 pruebas nuevas: `buscarProductos` (exacto, el caso real "torta de
  chocolate" → Porción Chocolate, substring, empate real →
  `multiple_matches`, catálogo vacío), `resolverMetodoDePago` (Nequi
  reconocido y permitido, método declarado no reconocido categoría,
  desconocido), el guardarraíl de contradicción (detecta, no marca falso
  positivo en preguntas ni en negaciones de otra cosa), y 7 pruebas de
  integración de `runAgentTurn` con mocks completos: producto encontrado,
  no encontrado, múltiples coincidencias, pago permitido, pago no permitido,
  aislamiento multi-tenant (dos organizaciones, catálogos distintos, la
  consulta de una nunca ve el catálogo de la otra) y el guardarraíl de
  contradicción disparándose y corrigiéndose de punta a punta.
- Suite completa: **1043 pruebas, 0 fallos**, sin regresiones.

## Riesgos y lo que queda pendiente

- **No llega a producción solo con este commit.** Como con toda bandera de
  este proyecto (`catalog_source`, `payment_source`), el contrato de estas
  dos acciones aparece en el prompt de un negocio real recién cuando se
  regenere (`regenerar:flota`) — hoy Lis ya tiene `payment_source='ficha'`,
  así que `consultar_medio_pago` le llegaría con solo regenerar;
  `consultar_producto` depende además de `catalog_source='tabla'`. Ninguno
  de los tres clientes reales se tocó en esta ronda.
- El diccionario de sinónimos de pago es deliberadamente pequeño (lo que ya
  causó un incidente real o es sentido común en Colombia) — un método nuevo
  no reconocido cae a `unknown`, que es el comportamiento seguro de siempre,
  no un fallo.
- El guardarraíl de contradicción exige que la oración de negación mencione
  una palabra significativa (4+ letras) del producto/método — es
  deliberadamente conservador: prefiere dejar pasar una contradicción rara
  (frase corta sin nombrar nada, "no, disculpa") a marcar un falso positivo
  sobre una negación de otra cosa.

## Lo que NO cambió (preservado a propósito)

- `consult_availability`, su bucle y su guardarraíl, y todo el vertical de
  citas: cero líneas tocadas.
- `conducta.ts`, `generar.ts`, el modelo de fichas: sin cambios.
- La inyección del catálogo completo en prosa sigue igual, para
  recomendaciones y preguntas abiertas ("algo para 15 personas", comparar
  opciones) — estas dos acciones son un complemento, no un reemplazo.
- `pagoDePedidosParaElPrompt`: sigue existiendo tal cual, como respaldo para
  cuando `consultar_medio_pago` devuelve `unknown`.
