# El vertical de citas (agendamiento)

> **Dentro:** Qué es y para quién · Cómo se aísla de los clientes de pedidos · El motor de disponibilidad · Cómo decide el agente (el loop de consulta) · Dar de alta un cliente de citas · Probarlo sin gastar WhatsApp · Lo que falta

Segundo vertical de negocio de korex.ia, aparte del de pedidos (La Churra, Lis
Pastelería). Nace el 1-ago-2026 para dos clientes potenciales de peluquería y
estética: agendan citas, las reprograman, y cada servicio lo atiende una
persona distinta. Referencia de diseño: el motor de `BOT VALENTINA CON IA`
(`C:\bots\BOT VALENTINA CON IA\src\lib\appointment\logic.ts`), portado a
Postgres/Drizzle y adaptado al contrato de acciones de korex.ia.

## Qué es y para quién

Es **opt-in por cliente**, decidido al darlo de alta en `/admin` (checkbox
"¿Este cliente necesita gestionar citas?", sección **Funcionalidades** al
final del formulario — editable después desde la tarjeta del cliente, junto a
`ClientNumber`). Apagado por defecto: La Churra y Lis Pastelería no lo ven ni
lo pagan en prompt.

`agent_profile.appointmentsEnabled` es el flag. Cuando está encendido:

- Aparecen **Citas** y **Servicios** en el menú de esa organización
  (`src/components/app-nav.tsx`).
- El prompt del agente carga el catálogo de servicios y el contrato de
  acciones de citas (`CONTRATO_DE_ACCIONES_CITAS`, `server/ai/prompts.ts`).
- El endpoint de cada tabla nueva rechaza con 403 si el flag está apagado
  (`appointmentsEnabledFor()`, `server/appointments/queries.ts`).

## Cómo se aísla de los clientes de pedidos

Mismo principio que todo korex.ia: `organization_id` obligatorio en las
4 tablas nuevas (`service`, `staff_member`, `staff_service`, `appointment`,
`src/lib/db/schema.ts`), y el prompt de citas solo se arma para quien tiene el
flag — el `CONTRATO_DE_ACCIONES` original (pedidos) no se toca, así que La
Churra y Lis no ganan ni pierden nada.

⚠️ **Nota de la auditoría de seguridad (1-ago-2026)**: las FK de `appointment`
y `staff_service` hacia `service`/`staff_member` son de una sola columna y **no
atan `organization_id` a nivel de constraint**. El aislamiento ahí lo hace la
APLICACIÓN: todo endpoint que reciba un `serviceId`/`staffId` del cliente debe
revalidarlo contra la organización de la sesión antes de escribir — como hace
`serviceIdsDeLaOrg()` en `queries.ts`.

## El motor de disponibilidad

`src/server/appointments/logic.ts` es lógica **pura**, sin tocar la base de
datos (probada en `tests/unit/appointments-logic.test.ts`, 26 casos):
búsqueda difusa de servicio por nombre parafraseado (`buscarServicio`),
cálculo de slots libres respetando solapamientos y horario (`calcularDisponibilidad`),
conversión Bogotá⇄UTC (Bogotá es UTC-5 fijo, sin horario de verano).

`src/server/appointments/queries.ts` es la capa que sí toca la base de datos:
CRUD de catálogo, `disponibilidadReal()`, `crearCita()`, `reprogramarCita()`,
`cancelarCita()`. Reusa `agent_profile.hoursOpen/hoursClose/hoursDays` — el
mismo horario que ya usan los pedidos — así que un cliente de citas configura
su horario en un solo lugar.

**Principio central**: la disponibilidad la calcula el servidor y se le
entrega resuelta al modelo — nunca se le pide aritmética de fechas. Lo mismo
vale para el horario y el calendario ([04-AGENTE-IA.md](04-AGENTE-IA.md)).

## Cómo decide el agente (el loop de consulta)

korex.ia le pide al modelo **una sola acción JSON por turno** — no tiene
tool-calling nativo de OpenRouter como Valentina. Para que el agente pueda
consultar horarios reales sin salir aún a hablar con el cliente, se sumó una
acción interna: `consult_availability`. El pipeline (`runAgentTurn`,
`server/ai/pipeline.ts`) la resuelve, le devuelve el resultado real como
mensaje de sistema **dentro del mismo turno**, y vuelve a llamar al modelo
— acotado a 2 vueltas para que una conversación confusa termine en handoff
en vez de un bucle.

