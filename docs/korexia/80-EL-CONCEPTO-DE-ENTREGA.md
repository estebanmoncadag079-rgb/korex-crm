# El concepto de «entrega» dentro del núcleo

> **Dentro:** 🔴 El hallazgo: el dato ya existe y el núcleo no lo mira · El
> inventario · Las cinco preguntas · El modelo propuesto · Lo que no hay que
> generalizar

**17-ago-2026. Auditoría, sin código.** Tras el paso 1 el núcleo dejó de saber
qué es una salsa. Queda un acoplamiento del mismo tipo, un nivel más arriba:
**el núcleo sigue dando por hecho que todo negocio entrega algo físico a
domicilio.**

---

## 🔴 El hallazgo: el CRM ya lo sabe, y el núcleo no se lo pregunta

La ficha de cada negocio **ya declara** cómo entrega:

```ts
Entrega = {
  haceDomicilios: boolean;   // ← si es false, el resto se ignora
  como?, quienPagaElDomicilio?, restricciones?, recogerEnLocal?
}
```

Se pide en el alta (`api/onboarding`), se puede editar en `/admin`
(`clients/[id]/ficha`), y el generador de prompts lo respeta con cuidado — su
propio comentario lo dice: *"un negocio sin domicilios no debe tener ni una línea
sobre domicilios"*.

**Y el validador de la Fase 2 no lo mira jamás.** `validarPropuesta` exige
siempre las tres cosas:

```ts
if (!estado.entrega.nombre?.trim())     rechazos.push("confirmado sin nombre");
if (!estado.entrega.telefono?.trim())   rechazos.push("confirmado sin teléfono");
if (!estado.entrega.direccion?.trim())  rechazos.push("confirmado sin dirección");
```

Consecuencia **hoy, sin cambiar nada**: un negocio con `haceDomicilios: false`
—que solo vende para recoger en el local— tendría un prompt que **nunca pide la
dirección**, un cliente que nunca la da y un validador que **rechaza el pedido
por no tenerla**. El pedido no se persistiría nunca.

> 🔑 Esto cambia la naturaleza del trabajo: **no hay que inventar un modelo de
> configuración, hay que conectar el que ya existe.** El dato tiene dueño
> —el CRM— y el núcleo lo ignora.

---

## El inventario

Búsqueda de `entrega`, `nombre`, `telefono`, `direccion`, `domicilio`,
`shipping`, `delivery`, `recoge`:

### 🔴 Núcleo — asume entrega física (4 archivos, ~25 referencias)

| Dónde | Qué |
|---|---|
| `orders/estado.ts` (12) | `EstadoDelPedido.entrega{nombre,telefono,direccion}` · los 3 rechazos de `confirmado` · `estadoVacio` · `aplanar` con 3 claves |
| `orders/extraer.ts` (6) | 3 entradas en `CAMPOS` · 3 `push` en `loQueFalta` |
| `orders/normalizar.ts` (4) | `EstadoPropuesto.nombre/telefono/direccion` · 3 `push` en `faltaParaCerrar` |
| `ai/pipeline.ts` (1) | **El prompt de extracción** pide los tres campos por su nombre |
| `registro-de-cambios.ts` | La clasificación lista `entrega.nombre/telefono/direccion` una a una |

### 🟠 Heurística — legítima, pero mira el mismo concepto

`orders/intencion.ts` (5): detecta que el cliente pregunta por el domicilio.
`ai/anuncio-de-cierre.ts` (3), `inbox/ingest.ts` (2).

### 🟢 Configuración y presentación — **aquí es donde debe vivir**

`ai/generador/ficha.ts` (16) · `generar.ts` (13) · `conducta.ts` (9) ·
`prompts.ts` (6) · `api/onboarding` (4) · `api/admin/clients/[id]/ficha` (4) ·
`seed/demo.ts` (10) · `lab/personas.ts` (11).

**El desequilibrio es la conclusión**: el concepto está bien modelado como
configuración en 70 sitios, y cableado como certeza en 25.

---

## Las cinco preguntas

### 1. ¿Qué partes del núcleo asumen que existe una entrega física?

Las cinco de la tabla 🔴. En concreto, tres decisiones que hoy no se pueden
cambiar sin tocar código: **qué datos hay que reunir**, **cuáles son
obligatorios para confirmar** y **en qué orden se piden**.

### 2. ¿Qué contratos deberían volverse genéricos?

| Hoy | Debería ser |
|---|---|
| `entrega: {nombre, telefono, direccion}` | `datos: Record<campoId, valor>` |
| 3 rechazos escritos en `validarPropuesta` | derivados de los **requisitos declarados** |
| 3 `push` en `loQueFalta` / `faltaParaCerrar` | ídem |
| 3 entradas fijas en `CAMPOS` | derivadas de los requisitos |
| 3 claves en `aplanar()` y en la clasificación | **por el TIPO del campo** (ver §5) |
| El prompt con tres campos por nombre | la lista de requisitos del negocio |

