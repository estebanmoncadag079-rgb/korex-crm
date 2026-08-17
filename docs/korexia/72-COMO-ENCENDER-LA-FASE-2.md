# Cómo encender la Fase 2 — la lista completa

> **Dentro:** El estado exacto al 16-ago · Las 18 tareas, numeradas y
> clasificadas · Cuáles escriben en producción · El camino mínimo · Lo que se
> hizo hoy sin tocar la base

**Este documento sustituye a la sección "cómo retomar" de
[70-PENDIENTES-16AGO.md](70-PENDIENTES-16AGO.md)** en todo lo que se solape. El
70 sigue siendo el pendiente general del proyecto; este es solo la Fase 2.

---

> # 🔴 FASE 2 CONGELADA (17-ago-2026)
>
> **No se enciende, no se carga nada en La Churra y no se corrige ningún bug
> específico suyo** hasta terminar la generalización del modelo.
>
> La lista de abajo **sigue siendo válida**, pero se ejecuta DESPUÉS de los
> cuatro pasos de [79-ARQUITECTURA-MULTIEMPRESA.md](79-ARQUITECTURA-MULTIEMPRESA.md).
> Las tareas 4 y 5 (cargar opciones, limpiar «Ambas») quedan expresamente
> detenidas: el modelo que las valida está a punto de cambiar.

---

## El estado exacto, al 16-ago-2026

| | |
|---|---|
| Código de la Fase 2 | ✅ escrito, con pruebas |
| Desplegado | ✅ **verificado dentro del contenedor** (`state_source` pasó de 0 a 4 archivos en `/app/.next`) |
| Métricas de la regla 10 | ✅ implementadas hoy, **sin ejecutar todavía** |
| Bandera `state_source` | `'prompt'` en los cuatro clientes |
| `conversation_state` | existe, **0 filas** |
| Catálogo de La Churra en tablas | 4 productos, **solo el grupo `SALSA`** |
| «Ambas» | ✅ resuelta: es lo mismo que `Azúcar-canela` |

**Nada de la Fase 2 se ejecuta hoy.** Con la bandera en `'prompt'` el pipeline
corre exactamente como antes: no lee estado, no lo escribe y no emite métricas.

---

## Las tareas, numeradas

`P` = **escribe en producción** · `L` = se hace en local, sin tocar la base.

### 🔴 Bloqueantes — sin esto no se enciende

| # | Tarea | ¿Escribe? |
|---|---|---|
| 1 | **Verificar el código de hoy**: `pnpm test` y el typecheck. Las métricas y `grupoDeSalsas` están escritos pero **no se han ejecutado ni una vez** | **L** |
| 2 | **Desplegar** ese cambio: commit → push → `git archive`+`scp` a la carpeta de EasyPanel → Desplegar → verificar **dentro** del contenedor | **L** (+ el botón) |
| 3 | **`pnpm probar:estado`**: la prueba de extremo a extremo contra Postgres real, sobre un cliente que **se crea y se borra en la misma corrida**. No toca a ningún cliente vivo | **P** (efímero, se limpia solo) |
| 4 | **Cargar `RECUBIERTO` y `ADICIONES`** en La Churra: simulación → comparar el catálogo renderizado antes/después → `--aplicar`. 40 INSERT · 0 UPDATE · 0 DELETE | **P** |
| 5 | **Borrar «Ambas»** del texto de la ficha y recompilar el prompt | **P** |
| 6 | **Un banco de escenarios que sirva** para un negocio de pedidos. El actual está escrito con los productos de Lis (*"el precio del Cremoso 12 oz"*, *"Lis NO acepta efectivo"*) y contra churros da falsos negativos | **L** para escribirlo · **P** para correrlo |
| 7 | **Encender la bandera en un cliente efímero** de pedidos y recorrer un pedido completo | **P** (efímero) |
| 8 | **La revisión a ojo del dueño** sobre ese pedido completo. Criterio 8 de [69](69-FASE-2-ESTADO-ESTRUCTURADO.md), y no lo puede hacer el asistente | — |
| 9 | **Los 8 criterios de encendido** de [69](69-FASE-2-ESTADO-ESTRUCTURADO.md), verificados uno a uno sobre ese cliente | **P** (lectura) |

