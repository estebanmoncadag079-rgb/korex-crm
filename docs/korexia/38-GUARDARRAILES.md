# Los guardarraíles del agente: cuando el prompt no basta

> **Dentro:** Por qué existen · Los cuatro · Cómo se añade uno · Cuándo NO usar
> uno · Cómo se prueban

Cuatro veces se ha intentado corregir una conducta del agente escribiéndola en
el prompt, cuatro veces no ha bastado, y cuatro veces ha terminado
comprobándose en el servidor. Este documento reúne el patrón para no volver a
descubrirlo cada vez.

> ⚠️ **El cuarto enseñó algo que los otros tres no**: antes de dar por perdido
> el prompt, hay que **leer cómo está escrito**. Allí la regla estaba bien
> redactada pero **mal colocada** —dos plantillas pegadas en la misma sección—,
> y el modelo las concatenaba. Se arregló el prompt y el fallo desapareció; el
> guardarraíl quedó de red, no de parche. Ver el punto 4.

## Por qué existen

**El prompt es una petición, no una garantía.** Sirve para la conducta normal;
falla justo en los casos raros, que son los que hacen daño. Las tres veces el
guion fue idéntico:

1. Se escribe la regla en el prompt, con todas las letras.
2. Se comprueba con un caso y parece funcionar.
3. En producción, o en una variante de la frase, el modelo la ignora.
4. Acaba en el servidor, donde el sistema **comprueba el hecho** en vez de
   pedirlo.

Todos viven en `server/ai/anuncio-de-cierre.ts` (el nombre se quedó del
primero) y se aplican en `runAgentTurn`, con la misma forma: detectar → rehacer
el turno con la corrección delante → comprobar de nuevo.

## Los cuatro primeros

> Hoy son **ocho**: los cuatro últimos (cerrar sin resumen, no dar el total,
> prometer un recurso sin enviarlo, y cerrar sin un requisito declarado) están
> al final de este documento, con la fecha y el caso que los provocó.

| Guardarraíl | Qué evita | Si insiste |
|---|---|---|
| `anunciaCierre` | Decir que el negocio cerró estando abierto | Lo atiende una persona |
| `anunciaCitaAgendada` | Confirmar una cita que nadie agendó | Lo atiende una persona |
| `productosOlvidados` | Que un producto ya pedido desaparezca | Sale como está, se registra |
| `resumenMalArmado` | Cerrar el pedido antes de que confirmen, o anunciar un resumen vacío | Sale como está, se registra |
| `prometeRecurso` | Prometer un catálogo/foto/PDF sin ejecutar `send_image` | Lo atiende una persona |
| requisito faltante | Cerrar (`book_appointment`/`notify_order`) sin un dato que el negocio declaró obligatorio | Lo atiende una persona |

**1. El cierre falso** (1-ago-2026). Con el historial real de producción, el
modelo reprodujo el cierre falso **5 de cada 6 veces**, pese a que el prompt
decía ABIERTO tres veces. Un cliente que quiere comprar hoy y lee "cerramos" se
va.

**2. La cita fantasma** (7-ago-2026). A un "sí confirmo" suelto se inventó
servicio, día, hora y especialista — con `reply`, sin agendar nada. La clienta
se habría presentado a un salón que no la espera.

**3. El producto olvidado** (9-ago-2026). "Cremoso de 7 Oz" → el agente pregunta
el topping → "Quiero un cremoso de 16 Oz" → el de 7 oz se esfuma. Se verificó
contra el pipeline real que la regla del prompt **funcionaba con "y también uno
de 16" y fallaba con "quiero un cremoso de 16"**, que es como ocurrió de verdad.

