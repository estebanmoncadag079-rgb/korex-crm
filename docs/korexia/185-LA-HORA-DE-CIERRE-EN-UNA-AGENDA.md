# 185 — La hora de cierre en una agenda no es la hora de terminar

**20-sep-2026** · Estado: auditado y verificado. **Sin cambios en el motor** —
la arquitectura ya era correcta. Lashes Valen migrado. Sin desplegar.

Continúa [184](184-EL-HORARIO-CON-UN-SOLO-DUENO.md).

## La pregunta

Lashes Valen tenía dos horas de cierre: `22:30` en su ficha y `18:30` en sus
columnas. La auditoría lo dejó como decisión de negocio: *"¿cuál de las dos es
la buena?"*.

**La pregunta estaba mal planteada, y el dueño lo vio.** No son dos opiniones
sobre lo mismo. Son las respuestas a dos preguntas distintas:

```
"¿hasta qué hora recibís citas?"        → 18:30
"¿hasta qué hora podéis estar trabajando?" → 22:30
```

El cuestionario preguntaba lo segundo y el horario de una agenda necesita lo
primero.

### La evidencia

El servicio más largo de Lashes dura **150 minutos**. Una cita que empieza a
las 18:30 termina a las **21:00**. El `22:30` de su ficha no es un error
absurdo: es alguien contestando honestamente hasta qué hora puede estar en el
salón.

## Lo que el motor ya hacía bien

Antes de tocar nada se auditó el motor. **Ya implementaba la distinción**, y
está en `calcularDisponibilidad` (`appointments/logic.ts`):

```ts
for (let t = open; t <= close; t += 30) candidatos.add(t);  // ← <= : el cierre INCLUIDO
…
if (slotMin < open || slotMin > close) continue;            // ← nada después del cierre
…
const libre = !citasRecurso.some(                            // ← solo mira CHOQUES
  (c) => slotMin < c.endMin && slotMin + input.duracionMin > c.startMin
);
```

La última línea es la que importa: **nunca compara `inicio + duración` contra
el cierre**. Solo comprueba que no choque con otra cita.

Es decir:

| | |
|---|---|
| 18:30 (el cierre exacto) | ✅ agendable |
| 18:30 + 150 min = 21:00 | ✅ permitido, corre después |
| 19:00 | ❌ no se ofrece |

Y no es casualidad: se corrigió el 18-ago-2026 tras rechazar un "Press on" de
120 minutos a la hora de cierre con la especialista libre toda la tarde.
`horarioLegible` incluso se lo explica al modelo con esas palabras.

**Conclusión: cero estructura nueva.** No hacen falta tres campos («horario
operativo», «última hora de inicio», «hora máxima de fin»). Un solo `cierra`
que significa *última hora de inicio* representa el negocio correctamente.

`tests/unit/citas-hora-de-cierre.test.ts` fija esa semántica para que nadie la
cambie sin darse cuenta.

### Un matiz que conviene saber

La rejilla es de **30 minutos** desde la apertura. Así que `18:29` no se
rechaza *por tarde* — **no existe** como hueco, igual que `09:31` o `12:07`.
Quien pida las 18:29 recibe `sin_cupo`, lo mismo que pedir una hora ocupada.
Es una regla del motor, no del horario, y cambiarla sería otra decisión.

## Lashes Valen: migrado

Con la decisión tomada (`18:30` = última hora de inicio), y confirmada la
apertura en **09:30** —que es lo que dicen la ficha *y* las columnas; la
ambigüedad era solo del cierre—:

```
porDia: lunes a sábado 09:30–18:30 · domingo cerrado
columnas: IDÉNTICAS a las de antes → cero cambio de comportamiento
```

La migración necesitó un mecanismo nuevo, `--resolver-con-columnas`, porque el
script se detenía —correctamente— ante la discrepancia. La bandera **exige un
`organizationId`**: resolver todas las discrepancias de golpe sería decidir por
todos los negocios a la vez.

Tras migrar, el auditor da **0 horarios incoherentes**.

## El auditor ahora clasifica

El auditor corre dentro del despliegue, así que la pregunta que contesta no es
*"¿está todo perfecto?"* sino *"¿es seguro desplegar este código sobre estos
datos?"*. De ahí sale el criterio, y es verificable:

> **Bloquea lo que el despliegue puede cambiar. No bloquea lo que va a seguir
> exactamente igual después de desplegar.**

| Grupo | ¿Bloquea? | Qué es |
|---|---|---|
| **BLOQUEADOR** | **sí** | Una incoherencia: dos fuentes del mismo dato en desacuerdo. Desplegar puede cambiar cuál gana — es lo que le pasó a Lis |
| **DECISIÓN DE NEGOCIO** | no | Un mecanismo aprobado sin encender en un cliente (`state_source`). Desplegar no lo empeora ni lo mejora; encenderlo es un acto deliberado |
| **OBSERVACIÓN** | no | Mejoras recomendadas y avisos |
| **NO EVALUABLE** | no | Cliente sin ficha: no hay negocio configurado que auditar |

