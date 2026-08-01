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
y `staff_service` hacia `service`/`staff_member` son de una sola columna — no
atan `organization_id` a nivel de constraint (igual que `lead` con `contact`).
El aislamiento entre tenants ahí lo hace la APLICACIÓN, no la base de datos:
todo endpoint que reciba un `serviceId`/`staffId` desde el cliente debe
revalidarlo contra la organización de la sesión antes de escribir. Ya está
hecho así en los endpoints existentes (`serviceIdsDeLaOrg()` en
`queries.ts` filtra antes de enlazar `staff_service`).

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

**Principio central, igual que con el horario de atención**: la disponibilidad
la calcula el servidor y se le entrega resuelta al modelo. Nunca se le pide
que haga la aritmética de fechas él mismo (la lección del bug "abierto a
medianoche", ver [04-AGENTE-IA.md](04-AGENTE-IA.md)).

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
hace dos turnos). A diferencia de `notify_order`, **no disparan handoff
automático**: agendar una cita no necesita que una persona coordine nada, así
que el agente sigue atendiendo.

## Dar de alta un cliente de citas

1. `/admin` → Nuevo cliente → marcar "¿Este cliente necesita gestionar citas?".
2. Entrar como el cliente → `/services` → crear los servicios (nombre, precio,
   duración) y el personal, asignando qué servicios atiende cada quien. **Un
   servicio sin nadie asignado no se puede agendar** — el prompt se lo dice al
   agente para que no lo ofrezca.
3. Configurar horario (`hoursOpen`/`hoursClose`/`hoursDays`) — hoy solo por
   base de datos, mismo hueco que ya tienen los pedidos (ver
   [08-PENDIENTES.md](08-PENDIENTES.md), punto 18).
4. Conectar el número y encender el agente, como cualquier cliente
   ([05-CLIENTES.md](05-CLIENTES.md)).

## Probarlo sin gastar WhatsApp

`corepack pnpm probar:citas <organizationId>` (o con mensajes propios:
`pnpm probar:citas <organizationId> "hola" "quiero un semipermanente" "mañana"`).

Crea un contacto y una conversación `is_test` dentro de esa organización y hace
correr el guion por `runAgentTurn` real — el sandbox jamás toca Graph/YCloud
(verificado en `tests/unit/send-sandbox.test.ts`), mismo principio que el
Laboratorio. Requiere que la organización ya tenga el flag encendido y al
menos un servicio con especialista asignado.

## Recordatorio de cita — manual, no automático

Decisión del dueño (1-ago-2026): **nada de recordatorios automáticos**. El
personal administrativo lo dispara cuando ellos decidan, con el botón
**"Recordar"** en `/appointments` (cualquier cita activa: pendiente,
confirmada o reagendada). Envía un texto libre por WhatsApp con el servicio,
la fecha, la hora y la especialista, y guarda `appointment.remindedAt` para
que se vea en el panel cuándo se envió el último.

**Límite real, no un bug**: como es texto libre (no hay plantilla de
Meta involucrada), solo sale si el cliente le ha escrito al negocio en las
últimas 24 h — si no, el botón devuelve un error explicando exactamente eso,
en vez de fallar en silencio. No hay ningún proceso que revise citas próximas
solo: si nadie aprieta el botón, no se manda nada.

## El Laboratorio ya reconoce citas (1-ago-2026)

Extendido `/lab`: el juez recibe el mismo catálogo y contrato de acciones de
citas que el agente, y reconoce `book_appointment`/`reschedule_appointment`/
`cancel_appointment` como acciones reales ejecutadas. **Restringido a
superadmin** (page + los 3 endpoints de `/api/lab`) — cada corrida cuesta
~33 llamadas al modelo que paga la agencia, así que un cliente ya no puede
dispararlo. Para probar el agente de un cliente puntual: "Entrar como" ese
cliente en `/admin` y correr el Laboratorio ahí.

## Lo que falta

- ⚠️ **Confirmar que el último despliegue incluye hasta el commit
  `6a8c213`** (recordatorio manual). Al cierre de la sesión del 1-ago quedaban
  sincronizados en la carpeta de EasyPanel pero sin confirmar desplegados:
  el arreglo de "confirmó sin agendar" (`2943382`), el Laboratorio
  (`7a5c1ed`) y el recordatorio (`6a8c213`). Verificar con el mismo método de
  siempre: grep de un texto nuevo dentro del contenedor que corre
  (`02-INFRAESTRUCTURA.md`), no basta con "converged".
- ⚠️ **Volver a correr `pnpm probar:citas` completo** (agendar → reprogramar →
  cancelar) contra `org_novxv78s08h12arzatr2` ("Peluqueria Demo (prueba)")
  después de ese despliegue, para confirmar que el bug de "confirmó sin
  agendar" (que agendaba en domingo, día cerrado) no reaparece. La última
  corrida completa fue ANTES del arreglo.
- **No se portó la reprogramación en cascada** de Valentina (correr toda la
  agenda de una especialista X minutos): es una herramienta de administración
  del negocio, no algo que un cliente pida por chat. Si hace falta, es
  trabajo aparte.
- **El panel `/services` no tiene edición inline de precio/duración**: para
  corregir un dato hoy hay que archivar el servicio y crear uno nuevo.
