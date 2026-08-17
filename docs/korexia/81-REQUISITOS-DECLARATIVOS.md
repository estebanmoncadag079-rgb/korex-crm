# Requisitos declarativos: sacar «entrega» del núcleo

> **Dentro:** El inventario, punto por punto · Las siete preguntas · La
> estructura propuesta · Qué es del núcleo y qué del vertical · Los riesgos ·
> Lo que NO entra

**17-ago-2026. Auditoría del paso 1.5, sin una línea de código.** El paso 1 sacó
los grupos de un negocio del núcleo. Queda el mismo acoplamiento un nivel
arriba: **qué datos hay que reunir para cerrar**.

---

## 1. Qué depende hoy de «entrega»: 26 puntos en 5 archivos

| Archivo | Puntos | Dónde exactamente |
|---|---|---|
| `orders/estado.ts` | **14** | El tipo `entrega{}` (3) · `estadoVacio` (1) · `validarPropuesta` al construir (3) · **los 3 rechazos de `confirmado`** · `aplanar` (3) · el comentario del aplanado |
| `orders/extraer.ts` | **9** | `CAMPOS` (3) · `loQueFalta` (3) · `comoTexto` (3) |
| `registro-de-cambios.ts` | **6** | `PERSONALES` (5 entradas) · `CLASIFICACION.conversation_state` (3) |
| `orders/normalizar.ts` | **5** | `EstadoPropuesto` (3) · `faltaParaCerrar` (3) |
| `ai/pipeline.ts` | **1** | **El prompt de extracción**, que los pide por su nombre |

## 2. Qué está cableado, en una frase

Tres decisiones que hoy **no se pueden cambiar sin tocar código**:

1. **Qué se pide**: exactamente nombre, teléfono y dirección.
2. **Qué es obligatorio para confirmar**: los tres, siempre.
3. **En qué orden**: el de `loQueFalta`.

Y una cuarta, implícita: **que existan**. Un negocio de citas no tiene «entrega»
y aun así arrastra los tres campos.

## 3. Qué debe volverse declarativo

| Hoy, en código | Mañana, en la ficha |
|---|---|
| Los 3 campos | La **lista de requisitos** |
| Los 3 rechazos de `confirmado` | `obligatorio: true` |
| El orden de `loQueFalta` | El orden de la lista |
| «la dirección siempre» | `soloSi` |
| «teléfono: ya lo dio» en el prompt | `etiqueta` |

Lo que **no** se vuelve declarativo, a propósito: que exista un momento de
cierre, que se valide antes de confirmar y que el total lo ponga el servidor.
Eso es el núcleo.

## 4. Qué cambiaría cada archivo

| Archivo | Cambio |
|---|---|
| **`EstadoDelPedido`** | `entrega: {nombre, telefono, direccion}` → `datos: Record<string, string \| null>`. **`SCHEMA_VERSION` 2 → 3** |
| **`EstadoPropuesto`** | Los 3 campos → `datos: Record<string, string \| null>` |
| **`normalizar.ts`** | `faltaParaCerrar` recorre **los requisitos**, no tres `if` |
| **`estado.ts`** | Los 3 rechazos → uno por cada requisito `obligatorio` que falte. `aplanar` emite `datos.<id>` |
| **`extraer.ts`** | `CAMPOS` y `comoTexto` se construyen desde los requisitos; las etiquetas salen de ellos |
| **`pipeline.ts`** | El prompt pide **los requisitos del negocio**, con sus etiquetas |
| **`registro-de-cambios.ts`** | Las 3 claves → **una**: `datos`, clasificada como `personal` |

> 🔑 **El detalle que simplifica la clasificación**: los `datos` son, por
> definición, lo que el cliente cuenta **sobre sí mismo**. Tratar el bloque
> entero como `personal` elimina la necesidad de un mapeo tipo→clase y es seguro
> por defecto. Si un negocio pide algo impersonal —*"número de mesa"*— se pierde
> un poco de trazabilidad; nunca al revés.

## 5. La estructura propuesta

```jsonc
// en la ficha, sección `flujo` (la escribe la agencia, no el cliente)
"cierre": {
  "requisitos": [
    { "id": "nombre",    "tipo": "texto",     "etiqueta": "¿a nombre de quién?",     "obligatorio": true },
    { "id": "telefono",  "tipo": "telefono",  "etiqueta": "un celular de contacto",  "obligatorio": true },
    { "id": "direccion", "tipo": "direccion", "etiqueta": "la dirección de entrega", "obligatorio": true,
      "soloSi": "entrega.haceDomicilios" }
  ]
}
```

```jsonc
// en el estado
"datos": { "nombre": "Andrea", "telefono": "3001234567", "direccion": null }
```

**Tres decisiones de diseño, y sus porqués:**

- **`soloSi` es una referencia a un campo de la ficha, no una expresión.** Sin
  operadores, sin `&&`, sin comparaciones. Un mini-lenguaje de condiciones es
  una puerta abierta a que el CRM acabe teniendo un intérprete dentro, y eso
  nadie lo pidió.
- **`tipo` no valida formato todavía.** Declara qué es el dato, para el prompt y
  para el log. Validar un teléfono es alcance nuevo — y hoy no se valida ninguno.
