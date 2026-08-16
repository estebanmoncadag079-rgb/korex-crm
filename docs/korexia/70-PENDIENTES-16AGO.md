# Pendientes al 16 de agosto — dónde retomar

> **Este es el documento que hay que leer al retomar.** Sustituye a
> [65-PENDIENTES-15AGO.md](65-PENDIENTES-15AGO.md), que se conserva por su
> relato de la Fase 1.

**Estado en una línea**: la Fase 1 quedó cerrada y verificada, se cerraron las
cuatro puertas por las que los datos cambiaban sin control, y la **Fase 2 está
implementada y APAGADA**, esperando tres decisiones que solo puede tomar el
dueño.

---

## 🔴 Lo primero de todo el 16-ago: **la Fase 2 no está desplegada**

Verificado dentro del contenedor, no en la documentación:

| | |
|---|---|
| Imagen viva construida | 15-ago **22:34 UTC** (17:34 hora local) |
| Commits posteriores a ella | `14cca67` 17:57 · `eb51c55` 18:08 · `701d1b2` 18:17 · `2c08431` 18:22 |
| `state_source` dentro de `/app/.next` | **0 archivos** (igual `totalCents`, `RECUBIERTO`, `ADICIONES`) |
| Código en `/etc/easypanel/…/crm/code` | ✅ al día (fecha del último commit) |

**Falta el paso 4: que el dueño pulse Desplegar en EasyPanel.** Hoy no rompe
nada —la bandera está apagada y el código vivo ni conoce la columna—, pero
encender la bandera antes de desplegar **no haría absolutamente nada**, y se
perdería una tarde buscando por qué.

## ⚠️ Cargar las opciones cambia el prompt VIVO de La Churra

`renderCatalogoDePedidos` ([render.ts](../../src/server/catalog/render.ts)) pinta
**cualquier** grupo que encuentre en las tablas, con su `(opcional)` y sus
precios. En cuanto `RECUBIERTO` y `ADICIONES` existan, aparecen en el prompt del
cliente que factura **sin desplegar nada**. No es un preparativo inocuo: hay que
renderizar el catálogo antes y después y comparar.

## ✅ Regla 10, cerrada el 16-ago

`registrarMetricaDeEstado` emite una línea por turno de la que salen las seis
métricas. Escrito, **sin ejecutar todavía**: falta `pnpm test` y desplegar.

## 👉 La lista de la Fase 2 vive ahora en el 72

Las 18 tareas numeradas, clasificadas (bloqueante · recomendada · opcional), con
cuáles escriben en producción y en qué orden: **[72-COMO-ENCENDER-LA-FASE-2.md](72-COMO-ENCENDER-LA-FASE-2.md)**.

---

## 🔴 Lo primero, sin cambios desde el 31-jul

**La contraseña del superadmin.** Quien la tenga entra como cualquier cliente,
lee y escribe todas sus conversaciones, borra un cliente entero y gestiona las
credenciales de WhatsApp. No hay segundo factor.

> ⚠️ Ojo: el 15-ago se cambió **una** contraseña de superadmin y se revisaron las
> sesiones (ninguna sospechosa activa). Confirmar que era esta.

---

## 🟠 Las tres decisiones que bloquean la Fase 2

Ninguna es técnica: las tres necesitan que alguien que conozca el negocio diga
cuál es la verdad.

### 1. ¿Qué significa «Ambas» en el recubierto?

El texto de la ficha ofrece cuatro: *Azúcar-canela · Azúcar sola · **Ambas** ·
Sin azúcar*. El dueño nombró **tres** (canela, azúcar normal, sin azúcar).

El parser la leyó como una **cuarta opción literal**, y así cargada el estado
guardaría `recubierto: "Ambas"` — una cadena opaca dentro de una estructura que
existe justamente para no tenerlas. **Está excluida de la carga.**

| Si significa… | Qué habría que hacer |
|---|---|
| Azúcar y canela mezcladas | Es lo mismo que `Azúcar-canela`: sobra, se borra del texto |
| Azúcar sola **+** azúcar-canela a la vez | Son **dos** recubiertos → `max_select: 2` y la opción desaparece |
| Otra cosa | Depende |

**Lectura del asistente, a confirmar**: en esa lista, "ambas" solo puede
referirse a las dos anteriores.

> ✅ **RESUELTA por el dueño el 16-ago**: «Ambas» **es lo mismo que
> `Azúcar-canela`**. Sobra en el texto: se borra de la ficha y la carga queda
> exactamente como se simuló — 3 opciones de recubierto, `max_select: 1`, sin
> "Ambas". El desbloqueo ya no depende de nadie.

### 2. ¿Cuál es el nombre bueno de la salsa de chocolate?

```
en la tabla : chocolate negro   ← lo que usa el agente hoy
en la ficha : CHOCOLATE
```

