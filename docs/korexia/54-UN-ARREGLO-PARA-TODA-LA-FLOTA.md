# Un arreglo, toda la flota

> **Dentro:** La regla de trabajo · Lo que estaba roto · La ficha se guarda ·
> `regenerar:flota` · La regla que el sistema pedía y nadie había escrito · Qué
> se migró · Cómo se hace de ahora en adelante

13-ago-2026, final del día. Instrucción del dueño, y pasa a ser la regla de la
casa:

> **"Necesito que todos los cambios de ahora en adelante sirvan para todos los
> clientes."**

## La regla de trabajo

Ante cualquier fallo, antes de arreglarlo hay que responder **dónde vive**:

| Naturaleza del fallo | Dónde se arregla | A quién llega |
|---|---|---|
| Conducta (cómo debe comportarse el agente) | `generador/conducta.ts` | A todos, al regenerar |
| Comprobación de un hecho (el modelo no obedeció) | Guardarraíl en `pipeline.ts` | A todos, al desplegar |
| Dato del negocio (precio, horario, una regla suya) | Su ficha | Solo a él |

**Si el fallo cabe en las dos primeras, no se arregla en el prompt de un
cliente.** Escribirlo a mano en uno solo es garantizar que reaparezca en el
siguiente con otra cara — que es exactamente lo que pasó con Lis y con La
Churra durante semanas.

## Lo que estaba roto

El generador ([45-GENERADOR-DE-PROMPTS.md](45-GENERADOR-DE-PROMPTS.md)) separa
la **ficha** (lo único de cada negocio) de la **conducta** (universal, escrita
una vez). Prometía que un incidente se convierte en inmunidad para toda la
flota. Pero le faltaba la mitad:

> El prompt queda **materializado** en `agent_profile.instructions`, y la ficha
> se perdía al terminar el alta.

Así que una lección nueva en `conducta.ts` solo la heredaba **el siguiente
cliente**. Los que llevaban meses vendiendo —los que habían pagado los
incidentes con conversaciones reales— se quedaban con la versión vieja. Al
revés de como tiene que ser.

## La ficha se guarda (migración 0019)

`agent_profile.ficha` guarda el JSON con el que se generó el prompt. Con eso, el
prompt se puede rehacer sin volver a escribir nada.

## `pnpm regenerar:flota`

```
pnpm regenerar:flota              # enseña qué cambiaría, no escribe
pnpm regenerar:flota --aplicar    # escribe, con respaldo previo
```

Vuelve a ensamblar el prompt de **todos** los clientes con la conducta al día.
Detalles que importan:

- **Respaldo automático** de `agent_profile` entero antes de tocar nada.
- Los clientes **sin ficha** se saltan y se listan: no se toca a ciegas un
  prompt escrito a mano.
- Si a una ficha le falta algo esencial, `faltantesDeLaFicha` frena a ese
  cliente y **deja su prompt viejo** en vez de escribir uno incompleto.
- Si el prompt sale idéntico, no se escribe: la corrida es segura de repetir.

## La regla que el sistema pedía y nadie había escrito

Buscando qué se perdía al migrar La Churra apareció un hueco de los caros. El
marco le dice al agente, en cada turno, si el negocio está abierto o cerrado
(`estadoDelNegocio`, en `prompts.ts`), y cuando ya cerró termina con:

> *"aplica la regla de pedidos fuera del horario"*

**Esa regla no existía en ninguna parte.** Solo estaba escrita a mano en el
prompt de La Churra. Cualquier cliente nuevo recibía la orden de aplicar algo
que nadie le había explicado, y el modelo improvisaba — así se llega a "estamos
cerrados, escríbenos mañana" y se pierde un pedido que ya estaba hecho.

Ahora es `FUERA_DE_HORARIO` en `conducta.ts`, y la heredan todos los negocios de
pedidos: tómalo completo, avisa de que queda para la próxima apertura, dilo en
el resumen y en el aviso al equipo, y pide el pago igual.

## Qué se migró

| Cliente | Antes | Ahora |
|---|---|---|
| **La Churra** | Prompt a mano, 11.168 caracteres, con `## Resumen y cierre` — el defecto que rompió a Lis | Generado, 13.830, con los DOS MOMENTOS del cierre |
| **Lashen Valen (salón)** | Ya era generado, pero **sin ficha guardada** | Ficha guardada: entra en las regeneraciones |
| **Lis** | Ya era generado, sin ficha | Pendiente: su ficha es la más larga (17.058 caracteres de prompt) |

> ⚠️ Ojo con el dato que engaña: buscar `MOMENTO 1` para saber quién tiene la
> conducta universal **da falso en los salones**, porque esa marca es del
> `CIERRE` de pedidos y ellos llevan `CIERRE_CITAS`. El salón ya la tenía.