### 🟠 Recomendadas — no bloquean, pero se pagan caras después

| # | Tarea | ¿Escribe? |
|---|---|---|
| 10 | **El nombre de la salsa en la ficha**: la tabla dice `chocolate negro`, la ficha `CHOCOLATE`. La tabla es la canónica | **P** |
| 11 | **Precios del saludo escritos a mano**: hoy un precio vive en la fila de `product` **y** en el primer mensaje de la ficha | **P** |
| 12 | **El formato horario**: el agente dice `09:30` y la regla nueva pide `9:30 a. m.` | **L** |
| 13 | **`.set({ ...body.data })`** en 3 rutas: hoy lo contiene Zod, frágil ante el próximo campo | **L** |
| 14 | **Pantalla de catálogo**: sin ella un cliente no puede cambiar su propio precio | **L** |

### ⚪ Opcionales — cuando haya motivo, no antes

| # | Tarea | ¿Escribe? |
|---|---|---|
| 15 | Tabla de métricas en vez de logs. **Solo cuando se sepa qué se pregunta** al leerlos | **L** |
| 16 | RLS: hoy el aislamiento depende de `scoped()` en cada consulta | **P** |
| 17 | Meter a **Lis** en el sistema de fichas. Regla 9: es **la última**, siempre | **P** |
| 18 | La columna `unidades`. Medida: arreglaba **1 caso de 60**. Descartada a propósito | **P** |

> 🔴 **Y por encima de todo esto, sin relación con la Fase 2**: la contraseña del
> superadmin sigue pendiente desde el 31-jul.

---

## El camino mínimo, en orden

El orden no es cosmético: **está puesto para que todo lo que se pueda descubrir
en un cliente de mentira se descubra antes de tocar el que factura.**

```
1 y 2  →  verificar y desplegar el código de hoy        (nadie se entera)
  3    →  pnpm probar:estado                            (cliente efímero, se borra)
  6    →  escribir el banco de un negocio de pedidos    (local)
  7    →  encender la bandera en el cliente efímero     (nadie real)
  8    →  el dueño mira un pedido completo              (la única puerta humana)
  4,5  →  cargar opciones y limpiar «Ambas» en La Churra
  9    →  los 8 criterios, sobre datos reales
  →       decidir si se enciende en La Churra
```

**La 4 va casi al final a propósito.** Es la única tarea de esta lista que
cambia lo que un cliente real ve **en el turno siguiente y sin desplegar**:
`renderCatalogoDePedidos` pinta cualquier grupo que encuentre en las tablas, así
que en cuanto existan `RECUBIERTO` y `ADICIONES` aparecen en el prompt de La
Churra con sus precios y su `(opcional)`. Todo lo demás se puede probar sin que
nadie lo note.

---

---

## Los hallazgos de la auditoría del 16-ago

Se auditó catálogo, endpoints, Fase 2, seguridad y arquitectura. Trece
hallazgos; ninguno necesita migración. Los que bloquean el encendido:

| | Hallazgo | Estado |
|---|---|---|
| 🔴 | **Datos personales en los logs**: `entrega.telefono/direccion/nombre` se volcaban en claro | ✅ **corregido el 16-ago** — ver [10-SEGURIDAD.md](10-SEGURIDAD.md) |
| 🔴 | **Tres logs volcaban datos de clientes YA en producción** (dos webhooks y el pipeline), sin relación con la Fase 2 | ✅ **corregido el 16-ago** — ver [74-REGLAS-DE-LOGS.md](74-REGLAS-DE-LOGS.md) |
| 🟠 | `normalizar.ts:382` calcula las salsas por su cuenta, sin `grupoDeSalsas()` | 🔴 pendiente |
| 🔴 | **`sumaDeExtras` cobraba la salsa incluida como si fuera adición** | ✅ **corregido el 16-ago** — ver [76](76-EL-MAPA-DE-LAS-SALSAS.md) |
| 🔴 | ~~El Mega Box no se puede completar nunca~~ | ✅ **corregido el 16-ago**: las salsas se repiten (decisión del dueño) |
| 🔴 | **El `"0"` del reinicio sigue clavado**: `matchesReinicio` acepta el parámetro pero el pipeline no se lo pasa. Con la Fase 2 encendida, un `0` borra el pedido en **cualquier** cliente | 🔴 pendiente (tarea 2C) — ver [78](78-CAMBIAR-EL-MODELO-IMPACTO.md) |
| 🔴 | **Decisión pendiente sobre el modelo de las opciones**: el estado guarda nombres sueltos, no `(grupoId, opcionId)`, y tiene los grupos de La Churra cableados. Explica cinco de los últimos errores | 🔴 **del dueño** — ver [77](77-EL-MODELO-DE-LAS-OPCIONES.md) |
| 🟠 | **`faltantesDeLaFicha` decide con `ficha.vertical`**, y en `/admin` se llama ANTES de normalizar: una ficha incoherente pasaría la validación y reventaría al generar el prompt | 🔴 pendiente, caso borde |
| 🟠 | `leerAporte()` es código muerto y la doc dice que se usa | 🔴 pendiente — **confirmado el 17-ago**: sigue sin llamarlo nadie |
| 🔴 | **`tsconfig` excluye `scripts/`**: el typecheck no los mira, y así `probar-estado.ts` —tarea bloqueante 3— estuvo roto con el gate en verde | 🔴 pendiente |
| 🟠 | **`medir-extraccion.ts` sigue con el contrato viejo**, a propósito: se rehace con la medición de la regla 13 | 🔴 pendiente |
| 🟠 | **`entrega: {nombre, telefono, direccion}` sigue cableado** en el estado: un salón no entrega nada. Es el paso 3 de [79](79-ARQUITECTURA-MULTIEMPRESA.md) | 🔴 pendiente |

Y los recomendados: la instrumentación de `agent/profile` que se autodeclara, el
precio de Lis dentro del prompt universal, los tres `.set({ ...body.data })` y
`api/kb/[id]` sin instrumentar.

---

## Lo que se hizo el 16-ago sin tocar la base

**Las métricas de la regla 10** (`registrarMetricaDeEstado`): una línea por turno
de la que se derivan las seis. Detalle en
[69](69-FASE-2-ESTADO-ESTRUCTURADO.md).

**Un bug latente, encontrado al contrastar el código con la Fase 1.5.** El
documento [67](67-FASE-1.5.md) declara corregido el patrón de coger *"el primer
grupo con opciones"*… y el pipeline lo seguía usando:

```ts
salsasQueLleva = delPedido?.grupos.find((g) => g.opciones.length > 0)?.maximo ?? 0;
```

Mientras el catálogo tenga **un solo grupo**, las dos formas dan lo mismo y el
fallo es invisible. **Se activa exactamente con la tarea 4**: con tres grupos
cargados, ese `find` puede devolver el recubierto —máximo 1— y el agente le
pediría **una** salsa a un Mega Box, que lleva **cinco**. Un pedido mal tomado,
en el cliente que factura, el mismo día de la carga.

Arreglado con `grupoDeSalsas()`, exportada desde `normalizar.ts` para que el
pipeline y el validador usen **el mismo criterio** en vez de dos parecidos. Con
tres pruebas, una de ellas con el catálogo tal como quedará después de la carga.

> 🔑 La lección, que es la de siempre en este proyecto: **el fallo no estaba en
> lo que se probó, sino en los dos sitios que hacían lo mismo de forma
> distinta.** Y solo se veía leyendo la doc y el código a la vez.