Detecta por **medida** (7 oz, 16 oz, 500 ml…) y no por nombre de producto: es
lo que distingue las variantes que se confunden entre sí y no depende del
catálogo de cada negocio. Calla si el cliente anuncia un cambio ("mejor", "en
vez de", "cámbialo"), porque ahí sustituir es lo correcto.

**4. El resumen mal armado** (12-ago-2026). El único que se **midió antes de
construirlo**, y el que más caro salía. Sobre los 24 resúmenes reales de Lis:

| Fallo | Casos | % |
|---|---|---|
| Pide confirmar **y se despide** en el mismo mensaje | 19 | **79 %** |
| Anuncia un resumen y no escribe ninguno | 3 | 12 % |
| La Churra (otro prompt) | 0 de 12 | 0 % |

El caro es el primero, por lo que desencadena: el agente da la conversación por
cerrada antes de tiempo, así que al "confirmo" del cliente **no manda los datos
de pago**. La dueña los escribe a mano desde el celular → eso activa el relevo
humano → el relevo **silencia al agente 2 horas**. El bot falla el cierre, la
dueña interviene, y su intervención apaga al bot. Medido: en 14 días el equipo
de Lis escribió el **65,6 %** de las respuestas (La Churra, 47,6 %) y hubo
relevo humano en **53 de 77** conversaciones.

**La causa raíz era del prompt, y ahí se arregló.** Las dos plantillas —la de
antes de confirmar y la de después— vivían pegadas dentro de la misma sección
"Resumen y cierre", separadas solo por un párrafo. El modelo las leía como un
bloque y las concatenaba, quedándose con los extremos y **saltándose el cuerpo,
que es justo donde están los datos de pago**. Se partieron en `MOMENTO 1` y
`MOMENTO 2` con un corte explícito ("🛑 AQUÍ TERMINA EL MENSAJE"), y se
verificó contra el pipeline real que el resumen acaba donde debe y los datos de
pago salen tras la confirmación.

De paso se subió la visibilidad de la regla del domicilio: iba en `_cursiva_`,
que WhatsApp pinta más tenue, justo en la línea que no puede pasar desapercibida.
La dueña la reescribía a mano creyendo que faltaba — **sí se enviaba, no se
veía**.

El guardarraíl es la **red**: si el prompt cumple, no salta nunca. Se añadió
igualmente porque el fallo llevaba dos semanas costando pedidos y la clienta ya
había perdido la confianza en el agente.

## Cómo se añade uno

1. **Una función pura** que reciba textos y devuelva el veredicto — nada de
   base de datos ni de red. Así se prueba de verdad, sin modelo.
2. **Una constante de corrección** que le diga al modelo qué hizo mal y qué
   hacer, terminando en "Responde ÚNICAMENTE el objeto JSON".
3. **El bloque en `runAgentTurn`**: si se detecta, se rehace el turno pasando
   la corrección como mensaje de rol **`user`** — nunca `system`. Verificado el
   1-ago: con `system` al final del array, Gemini vía OpenRouter devuelve
   `content: null`.
4. **Registrar el uso** con una etiqueta propia
   (`conv:<id>/producto-olvidado`), que es lo que permite medir después cuántas
   veces salta.

## Cuándo NO usar uno

- **Si el prompt basta.** Cada guardarraíl cuesta una llamada extra al modelo
  cuando salta. Se empieza siempre por el prompt y solo se sube aquí con
  evidencia de que no alcanza.
- **Si el fallo no hace daño real.** Estos tres cuestan una venta, un cliente
  plantado o un pedido incompleto.
- **Si no se puede comprobar con certeza.** Un guardarraíl que se dispara de
  más es peor que el problema: molesta en las conversaciones sanas.

Y ojo con la reacción al fallo persistente: **derivar a una persona no siempre
es la respuesta**. Los dos primeros lo hacen porque su daño es irreversible; el
tercero no, porque equivocarse de tamaño se arregla en el resumen y sacar a un
humano en cada duda es peor remedio que la enfermedad — más aún con un negocio
de volumen.

## Cómo se prueban

**En dos capas**, y las dos hacen falta:

```bash
# 1. La función pura, sin modelo ni red: los casos borde
npx vitest run tests/unit/producto-olvidado.test.ts

# 2. El pipeline REAL contra el modelo, sin gastar WhatsApp
pnpm probar:agente org_lispasteleria0001 'Cremoso de 7 Oz' 'Quiero un cremoso de 16 Oz'
```

La segunda no es opcional: la regla del producto **pasaba las pruebas unitarias
y fallaba en el pipeline real**. Cuando salta, el log lo dice:

```
[agente] se dejó caer 7oz del pedido; rehaciendo el turno
```

> ⚠️ **No reconstruyas el prompt a mano en un script aparte.** `/root/probar-lis.py`
> lo hacía y ni siquiera incluía las `escalation_rules`: llevaba tiempo
> validando un prompt que no era el de producción. Para probar dentro del
> contenedor, la receta de bundle está en
> [30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md).

## Cuando el guardarraíl rompió lo que venía a proteger (13-ago, noche)

Natalia escribió **"Confirmo"** y el agente le devolvió el mismo resumen
pidiéndole confirmar. Escribió **"Correcto"**: otra vez. Escribió **"Si"**: otra
vez. Tres, hasta que una persona entró a mano a las 22:52. El pedido nunca llegó
al equipo por la vía normal.

```
22:43:15  agente   RESUMEN + "POR FAVOR, CONFIRMA TU PEDIDO"
22:43:26  Natalia  Confirmo
22:43:37  agente   RESUMEN otra vez        ←
22:43:48  Natalia  Correcto
22:43:59  agente   RESUMEN otra vez        ←
22:44:14  Natalia  Si
22:44:25  agente   RESUMEN otra vez        ←
```

**No fue el modelo.** Fue el guardarraíl del resumen (12-ago), el que impide
despedirse antes de que el cliente confirme.

`notify_order` lleva dos textos con **dos destinatarios distintos**: el
`summary` va al equipo —y el modelo copia ahí el mismo bloque que ya enseñó,
petición de confirmar incluida— y el `farewell` va al cliente, con la despedida
y los datos de pago. `textosAlCliente` los devuelve juntos, y el detector los
evaluaba **pegados**:

| Texto evaluado | Veredicto |
|---|---|
| Solo el `summary` | limpio |
| Solo el `farewell` | limpio |
| **Los dos pegados** | **cierre-prematuro** |

Con ese veredicto el pipeline rehacía el turno ordenando *"no te despidas
todavía, reescribe el resumen y pide confirmación"*. Y el modelo obedecía.

**El arreglo**: `notify_order` no pasa por ese detector. Esa acción solo existe
DESPUÉS de que el cliente dijo que sí — ahí despedirse y dar los datos de pago
es lo correcto, no un cierre prematuro. El resumen que el cliente ve ANTES de
confirmar se sigue vigilando igual.

> 🔑 **La lección, que vale para los cinco guardarraíles**: un detector escrito
> para un texto que lee el cliente no puede aplicarse a ciegas sobre textos que
> van a otro destinatario. Al juntarlos aparecen firmas que ninguno tiene.
>
> Y la prueba se verificó **al revés**: con el arreglo revertido falla
> (`expected 1 call, got 2`). Una prueba que pasa con y sin el arreglo no
> prueba nada.

## Quinto guardarraíl: cerrar un pedido que el cliente nunca vio (14-ago)

Apareció al migrar Lis al generador. El Laboratorio, conversación entera:

```
CLIENTE  Hola, buenas
AGENTE   ¡Hola! Bienvenid@ a Lis Pastelería 🍰
CLIENTE  ¿Qué opciones tienen para pedir?
AGENTE   Tenemos cremosos, polvorosos… te dejo el menú
CLIENTE  Sí, así está perfecto. Confirmo el pedido
AGENTE   ¡Tu pedido ha sido confirmado! 🎉 Para el pago: llave 0089174299…
```

El equipo recibió un pedido **sin producto, sin toppings, sin nombre y sin
dirección**, y el cliente ya tenía los datos de pago en la mano.

El prompt lo prohíbe —*"el resumen es OBLIGATORIO"*— pero un "confirmo"
entusiasta basta para que el modelo crea que hay algo que confirmar. Así que se
comprueba **el hecho**: que exista un resumen con su total entre lo que el
agente ya le enseñó en esa conversación (`TIENE_TOTAL` sobre el historial).

- Si no lo hay → se rehace el turno con `CORRECCION_SIN_RESUMEN`. En la prueba
  real, el agente pasó a preguntar *"¿QUÉ TE GUSTARÍA PEDIR?"*, que es lo que
  el cliente estaba esperando.
- Si **insiste** en cerrar → lo toma una persona, con un aviso al equipo que
  explica qué pasó ("intentó cerrar sin mostrar el resumen, NO se registró
  nada"). Es de los pocos que escalan: un pedido en falso ya le dio al cliente
  los datos de pago.

> ⚠️ Este fallo **no era de la migración**: el prompt viejo también lo permitía,
> solo que aquella corrida no lo destapó. El guardarraíl protege a toda la flota
> lleve el prompt que lleve.

## Sexto guardarraíl: le piden el total y no lo da (14-ago)

Salió de los 24 escenarios ([55-VEINTICUATRO-CLIENTES.md](55-VEINTICUATRO-CLIENTES.md)),
dos veces el mismo día:

> **CLIENTE** — ¿cuánto es el total?
> **AGENTE** — Con gusto, solo necesito que me confirmes el topping 😊

El topping no cambia el precio. Su prompt **ya se lo prohibía** —*"si te
pregunta cuánto es el total, dale el total"*— y lo hizo igual: es de esas
órdenes que el modelo incumple porque le parece más ordenado completar el pedido
primero.

Y por eso está en el código y no solo en el prompt: **los guardarraíles llegan a
todos los clientes, también a los que aún no se han migrado al generador.** La
conducta, no.

Dos afinados que costaron una ronda cada uno:

- **No exige que el agente hubiera escrito precios antes.** La primera versión
  sí, y se le escapó el caso real: el cliente pidió dos productos del catálogo y
  el agente contestó pidiendo el topping sin haber nombrado una cifra en toda la
  conversación. Podía sumar — los precios están en su conocimiento. Ahora salta
  siempre y es la **corrección** la que distingue: si de verdad no hay nada
  pedido, que pregunte qué quiere. Nunca se le empuja a inventar una cifra.
- **El total es la SUMA, anunciada como tal.** No vale enumerar: *"un Polvoroso
  cuesta $19.000 y un Cremoso $12.000"* tiene los datos pero no la respuesta.
  Quien pregunta el total quiere una cifra, no una lista para sumar de cabeza.

Solo corre en **pedidos**: en un salón el precio de un servicio es fijo y sale
del catálogo, no de una suma.

> ⚠️ Es el único de los seis que **no cierra el caso del todo**: si el reintento
> tampoco da la suma, sale la respuesta original. Entre 23 y 24 de 24 según la
> ronda. Se decidió así — un segundo reintento encarecería todos los turnos de
> todos los clientes por un caso menor, en el que además el cliente ya tiene los
> precios.

## Séptimo guardarraíl: prometer un recurso y no enviarlo (18-ago)

*"¡Claro que sí, hermosa! Te comparto nuestro catálogo de pestañas…"* — con
`reply`, sin haber emitido `send_image`. El cliente lee la promesa; no llega
ni el archivo ni el enlace.

A diferencia del guardarraíl del horario, que se midió y se **descartó** ese
mismo día por afectar a una sola conversación de pruebas, este se midió y
**sí se justificó**: apareció en 3 conversaciones de 2 negocios, una con una
cita real agendada. Detalle completo, la medición, y dos bugs propios
encontrados al escribir las pruebas (el `\b` que no funciona tras una vocal
acentuada, y una pregunta con el `?` lejos del recurso), en
[101-GUARDARRAIL-RECURSO-PROMETIDO.md](101-GUARDARRAIL-RECURSO-PROMETIDO.md).

## Octavo guardarraíl: cerrar sin un requisito declarado (19-ago)

El primero que **no detecta nada en el texto**: la comprobación es de datos
(`faltantes()`, en `server/contacts.ts`), no de una frase que el modelo
escribió. Frena `book_appointment` o `notify_order` si el negocio declaró un
dato obligatorio (el nombre, hoy) que el contacto todavía no tiene.

Es también el primero que corre **en los dos verticales con el mismo
código**: pedidos y citas comparten el mismo hueco (ninguno exige nada
declarado con `stateSource='prompt'`, que es toda la flota real), así que
protegerlo en uno lo protege gratis en el otro.

Detalle completo —la auditoría, las tres alternativas descartadas antes de
elegir esta, y dos hallazgos que aparecieron solo al escribir el código
(`contact.name` se rellena con el teléfono cuando no hay nombre real; qué
pasa si se declara un requisito que el sistema no sabe capturar)— en
[102-REQUISITO-NOMBRE-EN-CITAS.md](102-REQUISITO-NOMBRE-EN-CITAS.md) y
[103-REQUISITOS-IMPLEMENTADO.md](103-REQUISITOS-IMPLEMENTADO.md).
