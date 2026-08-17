# `probar:estado`: qué tiene que demostrar

> **Dentro:** Los criterios de salida · Lo que se probaba antes y lo que se
> prueba ahora · Los dos clientes efímeros · 🔴 El hallazgo del `tsconfig` ·
> Cómo se ejecuta · Cómo se revierte

**17-ago-2026.** Antes de encender la Fase 2 para el vertical de pedidos, el
dueño puso una condición: **la prueba de extremo a extremo tiene que tener
criterios de salida escritos antes de ejecutarla**, no después.

Están escritos aquí y en la cabecera del propio script, que es donde alguien los
va a leer dentro de seis meses.

---

## Los criterios de salida

### Vertical de pedidos

| | Qué demuestra | Dónde |
|---|---|---|
| 1 | Crear un pedido | `A2` |
| 2 | Elegir producto (y que el `id` lo resuelve el servidor) | `A2` |
| 3 | Añadir opciones de **varios grupos a la vez** | `A3` |
| 4 | **Repetir** dentro de un grupo que lo permite | `A3` |
| 5 | Pedir los datos obligatorios **que declara la ficha** | `A4` |
| 6 | Confirmar el pedido | `A5` |
| 7 | Eliminar el estado temporal al terminar | `A7` |

### Vertical de citas

| | Qué demuestra | Dónde |
|---|---|---|
| 8 | Crear la conversación | `B1` |
| 9 | El flujo de citas sigue funcionando | `B3` |
| 10 | **NO** pide dirección | `B2` |
| 11 | **NO** pide teléfono | `B2` |
| 12 | `cierre.requisitos` **no cambia el prompt** | `B4` |

### Y en los dos

Sin errores · **sin datos huérfanos** · sin estado persistente tras la limpieza ·
sin diferencias entre lo esperado y lo observado · y la flota, fila completa,
idéntica antes y después.

---

## Lo que se probaba antes, y lo que faltaba

El script existía desde el 15-ago y probaba lo que entonces había: persistencia,
recuperación, corrupción deliberada, rollback, esquema desconocido y
concurrencia. **Todo eso sigue.**

Lo que **no** probaba, y es justo lo construido esta semana:

- ❌ Cerrar un pedido. Se validaba una propuesta y se guardaba; nunca se llegaba
  a `confirmado`.
- ❌ Más de un grupo de opciones. Un solo grupo con dos opciones no puede
  enseñar un cobro cruzado.
- ❌ La repetición.
- ❌ Los requisitos declarativos.
- ❌ **El vertical de citas, entero.** Contra la regla 9.

---

## Los dos clientes efímeros

Se crean y **se borran en el `finally`**, pase lo que pase. Ninguno es un
cliente real, y ninguno sobrevive a la ejecución.

**El de pedidos** tiene dos productos: uno sencillo, y una caja con **dos
grupos**:

- `SALSAS`: pide **5** y solo tiene **4** opciones → únicamente se completa
  repitiendo. Es el caso que el 16-ago dejó el pedido más caro sin poder
  cerrarse.
- `ADICIONES`: tiene una opción **con el mismo nombre** que una de las salsas,
  pero de pago. Si el cobro volviera a cruzarse entre grupos, el total saldría
  $1.500 más caro y la prueba lo dice.

Su ficha declara tres requisitos. **El código no sabe cuáles son**: los lee de la
ficha guardada, como hará el pipeline.

**El de citas** tiene un servicio, una profesional y una ficha que pide **una
sola cosa**: el nombre. Ni dirección ni teléfono — que es exactamente lo que un
salón no debe preguntar.

> El catálogo se lee **de la base** con `catalogoDe()`, no se escribe a mano en
> el script. Así la prueba recorre la misma cadena que el pipeline, incluida la
> columna que creó la migración 0023.

---

## El resultado: ✅ los 12 criterios, en verde

**Ejecutado el 17-ago-2026 contra la base de producción.** `41` comprobaciones,
todas en verde, y las tres del cierre:

| | |
|---|---|
| **La flota** | `agent_profile` fila por fila, **idéntica** antes y después |
| **Sin huérfanos** | Las 10 tablas contadas tras el borrado: cero |
| **Sin restos** | Verificado aparte: 4 organizaciones (las reales), 4 banderas en `prompt`, **0 filas** en `conversation_state` |

Lo que más importa de esa lista, en una línea cada uno:

