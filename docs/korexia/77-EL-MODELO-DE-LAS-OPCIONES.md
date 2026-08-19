# El modelo de las opciones: definición contra selección

> **Dentro:** La pregunta y la respuesta · Las dos representaciones, lado a lado
> · Los cinco errores, explicados por el modelo · Tres hallazgos nuevos · Lo que
> el modelo NO explica · Qué haría falta

**16-ago-2026. Auditoría, no refactorización.** Cinco errores consecutivos en la
interpretación de las opciones no parecen cinco descuidos. Esto responde a una
sola pregunta: **¿los explica el modelo de datos?**

---

## La pregunta central

> ¿Existe una separación explícita entre **la definición del catálogo** y **la
> selección que hace el cliente**?

**No.** Y no es un matiz: **son dos modelos incompatibles conectados por una
cadena de texto.**

---

## Las dos representaciones, lado a lado

**La definición** (`catalog/queries.ts`) es un modelo relacional completo:

```ts
ProductoDelCatalogo { id, nombre, precioCents, grupos: [
  GrupoDeOpciones { id, nombre, minimo, maximo, opciones: [
    OpcionDeProducto { id, nombre, precioExtraCents }
  ]}
]}
```

Cada opción **tiene identidad** (`id`), **pertenece a un grupo** y ese grupo
**tiene reglas** (`minimo`, `maximo`).

**La selección** (`orders/normalizar.ts` y `orders/estado.ts`) es esto:

```ts
{
  producto:   { id: "prod_x", nombre: "CHURRITA", cantidad: 1 },  // ← id resuelto
  salsas:     ["arequipe", "arequipe"],                            // ← solo nombres
  recubierto: "azúcar-canela",                                     // ← solo nombre
  adiciones:  ["botella de agua"],                                 // ← solo nombres
}
```

Tres diferencias, y las tres duelen:

| | Definición | Selección |
|---|---|---|
| **Identidad** | `id` estable por opción | **el nombre, y nada más** |
| **Pertenencia** | la opción cuelga de su grupo | **el nombre del campo en el código** (`salsas`, `adiciones`) |
| **Reglas** | `minimo` / `maximo` por grupo | ninguna: cada función las re-deriva |

Y una asimetría que lo dice todo: **el producto SÍ se resuelve a `id`** —con un
comentario que explica por qué: *"redundante a propósito: si el producto se
borra, el estado sigue siendo legible"*—. **Las opciones no.** La misma
precaución, no aplicada un nivel más abajo.

---

## Los cinco errores, explicados por el modelo

| # | Error | Qué lo causó, en el modelo |
|---|---|---|
| 1 | El pipeline cogía *"el primer grupo con opciones"* y podía devolver `RECUBIERTO` | La selección **no dice de qué grupo es** cada elemento: hay que adivinarlo desde el catálogo, y adivinar se escribe distinto en cada sitio |
| 2 | `sumaDeExtras` cobraba la salsa incluida como adición | Para poner precio hay que **volver a buscar por nombre**, y el nombre **no es único entre grupos**: `AREQUIPE` está en los dos |
| 3 | `faltaParaCerrar` usa su propio criterio (pendiente) | Las reglas (`maximo`) viven en el catálogo, no en la selección: **cada validador vuelve a buscarlas**, y cada uno lo hace un poco distinto |
| 4 | Las salsas se deduplicaban | `string[]` de nombres **es un conjunto disfrazado de lista**. Nada en el tipo dice que repetir es legítimo |
| 5 | Dos botellas de agua se cobraban como una | El bucle recorría **el catálogo** en vez de **lo pedido**: cuando los dos son "listas de nombres", cuál se recorre parece intercambiable — y no lo es |

**Los cinco son la misma frase**: *código que manipula opciones sin saber a qué
grupo pertenecen ni si pueden repetirse*. No se puede saber, **porque el dato no
lo dice**.

> 🔑 El catálogo es una **definición**; el pedido es una **selección**. Hoy los
> dos se representan como listas de nombres, y por eso se confunden.

---

## Tres hallazgos nuevos de esta auditoría

### A. Renombrar una opción rompe los pedidos en curso — 🟠

