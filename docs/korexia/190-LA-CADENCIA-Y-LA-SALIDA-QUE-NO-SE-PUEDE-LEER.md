# 190 — La cadencia conversacional y la salida que no se puede leer

22-sep-2026. Tres fallos de MALIA con `openai/gpt-5-mini`, relacionados entre
sí pero con causas raíz distintas, y una premisa del encargo que resultó falsa.

🟢 **ARQUITECTURA VIGENTE.** No modifica
[156](156-ARQUITECTURA-DECISION-CONVERSACIONAL-KOREX.md) ni la autoridad del
backend: todo lo de aquí vive en la capa de conducta y en una capa nueva de
integridad de salida. El modelo sigue siendo `gpt-5-mini` y el salvavidas de
cierre sigue siendo el de [189](189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md).

---

## 0. La corrección primero: MALIA ya NO está en state_source de prompt

El encargo partía de que MALIA seguía en `prompt` y pedía expresamente no
migrarla. **Leído de la base el 22-sep-2026, los cinco clientes con ficha —La
Churra, Lis, Lashes, Camilabrandcol y MALIA— están en `backend`.** El único
`prompt` que queda es `korex.ia`, la organización de la propia agencia, que no
atiende a nadie.

| Cliente | `state_source` | `catalog_source` | `delivery_source` |
| --- | --- | --- | --- |
| La Churra | backend | tabla | prompt |
| Lashes Valen | backend | prompt | prompt |
| Lis Pastelería | backend | tabla | prompt |
| MALIA | backend | tabla | tabla |
| Camilabrandcol | backend | — (sin ficha) | — |
| korex.ia | prompt | — (sin ficha) | — |

No hubo migración en este trabajo: ya estaba hecha. Lo que sí había eran **tres
comentarios en `pipeline.ts` afirmando lo contrario**, y el propio archivo
avisaba de que eso ya había pasado una vez — decía que hasta el 19-sep afirmaba
que los cuatro clientes estaban en prompt, que era cierto al escribirse y dejó
de serlo sin que nadie lo mirara, *"que es justo el modo en que un comentario
empieza a mentir"*.

Volvió a pasar. Los tres están corregidos y ahora dicen por qué esa lista
caduca sola: si hace falta saber quién está en qué, se consulta
`agent_profile.state_source`. Queda **uno sin corregir**, en
`anuncio-de-cierre.ts:1564`, porque ese archivo estaba fuera del alcance
autorizado: es una línea de comentario, no afecta al comportamiento, y se deja
anotada aquí para que se corrija cuando se toque el archivo.

---

## 1. El problema, en la conversación real

Una clienta (Yuli) escribió tres frases:

```
Hola buen día cómo estás?
Para encargar por fa dos cremosos de 7 onzas
Para un detalle
```

y el agente le devolvió, en un solo mensaje, las opciones de cada producto, si
era regalo, el nombre, el celular, cómo lo recibía y la forma de pago. Seis
cosas a alguien que llevaba dos frases. Además, las opciones llegaban
aplastadas en una línea (`MILO · OREO · AREQUIPE · …`) y en otra conversación
salió una respuesta con `}]}]}` pegado y restos del formato interno del modelo.

---

## 2. Las causas raíz

| # | Qué se veía | Dónde estaba | Por qué pasaba |
| --- | --- | --- | --- |
| 1 | Opciones en una sola línea | `catalog/render.ts` | El bloque de opciones las unía con un separador de punto medio. El modelo **copia los datos duros TAL CUAL** (regla `ESTILO` de `conducta.ts`), así que el formato con el que llega el dato le gana a cualquier instrucción de "haz listas" |
| 2 | El muro de preguntas | `generador/conducta.ts`, `meta()` | Decía literalmente *"agrupa lo que va junto"* y *"Una pregunta por mensaje alarga el pedido y cansa"*, **sin ningún techo**. Se escribió el 13-ago-2026 contra el fallo contrario y con otro modelo detrás; `gpt-5-mini` es más literal y la aplicó hasta el final |
| 2b | Munición para el muro | `ai/prompts.ts`, `requisitosParaElPrompt` | Listaba los datos pendientes y terminaba en *"Si todavía no te lo ha dado, pregúntaselo con reply"*. Leído junto a la anterior, preguntarlos todos de una vez era lo coherente |
| 3 | Basura estructural llegando al cliente | ninguno — **faltaba una capa** | `extractJson` y Zod validan la **forma** del objeto, y el objeto estaba impecable: la basura viajaba DENTRO del string de `reply`. Nadie miraba el **contenido** |

La número 3 es la que más importa entender: no fue un fallo de validación. Las
dos validaciones que existían hicieron exactamente su trabajo. Simplemente
responden a una pregunta distinta de la que había que hacer.

