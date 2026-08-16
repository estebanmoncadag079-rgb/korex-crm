# El mapa de las salsas

> **Dentro:** Por qué este inventario · Los catorce puntos que tocan el catálogo
> · 🔴 El hallazgo: la salsa que se cobra dos veces · Los otros dos · Qué se
> unifica y qué no

**16-ago-2026.** El bug del `find()` que devolvía `RECUBIERTO` en vez de `SALSA`
apareció en un sitio que la documentación **ya daba por corregido**. Eso no es
un descuido: es la señal de que la regla de negocio está repartida. Antes de
tocar una línea más, el mapa completo.

---

## Los puntos que interpretan el catálogo

| Archivo · función | Responsabilidad | Cómo identifica el grupo | Cómo calcula cuántas | Cómo valida | ¿`grupoDeSalsas()`? | ¿Duplica? |
|---|---|---|---|---|---|---|
| `orders/normalizar.ts` · `grupoLlamado` | Buscar un grupo por nombre | `llave(nombre).startsWith(…)` | — | — | **es la base** | — |
| `orders/normalizar.ts` · `grupoDeSalsas` | **El punto de verdad** | por nombre `"salsa"`, con red al primer grupo con opciones | — | — | **es él** | — |
| `orders/normalizar.ts` · `normalizarPedido` (opciones) | Validar las salsas propuestas | `grupoDeSalsas()` | `grupo.maximo` | contra `grupo.opciones` | ✅ | no |
| `orders/normalizar.ts` · `faltaParaCerrar` (:382) | Qué falta para despachar | `grupoLlamado(p,"salsa")` **sin red** | `.maximo ?? 0` | — | ❌ | **sí** |
| `orders/normalizar.ts` · `sumaDeExtras` | Sumar el precio de las opciones | **ninguno: recorre TODOS** | — | por nombre, sin mirar grupo | ❌ | **sí, y cobra de más** |
| `orders/normalizar.ts` · `opcionesConocidas` | Saber si algo es una opción | todos los grupos, a propósito | — | — | n/a | no |
| `ai/pipeline.ts` (:575) | Cuántas salsas lleva el pedido en curso | `grupoDeSalsas()` | `.maximo ?? 0` | — | ✅ | no |
| `orders/extraer.ts` · `loQueFalta` / `comoTexto` | Decirle al modelo qué falta | **recibe el número** | parámetro `salsasQueLleva` | — | n/a | no |
| `orders/estado.ts` · `validarPropuesta` | Validar el estado entero | vía `normalizarPedido` | ídem | ídem | indirecto | no |
| `catalog/render.ts` · `renderCatalogoDePedidos` | Pintar la carta en el prompt | **ninguno: todos los grupos** con `minimo>=1` | `g.maximo` de cada grupo | — | ❌ | **criterio propio** |
| `catalog/sembrar.ts` · `leerCatalogoDeTexto` | Texto → grupos | por la forma de la línea | del texto: `"2 salsa a elección"` → 2; global → `opciones.length` | — | n/a | no |
| `orders/intencion.ts` (:121) | ¿el cliente nombró una opción? | todos los grupos, a propósito | — | — | n/a | no |
| `scripts/cargar-opciones.ts` | Cargar `RECUBIERTO`/`ADICIONES` | por nombre, lista `CARGABLES` | del lector | — | n/a | no |
| `scripts/medir-extraccion.ts` (:216) | Medir la extracción | todos los grupos | — | — | n/a | no |
| `scripts/probar-estado.ts` | Prueba de extremo a extremo | fija `"SALSA"` en su catálogo | fija | — | n/a | no |
| `lab/personas.ts`, `ai/conducta.ts`, `ai/prompts.ts` | Guiones y texto del prompt | **texto, no lógica** | — | — | n/a | no |

---

## 🔴 El hallazgo: la salsa que se cobra dos veces

`sumaDeExtras` recorre **todos los grupos del producto** y suma el precio de
cualquier opción cuyo nombre coincida con lo que pidió el cliente — **sin mirar
a qué grupo pertenece**:

```ts
for (const g of producto.grupos) {
  for (const o of g.opciones) {
    const pedida =
      salsas.some((s) => llave(s) === llave(o.nombre)) ||
      adiciones.some((a) => llave(a) === llave(o.nombre));
    if (pedida) extra += o.precioExtraCents;
  }
}
```

En La Churra, **los mismos nombres están en los dos grupos**:

```
SALSAS   : arequipe · lechera · chocolate negro · chocolate blanco   (incluidas, $0)
ADICIONES: … LECHERA $1.500 · AREQUIPE $1.500 · CHOCOLATE BLANCO $2.000
```

Un cliente que pide **una Churrita con salsa de arequipe** —que va incluida—
haría saltar la coincidencia en el grupo `ADICIONES` y pagaría **$1.500 que no
pidió**. En un Mega Box, que lleva **cinco** salsas, pueden ser varias de golpe.

**Cuándo se activa**: hoy no, porque el catálogo solo tiene el grupo `SALSA` y la
Fase 2 está apagada. Se activa **en cuanto se ejecute `cargar:opciones`** (tarea
4 del [72](72-COMO-ENCENDER-LA-FASE-2.md)) **y se encienda la bandera** — las dos
cosas están en la lista de encendido.

> 🔑 Es el mismo error que el `find()` del pipeline, un piso más abajo: **código
> que mira las opciones sin mirar de qué grupo son**. Y el resultado no es un
> pedido mal tomado: es un cobro de más, que en este proyecto tiene nombre
> propio —*"adivinar es cobrar de más"*—.

## Los otros dos

