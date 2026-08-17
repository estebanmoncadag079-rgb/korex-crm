# Paso 4: recursos y reservas

> **Dentro:** Las diez preguntas · Los tres hallazgos · La joya que hay que
> mover con cuidado · Los contratos mínimos · Riesgos · La recomendación

**17-ago-2026. Auditoría, sin una línea de código.**

La pregunta ya no es *"¿cómo vendo un producto?"* sino **"¿cómo represento
cualquier recurso reservable sin volver a acoplar el núcleo a un negocio?"**.

---

## Las diez respuestas

### 1. ¿Dónde están definidos los profesionales?

`staff_member` — `id`, `organizationId`, `name`, `archivedAt`. Y
**`staff_service`**, la matriz de quién hace qué, con un índice único
`(staffId, serviceId)`.

**Es la única clase de recurso que existe.** No hay salas, ni elevadores, ni
aulas: para tenerlos habría que crear otra tabla y duplicar toda la lógica.

### 2. ¿Dónde se almacenan los horarios?

🔴 **En `agent_profile`, y son del NEGOCIO**: `hours_open`, `hours_close`,
`hours_days`, más el par de domingo. `calcularDisponibilidad` los recibe como un
único `hours` para todos.

**No existe el horario por recurso.** Hoy no se puede decir *"Andrea trabaja
martes y jueves"*, ni *"el elevador 2 está en mantenimiento los lunes"*.

### 3. ¿Dónde se valida la disponibilidad?

`server/appointments/logic.ts` → **`calcularDisponibilidad({ staffIds, citas,
duracionMin, hours, esHoy })`**, que devuelve `Record<staffId, string[]>`.

**Es una función pura**, y esa es la mejor noticia de esta auditoría: la lógica
ya está aislada del acceso a datos. Lo único que la ata al vertical es el
**nombre** de su parámetro.

### 4. ¿Dónde se detectan los solapamientos?

**En el motor de la base de datos**, y es lo mejor que tiene el sistema de
citas:

```sql
ALTER TABLE appointment ADD CONSTRAINT appointment_sin_solape
  EXCLUDE USING gist (
    staff_id WITH =,
    tsrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('pendiente','confirmada','reagendada'));
```

Dos citas de la misma persona que se pisan **no se pueden insertar**, pase lo
que pase en el código. No depende de que nadie se acuerde de comprobar.

🔴 **Y está atada a la columna `staff_id`.** El día que una reserva necesite dos
recursos —sala **y** especialista—, esta restricción no los cubre.

### 5. ¿Qué archivos asumen que una cita es solo un servicio?

`appointment` tiene **un `serviceId` y un `staffId`**, ambos únicos. Con eso:

- una cita **no puede llevar dos servicios** (*corte + tinte*), y
- **no puede requerir dos recursos** (*sala + especialista*).

Lo asumen `appointments/queries.ts` (1.258 líneas), `logic.ts`, `offered_slot`
y las ocho rutas de `/api/appointments`.

### 6. ¿Qué partes del núcleo conocen agendas?

El pipeline, en **tres puntos**: la acción `consult_availability` (que resuelve
servicio y especialista), `book_appointment` / `reschedule_appointment`, y el
registro de lo ofrecido (`offered_slot`).

> Conviene ser justo: **eso no es acoplamiento a un negocio**, es acoplamiento a
> un **vertical**, y el pipeline es donde los verticales se encuentran. El
> problema no es que el pipeline sepa agendar; es que sabe hacerlo **solo con
> personas**.

### 7. ¿Hay separación explícita entre catálogo, selección, recursos y reservas?

| Capa | ¿Existe? | Dónde |
|---|---|---|
| **Catálogo** | ✅ | `Ofrecible` + grupos + opciones (paso 3A) |
| **Selección** | ✅ | `seleccion[]` en el estado (paso 1) |
| **Recursos** | 🟠 **a medias** | `staff_member` existe, pero **solo de un tipo** y sin horario propio |
| **Reservas** | 🟠 **a medias** | `appointment` es a la vez la reserva **y** su único recurso |

**Las dos primeras se separaron esta semana. Las dos últimas están fundidas en
una tabla.**