- **Si la ficha no declara requisitos, los pone el vertical.** Ningún cliente
  actual los tiene, y obligar a reescribir cuatro fichas para desplegar esto
  sería cambiar datos de producción por una refactorización.

## 6. Qué es del núcleo y qué del vertical

| | Núcleo | Vertical |
|---|---|---|
| **Datos** | `item` · `seleccion` · `datos` · `totalCents` · `paso` · `confirmado` | Los **requisitos por defecto** |
| **Reglas** | Validar contra el catálogo · calcular el total · exigir lo obligatorio antes de confirmar | Qué es obligatorio, cómo se llama y en qué orden |
| **Acciones** | — | `notify_order` / `book_appointment` |
| **Recursos** | — | La reserva de tiempo (**solo citas**) |

Los **defaults por vertical** viven en el módulo del vertical, no en el núcleo:

```
pedidos → nombre · telefono · direccion (soloSi: entrega.haceDomicilios)
citas   → nombre
```

> ⚠️ **`fecha`, `hora` y `profesional` NO son `datos`.** Son la reserva de un
> recurso, con su restricción de solape y su disponibilidad: meterlos en el
> mismo cajón convertiría `datos` en un saco de todo. Van en `recurso`, y eso es
> el **paso 4**, no este.

## 7. Riesgos

| Riesgo | Gravedad |
|---|---|
| **`SCHEMA_VERSION` 2 → 3** | 🟢 gratis mientras `conversation_state` siga vacía. Es la tercera vez que se aprovecha esa ventana |
| **Segunda invalidación de la medición** | 🟠 el prompt vuelve a cambiar. **Recomendación: medir UNA vez, con los dos cambios dentro** — repetir la medición dos veces cuesta el doble y no responde nada nuevo |
| **Los defaults se convierten en el nuevo cableado** | 🟠 si nadie declara requisitos nunca, el sistema se comporta igual que hoy con más código. Mitigación: que `/admin` los muestre y se rellenen al alta |
| **Un requisito mal declarado bloquea pedidos** | 🟠 `obligatorio: true` en algo que el cliente nunca da = pedidos que no se confirman jamás. Es el fallo del Mega Box otra vez, ahora configurable |
| **`datos` sin clasificar en los logs** | 🟢 resuelto por construcción: el bloque entero es `personal` |
| **La deuda de `leerAporte`** | 🟢 `CAMPOS` es suya, y sigue muerta. Este cambio obliga a decidir: se conecta o se borra |

## Lo que NO entra en este paso

Por las restricciones dadas: **el catálogo no se toca** (ya es genérico), **los
cierres de pedidos y citas no se tocan** (siguen en la conducta), **el vertical
no se toca** (ya tiene fuente única), y **`recurso` no se implementa** — es el
paso 4.

---

## ✅ Implementado el 17-ago

```ts
// ANTES — los datos de un negocio que reparte, dentro del núcleo
entrega: { nombre: string|null; telefono: string|null; direccion: string|null }

// AHORA — lo que declare cada ficha
datos: Record<string, string | null>          // en el estado
Requisito { id, tipo, etiqueta, obligatorio, soloSi? }   // en la ficha (CRM)
```

`SCHEMA_VERSION` **2 → 3**.

### Las cuatro restricciones, cumplidas

**1. `datos` no es un contenedor sin contexto.** El `Requisito` es una entidad
explícita, y **nada interpreta `datos` sin ellos**: `validarPropuesta`,
`normalizarPedido`, `loQueFalta` y `comoTexto` los reciben. Se sigue pudiendo
responder qué falta (los `obligatorio` vacíos, en el orden declarado), qué es
personal (**todo el bloque**, por definición), qué pide el prompt (las
`etiqueta`) y qué sale en los logs (`datos.<id>`, clasificado por bloque).

**2. Los requisitos son del CRM.** No hay ninguna lista de campos en
`extraer.ts`, `estado.ts`, `normalizar.ts` ni `pipeline.ts` — el barrido lo
confirma: cero apariciones de `telefono` o `direccion` en los cuatro.

> 🔴 **Con una excepción, declarada y no escondida**: `requisitosDe()` en
> `ficha.ts` tiene un valor por defecto por vertical. Vive en el CRM y no en el
> núcleo, pero **es una lista de campos y hay que llamarla por su nombre**. Está
> ahí porque las cuatro fichas de producción no declaran `cierre`, y sin ella el
> despliegue las dejaría cerrando pedidos sin pedir un nombre. **Se borra el día
> que las cuatro fichas declaren lo suyo.**

**3. Un tercer vertical, demostrado.** `tests/unit/tercer-vertical.test.ts`: un
**taller de reparaciones** que vende una revisión con opciones (tipo de
pastilla, urgencia) y necesita **la placa del vehículo** y un número de orden —
ni dirección, ni teléfono, ni nombre. Cinco pruebas, y **ninguna línea del
núcleo sabe qué es una placa**. Pasaron a la primera.

**4. La medición de la regla 13**: pendiente de ejecución, **una sola vez**, con
los dos cambios de prompt dentro (paso 1 y paso 1.5).

## Estado

**Auditoría terminada e implementada.** Ningún acoplamiento nuevo entre el
núcleo y un negocio concreto apareció durante el análisis: el único que queda es
el que este paso viene a quitar.
