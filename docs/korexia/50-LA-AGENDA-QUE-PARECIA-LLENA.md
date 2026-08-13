# La agenda que parecía llena: "9 AM" y dos parsers

> **Dentro:** El síntoma · La causa · Por qué no lo vio nadie · El arreglo ·
> El otro arreglo: el cierre de citas · Lo que se probó · Lo que queda

13-ago-2026. Se probó el salón demo recién configurado desde el generador y el
agente **rechazaba todas las citas**.

## El síntoma

> *"Ay, caramba! 😥 Para el viernes 14 de agosto no tengo disponibilidad para el
> Lifting de pestañas."*
> *"Ese día está full 😊 ¿Te sirve el sábado 15?"*
> *"El viernes 14 a las 11 am con Carolina ya no está disponible."*

Las tres, mentira. Carolina tenía el viernes **entero** libre salvo media hora,
y atiende ese servicio. El agente nunca ejecutó `consult_availability`: todas
sus acciones eran `reply`.

## La causa: dos lectores del horario, ninguno tolerante

El horario del salón estaba guardado como **`9 AM` / `8 PM`**. El resto de
clientes lo tenían como `10:00` / `20:00`, y por eso nunca había fallado.

Había **dos** lectores distintos del mismo dato, y ninguno aceptaba eso:

| Dónde | Qué hacía con "9 AM" | Consecuencia |
|---|---|---|
| `toMinutes` (`ai/prompts.ts`) | regex `^(\d{1,2}):(\d{2})$` → `null` | el agente no sabía si el negocio estaba abierto |
| `horaAMin` (`appointments/logic.ts`) | `Number("9 AM")` → **NaN** | **la agenda entera sin un solo hueco** |

El segundo es el caro. En `calcularDisponibilidad`, la ventana del día se
construye así:

```ts
for (let t = open; t + input.duracionMin <= close; t += 30) candidatos.add(t);
```

Con `open` y `close` en `NaN`, la condición es `false` desde la primera vuelta:
cero candidatos, mapa vacío. **Y una agenda sin huecos es indistinguible de una
agenda llena.**

## Por qué no lo vio nadie

Porque no falló nada. No hubo excepción, ni log, ni aviso en el panel, ni un
contenedor caído. El sistema funcionaba con normalidad perfecta **diciendo que
no había sitio**. El único síntoma visible era un agente muy amable rechazando
clientas.

> 🔑 La lección: **NaN no es un error, es una respuesta**. Un parser que
> devuelve `NaN` en silencio convierte un dato mal escrito en una decisión de
> negocio equivocada, y no deja rastro para encontrarla.

Merece la pena anotar el rodeo: la primera hipótesis fue que el prompt generado
diluía las reglas —los 7.128 caracteres del salón frente a los 99 del prompt
anterior—. Se comprobó restaurando aquel prompt corto, con el que en agosto sí
agendaba: **falló exactamente igual**. Eso descartó el prompt en un minuto y
llevó al dato. Comparar en vez de suponer ahorró toda una tarde en la dirección
equivocada.

## El arreglo

Una sola función, en `lib/hora.ts`, que usan los dos lectores:

```ts
normalizarHora("9 AM")     // → "09:00"
normalizarHora("9:30 p.m.")// → "21:30"
normalizarHora("12 AM")    // → "00:00"   (medianoche)
normalizarHora("12 PM")    // → "12:00"   (mediodía)
normalizarHora("20:00")    // → "20:00"   (lo que ya funcionaba, intacto)
normalizarHora("por la mañana") // → null (dice que no, en vez de inventar)
```

Y tres capas más, para que esto no vuelva a pasar en silencio:

1. **Se guarda ya normalizado.** `aplicar.ts` convierte a `HH:MM` al escribir en
   la base: el cliente escribe "9 AM" en su cuestionario y la base guarda
   "09:00".
2. **La ficha lo valida.** `faltantesDeLaFicha` rechaza un horario ilegible con
   el texto que llegó, así que el alta falla ruidosamente en vez de crear un
   agente que no puede agendar.
3. **El motor avisa.** Si aun así llega algo que no se entiende,
   `calcularDisponibilidad` escribe en el log
   `[citas] horario ilegible (abre "…", cierra "…")` antes de devolver vacío.

## El otro arreglo: un negocio de citas no cierra como uno de pedidos

Al leer el prompt del salón apareció un segundo problema. Traía el ritual de
**pedidos** completo: `notify_order`, *"en la cocina no se entera nadie"*, *"el
total con la cifra"*, *"dirección o recoge en el local"* y hasta *"No hay
domicilios, ofrécele recoger"* — en un sitio donde solo hay que agendar.

`meta(vertical)` distinguía citas de pedidos desde el principio; el cierre, no:
`conducta.ts` tenía un único `CIERRE` escrito para pedidos y se lo llevaban
todos. Ahora hay `CIERRE_CITAS`, y la diferencia de fondo está escrita en él:

> En pedidos el resumen existe porque **el cliente** necesita ver qué va a pagar
> antes de pagarlo. En citas, lo que hay que proteger es que **no se anuncie una
> cita que no existe**.

De paso se quitó el bloque de entrega en el vertical de citas, el comprobante
deja "la cita" en firme (no "el pedido"), y el nombre del negocio se recorta:
venía con un espacio final del cuestionario y quedaba `**Lashen Valen **`, con
el asterisco separado y sin negrita en WhatsApp.

El prompt del salón pasó de **7.128 a 5.850 caracteres** sin perder nada suyo.

## Lo que se probó

Contra el modelo real, en conversaciones `is_test`, con el prompt regenerado:

| Escenario | Antes | Después |
|---|---|---|
| "¿qué horarios hay el viernes?" | ❌ *"está full"* (con la agenda vacía) | ✅ ofrece 3 y avisa de que hay más |
| Agendar de principio a fin | ❌ nunca llegaba | ✅ `book_appointment` real, guardada en la base |
| Reconfirmar la misma cita | — | ✅ no duplica: *"esa cita ya está confirmada"* |
| Cita en domingo (cerrado) | — | ✅ lo dice y ofrece otros días |
| "¿cuánto vale el volumen?" (hay 6) | — | ✅ pregunta cuál, no adivina |
| "¿tengo que abonar?" / devoluciones | — | ✅ aplica la regla propia sin inventar |
| Reclamo por un trabajo mal hecho | — | ✅ `handoff` con tono empático |
| Proveedor ofreciendo catálogo | — | ✅ cálido + `handoff` ([49](49-EL-PORTAZO-Y-EL-COLOR.md)) |

Gate completo en verde y **494 pruebas** (10 nuevas: `hora.test.ts`, la
regresión de la agenda con "9 AM" y las dos del cierre por vertical).

## Lo que queda

- 🟡 **El agente del salón está apagado.** No es un descuido: `aplicar.ts` lo
  deja en `enabled: false` a propósito, para que nadie encienda un agente sin
  revisarlo. Hay que encenderlo desde su panel antes de usarlo de verdad.
- 🟡 **Elige la hora por la clienta.** Ofreció 4:00, 4:30 y 4:45; la clienta
  contestó solo con su nombre y agendó las 4:45 sin preguntar cuál quería. No
  es nuevo ni es del cambio, pero conviene vigilarlo.
- 🟡 **Gemini falló en 3 de 6 pruebas** (`no devolvió una respuesta usable`) y
  hubo que reintentar con Sonnet, que cuesta bastante más. Saldo de OpenRouter
  comprobado: 8,22 USD, no era eso.
- **Los horarios ya guardados de los demás clientes** están bien (`12:30`,
  `10:00`, `20:00`): no hace falta migrar nada.
