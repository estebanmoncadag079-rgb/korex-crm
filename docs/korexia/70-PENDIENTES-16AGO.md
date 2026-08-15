# Pendientes al 16 de agosto — dónde retomar

> **Este es el documento que hay que leer al retomar.** Sustituye a
> [65-PENDIENTES-15AGO.md](65-PENDIENTES-15AGO.md), que se conserva por su
> relato de la Fase 1.

**Estado en una línea**: la Fase 1 quedó cerrada y verificada, se cerraron las
cuatro puertas por las que los datos cambiaban sin control, y la **Fase 2 está
implementada y APAGADA**, esperando tres decisiones que solo puede tomar el
dueño.

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

**El orden que queda:**

1. Resolver «Ambas» → cargar recubierto y adiciones (paso 3 de arriba).
2. Encender la bandera **en un cliente efímero** y correr el banco de escenarios.
3. Revisar a ojo un pedido completo (lo hace el dueño, no el asistente).
4. Solo entonces, decidir si se enciende en La Churra.

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