Acciones de escritura: `book_appointment`, `reschedule_appointment`,
`cancel_appointment`. Cada una revalida la disponibilidad real antes de
tocar la base de datos (nunca confía en lo que el modelo cree que consultó
hace dos turnos).

Desde el **5-ago-2026**, segunda barrera: **solo se agenda un horario que el
agente haya ofrecido** en esa conversación (tabla `offered_slot`). Estar libre
ya no basta — si se confunde con una fecha relativa y elige un hueco que nunca
ofreció, se le responden los horarios reales en vez de reservar mal. Sin nada
ofrecido se deja pasar, para no romper al cliente que pide día y hora
concretos ([26-NEA-AGENT.md](26-NEA-AGENT.md)). A diferencia de
`notify_order`, **no disparan handoff**: agendar no necesita que una persona
coordine nada.

## Dar de alta un cliente de citas

1. `/admin` → Nuevo cliente → marcar "¿Este cliente necesita gestionar citas?".
2. Entrar como el cliente → `/services` → crear los servicios (nombre, precio,
   duración) y el personal, asignando qué servicios atiende cada quien. **Un
   servicio sin nadie asignado no se puede agendar** — el prompt se lo dice al
   agente para que no lo ofrezca.
3. Configurar horario (`hoursOpen`/`hoursClose`/`hoursDays`) — solo por base
   de datos ([08-PENDIENTES.md](08-PENDIENTES.md), punto 18).
4. Conectar el número y encender el agente ([05-CLIENTES.md](05-CLIENTES.md)).

## Probarlo sin gastar WhatsApp

`corepack pnpm probar:citas <organizationId> "hola" "quiero semipermanente"`.

Crea un contacto y una conversación `is_test` y corre el guion por
`runAgentTurn` real — el sandbox jamás toca Graph/YCloud (verificado en
`tests/unit/send-sandbox.test.ts`). Requiere el flag encendido y al menos un
servicio con especialista. Para correrlo **dentro del contenedor** (la imagen
de producción no trae `scripts/`), ver [30-SALON-PRUEBAS.md](30-SALON-PRUEBAS.md).

## Recordatorio de cita — manual, no automático

Decisión del dueño (1-ago-2026): **nada de recordatorios automáticos**. Lo
dispara el personal con el botón **"Recordar"** en `/appointments` (cualquier
cita activa), que manda un texto libre con servicio, fecha, hora y
especialista, y guarda `appointment.remindedAt`. Si nadie lo aprieta, no se
manda nada.

**Límite real, no un bug**: al ser texto libre, solo sale si el cliente
escribió en las últimas 24 h — si no, el botón devuelve un error explicándolo,
en vez de fallar en silencio.

> 🔴 **Para un salón esto es un problema de fondo, no un detalle**: la clienta
> agenda el lunes para el viernes y el jueves su ventana lleva días cerrada.
> Vale igual para los avisos de la cascada. La salida es una **plantilla de
> utilidad** — cómo funciona, qué cuesta y quién la crea, en
> [29-RECORDATORIOS-Y-PLANTILLAS.md](29-RECORDATORIOS-Y-PLANTILLAS.md).

## Lo que la dueña puede hacer desde el panel (7-ago-2026)

En `/appointments`, además de la lista con filtros por estado:

- **Calendario del día**: una columna por especialista y las citas colocadas
  por hora, con **selector para saltar a cualquier fecha**. La lista sirve
  para buscar una cita concreta; para ver cómo va el día y dónde quedan huecos
  hace falta la rejilla. Pide su día al servidor (`?fecha=`) en vez de filtrar
  la lista general, que viene limitada a 200: al saltar lejos podía pintar
  vacío un día con citas.
