# Dos citas a la misma hora

> **Dentro:** Lo que ya estaba bien · El hueco entre mirar y escribir · Cómo se
> reprodujo · La restricción que lo cierra · El rango semiabierto · Qué se probó
> · Al desplegar

13-ago-2026. Antes de encender el salón se probó el motor de citas de punta a
punta. Todo pasó menos una cosa, y era la importante.

## Lo que ya estaba bien

La lógica de disponibilidad no tenía un solo fallo. Cada servicio ocupa **su**
duración —un Volumen Ruso tapa 150 minutos, un retiro de extensiones 30—, cada
especialista tiene su agenda, un servicio no se ofrece si no termina antes de
cerrar, el domingo se rechaza, y mover una cita libera el hueco viejo y ocupa el
nuevo recalculando el final.

## El hueco entre mirar y escribir

`crearCita` consultaba la disponibilidad y **después** insertaba:

```
        turno A                    turno B
   ¿está libre las 9? ──┐
                        │     ¿está libre las 9? ──┐
   sí ◀─────────────────┘                          │
   INSERT                     sí ◀─────────────────┘
                              INSERT
```

Entre la pregunta y la escritura hay una base de datos, y los webhooks de
WhatsApp **llegan en paralelo**: dos clientas escribiendo a la vez podían
consultar el mismo hueco libre antes de que ninguna hubiera reservado. La
comprobación previa no protege de nada en ese caso — es un TOCTOU de manual.

Nada en la base lo impedía: `appointment` tenía un índice por
`(organización, especialista, inicio)`, pero **no único** y sin noción de
solape. La disponibilidad era la única defensa, y se calculaba con datos que
para cuando se insertaba ya podían estar viejos.

## Cómo se reprodujo

No con un doble: con Postgres de verdad, en una base desechable. Dos
`crearCita` en paralelo sobre el mismo hueco y la misma especialista, cuatro
rondas a distintas horas:

| Hora | Aceptadas | Filas en la base |
|---|---|---|
| 09:00 | 2 | 2 |
| 12:00 | 2 | 2 |
| 14:30 | 2 | 2 |
| 17:00 | 2 | 2 |

**Cuatro de cuatro.** Dos clientas, una especialista, la misma hora.

> ⚠️ El primer intento de esta prueba **pasó en verde**, y era mentira.
> `postgres-js` abre las conexiones cuando hacen falta y, a través de un túnel
> SSH, el handshake de la segunda tardaba lo bastante como para que la primera
> petición terminara antes de que la segunda consultara: nunca hubo dos
> peticiones a la vez. Por eso la prueba ahora **precalienta el pool** antes de
> medir. Un verde por timing no prueba nada.

## La restricción que lo cierra

La única capa que puede decidir esto es la base (migración `0018`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointment ADD CONSTRAINT appointment_sin_solape
  EXCLUDE USING gist (
    staff_id WITH =,
    tsrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pendiente','confirmada','reagendada'));
```

Quien pierde la carrera recibe un `23P01`, y `crearCita`/`reprogramarCita` lo
traducen a un **"sin cupo" normal y corriente** (`esSolape()` en `queries.ts`).
Para la clienta no hay error: hay un horario que ya no está.

El `WHERE` parcial deja fuera canceladas y completadas — una cita cancelada no
debe reservar nada.

## El rango semiabierto, que no es un detalle

`'[)'`: el final **no** cuenta como ocupado. El motor ofrece a propósito el slot
que empieza justo cuando termina la cita anterior —11:30 tras una que acaba a
las 11:30, para no esperar al siguiente redondeo de media hora—. Con un rango
cerrado, esa reserva legítima empezaría a fallar. Hay una prueba dedicada a ese
borde: **encadenar una cita justo cuando acaba la anterior**.

## Qué se probó

13 pruebas contra Postgres real (`tests/integration/citas-motor.test.ts`, se
saltan solas sin `TEST_DATABASE_URL`):

- La cita guarda la duración de **su** servicio, no una por defecto
- Una de 150 min tapa las 2,5 horas siguientes, y libera al minuto exacto
- No deja crear una segunda cita encima de la primera
- Encadenar justo al terminar la anterior **sí** se puede
- Otra especialista sí puede a la misma hora
- Un servicio corto entra donde no cabe uno largo
- No se ofrece lo que no termina antes de cerrar
- Se rechaza el domingo
- Correr la cita: la mueve, recalcula el final, libera el hueco viejo
- Correrla encima de otra: no
- Correrla a otro día libera el día viejo
- Cancelar devuelve el hueco
- **Dos peticiones simultáneas: solo entra una**

## Al desplegar

Las migraciones las corre el propio contenedor al arrancar
(`CMD node migrate.mjs && node server.js`) y la app se conecta como `postgres`,
que es superusuario — `CREATE EXTENSION btree_gist` no dará problema.

> 🔴 **Si en producción hubiera citas ya solapadas, la migración falla y el
> contenedor NO arranca** (van encadenadas con `&&`). Se comprobó antes de
> desplegar: cero solapes. Si alguna vez vuelve a aplicarse esta migración
> desde cero, conviene repetir la comprobación:
>
> ```sql
> select a.id, b.id from appointment a join appointment b
>   on a.staff_id = b.staff_id and a.id < b.id
>  and a.starts_at < b.ends_at and b.starts_at < a.ends_at
>  and a.status in ('pendiente','confirmada','reagendada')
>  and b.status in ('pendiente','confirmada','reagendada');
> ```


## Mover una cita desde el panel (14-ago-2026)

*"¿En qué parte se corren las citas de los clientes? Si la quiero mover media
hora más tarde."*

No se podía. El panel dejaba **confirmar, cancelar, completar y marcar "no
llegó"**, y mover el día entero de una especialista — pero no cambiarle la hora
a UNA cita. Reprogramar solo sabía hacerlo el agente, por WhatsApp.

El apaño que quedaba era cancelar y crear otra: se pierde el historial de esa
cita y, si el recordatorio ya salió, la clienta se queda con la hora vieja.

Ahora cada cita activa tiene **"Cambiar hora"**, con la fecha y la hora
precargadas con las suyas (casi siempre se mueve poco).

> 🔑 **Pasa por el mismo camino que el agente** (`reprogramarCita`), y esa es la
> decisión de diseño: hereda gratis lo que ya estaba probado — no deja solapar
> con otra cita de esa especialista, recalcula el final según la duración del
> servicio y libera el hueco anterior. Lo único que añade `moverCita` es buscar
> lo que el panel no manda: el servicio, la especialista y el horario.

Los errores se dicen en el idioma del negocio, no en el del sistema: *"a esa
hora la especialista ya tiene otra cita (o el servicio no termina antes de
cerrar)"*.

⚠️ **A la clienta no se le avisa.** El aviso sigue siendo del equipo — el
recordatorio manual está justo al lado.