---

## 3. La cadencia: cómo se decide qué pide el bot

`conducta.ts` gana una constante nueva, **`CADENCIA`**, que llevan **los dos
verticales con el mismo texto literal** (`meta` la interpola en pedidos y en
citas; hay una prueba que lo comprueba, para que no deriven a dos doctrinas
distintas).

La regla es una sola:

> **En cada mensaje, UN punto de la lista numerada del orden.**

La unidad no es "una pregunta": es **un punto del orden que ya existía** en
`meta()`. Se eligió así por tres razones:

1. Es la única unidad que ya existía en el sistema. No hay que inventar un
   número.
2. Es **verificable leyendo un mensaje**: ¿a cuántos puntos del orden pertenece
   lo que pide? Más de uno es una violación. No depende de que algo "se sienta
   natural".
3. Los puntos ya vienen agrupados por afinidad: *"su nombre y su celular"* es
   UNO, y *"las opciones de CADA cosa que pidió"* también. Así que el techo
   **no rompe** la lección del 17-ago-2026 (preguntar por varios productos en
   el mismo mensaje), que vive dentro de un solo punto.

Y lleva explícito el antídoto contra el fallo contrario: dice, con esas
palabras, que esto no es una pregunta por mensaje. Un formulario de una
pregunta por turno alarga el pedido igual y cuesta lo mismo.

Contestar, recomendar o saludar **no cuenta** contra el techo. El límite es
solo de los datos que se piden.

### Los dos ejes que había que separar

Al auditar el cambio antes de regenerar aparecieron **dos instrucciones viejas
que lo contradecían**: en citas, *"pregunta una vez el día, una vez la hora y
una vez sus datos"*; en pedidos, *"pregunta en UN mensaje lo que falte de cada
cosa"*. Las dos son de la corrección del 17-ago-2026, que atacaba un fallo real
y distinto —el agente hacía una ronda de preguntas por producto— y se escribió
como *"pregunta de todos a la vez"*.

Era correcta para su eje, pero había dos y solo se nombró uno:

- **Las cosas pedidas ENSANCHAN el punto activo.** Si toca elegir opciones, se
  eligen las de todo lo que pidió, en el mismo mensaje. Esa es la lección de
  agosto y sigue viva.
- **Los puntos del orden NO se mezclan nunca**, por muchas cosas que haya.
  Varias cosas ensanchan el punto; no lo adelantan.

Escritas como estaban, autorizaban lo segundo mientras pedían lo primero. Los
dos bloques están reescritos diciendo los dos ejes por separado, y conservando
lo que sí era correcto: anotarlo todo desde el primer mensaje, tratar varios
servicios como UNA visita para calcular el tiempo, y no repreguntar.

La regla para quien vuelva a tocarlos: **enumerar productos está bien;
enumerar puntos del orden es el muro.**

---

## 4. La absorción: lo que el cliente adelanta

La otra mitad, y sin ella el arreglo sería peor que el problema:

> **El límite es de lo que el bot PIDE, nunca de lo que el cliente puede DAR.**

Si en un mensaje vienen datos de puntos que todavía no tocaban, se apuntan
TODOS y esos puntos quedan resueltos: ni se ignoran, ni se dejan para luego, ni
se vuelven a preguntar al llegar ahí. Eso hace saltar varios puntos de una vez,
**y así debe ser**: el siguiente objetivo es el primero que siga de verdad en
blanco, no el que toque por número.

Ejemplo: *"uno de lulo, uno de maracuyá, con tarjeta y domicilio"* resuelve de
golpe las opciones, el pago y la modalidad. Lo que sigue es el primer punto que
quedó vacío, no una repregunta.

`requisitosParaElPrompt` se reescribió en la misma línea: la lista pasa a
rotularse **REQUISITOS PARA CERRAR** y dice, con esas palabras, que no es la
lista de lo que se pregunta en este mensaje; cada uno se pide cuando le toque
su turno en el orden. La parte que sí era correcta —la acción
`provide_requirement` que guarda el dato— no se tocó.

---

## 5. La integridad de salida

Capa nueva e independiente: **`src/server/ai/integridad-de-salida.ts`**.

### Qué detecta, y por qué solo eso

| Motivo | De dónde sale |
| --- | --- |
| `resto-estructural` | Tres o más llaves/corchetes seguidos **en un texto descuadrado** (más cierres que aperturas). El descuadre es lo que distingue un resto arrastrado de un JSON legítimo escrito como texto, que siempre cuadra |
| `texto-interno` | Vocabulario de la máquina en un texto para una persona: el nombre del formato de respuesta, el del esquema, la clave `action` entrecomillada, los tokens especiales del modelo o una valla de código JSON |
| `truncado` | **No es una heurística**: lo dice el proveedor en `finish_reason` con valor `length` |
| `vacio` | No hay texto que enviar |

