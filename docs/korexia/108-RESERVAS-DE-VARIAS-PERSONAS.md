# `book_appointment` solo podía agendar a una persona por turno

> **Dentro:** El caso real · La auditoría · El origen · El fix · La decisión
> de fallo parcial · Cómo se verificó · Deuda que queda · Cómo revertir

**19-ago-2026.** Una clienta de Lashes Valen pidió cita para ella (con
Geimar, 3:30pm) y para su mamá (con Laura, 4:00pm) en la misma conversación.
El agente respondió confirmando las dos. Solo se creó una.

## El caso real

```
Agente: ✅ Quedaste agendada: Semipermanente + Semipermanente el 21/08/2026
        a las 4:00 PM con Laura.
        ¡Listo! Tu cita y la de tu mami han quedado agendadas.💖
        Para ti: Semipermanente... 3:30 p.m. Con: Geimar
        Para tu mami: Semipermanente... 4:00 p.m. Con: Laura
```
Consultado directo en `appointment`/`appointment_resource`: **una sola
fila** — la de Laura. La reserva de Geimar nunca existió, ni por el bot ni
a mano.

## La auditoría

Con protocolo formal, sin aceptar hipótesis. La sospecha inicial del dueño
era que el bot ignoraba citas puestas a mano desde el panel — se verificó y
se **descartó con evidencia**: 0 citas activas de Lashes Valen sin su fila
en `appointment_resource`, 0 solapes reales entre citas del mismo recurso.
El panel usa el mismo `crearCita` que el agente, con el mismo `EXCLUDE` de
PostgreSQL protegiendo contra doble-reserva — ese mecanismo funciona.

Lo que sí tenía evidencia (`usage_event`, una sola llamada al modelo en el
turno que agenda, sin reintentos) era el contrato de la acción.

## El origen

`book_appointment` (`actions.ts`) solo admitía **una** `fecha`/`hora`/
`especialista` por invocación — diseñado para "un contacto, varios
servicios, una misma visita" (la reserva múltiple de
[97-BITÁCORA](97-BITACORA-RESERVA-MULTIPLE.md)), nunca para "reservas
independientes de personas distintas en el mismo turno". El modelo, con dos
reservas confirmadas por la clienta, solo pudo declarar una en la acción —
pero redactó el texto de cierre con las dos, porque el texto es libre y la
acción no.

No es un bug de lógica: el código hacía exactamente lo que el contrato
permitía. Es una regla de negocio faltante en el contrato de la acción, no
en el prompt ni en el motor — el motor de disponibilidad y el `EXCLUDE` de
solape funcionaron perfecto para la reserva que sí se ejecutó.

## El fix

`book_appointment` pasa a llevar `reservas[]` (`actions.ts`, límite de 4):
cada elemento es una reserva completa (`servicios`, `fecha`, `hora`,
`especialista?`). El bloque de ejecución en `pipeline.ts` itera sobre el
array, **procesando cada reserva de forma independiente** — nunca todo o
nada.

## La decisión de fallo parcial

Antes de tocar el contrato compartido por toda la flota de citas, se
consultó al dueño: si una reserva del turno falla (sin cupo, horario
caído...), ¿la que sí tuvo cupo se cancela también? **No.** Se queda
agendada, y el mensaje le dice al cliente claramente cuál sí quedó y cuál
necesita otra hora — el mismo principio que ya usa el resto del sistema:
un fallo ajeno no le puede costar el cupo a quien sí lo consiguió.

Explícitamente pedido para toda la flota, no solo Lashes Valen: nada en el
fix depende de este cliente — `reservas[]`, el límite de 4, y el manejo de
fallo parcial son genéricos para cualquier negocio de citas.

## Cómo se verificó

```
pnpm test        # 886 passed (3 nuevas), 73 skipped — antes: 883 passed
pnpm typecheck   # limpio
pnpm lint        # limpio
pnpm build       # compila
```

Las 3 pruebas nuevas (`tests/unit/pipeline-reservas-multiples.test.ts`)
reproducen el patrón exacto del caso real (dos personas, mismo servicio,
horas y especialistas distintos):

- Las dos reservas tienen cupo → se crean las **dos** citas, un solo
  mensaje con las dos confirmaciones, un solo aviso al equipo con ambas.
- Una reserva sin cupo, la otra sí → la que pudo **queda agendada de
  verdad**; el mensaje informa cuál falló, sin inventar que también quedó.
- Las dos sin cupo → no se avisa al equipo (no hay ninguna cita real), solo
  se informa el fallo.

Se actualizó también `tests/unit/pipeline-appointments-dispatch.test.ts`
(el mock de `book_appointment` usaba el formato viejo) y el texto del
contrato que lee el modelo (`CONTRATO_DE_ACCIONES_CITAS`, `prompts.ts`),
con la instrucción explícita de una reserva por persona.

**No verificado contra WhatsApp real** — como el resto de fixes de esta
sesión sin acceso a un entorno de desarrollo separado de producción. La
próxima prueba en un chat limpio de Lashes Valen debería repetir el guion
de "cita para mí y para mi mamá".

## Deuda que queda

- **El Incidente A de la misma auditoría** (el agente niega disponibilidad
  — "ya no tenemos citas en la mañana" — sin haber llamado a
  `consult_availability` en ese turno, la mitad simétrica del guardarraíl
  noveno) queda **sin implementar**: necesita medirse contra mensajes
  reales antes de escribir el criterio textual, igual que se hizo con el
  guardarraíl 9.
- `MAX_RESERVAS = 4` no se ha medido contra ningún caso real más grande que
  2; es un límite razonable, no uno derivado de datos.

## Cómo revertir

```bash
git revert <commit>
```

Sin esquema, sin datos, sin estado. Revertir deja `book_appointment` con
una sola fecha/hora/especialista, como antes de hoy — y expuesto otra vez
al mismo fallo si dos personas piden cita juntas.