**`faltaParaCerrar` (:382)** usa `grupoLlamado(producto, "salsa")` **sin la red**
de `grupoDeSalsas`. Con un negocio cuyo grupo no se llame "salsa"
—*ACOMPAÑAMIENTO*—, la validación de opciones sí lo encuentra y esta línea
devuelve `0`: **el pedido se daría por completo sin haber elegido ninguna**.

**`renderCatalogoDePedidos`** tiene un criterio propio: pinta el *"elige N"* de
**todos** los grupos con `minimo >= 1`. No es duplicación —es otra
responsabilidad, y debe pintar el recubierto igual que las salsas—, pero **es un
tercer sitio que decide qué grupos importan**. Se deja como está, anotado.

---

## ✅ Corregido el 16-ago (tarea 2A, commit propio)

`sumaDeExtras` compara ahora **cada lista contra su grupo**: las salsas contra
`grupoDeSalsas()`, las adiciones contra `grupoDeAdiciones()` — nuevo, y **sin
red** al primer grupo con opciones, al revés que las salsas: confundirse aquí es
cobrar de más, y ante la duda se prefiere no cobrar nada.

Se verificó que **no existe una segunda implementación**: `sumaDeExtras` es el
único punto del proyecto que suma precios de opciones, y `normalizar.ts:372`
(`(precio + extras) × cantidad`) el único que calcula un total.

Seis pruebas con los datos reales de La Churra, entre ellas las cuatro que pidió
el dueño: la salsa incluida no genera cargo · la adición del mismo nombre sí ·
una Churrita con arequipe cuesta $10.000 exactos · un Family Box con sus tres
salsas, $32.000 exactos · una adición de arequipe suma $1.500.

> ⚠️ **El RECUBIERTO sigue sin sumarse**, a propósito: en La Churra es gratis y
> añadirlo cambiaría lo que se cobra hoy. Si algún día un negocio cobra por él,
> hay que tocarlo — y entonces será una decisión de negocio, no un descuido.

## ✅ Las salsas no son únicas (decisión del dueño, 16-ago)

> **El cliente puede repetir un sabor tantas veces como quiera, hasta el límite
> de su presentación.** Churrita 1 · Besties 2 · Family Box 3 · Mega Box 5.

Válido: *Besties → arequipe + arequipe* · *Mega Box → arequipe + arequipe +
lechera + chocolate + chocolate blanco*.

Con esa regla escrita, el bloqueo del Mega Box deja de ser un bug de borde y
pasa a ser lo esperado: **cinco salsas de cuatro sabores obligan a repetir.**

### La auditoría de duplicados, completa

| Sitio | Qué deduplicaba | Veredicto |
|---|---|---|
| `normalizar.ts:308` | salsas, **sin** presentación elegida | 🔴 quitado |
| `normalizar.ts:322` | salsas, **con** presentación | 🔴 quitado |
| `sumaDeExtras` | recorría el catálogo, no lo pedido → **dos aguas costaban una** | 🔴 corregido |
| `render.ts:68` (`vistos`) | el mismo **grupo** repetido entre productos | ✅ correcto: es catálogo, no selección |
| `notify-team.ts:45` (`seen`) | teléfonos del equipo | ✅ correcto: nadie quiere dos avisos |
| `medir-extraccion.ts:215` | nombres **válidos** del catálogo | ✅ correcto |
| `estado.ts:310`, `comparar-fila.ts:64` | campos de un log | ✅ correcto |
| `pipeline.ts:447`, `catalogo-diff`, `anuncio-de-cierre`, `logic.ts`, `runner.ts` | ids, horarios, índices | ✅ nada que ver con opciones |

**Dos deduplicaciones de salsas, y ninguna más en todo el proyecto.**

### Lo que hubo que añadir al quitarlas

El `includes` recortaba de rebote cualquier exceso que fuera repetición. Sin él,
pedir **siete** salsas en una Churrita pasaba sin protesta. Ahora se pregunta:

```
"CHURRITA lleva 1 y pidió 3"  →  "Una CHURRITA lleva 1 salsa. ¿Cuáles deja?"
```

**No se recorta en silencio**: elegir cuáles quitar es del cliente, no del
backend.

## 🔴 El hallazgo que salió al escribir la prueba (ya resuelto)

**El Mega Box no se puede completar nunca.** Lleva **cinco** salsas y el catálogo
tiene **cuatro** opciones distintas; como `normalizarPedido` deduplica
(`salsas.includes`), un cliente que pida dos de arequipe se queda en cuatro:

```
dudas: "MEGA BOX lleva 5 y hay 4"   →   totalCents: null   →   reconstruible: false
```

Con la Fase 2 encendida, **un Mega Box no se podría confirmar jamás**: el
validador rechaza `confirmado sin total calculado`, así que el estado no se
persiste y el pedido se queda dando vueltas.

> ✅ **Resuelto el 16-ago (tarea 2B)**, en cuanto el dueño zanjó la decisión de
> negocio: **las salsas se repiten**. Se quitaron las dos deduplicaciones y el
> Mega Box se completa con cinco salsas de cuatro sabores. La prueba que fijaba
> el comportamiento roto se sustituyó por la del comportamiento bueno — y el
> diff de ese cambio es exactamente lo que se quería poder ver.

## Qué se unifica

Un solo punto de verdad, `grupoDeSalsas()`, y una regla nueva para el precio:

> **Ninguna función que sume precios puede mirar una opción sin mirar su grupo.**

Lo que **no** se unifica, a propósito: `opcionesConocidas`, `intencion.ts` y
`medir-extraccion.ts` recorren todos los grupos **porque su pregunta es esa**
—*"¿esto que dijo el cliente es una opción de algo?"*—. Unificarlos sería
confundir dos preguntas distintas.