### 3. ¿Qué campos son del vertical y cuáles del núcleo?

| | Campo | Dónde debe vivir |
|---|---|---|
| **Universal** | quién es (nombre) y cómo contactarlo | Núcleo, pero **como requisito declarado**, no como campo fijo |
| **Pedidos** | dirección · domicilio o recogida · quién paga el envío | Vertical |
| **Citas** | fecha · hora · profesional | Vertical |
| **Futuros** | lo que traigan | Vertical |

Matiz que conviene no perder: en WhatsApp **el teléfono ya se conoce** —viene
del contacto—, y aun así se pide, porque quien escribe puede estar pidiendo
para otro. Eso es una regla de negocio, no una verdad universal: debe poder
declararse.

### 4. ¿Cómo debería declararlo cada negocio desde el CRM?

La ficha ya tiene `vertical` y `entrega`. Falta **una sección de cierre** que
diga qué hay que reunir, en qué orden y cuándo es obligatorio:

```jsonc
"cierre": {
  "requisitos": [
    { "id": "nombre",    "tipo": "texto",     "etiqueta": "¿a nombre de quién?", "obligatorio": true },
    { "id": "telefono",  "tipo": "telefono",  "etiqueta": "un celular de contacto", "obligatorio": true },
    { "id": "direccion", "tipo": "direccion", "etiqueta": "la dirección",
      "obligatorio": true, "solo_si": "entrega.haceDomicilios" }
  ]
}
```

Un salón declararía `fecha`, `hora` y `profesional`. Una tienda que solo hace
recogida, ninguna dirección. **Y el mismo dato lo leerían el generador de
prompts y el validador**, que es justo lo que hoy no ocurre.

### 5. ¿Qué modelo permite añadir un vertical sin volver a tocar la Fase 2?

El núcleo se queda con lo que es verdad en cualquier negocio:

```
item (qué quiere) · seleccion (cómo lo quiere) · datos (lo que hay que reunir)
· totalCents · paso · confirmado
```

Y cada vertical aporta **tres cosas, ninguna dentro del núcleo**:

1. **Sus requisitos** → datos en la ficha (§4).
2. **Su acción de cierre** → `notify_order` o `book_appointment`. Ya está
   separado en la conducta; falta separarlo en el backend.
3. **Si reserva un recurso escaso** → solo citas. Es la única asimetría real
   entre los dos verticales: en pedidos nada impide vender dos veces lo mismo;
   en citas, sí.

**El detalle que hace que esto funcione con la regla 3 de los logs**: si cada
requisito declara su `tipo`, la clasificación deja de ser una lista escrita a
mano. Un campo `tipo: "telefono"` **es personal por definición**, se llame
`telefono`, `celular` o `contacto_alterno`. Hoy esa lista se mantiene a mano y
un campo nuevo sale como `<sin clasificar>`.

---

## Lo que NO hay que generalizar

Por honestidad, y porque sobre-generalizar tiene su propio coste:

- **El catálogo no se toca**: `producto → grupos → opciones` ya sirve a los dos
  verticales. Lo demostró el paso 1 con una manicura.
- **`intencion.ts` puede seguir sabiendo qué es un domicilio**: su trabajo es
  entender al cliente, y los clientes preguntan por el domicilio con esa
  palabra. Eso es heurística de lenguaje, no modelo de datos.
- **La conducta puede seguir teniendo dos cierres** (`CIERRE` y `CIERRE_CITAS`):
  ya se separaron el 13-ago y funcionan.

## Riesgos de hacerlo

| Riesgo | |
|---|---|
| **Diseñar a ciegas otra vez** | Los requisitos de un tercer vertical no se conocen. La mitigación: declarar **solo** lo que hoy está cableado, ni un campo más |
| **La validación por tipo** | Un `tipo: "telefono"` implica validar formato. Hoy no se valida ninguno; añadirlo es alcance nuevo |
| **`SCHEMA_VERSION` 2 → 3** | Gratis **mientras `conversation_state` siga vacía**. Es la misma ventana del paso 1, y sigue abierta |
| **Dos fuentes para el vertical** | `appointmentsEnabled` y `ficha.vertical` siguen sin unificar (paso 2). Si los requisitos dependen del vertical, **conviene hacer el paso 2 antes** |

> 🔑 Y por eso el orden de la hoja de ruta cambia: **el paso 2 (un solo dueño
> para el vertical) deja de ser un arreglo de higiene y pasa a ser el
> prerrequisito de este trabajo.**