- **Nueva cita a mano.** Hasta hoy las citas **solo nacían por WhatsApp**, y
  eso dejaba un agujero que duele el primer día: la clienta que llama por
  teléfono o llega al local **no existía en la agenda**, así que el agente
  daba ese hueco por libre **y se lo ofrecía a otra**. Verificado en vivo:
  tras agendar a mano un Volumen 3D de Hilary a las 14:00, el agente dejó de
  ofrecer esa hora y pasó a las 16:30 — justo cuando ella termina.
  Pasa por el **mismo** `crearCita` que el agente (valida horario, servicio y
  solape), y pide nombre y celular: el celular normalizado es lo que une la
  cita con la conversación de WhatsApp de esa clienta.
- **Mover el día de una especialista**: pasarlo a otra o liberarlo (arriba).

**Lo que NO hay todavía**: editar precio o duración de un servicio (hay que
archivarlo y crear otro), ni configurar horario y marca por pantalla.

## El Laboratorio ya reconoce citas (1-ago-2026)

Extendido `/lab`: el juez recibe el mismo catálogo y contrato de acciones de
citas que el agente, y reconoce `book_appointment`/`reschedule_appointment`/
`cancel_appointment` como acciones reales ejecutadas. **Restringido a
superadmin** (page + los 3 endpoints de `/api/lab`) — cada corrida cuesta
~33 llamadas al modelo que paga la agencia, así que un cliente ya no puede
dispararlo. Para probar el agente de un cliente puntual: "Entrar como" ese
cliente en `/admin` y correr el Laboratorio ahí.

## Lo que falta

- ✅ **Despliegue confirmado (3-ago-2026)**: los commits de citas
  (`2943382`, `7a5c1ed`, `6a8c213`), el arreglo de nombres de usuario de
  WhatsApp y la auditoría del mismo día están **todos en vivo** — verificado
  con grep dentro del contenedor real (no solo "converged") y consultando la
  base de datos de producción directamente.
- ✅ **`pnpm probar:citas` corrido contra producción tras el despliegue**
  (3-ago-2026), directamente dentro del contenedor real con
  `org_novxv78s08h12arzatr2`: ciclo completo **agendar → reprogramar →
  cancelar** en la misma conversación, con confirmación explícita del
  cliente en cada paso. El bug de "confirmó sin agendar" **no reapareció**
  — al contrario, el agente rechazó correctamente reservar dos veces el
  mismo horario ("Ese horario ya no está disponible") en vez de duplicarlo.
  Verificado también en la tabla `appointment`: la cita reprogramada quedó
  con `status='cancelada'` tras el ciclo.
- **Detalle de comportamiento observado, no un bug**: sin una confirmación
  explícita del cliente ("sí, resérvalo"), el modelo a veces prefiere
  preguntar antes de llamar a `book_appointment` en vez de agendar directo
  — es justo el comportamiento que se buscaba con la regla dura de "no
  confirmar sin ejecutar".
- ✅ **Lo de las "fechas ambiguas" SÍ era un bug, corregido el 7-ago-2026**:
  no fallaba el modelo, `normalizarFecha` **rechazaba el formato ISO** y la
  fecha se leía como día "2026". Con eso y otros cuatro datos que le faltaban
  al agente, ver [31-BITACORA-7AGO.md](31-BITACORA-7AGO.md).
- ✅ **Cascada de agenda — hecha el 7-ago-2026**, al entrar el primer cliente
  real. En `/appointments`, "Mover el día de una especialista": se elige
  persona y día, se **ve primero** qué citas tiene, y desde ahí se **pasan a
  otra persona** o se **cancela el día completo**. Se le escribe a cada
  clienta.
  - **Nada se mueve a ciegas**: antes de reasignar cada cita se comprueba que
    la otra persona **atienda ese servicio** y que **tenga el hueco libre**.
    Lo que no pasa el filtro se queda donde está y sale listado — dos
    clientas a la misma hora con la misma persona es peor que avisar de un
    choque.
  - **A quien no se le pudo avisar sale en una lista aparte** ("hay que
    llamarla"): es la ventana de 24 h, ver abajo.
  - No se portó "correr la agenda X minutos" (lo que sí tenía Valentina): el
    dueño eligió estas dos y no esa.
- **El panel `/services` no tiene edición inline de precio/duración**: para
  corregir un dato hoy hay que archivar el servicio y crear uno nuevo.

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