Lo que La Churra conserva como **suyo** (en `reglasPropias`, no en la conducta):
el formato exacto de su resumen, su mensaje de cierre con el "Marca 0", las
salsas por presentación, lo de los dos teléfonos, el efectivo solo si preguntan.

## Cómo se hace de ahora en adelante

1. Aparece un fallo → se clasifica con la tabla de arriba.
2. Si es conducta: se escribe en `conducta.ts` **una vez**.
3. `pnpm regenerar:flota` sin `--aplicar` para ver a quién cambia el prompt.
4. Laboratorio del cliente más expuesto, antes y después.
5. `--aplicar`, y el respaldo queda por si acaso.

## La verificación de la migración

El Laboratorio de La Churra, antes y después de migrarla, con el mismo guion y
el modelo real:

| | Antes (prompt a mano) | Después (generado) |
|---|---|---|
| Puntaje | 75 | 75 |
| Cliente decidido | 🔴 con **dos** hallazgos | 🔴 con **uno** |
| *"La más pedida por lejos es nuestra Besties"* | apareció | **desapareció** |

La alucinación se fue sola: la conducta universal lleva *"nunca digas cuál es el
más pedido si nadie te dio ese dato"*, y La Churra no la tenía escrita. Es
exactamente lo que se compra al migrar — una lección que se pagó en otro cliente.

Queda un fallo real, y es suyo: le preguntan **cuánto es el total** y responde
pidiendo antes las salsas y el recubierto. Su propia regla dice lo contrario
("si te pregunta cuánto es el total, dale el total"), y el total no depende de
las salsas: depende de la presentación. Pendiente de afinar.

## La conducta no es una sola: hay tres niveles

Lo planteó el dueño: *"las conductas de cada negocio son diferentes junto con
los flujos, por ejemplo la peluquería y Lis"*. Tiene razón, y por eso la
conducta universal no es un cajón único:

| Nivel | Ejemplo | Quién lo hereda |
|---|---|---|
| Universal | "no inventes datos duros", "nunca des un pago por bueno" | Todos |
| **Por vertical** | `CIERRE` (resumen + total) vs `CIERRE_CITAS` (*"no la hagas confirmar dos veces"*); `FUERA_DE_HORARIO` solo en pedidos | Solo su tipo |
| Propia del negocio | El enlace de la carta de Lis, las salsas de La Churra, "los festivos no trabajamos" | Solo él |

Y el aviso destapó una fuga real: **`resumenMalArmado` se aplicaba también a los
salones**. Ese detector busca un total en pesos, así que un *"aquí está el
resumen de tu cita"* lo daba por vacío y rehacía el turno — cuando en citas el
resumen ni siquiera es obligatorio. Ya solo corre en pedidos.

> 🔑 **Regla**: un guardarraíl escrito para un vertical no se aplica al otro
> solo porque el texto se le parezca.

## Lis: la ficha está hecha, pero NO activa

Se reconstruyó su ficha entera (domicilios por Yango con su excepción de
regalo, la entrega en portería, solo transferencia, el enlace de la carta con su
plan B, los toppings por producto, el trato dulce…) y de paso apareció que **su
horario estaba solo en el conocimiento y no en su configuración**, así que el
sistema nunca podía saber si estaba abierta.

Pero al probarla, su Laboratorio quedó por debajo del prompt de siempre y las
corridas **oscilaron entre 83 y 75 sin cambios de fondo**, mientras el original
había dado 92. Eso no alcanza para demostrar que no empeora al cliente que más
factura, así que:

- Su prompt en producción **sigue siendo el de siempre** (17.058 caracteres).
- Su `ficha` quedó en `null` a propósito: `regenerar:flota` la salta y la lista
  como pendiente, en vez de pisarle el prompt en la próxima corrida.
- La ficha escrita se conserva en `scripts/fichas-de-clientes.ts` para
  terminarla con calma.

De ese intento salieron dos arreglos que **sí** se quedaron, y que valen para
todos:

1. **El guardarraíl del cierre sin resumen** ([38-GUARDARRAILES.md](38-GUARDARRAILES.md)).
2. **"La más pedida" es una petición de consejo, no un dato.** El prompt viejo
   de Lis tenía la prohibición *y* qué hacer en su lugar ("te recomiendo el de
   12 oz: lleva 2 toppings y rinde bastante"); la conducta universal solo tenía
   la prohibición, y el agente se quedaba devolviendo la pregunta. Ahora lleva
   las dos mitades — y La Churra y el salón la heredaron con un comando, que es
   justo de lo que trata este documento.