Y **deliberadamente no detecta**: repetición degenerada, texto en otro idioma
ni "respuestas malas". Lo primero no se ha visto todavía en este sistema y su
umbral es justo el tipo de número que se inventa y empieza a bloquear listas
legítimas; los otros dos no tienen detector honesto aquí.

El detector es corto de manga a propósito. **Un falso positivo no es un mensaje
feo: es un cliente que pregunta un precio y recibe "te paso con una persona".**
Cuesta lo mismo que el fallo que evita. Por eso solo reconoce lo que ningún
mensaje de WhatsApp de verdad contiene, y por eso el bloque de pruebas de
falsos positivos (CA-08) pesa tanto como el de detección.

### El finish_reason, que se estaba tirando

`lib/ai/index.ts` recibía `finish_reason` del proveedor y lo descartaba. Ahora
viaja en `ChatJsonResult` (opcional: no todos los modelos de la cadena lo
mandan, y su ausencia no puede costar un turno) y `chatJsonConEstado` lo
reenvía — sin esa línea se perdía justo para los clientes con el estado en el
backend, que hoy son todos.

### Dónde corre, y por qué ahí

```
modelo -> extractJson -> Zod -> [8 guardarrailes de texto] -> GATE -> ejecutar -> deliverReply -> WhatsApp
                                                               |
                                                        roto: 1 reintento
                                                               |
                                                    sigue roto: handoff
```

El gate va en el punto que el propio `pipeline.ts` llama *"la decisión final"*:
después de los ocho guardarraíles que pueden reescribir la acción, y antes de
ejecutarla. **Ponerlo junto a la primera respuesta del modelo habría dejado
fuera** todo lo que produce una segunda llamada (`consult_product`,
`consult_availability`, los reintentos de guardarraíl) — que es justo de donde
sale el texto que lee el cliente en esos turnos.

`deliverReply` lleva además una comprobación **fail-closed** que no reintenta
ni decide: solo no envía y deriva. Hoy es redundante, porque todos los caminos
pasan por el gate. Existe para el día en que alguien añada un `deliverReply`
antes de ese punto: quien lo escriba no tiene por qué acordarse de un gate que
está novecientas líneas más arriba, y el precio de que se le olvide lo paga un
cliente. El aviso de derivación se salta la comprobación (lo escribe el
servidor, y comprobarlo abriría una recursión).

### La recuperación

**UN reintento y se acabó**, mismo criterio que el resto de guardarraíles del
archivo. Se le pide al modelo **la misma respuesta**, no una nueva: el
contenido que había decidido dar suele estar bien y lo que falló fue cómo lo
emitió; dejarlo replantear el turno cambiaría la conversación por un problema
de formato. Si el reintento tampoco sirve, lo toma una persona.

No hay tercer modelo ni cadena nueva. Los salvavidas siguen viviendo en el
adaptador, y el de cierre en `recuperacion-de-turno.ts`
([189](189-EXCEPCION-GEMINI-SALVAVIDAS-DE-CIERRE.md)): **son capas
independientes y ninguna sabe de la otra.**

---

## 6. Lo que esto NO resuelve

- **No mide si la conversación mejoró.** La cadencia vive en el prompt, y un
  prompt no es una garantía: es una petición. No hay guardarraíl posible aquí
  —no existe un literal que comparar— igual que con `NO_ENCAJA` o
  `PREGUNTAS_FRECUENTES`. La comprobación real es el escenario nuevo de
  `probar:escenarios`, y **solo tiene sentido después de regenerar la flota**.
- **No detecta una respuesta que degenere repitiéndose.** Ver arriba: sin un
  caso medido, el umbral se inventa.
- **No cambia de dónde sale el objetivo conversacional.** El agente sigue
  decidiendo él cuál es el punto pendiente, leyendo la conversación. El backend
  no se lo dice.

---

## 7. Futuro: el objetivo conversacional desde el backend

Hoy el techo es una instrucción. La evolución natural es que el **backend**
calcule cuál es el primer punto sin resolver —ya conoce el carrito, la
modalidad, el total y los requisitos capturados— y se lo pase al modelo como un
hecho, igual que ya le pasa el estado del pedido. Eso convertiría la cadencia
de petición en dato, y con ello sería verificable con un guardarraíl de verdad.

El contrato de `CADENCIA` se escribió pensando en eso: habla de *"el primer
punto que sigue sin resolver"*, que es exactamente lo que el backend podría
calcular. **No se implementa ahora** — es una migración mayor y este problema
no la necesitaba.