No se sabe si alguien afinó el nombre en la tabla o si la ficha se editó
después. **La tabla es la fuente canónica de las salsas** (decisión del dueño:
representa correctamente el 1/2/3/5 por presentación, que el texto no sabe
expresar), así que esto es un desajuste de la ficha, no de la tabla.

### 3. ¿Se autoriza la carga parcial ya simulada?

`pnpm cargar:opciones org_lo5gdlt6k43z9fg1ling --aplicar`

Simulación hecha y revisada: **40 INSERT · 0 UPDATE · 0 DELETE**. Añade
`RECUBIERTO` (3 opciones, sin "Ambas") y `ADICIONES` (5 con su precio) a los
cuatro productos. No toca salsas, ni productos, ni IDs.

El comando **se cancela solo** si su plan contuviera una sentencia destructiva.

---

## Cómo retomar la Fase 2

Está toda implementada y desplegada, con `state_source = 'prompt'` en los cuatro
clientes. Ver [69-FASE-2-ESTADO-ESTRUCTURADO.md](69-FASE-2-ESTADO-ESTRUCTURADO.md).

**El orden que queda** (corregido el 16-ago: el despliegue va PRIMERO):

1. **Desplegar** y comprobar dentro del contenedor que `state_source` ya aparece.
2. Borrar «Ambas» de la ficha y aplicar `cargar:opciones`, comparando el
   catálogo renderizado antes y después.
3. Corregir el nombre de la salsa en la ficha (`CHOCOLATE` → `chocolate negro`,
   que es lo que dice la tabla, que manda).
4. Las cuatro métricas que falta añadir (regla 10).
5. Encender la bandera **en un cliente efímero** y correr el banco de escenarios.
6. Revisar a ojo un pedido completo (lo hace el dueño, no el asistente).
7. Solo entonces, decidir si se enciende en La Churra.

> 🔴 **Aviso sobre el laboratorio**: el salón es de **CITAS**, así que el estado
> de pedido no le aplica. El único cliente de pedidos con catálogo en tablas es
> **La Churra, que está encendida y factura**. No hay entorno barato de
> equivocarse: hay que usar clientes efímeros.

---

## Lo que quedó cerrado el 15-ago

| | |
|---|---|
| **Fase 1** (catálogo en tablas) | ✅ verificada dentro del contenedor |
| **Fase 1.5** (validación semántica + intención) | ✅ |
| **Un dueño por dato** | ✅ fichas por secciones, La Churra y el salón convertidos |
| **Las cuatro puertas** (A–D) | ✅ `seed/demo`, horario, catálogo, conocimiento |
| **Trazabilidad** | ✅ 7 procesos instrumentados, desplegados |
| **Horario del salón** | ✅ restaurado a 9:30–18:30 en sus dos copias |

Relato completo en [68-UN-DUENO-POR-DATO.md](68-UN-DUENO-POR-DATO.md).

---

## La deuda que sigue viva

| Deuda | Por qué importa |
|---|---|
| **SQL manual** | Sin arreglo técnico posible. Solo trazabilidad |
| **`.set({ ...body.data })`** en 3 rutas | Hoy contenido por Zod; frágil ante el próximo campo que alguien añada |
| **Precios en el saludo escrito a mano** | Un precio vive en dos sitios: la fila de `product` y ese texto |
| **Lis fuera del sistema** | Sin ficha, prompt manual. Dos regímenes conviviendo |
| **Sin pantalla de catálogo** | Un cliente no puede cambiar su propio precio |
| **Sin RLS** | El aislamiento depende de `scoped()` en cada consulta |
| **El formato horario** | Auditado: el agente dice "09:30" y la regla nueva pide "9:30 a. m.". Sin implementar |

---

## Lo que bloquea al salón

Su agente **sigue apagado a propósito**:

1. Completar su conocimiento (tiene una sola entrada; faltan dirección,
   parqueadero, cancelación y retardos).
2. Corregir las erratas del saludo (*"consertirte"*, *"queires"*).
3. Borrar las conversaciones y citas de prueba antes del día 1.

✅ Ya resuelto: horario (9:30–18:30 en las dos copias), catálogo, datos de pago,
acceso de la dueña y la entrada de salud.

---

## Comandos útiles

```bash
pnpm simular:ficha <org>          # ¿el prompt recompila idéntico? (solo lectura)
pnpm probar:estado               # Fase 2 de extremo a extremo, cliente efímero
pnpm probar:propiedad            # el cuestionario no pisa lo del operador
pnpm cargar:opciones <org>       # simula la carga aditiva; --aplicar la ejecuta
pnpm migrar:catalogo <org>       # lee el catálogo del texto; --forzar para reemplazar
pnpm restaurar:horario <org> "9:30 AM" "6:30 PM" --aplicar
pnpm convertir:ficha <org> --revertir
```

**Todos los que escriben tienen simulación por defecto y rollback.**
