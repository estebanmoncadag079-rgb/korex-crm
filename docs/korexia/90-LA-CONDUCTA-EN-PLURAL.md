# La conducta, en plural

> **Dentro:** La otra mitad del trabajo · Lo que decía y lo que dice · Los dos
> verticales · El vocabulario de comida que quedaba · Las pruebas · Impacto ·
> Reversión

**17-ago-2026. Paso 3 del camino de [88](88-AUDITORIA-SELECCION-MULTIPLE.md).**

---

## Por qué existe este paso

El [89](89-EL-CONTRATO-DE-LOS-ITEMS.md) hizo que el backend pudiera sostener
varias cosas en un pedido. Esto es **la otra mitad**, y sin ella lo anterior no
sirve de nada:

> De nada sirve que el estado aguante tres productos si el agente los pregunta
> de uno en uno.

`conducta.ts` es el texto que **se lleva todo cliente de VOCERO** —pedidos y
citas, hoy y los que vengan— y estaba escrito para **una cosa por conversación**:

| Dónde | Decía |
|---|---|
| `meta("pedidos")` | *«Las opciones de **ESE producto** (sabores, salsas, tamaño…)»* |
| `meta("pedidos")` | *«con **el producto elegido**, pídele las opciones»* |
| `meta("citas")` | *«**Qué servicio** quiere»* |
| `CIERRE_CITAS` | *«Necesitas **el servicio**, el día, la hora»* |

Un cliente real pidió dos productos en un mensaje y el agente hizo **lo único
que el guion contemplaba**: repetir la ronda entera por cada uno, incluida una
pregunta que el cliente ya había contestado.

---

## Lo que dice ahora

### Pedidos

```
1. Qué quiere y cuántos. Pueden ser varias cosas: apúntalas TODAS.
2. Las opciones de CADA cosa que pidió, con el nombre de los grupos que
   tenga en el catálogo. Dile cuántas puede elegir de cada una.
```

Y una sección nueva:

> **## Si pide VARIAS cosas a la vez**
>
> Es lo normal: *"uno de esto y dos de aquello"* llega en un solo mensaje.
>
> **Anótalo todo de una vez** y pregunta en UN mensaje lo que falte de cada cosa,
> diciendo de cuál es cada pregunta. Nada de terminar una y empezar la otra: eso
> convierte un pedido en un interrogatorio.
>
> 🛑 **Y lo que ya te dijo de una cosa, no se lo vuelvas a preguntar por estar
> preguntando por otra.**
>
> Cada cosa lleva **sus propias** opciones, y no se mezclan: lo que eligió para
> la primera no cuenta para la segunda, aunque se llame igual.

Esa última línea es la traducción al castellano de lo que el paso 2 hizo en el
modelo de datos. Las dos mitades dicen lo mismo.

### Citas — la regla 9, cumplida

No se toca pedidos y se deja citas para luego. El mismo problema existe en un
salón y **tiene una vuelta propia**:

> **## Si pide VARIOS servicios**
>
> **Anótalos todos** y trátalos como **una sola visita**: pregunta una vez el
> día, una vez la hora y una vez sus datos. Y **cuenta el tiempo de todos
> juntos** — dos servicios seguidos no caben en el hueco de uno, así que ofrece
> horarios donde quepa la visita entera.
>
> 🛑 **Si de verdad no pueden ir juntos** —porque no hay hueco o los hace gente
> distinta—, dilo y propón cómo hacerlo, pero **no des por agendado** lo que no
> agendaste.

> ⚠️ **Y esto es una promesa que el backend todavía no puede cumplir.** Hoy
> `appointment` tiene **un** `service_id` y **un** `staff_id`, así que dos
> servicios son dos citas que el sistema no sabe que van juntas
> ([83](83-RECURSOS-Y-RESERVAS.md), [88](88-AUDITORIA-SELECCION-MULTIPLE.md)).
> El prompt pide lo correcto; el paso 4 es el que lo hará posible. Se deja dicho
> aquí para que nadie lo descubra por sorpresa.

### El resumen

> Si pidió varias cosas, **una línea por cosa, con sus propias opciones debajo**.
> Juntarlas todas en una lista suelta deja al cliente sin saber qué lleva cada
> una, y a quien lo prepara, adivinando.

---

## El vocabulario de comida que quedaba

Aprovechando que se tocaba el archivo, cuatro sitios más del hallazgo 3 de
[88](88-AUDITORIA-SELECCION-MULTIPLE.md) — vocabulario de un sector en el texto
que comparten todos:

| Antes | Ahora |
|---|---|
| *«en **la cocina** no se entera nadie»* | *«en **el negocio** no se entera nadie»* |
| *«te recomiendo el de **12 oz**: lleva **2 toppings**»* | *«el de $X: lleva tal y tal»* |
| *«(el **sabor**, el **topping**, el color)»* | *«(el color, el acabado, el detalle que sea)»* |
| *«(**"sabor** por confirmar") llega a **la cocina**»* | *«("el color, por confirmar") llega **al equipo**»* |

Ninguna cambia lo que se pide, solo a quién le sirve. Una papelería no tiene
cocina.

---

## Las pruebas

**776 en verde** (+6), `tsc` y `eslint` limpios.

| Prueba | Qué impide |
|---|---|
| **ni una palabra de comida** en `ESTILO`, `CIERRE`, `CIERRE_CITAS`, `NUNCA` y las dos `meta()` | Que el vocabulario de un sector vuelva al prompt común |
| **EL DETECTOR DETECTA** | Que la de arriba se quede verde con un patrón que no encuentra nada |
| pedidos: se apuntan todas y se pregunta en un mensaje | |
| pedidos: **no se vuelve a preguntar** lo ya dicho | Exactamente lo que falló |
| pedidos: las opciones son de CADA cosa y no se mezclan | |
| citas: varios servicios son **una visita**, con el tiempo sumado | La regla 9 |
| el resumen lleva una línea por cosa | |

Y **dos pruebas existentes cambiaron su texto**: las que fijaban *«en la cocina
no se entera nadie»* (una exige que esté en pedidos, la otra que NO esté en
citas). Se actualizaron las dos — cambiar solo la primera habría dejado la
segunda comprobando una frase que ya no existe en ninguna parte, es decir,
verde para siempre y sin comprobar nada.

---

## Impacto en producción

**Cambia el prompt de los cuatro clientes** en cuanto se regenere.

Y conviene ser preciso sobre cuándo: el prompt se guarda en `agent_profile`, así
que **el texto vivo no cambia hasta que alguien ejecute `regenerar:flota`** o se
edite la ficha de un cliente. Hasta entonces, los agentes siguen con el texto
anterior.

Nada de esto depende de `state_source`: la conducta se lleva igual con la Fase 2
apagada. Por eso **este cambio se nota antes que todo lo demás** — y es el que
de verdad arregla lo que se vio en WhatsApp.

---

## Reversión

`git revert` del commit y, si ya se había regenerado, `regenerar:flota` otra vez.
Sin migración, sin datos, sin bandera.
