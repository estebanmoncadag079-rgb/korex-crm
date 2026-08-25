# 141 — El menú guiado de WhatsApp (listas y botones)

25-ago-2026.

## El incidente que lo motiva

Una clienta de Lis Pastelería escribió "¿Tienen disponible torta de
chocolate?" y luego "¿La porción?". El bot escaló a una persona en vez de
responder. Investigado a fondo contra la base real (ver
[140](140-REQUISITO-FUERA-DE-CATALOGO-BLOQUEABA-EL-GUARDADO.md) para el
incidente vecino del mismo día): el catálogo estaba bien cargado — el
producto real se llama **"Porción Chocolate"**, $12.500, disponible — pero el
modelo no conectó el sinónimo de la clienta con el nombre exacto del
catálogo, y en otras conversaciones anteriores (19-ago, 21-ago) sí lo había
hecho. Es un fallo probabilístico del modelo, no un dato faltante.

Esteban pidió la solución de raíz: que el cliente **toque** una opción en vez
de escribir texto libre que el modelo tenga que adivinar — y que sea una
capacidad genérica de Vocero, no un parche solo para Lis.

## Por qué esto no es un guardarraíl

Antes de escribir código se investigó si WhatsApp soporta esto de verdad
(fuente oficial de YCloud, el proveedor que ya usa el sistema): sí — mensajes
de **lista** (hasta 10 opciones en hasta 10 secciones) y de **botones**
(hasta 3), por el mismo endpoint que el sistema ya usa para texto e imágenes
(`sendDirectly`). Cuando el cliente toca, el sistema recibe exactamente qué
eligió — cero ambigüedad, cero interpretación del modelo.

Se consultó a un diseñador UX y a un arquitecto (con este contexto ya
confirmado) antes de tocar código. Conclusión alineada de los dos: **no**
conviene un árbol profundo de listas encadenadas — cada nivel extra es
fricción, no ayuda. Basta un menú de intenciones (nivel 0) y, si el catálogo
cabe en 10 filas, una sola lista con secciones por categoría (nivel 1). Una
sub-lista por categoría (nivel 2) queda pospuesta: ningún negocio real la
necesita hoy.

## La arquitectura

**Nivel 0 (intenciones)** vive en `ficha.menu` — un campo nuevo, análogo a
`saludoInicial`, editable en el wizard de alta con el mismo componente
`Lista` que ya existía. El dueño del negocio solo escribe el texto ("Hacer un
pedido"); el `id` que WhatsApp necesita se deriva solo (`idDeOpcionDeMenu`,
`ficha.ts`) — nunca lo ve ni lo escribe.

**Nivel 1 (categorías → productos) NO se declara aparte.** Se deriva de la
tabla `product` en el momento de armar el menú (`armarMenuDeCatalogo`,
`src/server/catalog/menu.ts`). Declararlo en la ficha habría repetido
exactamente el error que ya corrigió `catalog_source`: un catálogo editable
en dos lugares, donde uno se queda viejo sin que nadie se entere.

**El modelo decide el momento, nunca el contenido.** Nueva acción
`send_menu` (`tipo: "intenciones" | "catalogo"`, mismo contrato que
`send_image`): el modelo pide cuándo mostrar el menú, y el servidor arma las
filas desde datos reales. Si el menú no cabe en los límites de WhatsApp (más
de 10 productos sin categorías, un nombre demasiado largo) o no hay datos,
**degrada al texto normal** — nunca falla en silencio. `reply` es obligatorio
en el esquema para esta acción, por la misma razón que ya cerró el
guardarraíl del turno mudo
([133](133-TURNO-MUDO-SIN-REPLY.md)): sin él, degradar dejaría al cliente sin
una sola palabra.

**Recepción**: cuando el cliente toca una opción, YCloud manda
`interactive.list_reply`/`button_reply` con el título elegido. Se convierte
en el `text` del mensaje entrante — igual que ya se hace con una edición
(`type: "edit"`) — así que el resto del pipeline (ingesta, historial,
guardarraíles) no cambió ni una línea: el agente sigue la conversación con
naturalidad después del toque, no se volvió un árbol rígido.

