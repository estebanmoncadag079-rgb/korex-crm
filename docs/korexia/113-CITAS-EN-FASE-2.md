# Citas entra en la Fase 2 — y la falsa alarma de la agenda

> **Dentro:** El bug que no existía · El que sí existía y no se veía · Por qué
> solo aparecía con la Fase 2 encendida · Cómo revertir

**20 de agosto de 2026.** Lashes Valen pasa a `state_source='backend'` y con eso
**los tres negocios quedan en la arquitectura nueva**. El camino tenía dos
bloqueadores anotados en [112](112-PLAN-ALINEAR-LA-FLOTA.md); al auditarlos,
**uno no era un bug y el otro no era el que estaba anotado**.

---

## 1. La agenda no estaba rota — la prueba describía una regla derogada

`pnpm probar:estado` llevaba en rojo desde el 18-ago con esto:

```
🔴 y ninguno cuando el día entero está ocupado
```

Se leyó como *"ofrece huecos con la agenda llena → riesgo de doble reserva"*, y
se anotó como bloqueador crítico. **Era falso.**

Reproducido en aislamiento, con el día ocupado de 09:30 a 18:30 y un servicio de
90 minutos:

```
huecos devueltos: {"18:30":["staff1"]}
cita ocupa: 09:30 (570) → 18:30 (1110)
```

El único hueco es **el minuto exacto en que la cita anterior termina**. No se
solapa con nada. Y empezar a las 18:30 es legítimo desde el **18-ago**, cuando el
cierre pasó a limitar **cuándo EMPIEZA** una cita, no cuándo termina (`70ef95a`,
tras el caso real del "Press on" de 120 min rechazado a las 18:30 con la
especialista libre toda la tarde).

La cronología lo dice todo:

| | Fecha | Qué |
|---|---|---|
| `dfc4a19` | **17-ago** | Se escribe la comprobación "y ninguno cuando el día entero está ocupado" |
| `70ef95a` | **18-ago** | Cambia la regla del cierre — la comprobación queda describiendo el pasado |

**Lo que se corrigió fue la prueba, no el motor.** Y no borrándola: ahora
comprueba lo que de verdad costaría dinero —que ningún hueco **pise** lo ya
agendado— más que el único libre sea el instante en que se desocupa.
`probar:estado` pasa **46/46**.

> 🔑 Una prueba en rojo no siempre acusa al código. A veces es la única parte del
> sistema que todavía cree en una regla que el negocio ya cambió. Antes de
> arreglar el motor: **¿qué versión de la regla describe esta prueba?**

---

## 2. Lo que sí estaba roto: la llamada que sigue a consultar disponibilidad

Al encender la Fase 2 en el salón, la conversación **se cayó a handoff por error
2 de 2 veces**, con dos síntomas distintos:

```
[agente] fallo del proveedor: la acción no cumple el contrato: Required
[agente] fallo del proveedor tras consultar disponibilidad: sin JSON extraíble
         (raw=¡Hola, hermosa! 🌸 Ya vi que quieres tus pestañas efecto natural...)
```

La clienta leía *"dame un momentico, te comunico con una persona"* **mientras el
sistema ya tenía los horarios calculados en la mano**.

### La causa

El vertical de citas hace **dos** llamadas al modelo en un mismo turno: la
primera decide `consult_availability`, el servidor calcula los horarios reales, y
la segunda redacta la respuesta con esos horarios. Esa segunda llamada
(`pipeline.ts`) era **la única de todo el camino de citas sin esquema exigido al
proveedor** — el mismo agujero de [110](110-EL-MODELO-NO-EMITIA-EL-ESTADO.md), en
el sitio que se pasó por alto.

### Por qué no se había visto nunca

Porque **con la Fase 2 apagada el mismo guion pasa**. Comprobado apagando la
bandera y repitiendo: sin fallo. Lo que empuja al modelo a contestar en prosa en
ese segundo turno es el **bloque de estado** que la Fase 2 inyecta en el prompt.

Es decir: el fallo vivía escondido detrás de una bandera que nadie había
encendido en citas. Encenderla en el salón fue lo que lo destapó — igual que
encenderla en Lis destapó que la Fase 2 nunca había funcionado.

### El arreglo

Esa llamada lleva ahora el mismo esquema, sin estado
(`formatoDeRespuestaDeAccion` en `actions.ts`). Los dos formatos salen del mismo
sitio, así que no pueden separarse del contrato.

Verificado después, con la Fase 2 encendida:

```
[metrica] ... resultado=guardado ... producto=Efecto Natural total_cents=9500000
AGENTE: Para el viernes 21 de agosto, por la tarde, tengo disponibles los
        siguientes horarios para tu Efecto Natural: 6:00 PM o 6:30 PM.
```

Y de paso, el detalle del error de contrato ahora dice **qué campo falta y qué
acción llegó**, no solo `Required`: con doce acciones y el modo estricto
emitiendo nulos, averiguarlo costaba una reproducción entera.

---

## Estado de la flota

| Negocio | Vertical | Catálogo | Fase 2 |
|---|---|---|---|
| Lis Pastelería | pedidos | tabla | ✅ backend |
| La Churra | pedidos | tabla | ✅ backend |
| **Lashes Valen** | citas | *(no aplica — ver [112](112-PLAN-ALINEAR-LA-FLOTA.md))* | ✅ backend |

Desplegado y verificado dentro del contenedor el 20-ago (marcador `sin action`
presente en los chunks compilados; arranque limpio).

⚠️ Durante las pruebas se comprobó que **`isTest` NO protege la creación de
citas**: solo bloquea el envío por WhatsApp. Una conversación de prueba que
llegue a `book_appointment` **crea una cita real en la agenda del negocio**. Por
eso el guion de prueba se quedó en consultar disponibilidad, y se contaron las
citas antes y después (74 → 74). Quien pruebe citas en un cliente vivo tiene que
saberlo.

---

## Cómo revertir

```bash
pnpm fase2 org_novxv78s08h12arzatr2 --apagar   # el salón vuelve al prompt
```

Efecto en el turno siguiente, sin desplegar. El arreglo de la segunda llamada
**no depende de la bandera**: mejora el camino de citas igual con la Fase 2
apagada, así que no hay motivo para revertirlo aunque se apague el estado.