### 8. Contrato mínimo de un recurso

```ts
Recurso {
  id
  organizationId
  tipo          // "persona" | "espacio" | "equipo" | lo que declare el negocio
  nombre
  activo
  horario?      // el suyo; si no, hereda el del negocio
}
```

`tipo` **no es un enum cerrado** — mismo criterio que `paso` en la Fase 2: el
día que alguien reserve una bicicleta, no debería hacer falta desplegar.

### 9. Contrato mínimo de una reserva

```ts
Reserva {
  id · organizationId · contactId
  ofrecibleId          // qué se reservó
  inicio · fin
  estado               // pendiente | confirmada | cancelada | reagendada
}

ReservaRecurso {       // ← la tabla que hoy no existe
  reservaId
  recursoId
}
```

**La separación en dos es el cambio de fondo.** Con ella, una reserva puede
necesitar varios recursos, y la restricción de solape se mueve a
`reserva_recurso`:

```sql
EXCLUDE USING gist (recurso_id WITH =, tsrange(inicio, fin, '[)') WITH &&)
```

— la misma joya, sobre un recurso cualquiera.

### 10. ¿Puede un negocio tener más de un tipo de recurso?

**Hoy no. Y varios negocios reales lo necesitan:**

| Negocio | Recursos de una reserva |
|---|---|
| Peluquería | profesional |
| Clínica | especialista **+** consultorio |
| Taller | mecánico **+** elevador |
| Academia | profesor **+** aula |
| Alquiler | solo el objeto |

Tres de los cinco necesitan **dos recursos a la vez**, y eso es exactamente lo
que `appointment.staff_id` no puede expresar.

---

## Los tres hallazgos

**A — 🔴 Una reserva solo puede tener un recurso.** `appointment` funde la
reserva y su recurso en una fila.

**B — 🔴 El horario es del negocio, nunca del recurso.** No hay dónde decir que
Andrea libra los lunes.

**C — 🟠 La restricción de solape, que es lo mejor del diseño, está escrita
sobre `staff_id`.** Moverla es delicado **y hay que moverla**: es lo único que
impide vender dos veces la misma hora.

---

## Riesgos

| | Riesgo | |
|---|---|---|
| 🔴 | **Datos vivos** | Medido hoy: **4 citas · 5 profesionales · 46 servicios · 111 filas de matriz · 74 franjas ofrecidas**. Es la primera migración de la serie con datos de verdad encima |
| 🔴 | **Mover la restricción de solape** | Entre que se quita de `appointment` y se crea en `reserva_recurso` hay una ventana en la que **el motor no protege nada**. Tiene que ir en una sola transacción |
| 🟠 | **El vertical vivo** | El salón está apagado, pero sus datos son reales y su día 1 está pendiente. Romper su agenda es romper su lanzamiento |
| 🟠 | **`appointments/queries.ts` son 1.258 líneas** | El archivo más grande después del pipeline |
| 🟢 | **`calcularDisponibilidad` es pura** | Generalizarla es un rename de `staffIds` a `recursoIds` |
| 🟢 | **El núcleo de pedidos** | No se toca |

---

## Recomendación

**Partir el paso 4 en tres, y no empezar por la migración:**

| | Qué | Coste |
|---|---|---|
| **4a** | Generalizar `calcularDisponibilidad` a `recursoIds` **sin tocar tablas**. Renombrar el concepto en la lógica pura y sus pruebas | Sin migración, reversible |
| **4b** | `recurso` + `reserva_recurso`, con la restricción de solape movida. **Migración con datos vivos, en una transacción** | La más cara de todo el proyecto |
| **4c** | Horario por recurso | Aditiva |

Y una condición que este proyecto ya aprendió por las malas: **antes de 4b, un
respaldo verificado del salón**. No el de las 6 horas: uno hecho a mano, antes,
y probado restaurándolo.

> **Y una decisión que conviene tomar antes de escribir nada**: ¿el paso 4 entra
> antes o después de encender la Fase 2 para pedidos? Son verticales
> independientes — La Churra no necesita recursos— y hoy **el vertical de
> pedidos está a un despliegue y una medición de poder encenderse**.
