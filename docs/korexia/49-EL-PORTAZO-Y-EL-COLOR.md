# El portazo del agente y el color de un cliente en toda la app

> **Dentro:** Los dos hallazgos · 1. El portazo: el hueco también enseña ·
> 2. El color: un `limit 1` que se quedó viejo · Lo que se probó · Lo que queda

Dos fallos encontrados el 13-ago-2026 mirando una captura del CRM y una
conversación de Lis. Ninguno de los dos había saltado en ninguna alarma, y los
dos llevaban **semanas** activos: uno tratando mal a quien escribe, el otro
pintando la aplicación entera con el color de un cliente.

---

## 1. El portazo: cuando no hay regla, el modelo se inventa una

Le escribieron a Lis ofreciéndole unos servicios al negocio:

> *"Hola, ¡Buenas tardes! Quisiéramos saber si están interesados en conocer
> nuestros servicios para comunicarme con ustedes?"*

Y el agente contestó:

> *"¡Hola! 💗 En este momento estamos enfocados en atender a nuestros clientes.
> Te agradecemos mucho tu interés. 😊"*

Un portazo. La dueña tuvo que entrar a mano a rescatar la conversación
(*"Muy buenas tardes 😀 / Servicios de qué información?"*), y esa intervención
además dispara el relevo humano, que **silencia al agente durante horas**.

### De dónde salió esa frase

De ningún sitio: **no existía ninguna regla que la mandara**. Se buscó en las
192 líneas de su prompt y en sus `escalation_rules`, y no hay nada que le pida
rechazar a quien no sea cliente.

Lo que sí hay es esto, en la línea 15 de su prompt — el ejemplo del caso
CERRADO:

| El molde que tenía a mano | Lo que escribió |
|---|---|
| "¡Hola! 💗 En este momento estamos **fuera de horario**…" | "¡Hola! 💗 En este momento estamos **enfocados en atender a nuestros clientes**…" |

Copió la única frase de "salir del paso" del prompt —que resulta ser una
excusa— y le cambió el final.

> 🔑 **La lección, que es nueva: el hueco también enseña.** Hasta ahora las
> lecciones venían de reglas mal escritas o mal colocadas. Esta viene de una
> regla que **no estaba**. Sin una salida escrita para lo que no encaja, el
> modelo se inventa una, y la que se inventa suele ser un rechazo — porque
> copia la frase más parecida que encuentra.

El hueco estaba, además, reforzado por la última línea de "Otras situaciones":
*"Cualquier otro caso lo resuelves tú con el conocimiento del negocio"*. Eso lo
empuja a resolver por su cuenta incluso cuando no tiene con qué.

### Dónde se arregló

En **`CONTRATO_DE_ACCIONES`** (`server/ai/prompts.ts`), no en el prompt de Lis.
Ese bloque se inyecta en el prompt de **todos** los clientes en cada turno, así
que la regla llega a la flota entera sin tocar una sola fila de `agent_profile`
— ni a Lis, ni a La Churra, ni a Studio Bella.

La regla dice, en resumen: quien ofrece servicios, un proveedor, una propuesta o
un asunto que no está en tu conocimiento **es una persona escribiéndole al
negocio, y el negocio quiere enterarse**. Prohibidas las frases que cierran la
puerta ("no estamos interesados", "solo atendemos pedidos"), aunque suenen
amables. Se saluda con calidez, se agradece, se dice que se le pasa el mensaje
al equipo sin prometer cuándo, y se emite `handoff`.

Va acompañada de una segunda línea que la separa del **encargo ajeno** (una
receta, un poema, código): eso se sigue declinando en una línea y **sin
escalar**. Sin esa distinción, la regla nueva habría convertido cada off-topic
en una transferencia.

Para los clientes nuevos, la lección queda además explicada larga en
`generador/conducta.ts` (`NO_ENCAJA`), que es de donde nace su prompt.

---

## 2. El color: un `limit 1` que se quedó viejo

Toda la aplicación se pintaba de **rosa fucsia** — el acento de Lis Pastelería
(`#e91e8c`). No solo su CRM: también el panel de la agencia, el login y la
portada pública. La prueba, sin sesión de nadie:

```bash
curl -s https://korexia.online/ | grep -o '\-\-accent:[^;]*;'
# → --accent:#e91e8c;
```

**La cadena:**

- `app/layout.tsx` es el **único** sitio que inyecta el acento (SSR, para que no
  haya flash de tema), y llamaba a `getBranding()` **sin decirle de qué
  organización**.
- `server/branding.ts`, sin organización, hacía
  `select metadata from organization limit 1` **sin `order by`**, con este
  comentario: *"Sin sesión (login, layout raíz): la única organización de la
  instancia."*
- Ese supuesto era cierto con un solo cliente. Hoy hay cuatro, y Postgres
  devuelve la primera fila del heap: Lis.

`app/(app)/layout.tsx` sí pedía la marca correcta (`session.organizationId`),
pero solo la usaba para el **nombre**. El color nunca se volvía a tocar.

**Arreglado así**: sin organización, `getBranding()` devuelve
`DEFAULT_BRANDING` — la marca de la agencia, nunca la de un cliente. Y el layout
raíz resuelve la marca de la petición mirando la sesión (envuelto en `cache` de
React para no resolverla dos veces entre el layout y los metadatos).

De paso arregla dos cosas que nadie había notado: el login público mostraba
**"Lis Pastelería"** como título, y el `<title>` de la portada llevaba el nombre
de un cliente.

> Estando en modo impersonación el CRM **sigue pintándose** con el color del
> cliente, y eso es lo correcto: es lo que ve él.

---

## Lo que se probó

El gate completo (`typecheck`, `lint`, `build`) en verde. `pnpm test`: **482
pruebas pasan**, con 2 errores no capturados en
`tests/unit/ycloud-reintento-envio.test.ts` que hacen fallar el proceso —
**verificado que son idénticos sin estos cambios** (ver "Lo que queda").

Y, como manda [48-AFINAR-PROMPTS.md](48-AFINAR-PROMPTS.md), contra el **pipeline
real** con el bundle del código nuevo dentro del contenedor, antes de desplegar:

| Escenario | Antes | Después |
|---|---|---|
| Le ofrecen servicios al negocio | ❌ portazo, con `reply` | ✅ agradece y `handoff` |
| Precio y domicilios | — | ✅ responde directo, sin escalar |
| Le piden una receta de arroz con pollo | — | ✅ declina en una línea, **sin escalar** |
| Pedido completo hasta el resumen | ✅ | ✅ igual (resumen correcto, con su total) |

La respuesta nueva, textual:

> *"¡Hola! 💗 Te agradecemos mucho el interés en nuestros servicios. Con gusto le
> paso tu mensaje a nuestro equipo para que puedan revisar tu propuesta…"*

---

## Lo que queda

- 🔴 **El "sí, confirmo" que no cierra el pedido.** En la prueba del flujo
  completo, al confirmar, el agente **repitió el resumen** en vez de emitir
  `notify_order` con los datos de pago. El guardarraíl `resumenMalArmado` lo
  detecta (`[agente] resumen mal armado (cierre-prematuro); rehaciendo el
  turno`) pero **la corrección no lo repara**: el turno rehecho vuelve a ser el
  mismo resumen.

  **No lo causaron estos cambios**: se ejecutó la misma secuencia con el bundle
  del código actual de producción y falla exactamente igual.

  **No es un apagón**, es intermitente: en producción Lis sigue cerrando (1
  pedido con datos de pago el 13-ago, 5 el 12-ago, 8 el 5-ago). Pero es el mismo
  fallo caro de [38-GUARDARRAILES.md](38-GUARDARRAILES.md) volviendo por otra
  puerta, y merece medirse: cuántas veces salta el guardarraíl y en cuántas la
  corrección no sirve de nada.

- ⚠️ **`pnpm test` sale con código 1** por dos rechazos no capturados en el test
  de reintento de YCloud. Ninguna prueba falla (482 pasan). Es previo y
  reproducible en `main` limpio, pero deja el gate sin poder leerse de un
  vistazo.

- **La Churra y Studio Bella heredan la regla nueva** en cuanto se despliegue,
  porque vive en el contrato. Conviene probar el flujo de citas de Studio Bella
  con un mensaje que no encaje, para confirmar que tampoco escala de más.
