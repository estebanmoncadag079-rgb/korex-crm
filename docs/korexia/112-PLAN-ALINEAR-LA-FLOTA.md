# Plan para alinear la flota: catálogo en tablas y Fase 2

> **Dentro:** El estado real medido · Lo único que bloquea todo · Las tres fases
> · Lo que NO hay que hacer · Riesgos · Criterios de éxito

**20 de agosto de 2026.** Lis quedó con la arquitectura completa
([111](111-LIS-EN-LA-ARQUITECTURA-NUEVA.md)) y la Fase 2 por fin funciona de
verdad ([110](110-EL-MODELO-NO-EMITIA-EL-ESTADO.md)). Este es el plan para que
los otros dos negocios lleguen al mismo sitio.

---

## Estado real, medido hoy

| Negocio | Vertical | Ficha | Requisitos | Catálogo en tablas | Fase 2 |
|---|---|---|---|---|---|
| **Lis Pastelería** | pedidos | ✅ | ✅ | ✅ `tabla` | ✅ **backend** |
| **La Churra** | pedidos | ✅ | ✅ | ✅ `tabla` | ⬜ `prompt` |
| **Lashes Valen** | citas | ✅ | ✅ | ✅ *(ver abajo)* | ⬜ `prompt` |

**La flota está mucho más cerca de lo que parece.** Los requisitos de cierre ya
están declarados en las tres fichas (`pnpm migrar:requisitos` → *"Se migrarían:
0"*). Lo único que falta de verdad es **encender la Fase 2 en dos clientes**.

---

## ⛔ Lo único que bloquea todo: desplegar

La Fase 2 solo funciona con el código de [110](110-EL-MODELO-NO-EMITIA-EL-ESTADO.md)
**corriendo en el contenedor**. Ahora mismo:

- En la base, Lis tiene `state_source='backend'`.
- En producción corre el pipeline **sin** salidas estructuradas.

No es peligroso —degrada exactamente al comportamiento de siempre— pero **la
Fase 2 no está protegiendo nada** aunque la bandera diga que sí. Encenderla en
más clientes antes de desplegar solo multiplicaría esa ilusión.

> Desplegar son tres pasos y saltarse uno no da error: `push` → `git archive` +
> `scp` + `tar` a la carpeta de EasyPanel → el dueño pulsa Desplegar →
> **verificar DENTRO del contenedor**. Ver [02-INFRAESTRUCTURA.md](02-INFRAESTRUCTURA.md).

---

## Lo que NO hay que hacer

**No pongas `catalog_source='tabla'` en Lashes Valen.** Parece que falta, pero
no aplica: `catalog_source` es un concepto **exclusivo de pedidos**
(`pipeline.ts`: `!contrataCitas(vertical) && catalogSource === 'tabla'`). Un
negocio de citas lee sus servicios de la tabla `service` **siempre**, sin
bandera, y `generar.ts` ya se niega a meter el catálogo en su prompt
(`queOfrece` devuelve `null` para citas, para no tener dos fuentes de verdad).

Cambiar esa bandera en un salón no haría nada bueno y dejaría a alguien
pensando que hizo algo.

> 🔧 Por esto mismo se corrigió `scripts/fase2.ts` en este mismo commit: su
> primera versión exigía `catalog_source='tabla'` para dejar encender, lo que
> **habría bloqueado a Lashes Valen para siempre** por un interruptor que no le
> aplica. Ahora comprueba lo que de verdad exige el pipeline: que haya catálogo
> que leer en tablas, sea del vertical que sea.

---

## Fase A — Desplegar y confirmar a Lis (primero, sin excepción)

| | |
|---|---|
| **Objetivo** | Que el código nuevo corra en producción y la Fase 2 de Lis sea real |
| **Pasos** | `push` → despliegue → verificar dentro del contenedor → un pedido de prueba |
| **Cómo se comprueba** | En los logs del contenedor, `[metrica] ... resultado=guardado` con `total_cents` con valor. Si sale `sin_propuesta`, el despliegue no llegó |
| **Rollback** | `pnpm fase2 org_lispasteleria0001 --apagar` |
| **Criterio de éxito** | Un pedido real de una clienta, revisado a ojo por el dueño (criterio 8 del [69](69-FASE-2-ESTADO-ESTRUCTURADO.md)) |

**Antes de desplegar, decide una cosa**: o apagas la bandera de Lis hasta que el
código esté arriba, o la dejas encendida sabiendo que hasta entonces no protege.
Recomendado: apagarla y encenderla después, para no tener un estado a medias.

---

## Fase B — La Churra (pedidos, riesgo bajo)

Es el cliente **para el que se diseñó la Fase 2**: su catálogo ya está en
tablas, sus requisitos declarados, y todo el motor (`items[]`, opciones por
producto, repetición de salsas) salió de sus casos reales.

| | |
|---|---|
| **Prerequisito** | Fase A terminada y verde durante al menos un día de operación de Lis |
| **Paso** | `pnpm fase2 org_lo5gdlt6k43z9fg1ling --encender` |
| **Probar antes** | `pnpm probar:agente <org>` con un pedido de varias presentaciones y salsas repetidas (el Mega Box lleva 5 salsas de 4 sabores) |
| **Riesgo** | Bajo. Mismo vertical, mismo motor ya probado en Lis |
| **Rollback** | `pnpm fase2 <org> --apagar`, efecto en el turno siguiente |
| **Criterio de éxito** | Los 8 criterios del [69](69-FASE-2-ESTADO-ESTRUCTURADO.md), medidos sobre sus datos |

⚠️ **Ojo con el `"0"`**: en La Churra el `0` reinicia el pedido, y con la Fase 2
encendida ese `0` **borra el estado** (`pipeline.ts`, `matchesReinicio`). Es el
comportamiento deseado, pero conviene verlo funcionar en una conversación de
prueba antes de dejarlo con clientes.

---

## Fase C — Lashes Valen (citas, riesgo medio)

Es el paso que **estrena el vertical de citas en la Fase 2**: nadie lo ha
ejercitado nunca en vivo. No es un cliente más — es la prueba de que la
arquitectura sirve a los dos modelos.

| | |
|---|---|
| **Prerequisito** | Fase B terminada, **y los dos bloqueadores de abajo resueltos** |
| **Paso** | `pnpm fase2 org_novxv78s08h12arzatr2 --encender` |
| **Riesgo** | Medio: el esquema del estado añade `reserva`, que nunca ha pasado por el proveedor |
| **Rollback** | `pnpm fase2 <org> --apagar` |

### Bloqueador 1 🔴 — la agenda ofrece huecos con el día lleno

`calcularDisponibilidad` devuelve franjas libres cuando el día entero está
ocupado (único fallo de `pnpm probar:estado`, 44/45). Vive en
`server/appointments/`, **no lo tocó ningún trabajo reciente** y es del área del
commit `3d89ff2`. Es riesgo de **doble reserva**, y es independiente de la Fase 2
— pero encender el estado estructurado sobre una agenda que miente sería
construir encima de un cimiento torcido.

**Hay que arreglarlo antes, y merece su propia auditoría.**

### Bloqueador 2 🟠 — el esquema de citas sin probar contra el proveedor

`esquemaDelEstado` añade `reserva` para citas. Si el proveedor lo rechazara, el
reintento sin esquema protege (degrada al comportamiento de siempre), así que no
hay riesgo de caída — pero tampoco habría Fase 2. **Se comprueba en 10 minutos**
con un cliente efímero de citas antes de tocar al salón.

---

## Riesgos que aplican a todos

| | Riesgo | Estado |
|---|---|---|
| 🟠 | **`direccion` obligatoria en pedidos para recoger.** `soloSi` se evalúa contra la FICHA (¿hace domicilios?), no contra el pedido. El modelo mete "recoge en el local" en ese campo para cumplir. No ensucia la ficha del contacto (solo `nombre` se escribe ahí) y el resumen sale bien | Afecta a Lis y a La Churra. La corrección de fondo es que la condición mire el pedido |
| 🟠 | El `paso` llega con valores raros (`"sin pedido"` con pedido en curso) | No bloquea: la regla 4 dice que el estado es abierto y el backend normaliza |
| 🟢 | Coste y latencia | Medido en Lis: backend ~890 ms por turno, sin encarecer la llamada |

---

## Por qué este orden y no otro

**Lis → La Churra → Lashes Valen** invierte el orden congelado del
[79](79-ARQUITECTURA-MULTIEMPRESA.md) (que ponía a Lis la última), y es a
propósito: aquel orden existía para que Lis no fuera la cobaya. Ya no lo es —
**ya está migrada y funcionando**, y fue justo ella quien destapó que la Fase 2
nunca había funcionado. A partir de aquí el orden lo dicta el riesgo:

1. **Desplegar** — sin esto nada de lo demás es real.
2. **La Churra**: mismo vertical, mismo motor ya probado. Riesgo bajo.
3. **Lashes Valen**: vertical nuevo para la Fase 2, con dos bloqueadores propios.

Nunca dos a la vez: cada encendido es una bandera por cliente y su rollback es un
`UPDATE` (regla 8), pero eso solo vale si se sabe cuál fue el cambio que rompió
algo.

---

## Criterio de "la flota está alineada"

1. Las tres fichas generan su prompt (ninguna editada a mano).
2. Los dos negocios de pedidos con `catalog_source='tabla'`.
3. Los tres con `state_source='backend'`, sostenido — no solo probado una vez.
4. **Ningún log de "se usa el del prompt"** (`pipeline.ts`) en producción: es la
   prueba de que el flujo nuevo se está ejecutando de verdad.
5. `pnpm probar:estado` en 45/45 (hoy 44/45 por el bloqueador 1).
6. Un pedido y una cita completos, revisados a ojo por el dueño.