- **El pedido difícil se cierra.** Cinco salsas de cuatro sabores, y las cinco
  se conservan: `arequipe` dos veces son dos.
- **El cobro no se cruza.** $40.000 + una adición de $1.500 = **$41.500**. Con el
  bug de antes habrían sido $43.000, porque el mismo nombre existe gratis en un
  grupo y de pago en otro.
- **Donde el grupo no permite repetir, se pregunta**: *«oreo ya está en tu
  adiciones. ¿Querías otra distinta?»*. No adivina.
- **No se confirma sin lo que pide la ficha**, ni —y esto es lo importante—
  cuando la ficha **no ha declarado** nada: *«confirmado sin requisitos
  declarados en la ficha del negocio»*.
- **El salón no pide dirección ni teléfono.** Lo único que le falta antes de
  elegir servicio es el servicio.
- **El prompt no cambia** con los requisitos declarados. Byte a byte.
- **Los datos personales no aparecen en los logs**: `datos.nombre`,
  `datos.telefono` y `datos.direccion` salen como
  `<personal · 10 caracteres · huella e325c97575c9>`.

---

## 🔴 Segundo hallazgo: la auditoría describía mal el contrato de las citas

`calcularDisponibilidad` devuelve **`Record<hora, staffId[]>`** — la clave es la
franja, el valor es quién la tiene libre. La auditoría del paso 4
([83](83-RECURSOS-Y-RESERVAS.md)) decía `Record<staffId, string[]>`, **al revés**.

Se descubrió aquí: la prueba leyó `huecos[staffId]`, obtuvo `undefined` y
concluyó «0 franjas». **El código siempre estuvo bien**; el documento no.

Y tiene una consecuencia que va más allá de una prueba mal escrita: el paso 4a
está planificado como *«generalizar `staffIds` a `recursoIds`, un rename»*. Si
alguien lo hace leyendo el documento, esperará una salida por recurso —y leer una
clave que no existe **no falla: devuelve `undefined`**, que es indistinguible de
una agenda llena. Es el mismo fallo silencioso que ya rechazó citas durante dos
días con el salón vacío.

Corregido en el documento **y en la firma de la función**, que es donde alguien
lo va a mirar antes de tocarla.

---

## 🔴 El hallazgo: `scripts/` no se comprueba

Al preparar esta ejecución, el script **no compilaba**. Cuatro errores de tipo:

| Error | Qué habría pasado |
|---|---|
| Contrato viejo (`nombre`/`telefono`/`direccion` en vez de `datos`) | Falla al ejecutar |
| `Duda.porque` no existe | Falla al ejecutar |
| `service` no tiene `position` | Falla **con el cliente ya creado** |
| `generarPerfil(ficha, false)` — el 2.º parámetro es un objeto | Falla al ejecutar |

Los tres primeros venían de los pasos 1, 1.5 y 3A: se cambió el contrato del
núcleo y **el script se quedó atrás dos días sin que nada avisara**.

La causa es una línea:

```json
"exclude": ["node_modules", "scripts"]
```

`pnpm typecheck` **no mira `scripts/`**. Y ahí viven `migrar:requisitos`,
`sembrar`, `regenerar:flota` y este mismo — todos los que escriben en la base de
producción. **El código con menos red es el que más cerca está de los datos
vivos.**

Se comprobó a mano con un `tsconfig` temporal antes de ejecutar nada. **Queda
como pendiente**, no se arregla aquí: cambiar el `tsconfig` toca el gate de todo
el repo y eso es una decisión, no un detalle de esta prueba.

---

## Cómo se ejecuta

Necesita la base **de producción** (es una prueba de integración: sin Postgres
de verdad no demuestra nada). El túnel se abre antes:

```bash
ssh -i ~/.ssh/churrabot_key -f -N -L 15433:172.16.1.1:5433 root@2.25.159.117
pnpm probar:estado
```

Termina en `0` si todo pasa y en `1` con la lista de lo que falló.

---

## Cómo se revierte

`git revert` del commit. El script no cambia esquema ni datos: crea dos
organizaciones y las borra. Si se interrumpe a mitad, el `finally` las borra
igual; si ni eso llega a correr, quedan dos organizaciones con nombre
`PRUEBA pedidos <marca>` y `PRUEBA citas <marca>` que se pueden borrar a mano
desde `/admin`.