**Interruptor**: `agent_profile.menu_mode` (`'texto'` por defecto, `'guiado'`
encendido), mismo patrón Fase 1 que `catalog_source`/`payment_source`.
Depende de `catalog_source='tabla'` — sin el catálogo en tablas no hay de
dónde derivar las secciones. Script `pnpm migrar:menu <org>
[--aplicar|--encender|--apagar]`: sin flags revisa (marca violaciones de
límites sin escribir nada), `--aplicar` siembra un `ficha.menu` de partida
neutral para quien no pasó por el wizard nuevo, `--encender`/`--apagar`
activan o revierten con las guardas correspondientes.

## Verificado

- `tsc --noEmit` y `eslint`: limpios en los 20 archivos tocados.
- 21 pruebas unitarias nuevas: el renderer del menú (agrupa por categoría,
  respeta los límites de WhatsApp, degrada a `null` en vez de truncar un
  nombre a algo ambiguo), el parser del webhook (`list_reply`/`button_reply`
  → texto), la instrucción condicionada en el prompt (solo aparece con las
  dos condiciones a la vez, nunca en citas), la validación del esquema
  (`send_menu` sin `reply` no es válido) y `idDeOpcionDeMenu`.
- Suite completa: **1008 pruebas, 0 fallos**, sin regresiones.

**Lo que NO se verificó todavía** (decisión pendiente, no de código): probar
en el Laboratorio con el catálogo real de Lis, y encender `menu_mode='guiado'`
para Lis con `pnpm migrar:menu org_lispasteleria0001 --aplicar --encender` —
son pasos que gastan una llamada real al modelo y tocan producción, así que
quedan para cuando Esteban decida darle luz verde, siguiendo el mismo patrón
de todo `regenerar:flota`/`migrar:*` de este proyecto.

## Actualización del mismo día: el nivel 2 SÍ hacía falta

Al preparar la prueba real con Lis, este documento decía "ningún negocio real
necesita sub-listas de nivel 2" — **era falso**. El catálogo real de Lis
tiene 15 productos, y el límite de WhatsApp para una lista es **10 filas en
total, sumando todas las secciones** (no 10 por sección, como se asumió al
diseñar). Encender el menú guiado para Lis con el diseño original habría
dejado "Ver menú y precios" degradando siempre a texto — exactamente el
mismo comportamiento de hoy, sin resolver el incidente que lo motivó.

Se agregó el nivel 2 el mismo día: `armarMenuDeCategorias` (lista solo los
nombres de categoría) y `armarMenuDeCategoria` (los productos de una,
terminando en una fila "⬅ Volver a categorías" — ninguna sub-lista es un
callejón sin salida). `armarMenuDelCatalogo` es el punto de entrada que usa
el pipeline: intenta el catálogo entero en una lista: si no cabe, cae a
categorías. La acción `send_menu` gana un campo opcional `categoria`, y la
instrucción del prompt le explica al modelo el ida-y-vuelta (tocar una
categoría → pedir esa categoría; tocar "Volver" → pedir sin categoría).

De paso, al preparar los datos reales de Lis para la prueba, se encontraron y
corrigieron dos errores de captura en su `ficha.menu` (recién escrito desde
el wizard): las 4 opciones estaban pegadas como una sola entrada de texto
(se separaron), y una etiqueta con un emoji compuesto ("🧑‍💼", persona +
maletín) medía 26 caracteres — sobre el límite de 24 para una fila de lista —
así que se le quitó el emoji.

## Verificado (ampliado)

9 pruebas más (24 en total): categorías derivadas correctamente del catálogo
real de Lis reproducido en el test, la sub-lista de una categoría con su fila
de volver, y que `armarMenuDelCatalogo` elige automáticamente entre plano y
por categorías según si cabe. Suite completa: **1016 pruebas, 0 fallos**.

## Lo que no se resuelve en esta fase (documentado, no descartado)

- Sub-listas de nivel 3 (una categoría que ella misma supere 9 productos,
  descontando la fila de "Volver"): no ha aparecido en ningún negocio real
  todavía — si aparece, es el mismo patrón otra vez, un nivel más.
- Vertical de citas: el catálogo de servicios tiene su propia estructura
  (duración, especialista); se evalúa aparte con datos reales.
- El wizard no valida en vivo los límites de WhatsApp mientras el dueño
  escribe (solo el script `migrar:menu` los marca) — una mejora de UX
  razonable, no bloqueante para esta fase.
