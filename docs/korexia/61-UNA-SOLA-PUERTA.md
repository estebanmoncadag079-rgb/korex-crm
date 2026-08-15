# Una sola puerta: quién manda sobre el agente

> **Dentro:** El día que una corrección se deshizo sola · La regla · Qué se
> quitó y por qué · Lo que sí se sigue editando · Cómo se cambia ahora el
> comportamiento · Lo que queda pendiente

**15-ago-2026.** El mismo dato se podía escribir en dos pantallas distintas, y
una borraba a la otra sin decir nada. Este documento explica por qué ahora solo
hay una puerta para cada cosa.

## El día que una corrección se deshizo sola

El 14-ago se corrigió a mano una respuesta de **Lashes Valen** que prometía lo
que no se puede prometer:

> *"¿Me irrita los ojos?"* → *"Claro que no, lo hacemos con mucho amor para que
> esto no suceda"*

En un salón de pestañas esa es **la pregunta que más se hace antes de agendar**,
y es un asunto de salud: la conducta prohíbe expresamente tranquilizar con un
"claro que no". Se cambió para que derivara a una persona, se **verificó contra
el agente real**, y se dio por cerrada.

El 15-ago a las 01:12 la respuesta vieja estaba de vuelta en producción.

No la repuso nadie. La corrección se había hecho en la pantalla de
Conocimiento, y `aplicarFicha` —que corre al enviar el cuestionario— **borraba
`kb_entry` entero** y lo reponía desde la ficha, donde seguía la versión vieja.
El borrado no avisa, no deja rastro y no aparece en ningún registro: la única
señal fue que alguien se puso a contar entradas dos días después.

> **Lo que hay que aprender de esto no es el bug, es la forma del bug.** La
> corrección se probó y la prueba pasó. Lo que no se comprobó es **cuánto duraba
> el estado que se había probado**. Una verificación sobre algo que el siguiente
> clic deshace no verifica nada.

## La regla

**Cada dato se escribe en un solo sitio.** Si dos pantallas preguntan lo mismo,
una de las dos va a ganar, y va a ganar en silencio.

No es una regla nueva en este proyecto: es la que ya se había aplicado al
catálogo. En `aplicar.ts` estaba escrita desde el principio, a veinte líneas del
código que causó el problema:

> *"El alta llegó a pedirlo también, y eso significaba cargarlo dos veces y que
> una de las dos copias empezara a quedarse vieja el mismo día. (…) una sola
> fuente de verdad."*

Se había aplicado a los servicios y no al conocimiento. Ahora sí.

| Dato | Dónde se escribe | Quién lo puede tocar |
|---|---|---|
| Catálogo / servicios | Pantalla de **Servicios** | El negocio |
| **Conocimiento** | Pantalla de **Conocimiento** | El negocio |
| Teléfonos de aviso | Pantalla del **Agente** | El negocio |
| Nombre, tono, saludo | **Ficha** (cuestionario) | Se regenera |
| Instrucciones y escalado | **Ficha + `conducta.ts`** | Se regenera |

## Qué se quitó y por qué

**Del cuestionario**: el paso *"Lo que más te preguntan"*. Preguntaba lo mismo
que la pantalla de Conocimiento.

**De la pantalla del Agente**: los campos **Nombre**, **Tono**,
**Instrucciones**, **Reglas de escalado** y **Saludo**.

No eran campos de más: era una pantalla que **mentía**. Los cinco los reescribe
`generarPerfil()` cada vez que se envía el cuestionario o se pasa
`regenerar:flota`, así que lo que se escribiera ahí duraba hasta el siguiente
clic. Ofrecer un campo editable cuyo valor se va a descartar es peor que no
ofrecerlo.

Y había una razón de fondo, más importante que el borrado: **la conducta es la
misma para todos los clientes**. Una lección aprendida se escribe **una vez** en
`conducta.ts` y llega a toda la flota. Un prompt editado a mano se queda fuera
de esa mejora para siempre — que es exactamente el problema que el generador de
prompts venía a resolver ([45-GENERADOR-DE-PROMPTS.md](45-GENERADOR-DE-PROMPTS.md)).

> ⚠️ **Quitar los campos de la pantalla no bastaba: la ruta seguía abierta.**
> `PUT /api/agent/profile` aceptaba esos cinco campos de quien se los mandara.
> Se cerraron también en el esquema del endpoint. Una interfaz no es un control
> de acceso.

## Lo que sí se sigue editando

- **El conocimiento**, en su pantalla. Es la fuente de verdad y ya no se pisa
  nunca. Crece con el negocio: dirección, parqueadero, cancelación, retardos.
- **Los teléfonos de aviso**, en la pantalla del Agente.
- **El interruptor de encendido**, donde estaba.

`aplicarFicha` **siembra** el conocimiento solo si el cliente no tiene ninguno,
para que un alta nueva siga arrancando con lo que trajo su ficha. Nunca borra.

> Los teléfonos de aviso tenían **el mismo borrado silencioso**: se ponían a
> `NULL` si no se pasaban en las opciones, así que reenviar el cuestionario
> dejaba al negocio sin avisos. Ahora, si no vienen, se deja lo que hubiera.

## Cómo se cambia ahora el comportamiento

1. Si es algo **de ese negocio** (su tono, su saludo, sus casos de escalado):
   se corrige **la ficha** y se regenera.
2. Si es algo que **vale para todos** (no prometer, no inventar, cómo cerrar):
   se escribe en **`conducta.ts`** y se pasa `pnpm regenerar:flota`.

La pregunta que decide cuál de las dos: *"¿esto lo querría cualquier otro
cliente?"*. Si la respuesta es sí, no va en la ficha.

## Probado

`tests/integration/ficha-no-pisa-conocimiento.test.ts`, contra Postgres real —
lo que hay que demostrar es lo que queda **en la base** después de la
transacción:

| Prueba | Qué fija |
|---|---|
| No borra la respuesta corregida a mano | El caso de Lashes Valen, exacto |
| Sí siembra a un cliente sin conocimiento | Que el alta siga sirviendo |
| Reenviar el cuestionario no duplica | Que "sembrar si está vacío" aguante el segundo envío |
| No borra los teléfonos de aviso | El mismo fallo, en el otro campo |
| El prompt **sí** se regenera | El contrapunto: lo universal debe pisarse |

> Se comprobó además que la prueba **falla** si se restaura el borrado viejo. Un
> test que nunca ha fallado no ha demostrado que detecte nada — y aquí el
> antecedente es justo ese: una verificación que pasó sobre un estado que no
> duró.

## Lo que queda pendiente

- **Todas las cuentas de acceso nacen como Propietario**: la interfaz manda
  `role: "owner"` fijo aunque el servidor ya acepte `member`
  ([10-SEGURIDAD.md](10-SEGURIDAD.md)).
- **Los clientes sin ficha guardada** (Lis, a propósito) ya no tienen dónde
  editar su prompt: el suyo se escribió a mano y no se regenera. Hoy solo se
  puede tocar por base de datos. Si se le va a dar mantenimiento, lo coherente
  es migrarlo a ficha.