`--estricto` bloquea también los dos de en medio. **Nada se oculta**: los
cuatro grupos se imprimen siempre, con nombre y motivo.

Estado hoy: **0 bloqueadores**. MALIA queda como decisión (su `state_source`
sigue en `prompt`, por fases), La Churra y Lis como observaciones,
Camilabrandcol y korex.ia como no evaluables.

## Un fallo que solo apareció al empezar a pasar

El auditor **se colgaba cuando pasaba**. El camino de fallo terminaba con
`process.exit(1)`; el de éxito no terminaba con nada, así que la conexión
quedaba abierta y el proceso imprimía «PASS» y se quedaba ahí.

Estuvo latente mientras el auditor siempre encontraba algo. En cuanto pasó
limpio —tras migrar Lashes— se colgó a la primera. Y su sitio es el gate de
despliegue: colgarse ahí no es una molestia, es **un despliegue bloqueado con
la auditoría en verde** hasta que el job muera por tiempo.

Corregido con un `process.exit(0)` explícito, y con una prueba que exige que
los dos caminos terminen.

## Pruebas de inyección

El guardarraíl se probó rompiéndolo a propósito, contra una base desechable:

| Caso | Inyección | Resultado |
|---|---|---|
| A | `exit 0` ante secreto ausente en el workflow | 3 pruebas en rojo ✅ |
| B | Un tenant con ficha 20:00 y columnas 23:59 | `exit 1`, bloquea ✅ |
| C | Un tenant sin ficha | reportado como NO EVALUABLE, no bloquea ✅ |
| D | Todo coherente | `exit 0`, deja pasar ✅ |
| E | `continue-on-error: true` en el paso | prueba en rojo ✅ |

## Lo que NO se tocó

MALIA (delivery, catálogo, pagos, `state_source`) · Lis (sigue con `porDia` +
`observacionesHorario`, sin segundo horario estructurado) · SSH · producción.

## Lis: qué se movió y qué se quedó

`reglasPropias` es un cajón de texto libre donde el operador escribe tras un
incidente, y acaba cayendo de todo. Lis tenía **seis reglas**; se auditaron una
por una antes de tocar nada:

| # | Contenido | Qué es | Destino |
|---|---|---|---|
| 0 | El enlace de Rappi | canal | se queda |
| **1** | **«WhatsApp 10:00–20:00 · Punto físico 13:00–20:00»** | **horario** | **→ `observacionesHorario`** |
| 2 | Respuestas estructuradas, no todo junto | conducta | se queda |
| 3 | Mandar el enlace del catálogo antes que la lista | operativa | se queda |
| 4 | «TOTAL SIN DOMICILIO: X» | comercial | se queda |
| 5 | *(cadena vacía)* | ruido | se queda — no es horario |

**Solo una de las seis era de horario.** Mover "todo lo que mencione una hora"
le habría vaciado media configuración: la 4 habla de dinero, la 3 de catálogo,
la 0 de un canal externo.

Se movió **tal cual, sin reescribir una palabra**, con
`pnpm mover:regla <org> <índice>` — un mecanismo general, no un parche: pide el
índice porque cuál regla es "de horario" es una lectura humana, y **se niega a
concatenar** si el negocio ya tiene observaciones (pegar dos textos que nadie
escribió juntos es inventar redacción).

Después se regeneró su prompt: **16.612 → 16.350**, y el texto salió de
`instructions`. Las otras cuatro reglas siguen ahí, verificado una por una.

> 📌 **Observación que queda para el negocio**: el texto movido todavía repite
> el horario de WhatsApp («Lunes a sábado desde las 10:00 am hasta las 8:00
> pm»), que es exactamente lo que `porDia` ya dice y el servidor ya inyecta en
> cada turno. No es un problema —una observación no puede decidir nada— pero si
> Lis cambia su horario, ese texto se quedará viejo. Recortarlo a lo que solo
> él sabe decir (el local físico a la 1) es cosa suya, no mía: son sus
> palabras.

## Qué queda

1. **MALIA `state_source=prompt`**: decisión de negocio, reportada y sin
   bloquear.
2. **`DEPLOY_DB_URL`**: pendiente de crear. Con 0 bloqueadores, el gate ya
   pasaría.
3. **Lis**: su horario del local físico sigue en `reglasPropias`; ahora tiene
   `observacionesHorario` donde moverlo, pero no se migró.
4. **Hardening del `authorized_keys` de `deploy`**: tarea aparte.
