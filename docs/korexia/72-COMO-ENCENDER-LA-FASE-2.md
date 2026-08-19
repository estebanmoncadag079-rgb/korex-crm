# Cómo encender la Fase 2 — la lista completa

> **Dentro:** El estado exacto al 16-ago · Las 18 tareas, numeradas y
> clasificadas · Cuáles escriben en producción · El camino mínimo · Lo que se
> hizo hoy sin tocar la base

**Este documento sustituye a la sección "cómo retomar" de
[70-PENDIENTES-16AGO.md](70-PENDIENTES-16AGO.md)** en todo lo que se solape. El
70 sigue siendo el pendiente general del proyecto; este es solo la Fase 2.

---

> # ✅ DESCONGELADA — y el orden, decidido (17-ago-2026, tarde)
>
> La generalización que la congeló **está hecha**: pasos 1, 2, 1.5 y 3A. El
> núcleo ya no sabe qué es una salsa, ni una dirección, ni si un negocio reparte.
>
> **Decisión del dueño**: se enciende **primero el vertical de PEDIDOS**, y el
> paso 4 (recursos y reservas) va después. No son dos negocios: son **dos
> modelos** — pedidos es *selección + confirmación*; citas es *selección +
> reserva de recursos + disponibilidad*. La Churra valida el núcleo nuevo; el
> salón validará el motor de reservas. **No a la vez.**
>
> ⚠️ **Todo lo construido esta semana sigue sin verse con un cliente real.** Ese
> es justamente el motivo de encender.

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

## El camino de encendido, al 17-ago por la tarde

Verificado en producción hoy:

| | |
|---|---|
| `conversation_state` | **0 filas** — la ventana de cambiar el contrato sigue abierta |
| Banderas | `prompt` en los cuatro |
| La Churra | `catalog_source = tabla`, vertical `pedidos`, **sin `cierre` en su ficha** |

### 🔴 Bloqueantes, en orden

> **🛑 DETENIDO EL 17-AGO, DESPUÉS DEL PASO 4.** Una prueba real por WhatsApp
> pidió dos productos en un mensaje y destapó que **el estado solo sabe sostener
> uno** ([87](87-PEDIDOS-MULTIPRODUCTO.md)). El camino sigue siendo válido, pero
> **no se reanuda hasta cerrar el paso 3.6**: encender ahora significaría poner
> en producción un backend que no puede representar la mitad de un pedido real.
>
> Y hay una razón de coste, no solo de calidad: `conversation_state` tiene **0
> filas**, así que cambiar la forma del estado hoy **es gratis y reversible con
> un `git revert`**. Con el primer cliente encendido, deja de serlo.

| # | Tarea | ¿Escribe? |
|---|---|---|
| 1 | ✅ **`pnpm test` + typecheck + lint** sobre lo de esta semana | L |
| 2 | ✅ **Desplegar.** Aplica sola la migración `0023` (columna + el `UPDATE` de 1 fila) | L + el botón |
| 3 | ✅ **`pnpm migrar:requisitos`** — simular, revisar la lista, aplicar. **Sin esto ningún pedido se confirma**: el validador se niega si la ficha no los declara | **P** |
| 3.5 | ✅ **Blindar el modelo de la ficha** ([84](84-EL-MODELO-DE-LA-FICHA.md)) | L |
| 4 | ✅ **`pnpm probar:estado`** — 41 comprobaciones, dos clientes efímeros, los dos verticales ([85](85-PROBAR-ESTADO.md)) | P (efímero) |
| **3.6** | 🛑 **PEDIDO MULTIPRODUCTO** — auditado en [87](87-PEDIDOS-MULTIPRODUCTO.md), **sin decidir**. Bloquea todo lo de abajo | — |
| 4.1 | 🔴 **Alinear los nombres del catálogo con el prompt** de La Churra, y cargar `RECUBIERTO` y `ADICIONES`. Hoy la tabla dice `chocolate negro` y el prompt `CHOCOLATE`: toda propuesta con «chocolate» se rechazaría ([86](86-DOS-PRODUCTOS-EN-UN-PEDIDO.md)) | **P** |
| 4.2 | 🔴 **`permite_repeticion = true`** en los cuatro grupos `SALSA`. La migración 0023 solo arregló el Mega Box: era aritmética, y la regla es del negocio. **Desde el 17-ago se hace en el CRM** (Catálogo → Grupos de opciones, [94](94-BITACORA-PERMITE-REPETICION-CRM.md)); `pnpm repeticion <org> SALSA --si --aplicar` sigue siendo lo más corto para los cuatro de una vez | **P** |
| 5 | **La medición de la regla 13, UNA sola vez**, con los cambios de prompt dentro. Comparar con la línea base del 15-ago | P (lectura + llamadas al modelo) |
| 6 | **Un banco de escenarios de pedidos** — el actual está escrito con los productos de Lis, y **ninguno de los 26 pide dos productos** | L + P |
| 7 | **Encender en un cliente efímero** y recorrer un pedido entero | P (efímero) |
| 8 | **La revisión a ojo del dueño.** Criterio 8 de [69](69-FASE-2-ESTADO-ESTRUCTURADO.md) | — |
| 9 | Los 8 criterios de [69](69-FASE-2-ESTADO-ESTRUCTURADO.md), uno a uno | P |

**El orden importa**: del 1 al 8 no toca a ningún cliente real. Las **4.1** y
**4.2** son las primeras que La Churra nota — y ahora van **antes** de la
medición, porque medir contra un catálogo que contradice al prompt sería gastar
la única toma en un dato que no vale.

### 🟠 Recomendadas, no bloqueantes

`leerAporte()` sigue muerta (decidir: conectarla o borrarla) · `tsconfig`
excluye `scripts/` · el nombre de la salsa en la ficha (`CHOCOLATE` →
`chocolate negro`) · los precios escritos a mano en el saludo · el `"0"` del
reinicio, que sigue clavado · `faltantesDeLaFicha` decide con `ficha.vertical`
antes de normalizar · los tres `.set({ ...body.data })` · instrumentar
`api/kb/[id]`.

### 🔴 Y antes de dar por validado el vertical: **Lis no puede entrar todavía**

Pedidos tiene **dos** clientes, y el segundo no está en condiciones. Medido hoy:

| | Ficha | Productos en tabla | `catalog_source` | Prompt |
|---|---|---|---|---|
| La Churra | ✅ | 4 | `tabla` | 17.312 |
| **Lis Pastelería** | ❌ **no tiene** | **0** | `prompt` | 17.058, **escrito a mano** |

Con la Fase 2 encendida, **Lis no podría confirmar un solo pedido**: el
validador exige requisitos declarados en la ficha, y ella no tiene ficha donde
declararlos. `migrar:requisitos` la salta a propósito, y `migrar:catalogo`
también —lee de la ficha—.

**No es un fallo, y no es un bloqueante de este encendido.** El 17-ago se
congeló el orden: **La Churra → Lashes Valen → Lis**, y Lis va la última **a
propósito** ([79](79-ARQUITECTURA-MULTIEMPRESA.md)).

Su valor no es ser el segundo cliente de pedidos: es ser **la prueba de que la
arquitectura se replica**, y eso solo significa algo con los dos modelos ya
estabilizados. **Este encendido valida pedidos con La Churra. Lis no entra.**

### ⏳ Después de encender

Paso 3B (opciones en `service`) · paso 4a/4b/4c (recursos y reservas) · el día 1
del salón.

---

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
