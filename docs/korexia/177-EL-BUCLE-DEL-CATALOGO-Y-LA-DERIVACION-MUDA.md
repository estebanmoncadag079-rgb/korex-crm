# 177 — El bucle del catálogo y la derivación muda

**15-sep-2026.** Dos fallos independientes que aparecieron en la misma
pantalla de Lis Pastelería, ambos dejando al cliente sin avanzar.

---

## 1. El bucle del catálogo

### Lo que vio la clienta

`cv_qe4v3mxc9txnxitfcgnm`, Sofi:

```
23:48  CLIENTE  "Tienen disponible el cremoso de franui?"
23:49  BOT      "¡Claro que sí! Cremoso de Temporada Franui 12 oz por $19.000.
                 Aquí puedes ver todas las fotos y precios: [link]
                 ¿Te gustaría añadirlo a tu pedido?"
23:49  CLIENTE  "Si me gustaría añadirlo a mi pedido"      ← confirma
23:49  BOT      [la misma frase, palabra por palabra]
23:50  CLIENTE  "Quiero añadirlo a mi pedido"              ← insiste
23:50  BOT      [la misma frase, otra vez]
23:50  HUMANO   [entra a resolverlo a mano]
```

El producto **sí estaba en el carrito** (`items: [Cremoso Franui]`,
`totalCents: 1900000`). El bot no estaba perdido: estaba atrapado.

### La causa

La entrada de conocimiento de Lis está impecablemente escrita:

> **"¿Tienen catálogo o fotos del menú para ver antes de pedir?"**
> → `https://drive.google.com/file/d/...`

De ahí el sistema extrae las raíces disparadoras: `tien`, `cata`, `foto`,
`menu`, **`pedi`**.

Y `pedi` —de "pedir"— colisiona con **"pedido"**, la palabra más frecuente de
todo el flujo de compra. Cada "añádelo a mi pedido" se leía como "muéstrame
el catálogo".

El guardarraíl de contenido obligatorio (doc 125) entonces **exigía** que la
respuesta incluyera el enlace. La única frase del modelo que lo contiene es
la oferta inicial completa — así que la corrección devolvía a la clienta al
punto de partida, una y otra vez.

### Lo que NO es la causa

La colisión `pedir`/`pedido` es **deliberada** (`raiz()`, 4 letras, sin
diccionario de conjugaciones) y es correcta al empezar: *"¡Hola! Quiero
hacer un pedido"* debe recibir el catálogo. Ese es el caso de Maricel, que
originó el guardarraíl (doc 125) y tiene su propia prueba.

Quitar "pedir" de las raíces habría arreglado a Sofi rompiendo a Maricel.

### El arreglo

**La distinción no es la palabra, es el momento.** Con el carrito vacío,
"pedido" significa *quiero empezar*; con algo dentro, *lo que ya estamos
armando*.

`disparadoPor` recibe ahora si hay un pedido en curso. Cuando lo hay, las
raíces de verbos de compra (`pedi`, `comp`, `orde`, `enca`, `llev`) dejan de
disparar. Las demás (`cata`, `foto`, `menu`…) siguen disparando siempre:
quien pregunta por el catálogo a mitad del pedido sí debe recibirlo.

---

## 2. La derivación muda

### Lo que vio la clienta

`cv_z4d9leo1jbencecfx2dl`. Mandó una foto del producto que quería y esperó
**nueve minutos sin recibir una sola palabra** — ni del bot ni de nadie—
hasta que alguien miró la bandeja por casualidad.

### La causa

El bot **sí procesó** el mensaje y decidió derivar (`accion=handoff`,
`guardarrailes=-`). Pero:

```js
case "handoff": {
  if (action.farewell) {              // ← opcional en el contrato
    await deliverReply(conversation, action.farewell);
  }
```

`farewell` es opcional. El prompt le pide al modelo despedirse y casi
siempre lo hace; esa vez no. Y como Lis **no tiene números de aviso
configurados**, la notificación al equipo tampoco salió.

Silencio por los dos lados: el cliente sin saber que venía alguien, el
equipo sin saber que lo necesitaban.

### El arreglo

```js
await deliverReply(conversation, action.farewell || AVISO_DE_DERIVACION);
```

El cliente siempre se entera. Nunca pisa el texto del modelo: solo cubre la
ausencia.

---

## Verificación

- `contenido-obligatorio.test.ts` — 4 casos nuevos: el bucle de Sofi
  resuelto, **el caso de Maricel intacto**, preguntar por el catálogo a
  mitad del pedido sigue funcionando, y retrocompatibilidad sin el
  parámetro.
- `pipeline-handoff-modelo-notifica-equipo.test.ts` — la derivación sin
  `farewell` ahora avisa al cliente y sigue notificando al equipo.
- Gate completo: typecheck, **2197 pruebas**, lint y build.

## Lo que queda pendiente, y no es código

**Los números de aviso de Lis, MALIA y La Churra siguen sin configurar.** La
derivación muda ya no deja mudo al cliente, pero el equipo sigue sin
enterarse de ninguna derivación. Es configuración del CRM (`/agente`), no
código.

## Un riesgo conocido que sigue vivo

`"Te dejo con el encargado"` le devuelve el turno al bot: la frase coincide
con `RETURN_PHRASES` y `QUIEN_ATIENDE` incluye "encargado". El propio código
ya lo advertía:

> *"en Colombia 'el encargado' es casi siempre una persona (…) Queda anotado
> para que nadie lo trate como un bug nuevo si vuelve a pasar."*

Pasó hoy, en esta misma conversación: Karen escribió esa frase refiriéndose
a una persona y el bot volvió a hablar. **No se toca en este commit** — la
decisión de mantenerlo fue deliberada y cambiarla afecta a todos los
negocios. Queda documentado con su caso real para cuando se decida.

## Cómo revertir

`git revert` del commit. El parámetro de `disparadoPor` es opcional con
default `false` (comportamiento anterior), y el `||` del farewell es una
línea.