El estado guarda `"arequipe"`. Si el negocio corrige el nombre a `"Arequipe
artesanal"`, el pedido en curso deja de resolver: la salsa pasa a *"no está entre
las opciones"* y el pedido se queda sin total. Con `producto` no pasa, porque de
él **sí** se guarda el `id`.

**No es teórico**: cambiar un nombre del catálogo es exactamente lo que hará un
cliente desde la pantalla que falta por construir.

### B. El estado tiene los grupos de La Churra cableados — 🔴

`EstadoDelPedido` declara **tres campos fijos**: `salsas`, `recubierto`,
`adiciones`. También el prompt que pide la extracción, y también `loQueFalta`,
que ordena el flujo *presentación → salsas → recubierto*.

Pero el catálogo es **genérico**: cualquier producto puede tener cualquier grupo.
Un negocio con `TAMAÑO`, `LECHE`, `TÉRMINO` o `PUNTO DE COCCIÓN` **no tiene dónde
guardar sus opciones**: no hay campo, y el validador no las vería.

Es decir: **la Fase 2, tal como está, sirve para La Churra y no para el siguiente
cliente de pedidos.** Puede ser deliberado —pilotar en un cliente—, pero choca de
frente con la regla 1, que dice que el objetivo **es escalar**, y en ninguna
parte de la documentación consta como decisión.

### C. Tres formas para tres grupos que el catálogo trata igual — 🟠

```ts
salsas:     string[]        // varias
recubierto: string | null   // una
adiciones:  string[]        // varias
```

El catálogo no distingue: **todos son grupos con `minimo` y `maximo`**. La forma
del estado congela una interpretación —*"el recubierto es uno"*— que es un dato
del catálogo, no del código.

Consecuencia inmediata y concreta: si «Ambas» se hubiera resuelto como
`max_select: 2` —una de las dos opciones que se barajaron el 16-ago—, **el estado
no habría podido representarlo**. La decisión de negocio se salvó por casualidad.

---

## Lo que el modelo NO explica

Por honestidad, porque no todo es lo mismo:

- Las fugas de datos personales en los logs son de otra familia (observabilidad).
- El `.from` que faltaba en el guardarraíl fue una lista incompleta, no un
  modelo malo.
- El despliegue que no estaba desplegado no tiene nada que ver.

**Cinco de los últimos nueve hallazgos**, sí: todos los que tocan opciones.

---

## Qué haría falta (no implementado, no propuesto para hoy)

> ⚠️ **Actualizado el 17-ago-2026: esto YA SE HIZO.** `seleccion` es hoy una
> lista de `{ grupoId, grupoNombre, opcionId, nombre, precioDeltaCents }` en
> `orders/normalizar.ts`, y el contrato del estado pasó a `items[]`
> ([89](89-EL-CONTRATO-DE-LOS-ITEMS.md)). Lo que sigue se conserva como el
> razonamiento que lo justificó, no como trabajo pendiente. La regla de
> **repetir** que aquí se menciona vive desde entonces en el catálogo
> (`permiteRepeticion`) y se configura desde el CRM
> ([94](94-BITACORA-PERMITE-REPETICION-CRM.md)).

El cambio pequeño que quita el 80 % del filo, si se decidiera hacerlo:

```ts
seleccion: [ { grupoId, opcionId, nombre } ]   // en vez de tres listas de nombres
```

Con eso, los cinco errores **dejan de ser expresables**: cada elemento sabe de
qué grupo es, tiene identidad estable, y repetir es natural porque es una lista
de elecciones y no un conjunto de nombres.

Lo que costaría, dicho sin adornos: cambia `EstadoDelPedido` (y con él
`SCHEMA_VERSION`), el prompt de extracción, el validador, el extractor y las
pruebas. **La tabla `conversation_state` está vacía**, así que no hay migración
de datos — pero sí es tocar el contrato central de la Fase 2.

> **Esto es un informe, no una propuesta.** La decisión de si se toca el modelo,
> se aplaza o se acepta como deuda consciente **es del dueño**, y conviene
> tomarla antes de encender la bandera: después, cada cambio de forma tendrá
> conversaciones vivas encima.
