# Selección múltiple en citas: una reserva con varios servicios, implementado

> **Dentro:** Objetivo · Archivos modificados · Dónde vive la reserva · El
> desacople deliberado (estado vs. acción real) · La migración · El mapa de
> refactor · Lo que NO cambió, y por qué · Las pruebas · Resultado del gate ·
> Riesgos y lo que queda pendiente · Cómo revertir · §12 Ajustes tras la
> auditoría (18-ago, mismo día) · §13 El calendario solo mostraba el
> servicio principal (18-ago, primer cliente real) · §14 La cascada de
> agenda solo comprobaba el servicio principal · §15 el cierre bloqueaba
> citas que sí debían caber (diagnóstico corregido en el mismo día) · §16
> la lista del panel mostraba TODAS las citas, no las del día

**18-ago-2026.** Cierre del paso 4 auditado el 17-ago en
[88-AUDITORIA-SELECCION-MULTIPLE.md](88-AUDITORIA-SELECCION-MULTIPLE.md):
una cita admite varios servicios en la misma visita ("manos y pies
tradicional", en cualquier orden y cualquier combinación). El doc 88 congeló
que `items[]` entraba en pedidos **y** citas a la vez; solo se implementó
para pedidos (docs 89, 90). Esto cierra la parte de citas que quedó
pendiente.

Motivado por un caso real de Lashes Valen: sus clientas piden combinaciones
de servicios de uñas, pestañas y cejas en un solo mensaje, y no existe (ni
debe existir) un catálogo de combos — la combinación la compone la clienta,
no el negocio.

---

## 1 · Objetivo

Que un cliente pueda escribir *"hola, me agendas para mañana manos y pies
tradicional"* (o al revés: *"pies y manos"*) y el agente agende **una sola
visita** con los dos servicios, un solo bloque de tiempo, un solo recurso —
sin que el negocio tenga que dar de alta "Tradicional manos y pies" como un
servicio más.

**Trabajo local únicamente**, mismo criterio que el paso 4 de recursos y
reservas ([96](96-BITACORA-RECURSOS-Y-RESERVAS.md)): código + migración
escrita y gateada, sin tocar ninguna base. El despliegue lo hace el dueño en
EasyPanel.

---

## 2 · Archivos modificados

| Archivo | Qué |
|---|---|
| `src/lib/db/schema.ts` | Índice `service_org_id_uq` (faltaba); tabla nueva `appointmentService` |
| `src/lib/db/ids.ts` | Prefijo nuevo `appointmentService` (`apts`) |
| `src/server/orders/estado.ts` | `ReservaDeCita`, `SCHEMA_VERSION` 4→5, `EstadoDelPedido.reserva?`, `PropuestaDelModelo.reserva?`, `aplanar()`, `validarPropuesta` copia `reserva` y rechaza "confirmado sin fecha/hora de la cita" |
| `src/server/registro-de-cambios.ts` | `reserva: "negocio"` en `CLASIFICACION.conversation_state` |
| `src/server/orders/extraer.ts` | `loQueFalta`/`comoTexto` ganan `vertical` (default `"pedidos"`): "presentación"→"servicio", "PEDIDO EN CURSO"→"CITA EN CURSO" |
| `src/server/appointments/logic.ts` | `encontrarCitaActiva` acepta `serviceNames?: string[]` opcional (busca también en servicios secundarios de la visita) |
| `src/server/appointments/queries.ts` | Nuevas: `staffIdsForServices` (privada), `resolverEspecialistaMultiple`, `disponibilidadRealMultiple`, `proximasFechasConCupoMultiple`, `crearCitaMultiple`. Extraídos `citasDelDiaDeRecursos` y `fechasConCupo` (compartidos con las versiones singulares). Corregido `reprogramarCita` (sumaba solo la duración del primer servicio). Enriquecido `citasActivasDeContacto` con `serviceNames` |
| `src/server/ai/actions.ts` | `book_appointment`/`consult_availability`: `servicio: string` → `servicios: string[]` (máx. `MAX_ITEMS`) |
| `src/server/ai/prompts.ts` | `CONTRATO_DE_ACCIONES_CITAS` reescrito a plural |
| `src/server/ai/pipeline.ts` | Se levanta la exclusión de citas en `estadoEstructurado`; `catalogoDe`/`verticalDe` sustituyen a `catalogoDePedidosQuery` en la Fase 2; `chatJsonConEstado` gana el bloque `reserva` condicional por vertical; `resolverConsultaDisponibilidad` y el caso `book_appointment` resueltos por `servicios[]` |
| `drizzle/0025_reserva_multiple.sql` | La migración — escrita, no ejecutada |
| `drizzle/meta/_journal.json` | Entrada `idx: 25` |
| `tests/unit/estado-del-pedido.test.ts` | Bloque `reserva de cita (v5)`: 4 casos |
| `tests/unit/appointments-logic.test.ts` | `encontrarCitaActiva` con `serviceNames`; duración combinada en `calcularDisponibilidad` |
| `tests/unit/appointments-multiple.test.ts` | Nuevo: `resolverEspecialistaMultiple` (y, a través suyo, `staffIdsForServices`) |
| `tests/unit/pipeline-appointments-dispatch.test.ts` | Mock actualizado a los nombres plurales; `servicio`→`servicios` en el caso de `book_appointment` |
| `tests/integration/citas-motor.test.ts` | Bloque nuevo: reserva de varios servicios (bloque combinado, colisión a mitad de visita, reprogramar, `citasActivasDeContacto`) |
| `scripts/probar-estado.ts` | Bloque B6: `comoTexto`/`loQueFalta` en modo citas, `validarPropuesta` con `reserva` |

**No tocado, verificado explícitamente**: `src/app/api/appointments/route.ts`
(agenda manual desde el panel — sigue en un solo servicio, no lo pidió
nadie), los 6 componentes de React de `/appointments`, `appointment.serviceId`
(se conserva; pasa a significar "el primero de la visita").

---

## 3 · Dónde vive la reserva: en la raíz del estado, no por ítem

El boceto del doc 88 (`reserva?` dentro de cada `ItemDelPedido`) quedó
descartado a propósito: los casos reales ("manos y pies", "cejas y
pestañas") son siempre **una sola visita** — un bloque de tiempo, un
recurso. `EstadoDelPedido.reserva?: ReservaDeCita | null` es hermano de
`items`, no un campo de cada ítem — mismo criterio que ya aplica `datos`
("del pedido entero, no se duplica").

```ts
export type ReservaDeCita = {
  fecha: string | null;
  hora: string | null;
  duracionMin: number | null;   // suma de duracionMin de los servicios resueltos
  recursoId: string | null;     // resuelto por el backend, nunca por el modelo
  recursoNombre: string | null; // redundante a propósito, igual que ofrecible.nombre
};
```

`validarPropuesta` copia `propuesta.reserva` tal cual (fecha/hora/
especialista → recursoNombre) sin resolver `recursoId`/`duracionMin`: esa
función es pura, sin acceso a la base, y esos dos campos exigen consultar
recursos reales. Confirmar sin `fecha`/`hora` cuando `reserva` está presente
es un estado imposible, igual que "confirmado sin producto" en pedidos —
pero **solo si el modelo mandó `reserva`**: un pedido nunca la trae, así
que la regla no le aplica.

---

## 4 · El desacople deliberado: la reserva REAL no depende de este estado

Verificado contra el código real, no supuesto: `notify_order` (la acción
que cierra un pedido) **nunca** ha leído `items[]`, con la Fase 2 encendida
o apagada (`src/server/ai/actions.ts`, su esquema Zod no menciona `items`).
No hay precedente de "la acción confía en el estado acumulado" que copiar
para citas.

Y atar `book_appointment` a `items[]`/`reserva` exigiría
`stateSource='backend'`, que **hoy ningún cliente real tiene encendido** —
dejaría la función inutilizable para Lashes Valen hasta un segundo rollout
que nadie pidió. Por eso `book_appointment`/`consult_availability` ganaron
su propio `servicios: string[]` directo, funcionan hoy mismo para cualquier
organización de citas, y `items[]`/`reserva` quedan como memoria entre
turnos para cuando algún cliente encienda la Fase 2 — infraestructura
lista, sin cliente que la use todavía (igual que en el paso 4 con `type` en
`resource`).

Flujo real: el modelo emite `book_appointment` con `servicios[]` → cada uno
se resuelve con `buscarServicio` (el mismo matcher de siempre, sin
duplicarlo) → `resolverEspecialistaMultiple` sobre la intersección de
quienes atienden TODOS → `estaEntreLosOfrecidos` (sin cambios) →
`crearCitaMultiple` dentro de su transacción.

---

## 5 · La decisión de esquema

| Antes | Después | Cómo |
|---|---|---|
| `appointment.service_id` (uno solo, `NOT NULL`) | se conserva, pasa a significar "el primero de la visita" | sin migración de esa columna: todo lo que hace `innerJoin` contra ella sigue funcionando |
| — | `appointment_service` | `CREATE TABLE`: `id`, `organization_id`, `appointment_id`, `service_id`, `position`, `duration_min` (espejo), `created_at` |
| — | `service_org_id_uq` | faltaba desde el principio — la habilita la FK compuesta de `appointment_service` |

**Aditiva, no un reemplazo**: `appointment_service` es la fuente completa
(uno o varios servicios, en orden); `appointment.service_id` sigue siendo
el resumen rápido que ya usan `agendaDelDia`, `listAppointments`,
`citasDelDia` y la UI de `/appointments`, sin tocar ninguno de los cuatro.

El `EXCLUDE` de solape (`appointment_resource_sin_solape`, nacido en la
0024) **no se tocó**: protege el bloque de tiempo completo de la reserva
sin saber ni necesitar saber cuántos servicios contiene — es la ventaja de
haberlo movido a `appointment_resource` en el paso 4b, un mes… un día antes
de este cambio.

---

## 6 · Mapa de refactor de `queries.ts`

- **Nuevas, junto a su par singular**: `staffIdsForServices` (privada, como
  `staffIdsForService`), `resolverEspecialistaMultiple`,
  `disponibilidadRealMultiple`, `proximasFechasConCupoMultiple`,
  `crearCitaMultiple`.
- **Helpers extraídos para no duplicar consultas**: `citasDelDiaDeRecursos`
  (compartido por `disponibilidadReal`/`disponibilidadRealMultiple`) y
  `fechasConCupo` (compartido por `proximasFechasConCupo`/su variante).
  Las funciones singulares no cambiaron de comportamiento, solo de forma
  interna.
- **Corrección real, no diferible**: `reprogramarCita` calculaba `endsAt`
  con la duración de un solo servicio (`input.service.durationMin`). Una
  visita multiservicio reprogramada quedaba con su bloque truncado —
  desprotegido contra el doble cupo en los minutos que sobraban. Arreglo:
  suma `duration_min` de `appointment_service` para ese `appointmentId`,
  con fallback a la duración simple para citas creadas antes de este
  cambio (sin filas en `appointment_service`).
- **Enriquecimiento**: `citasActivasDeContacto` gana `serviceNames: string[]`
  (segunda consulta liviana, solo para las citas de ese contacto) —
  "cancela mi cita de pies" encuentra la visita aunque el servicio
  PRINCIPAL sea "Manicure". `encontrarCitaActiva` (logic.ts) lo usa si
  está presente y se comporta exactamente igual que antes si no lo está.

**Intersección, no unión**: el recurso válido para una visita de varios
servicios es quien los atiende TODOS (`staffIdsForServices`), no quien
atiende cualquiera de ellos. Es el caso real de un salón pequeño: una sola
especialista hace manos, pies, cejas y pestañas seguidas.

---

## 7 · Lo que NO cambió, y por qué

- **Un solo recurso por visita.** La tabla `appointment_service` deja la
  puerta abierta (una columna `resourceId` opcional por servicio, aditiva)
  para el día que un negocio necesite que un servicio de la visita lo
  atienda alguien distinto — no hay caso de uso hoy, no se implementó.
- **`reschedule_appointment`/`cancel_appointment` siguen en singular.**
  Identifican una cita YA agendada por su servicio principal
  (`encontrarCitaActiva`); no son el punto donde se compone una
  combinación nueva.
- **`/api/appointments/route.ts` (agenda manual del panel) no se tocó.**
  El equipo administrativo sigue agendando un servicio a la vez desde el
  CRM; nadie pidió lo contrario, y `crearCita`/`resolverEspecialista`
  (singulares) siguen ahí exactamente para ese camino.

---

## 8 · Pruebas

- `tests/unit/estado-del-pedido.test.ts` — 4 casos nuevos: cita completa y
  confirmada con `reserva` resuelta, rechazo sin hora, rechazo sin fecha, y
  un pedido (sin `reserva` en la propuesta) que sigue confirmando exactamente
  igual que siempre.
- `tests/unit/appointments-logic.test.ts` — `encontrarCitaActiva` encuentra
  por un servicio secundario de la visita y se comporta igual que antes sin
  `serviceNames`; duración combinada en `calcularDisponibilidad` (90 min de
  dos servicios de 45 cierran un hueco que sí estaba libre a los 45).
- `tests/unit/appointments-multiple.test.ts` (nuevo) — `resolverEspecialistaMultiple`
  sobre la intersección: sin nombre, con nombre que sí está en la
  intersección, con nombre que solo atiende uno de los dos servicios, sin
  nadie que atienda la combinación completa (sin segunda consulta), y el
  caso de un solo servicio.
- `tests/unit/pipeline-appointments-dispatch.test.ts` — actualizado a los
  mocks plurales; sigue en 4/4 ✅.
- `tests/integration/citas-motor.test.ts` — bloque nuevo con 6 pruebas:
  duración sumada, filas `appointment_service` en orden, colisión a MITAD
  del bloque combinado (no solo contra el primer servicio), el hueco se
  libera justo al terminar el bloque completo, `reprogramarCita` conserva
  la duración combinada, `citasActivasDeContacto` trae todos los servicios.
- `scripts/probar-estado.ts` (Bloque B6) — actualizado; sin verificación
  automática (fuera de `tsconfig`/`eslint`, deuda ya anotada en la
  bitácora del paso 4).

### ⚠️ `citas-motor.test.ts` sigue sin ejecutarse

Mismo caso documentado el 18-ago en
[96](96-BITACORA-RECURSOS-Y-RESERVAS.md): sin `TEST_DATABASE_URL` ni Docker
en esta máquina, solo el túnel SSH a producción. Las 6 pruebas nuevas
quedan **escritas y revisadas, no ejecutadas**.

---

## 9 · Resultado del gate

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | ✅ limpio en todo el árbol |
| `pnpm lint` | ✅ limpio |
| `pnpm test` | ✅ **794 passed, 73 skipped (867)** — 12 pruebas más que pasan (las nuevas unitarias) y 6 más saltadas (las nuevas de integración, correctamente reconocidas sin `TEST_DATABASE_URL`) |

La migración `.sql` **no se ejecutó**: revisada a mano, statement por
statement, contra `schema.ts` y contra el estilo real de
`drizzle/0024_recursos_y_reservas.sql` (donde nació `appointment_resource`,
la tabla hermana de esta). No hay forma de correr `pnpm db:migrate` en esta
máquina hoy.

---

## 10 · Riesgos y lo que queda pendiente

| | Qué |
|---|---|
| 🔴 | **La migración no se ha ejecutado contra ninguna base.** Antes de desplegar: respaldo manual verificado, mismo criterio que el paso 4 |
| 🟠 | **`citas-motor.test.ts` sin ejecutar** — incluidas las 6 pruebas nuevas de reserva múltiple |
| 🟠 | **`scripts/probar-estado.ts` fuera del gate** — su corrección de hoy (Bloque B6) no tiene red automática |
| ⬜ | **Un recurso por servicio de la visita no se implementó** — la columna está prevista en el diseño, no en el esquema; aditiva cuando haga falta |
| ⬜ | **`items[]`/`reserva` en el estado quedan sin cliente que los use** — ningún negocio de citas tiene `stateSource='backend'` hoy; es infraestructura lista para cuando lo tenga, igual que `resource.type` en el paso 4 |
| 🟢 | **`book_appointment`/`consult_availability` funcionan hoy mismo**, sin depender de la Fase 2 — el desacople del §4 es lo que lo permite |

---

## 11 · Cómo revertir

**Antes de desplegar**: `git revert` del commit (o borrar/deshacer los
archivos de §2). La base no se toca — nada de esto se ejecutó contra
producción.

**Si hiciera falta revertir después de desplegar**, sin migración de bajada
automática:

1. Borrar la tabla `appointment_service` y el índice `service_org_id_uq`.
2. `appointment.service_id` no necesita tocarse: nunca dejó de ser el
   servicio principal, y ninguna fila se le quitó.
3. En el código: revertir `actions.ts` (`servicios`→`servicio`),
   `pipeline.ts` (el caso `book_appointment`/`consult_availability` y la
   exclusión de `estadoEstructurado`), `prompts.ts` (`CONTRATO_DE_ACCIONES_CITAS`).
   Ninguno de los tres depende de la tabla nueva, así que el orden no
   importa.
4. `estado.ts`/`registro-de-cambios.ts`: `reserva` es un campo opcional
   aditivo — dejarlo sin usar no rompe nada; quitarlo es opcional.

El respaldo manual verificado que hará el dueño antes de desplegar sigue
siendo la defensa principal.

---

## 12 · Ajustes tras la auditoría (18-ago, mismo día)

Una auditoría de arquitectura de solo lectura sobre este mismo trabajo
(fuera del gate, a pedido del dueño) encontró tres puntos concretos.
Aplicados los tres, código + pruebas + doc en el mismo cambio, sin
migración ni commit:

1. **`pipeline.ts` mezclaba dos formas de preguntar por el vertical.** Seis
   sitios (`529, 546, 625, 793, 986, 1019` antes de este ajuste) seguían
   leyendo `profile.appointmentsEnabled` directo, sin pasar por
   `verticalDe()`/`Vertical` — la promesa de "un solo sitio" de
   [`src/server/vertical.ts`](../../src/server/vertical.ts) estaba a
   medias. Se movió `const vertical = verticalDe(...)` al inicio de
   `runAgentTurn` (antes de su primer uso) y los seis sitios pasaron a usar
   `contrataCitas(vertical)`. Mecánico, mismo comportamiento — no cambia
   ningún resultado, solo la fuente de la condición. Verificado: hoy
   `profile.appointmentsEnabled` solo se lee en un lugar de todo el
   archivo, dentro de `verticalDe(profile.appointmentsEnabled)`.
2. **`appointment.serviceId` y `appointment_service` (posición 0) duplican
   el mismo hecho sin trigger que los sincronice** (a diferencia de
   `appointment_resource`, que sí lo tiene). Se documentó explícitamente
   en los dos lugares donde alguien lo tocaría primero —
   `schema.ts` (docstring de la tabla) y `queries.ts` (`crearCitaMultiple`,
   donde nace la duplicación) — dejando dicho que esa función es la ÚNICA
   autorizada a escribir las dos tablas, y que cualquier función nueva que
   edite los servicios de una cita ya creada debe actualizar ambas. Sin
   trigger nuevo: el riesgo está dormido (nadie edita servicios de una
   cita ya creada hoy) y construirlo ahora habría sido generalizar sin
   necesidad.
3. **`comoTexto` no recordaba la `reserva`.** Se le pedía al modelo que la
   reportara (`chatJsonConEstado`) pero nunca se le devolvía en el
   recordatorio del turno siguiente — la regla "no vuelvas a preguntar lo
   que ya te dijeron" no cubría cuándo o con quién. Corregido en
   `orders/extraer.ts`: una línea `reserva: fecha hora con Fulana` cuando
   hay algo que mostrar, con el mismo criterio de "corto, no crece si no
   hay nada". Sin cliente real que lo ejerza hoy (ningún vertical de citas
   tiene `stateSource='backend'`), pero corregido antes de que haga falta.

**No se tocó** (evaluado y descartado explícitamente en la propia
auditoría, no por omisión): el naming `orders/`/`EstadoDelPedido` (alto
radio, tarea aparte), los guardarraíles de negocio dentro de `pipeline.ts`
(preexistentes, con historia de incidentes reales, requieren su propia
auditoría antes de mover), el techo de `appointments_enabled` como
booleano (solo urge con un tercer vertical real), y la reserva simultánea
de dos tipos de recurso — el caso "clínica: médico + consultorio a la vez"
— (sin cliente que lo pida hoy).

**Gate tras los tres ajustes**: `pnpm typecheck` ✅ · `pnpm lint` ✅ ·
`pnpm test` ✅ **796 passed, 73 skipped (869)** — dos pruebas más que
pasan (las de `comoTexto` recordando la reserva), ninguna más saltada (los
otros dos ajustes no tocaron ningún camino que dependiera de la base).

### Cómo revertir estos tres ajustes

Independientes entre sí y del resto del cambio — cualquiera se puede
revertir solo:

1. `pipeline.ts`: volver a `profile.appointmentsEnabled` en los seis
   sitios y borrar la declaración movida de `vertical` (o dejarla, es
   inocua).
2. `schema.ts`/`queries.ts`: quitar los dos comentarios de advertencia — no
   afectan ningún comportamiento, son documentación.
3. `orders/extraer.ts`: quitar el bloque que añade la línea `reserva:` en
   `comoTexto`.

---

## 13 · El calendario solo mostraba el servicio principal (18-ago, primer cliente real)

**El primer caso real, minutos después de prender el agente de Lashes
Valen.** Una clienta pidió "Diwpower + Tradicionales" (manos y pies), el
agente la agendó bien —el WhatsApp de confirmación decía correctamente
"Diwpower + Tradicionales" y "tus manos y pies"—, pero el calendario del
panel (`/appointments`) solo mostraba **"Diwpower"**: Laura, mirando su
agenda, no tenía forma de saber que también le tocaban los pies.

**Verificado en la base antes de tocar nada** (regla de oro: medir, no
suponer): la reserva estaba completa —

```
appointment_service para esa cita:
  Diwpower       · 90 min · posición 0
  Tradicionales  · 30 min · posición 1
  Total: 120 min → 09:30–11:30, exacto el bloque que ocupó a Laura
```

No hubo pérdida de datos ni doble cupo. La causa exacta era la ya anotada
en §2/§7 de este documento como "no tocado": `citasDelDia`, `listAppointments`
y los componentes de `/appointments` seguían leyendo solo
`appointment.serviceId` (el principal), nunca `appointment_service`. Se
sabía que faltaba; no se sabía que el costo fuera operativo y no solo
cosmético hasta que lo reportó el dueño con el primer cliente real.

### Arreglo

Mismo patrón que ya tenía `citasActivasDeContacto` (§ paso 4 de este
documento), esta vez **extraído a un helper compartido** para no
triplicarlo:

- Nueva `serviciosDeCitas(organizationId, appointmentIds)` en
  `appointments/queries.ts`: una consulta liviana a `appointment_service`,
  acotada a las citas ya leídas, que devuelve un `Map<appointmentId,
  string[]>`.
- `citasActivasDeContacto` (ya existente) se reescribió para usar el
  helper en vez de tener su propia copia de la misma consulta.
- `citasDelDia` y `listAppointments` ganan `serviceNames: string[]` en
  `AppointmentRow`, usando el mismo helper.
- `src/components/appointments/calendario-dia.tsx` y
  `appointments-client.tsx`: el tipo `Cita`/`Appointment` gana
  `serviceNames?: string[]`, y las tres vistas (calendario en rejilla,
  `title` del hover, lista del panel) pintan
  `serviceNames.join(" + ")` en vez de `serviceName` a secas.

**No tocado, y anotado por qué**: `agendaDelDia`/`reasignarAgenda` (la
herramienta de cascada, "pasa las citas de Laura a Camila") sigue
comprobando solo `cita.serviceId` (el principal) al decidir si la nueva
especialista puede recibir la cita — para una visita "Diwpower +
Tradicionales", solo verifica que la destinataria atienda Diwpower. Es un
riesgo de **corrección**, no solo de visualización (podría reasignar una
visita a quien no atiende una parte de ella), pero es un camino de
ESCRITURA distinto, con su propia lógica de conflictos — se dejó fuera de
este arreglo a propósito, para no mezclar un cambio de visualización con
uno que cambia qué se permite reasignar. Pendiente, con dueño claro si se
pide.

### Pruebas

- `tests/unit/citas-del-dia.test.ts`: reescrito con cola de respuestas
  (antes usaba una sola respuesta compartida, que no distinguía la
  segunda consulta); casos nuevos para visita de un servicio y de varios,
  y un caso nuevo para `listAppointments`.
- Sin prueba de integración nueva: el caso real ya está verificado a mano
  contra la base de producción (arriba), y `citasActivasDeContacto` —que
  comparte el mismo helper— ya tiene su cobertura de integración desde el
  §5 de este documento.

**Gate**: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅
**799 passed, 73 skipped (872)** — tres pruebas más que pasan, ninguna más
saltada.

### Cómo revertir

Independiente del resto: quitar `serviciosDeCitas` y sus tres llamadas en
`queries.ts` (`citasActivasDeContacto` vuelve a su versión anterior con la
consulta inline), quitar `serviceNames` de `AppointmentRow`, y en los dos
componentes de React volver a pintar `serviceName` a secas. Nada de esto
toca el esquema ni la reserva real — es una capa de lectura.

### Refinamiento (18-ago, mismo día): el nombre completo seguía sin verse

El arreglo de arriba trajo los nombres completos hasta el componente, pero
`calendario-dia.tsx` seguía cortándolos con `truncate` (una sola línea,
puntos suspensivos) en una columna de 160px — "Semipermanente + Semip…"
en vez de completo. Reportado por el dueño con una captura del calendario
real.

Arreglo: la columna pasa de `w-40` (160px) a `w-48` (192px), y la línea
del nombre del servicio pierde `truncate` a favor de `break-words
leading-snug` (envuelve a varias líneas en vez de cortar). Solo esa
línea — la hora y el nombre de la clienta se quedan en una sola línea,
porque esas sí caben. Seguro porque estas tarjetas ya tienen alto de
sobra: viene de la duración real de la cita, y una visita de dos
servicios dura más, no menos.

No se pudo verificar en un navegador en esta sesión (sin herramienta de
captura disponible): el cambio se razonó contra el modelo de caja exacto
(alto de la tarjeta en píxeles = minutos de duración) y se dejó listo
para que el dueño lo confirme visualmente tras desplegar, como ya viene
haciendo con cada cambio de este documento.

---

## 14 · La cascada de agenda solo comprobaba el servicio principal

**Encontrado al investigar §13, mismo día, no un reporte nuevo.** La
herramienta "pasa las citas de Laura a Camila"
(`reasignarAgenda`/`/appointments` → *Mover el día de una especialista*)
decidía si Camila podía recibir una cita comprobando únicamente
`cita.serviceId` — el principal. Para "Diwpower + Tradicionales" eso
significaba que una reasignación se aprobaría si Camila atendía Diwpower,
**sin comprobar Tradicionales**: a diferencia de §13 (que era solo de
visualización), este SÍ era un riesgo de corrección — una visita se podía
mover a quien no puede hacerla completa.

### Arreglo

- `serviciosDeCitas` (§13) ahora devuelve `{id, name}[]` por cita, no solo
  el nombre — las tres funciones que ya lo usaban (`citasActivasDeContacto`,
  `citasDelDia`, `listAppointments`) se ajustaron a leer `.name`.
- `CitaDeAgenda` gana `serviceIds`/`serviceNames` (todos, no el principal);
  `agendaDelDia` los llena con el mismo helper.
- `reasignarAgenda`: la condición pasa de `atiende.has(cita.serviceId)` a
  exigir que `atiende` cubra **todos** los `serviceIds` de la visita; el
  conflicto nombra específicamente cuáles le faltan a la destinataria
  ("no atiende Tradicionales"), no un genérico.
- `POST /api/appointments/agenda`: el resumen que ve el panel
  (`resumirCita`) y el aviso que recibe la clienta por WhatsApp
  (`avisarACadaClienta`) ahora dicen "Diwpower + Tradicionales", no solo
  "Diwpower" — mismo criterio que §13, la clienta y el equipo deben ver la
  visita completa.

### Pruebas

`tests/unit/cascada-agenda.test.ts`: las tres pruebas existentes se
ajustaron a la consulta extra (`serviciosDeCitas`, ahora siempre en la
cola de respuestas del mock) sin cambiar lo que verifican, y se agregaron
dos casos nuevos — una visita multiservicio que NO se mueve porque a la
destinataria le falta un servicio (y el motivo la nombra), y una que SÍ se
mueve porque la destinataria atiende los dos. **8/8** ✅.

**Gate**: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅
**801 passed, 73 skipped (874)**.

### Cómo revertir

Independiente del resto de este documento: revertir `reasignarAgenda` a
comprobar solo `cita.serviceId`, quitar `serviceIds`/`serviceNames` de
`CitaDeAgenda`, y en `route.ts` volver a `c.serviceName` en `resumirCita`
y `avisarACadaClienta`. El cambio de forma de `serviciosDeCitas` (de
`string[]` a `{id,name}[]`) solo se revierte si nada más lo sigue usando.

---

## 15 · "Ese horario ya está ocupado" — el cierre bloqueaba citas que sí debían caber

**Reportado por el dueño el mismo día**, con capturas: desde el panel
("Nueva cita, por teléfono o en el local") intentó agendar "Press on"
(120 min) con Laura a las 18:30 y salió *"Ese horario ya está ocupado
para todas las que atienden ese servicio"* — con Laura visiblemente libre
toda la tarde en el calendario de al lado.

### El primer diagnóstico fue INCORRECTO — queda anotado, no borrado

La primera pasada de este arreglo (ver el historial de este archivo)
asumió que `close` (18:30) era la hora límite para que un servicio
**terminara**, y que rechazar un servicio de 120 min empezando justo al
cierre era aritmética correcta — el "arreglo" de entonces solo mejoraba
el MENSAJE de error (`ultimaHoraPosible`), sin tocar la regla.

**El dueño corrigió la premisa**: en Lashes Valen (y, por extensión, en
cualquier negocio de este vertical) `close` es la hora límite para
**empezar** una cita, no para terminarla — cualquier servicio, sin
importar su duración, se puede agendar hasta la hora de cierre, y corre
después si hace falta. Es como de verdad trabaja un salón: la última
clienta del día no se corta a la mitad porque el reloj marcó la hora.

`ultimaHoraPosible` y su mensaje en `route.ts` (de la primera pasada) se
**revirtieron por completo** — no tenían sentido una vez corregida la
regla real, y dejarlos habría sido documentación de un diagnóstico
equivocado disfrazada de arreglo.

### El arreglo real: `calcularDisponibilidad` (appointments/logic.ts)

Tres sitios exigían que el servicio TERMINARA antes del cierre; los tres
pasan a exigir solo que EMPIECE antes o al cierre:

```ts
// antes: for (let t = open; t + input.duracionMin <= close; t += 30) ...
for (let t = open; t <= close; t += 30) candidatos.add(t);

// antes: if (c.endMin >= open && c.endMin + input.duracionMin <= close) ...
if (c.endMin >= open && c.endMin <= close) candidatos.add(c.endMin);

// antes: if (slotMin < open || slotMin + input.duracionMin > close) continue;
if (slotMin < open || slotMin > close) continue;
```

Un solo cambio en la función pura arregla los tres consumidores
(`disponibilidadReal`, `disponibilidadRealMultiple`,
`proximasFechasConCupo(Multiple)`) sin tocarlos: exactamente por lo que
esta lógica vive aislada en `appointments/logic.ts`, sin base de datos.

**Lo que NO cambia**: el solape contra citas YA agendadas. Una visita
larga sigue chocando con más horas de otras citas que una corta — eso es
real e independiente de la hora de cierre.

### Pruebas

- `tests/unit/appointments-logic.test.ts`: las dos pruebas que asumían la
  regla vieja se reescribieron para la nueva ("ofrece la grilla completa
  hasta la hora de cierre", "una duración combinada sigue chocando más
  con las citas existentes, pero ya no con el cierre" — con una cita
  existente de por medio para seguir probando que el solape sí importa).
  Las 4 pruebas de `ultimaHoraPosible` se quitaron con la función.
- `tests/integration/citas-motor.test.ts`: "no ofrece un servicio que no
  termina antes de cerrar" se reescribió a "un servicio puede empezar
  justo a la hora de cierre, y corre después si hace falta" —
  agenda un Volumen Ruso (150 min) a las 20:00 (la hora de cierre) y
  comprueba que se acepta y corre hasta las 22:30.

**Gate**: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅
**804 passed, 73 skipped (877)**.

### Cómo revertir

Los tres `<=` de `calcularDisponibilidad` vuelven a `+ input.duracionMin
<=`/`> close`. No toca el esquema ni ninguna cita ya agendada — es
lógica pura de cálculo, sin estado.

---

## 16 · La lista del panel mostraba TODAS las citas, no las del día

**Reportado por el dueño**, con captura: la pestaña "Todas" de la lista
de citas (debajo del calendario, en `/appointments`) mostraba citas de
cualquier fecha mezcladas — encontrar una cita concreta se pone peor
cada día que pasa, con la agenda creciendo sin parar.

**Causa**: `AppointmentsClient` pedía `GET /api/appointments?status=X`
(o sin parámetro para "Todas") — la ruta que llama a `listAppointments`,
tope de 200 filas, más recientes primero, **sin filtrar por fecha**. El
calendario de arriba sí pedía un día concreto (`?fecha=`), pero como
`CalendarioDia` llevaba su propio `useState` interno, la lista de abajo
no tenía forma de saber qué día estaba mirando el calendario.

### Arreglo

En vez de darle a la lista su propio selector de fecha (un segundo
calendario aparte, que podría desincronizarse del primero), se sube el
estado del día del calendario a `AppointmentsClient` — **una sola fuente
de verdad para "qué día se está mirando"**, compartida por las dos vistas:

- `CalendarioDia` deja de tener `dia` como estado interno; lo recibe como
  prop controlada (`dia`, `onDiaChange`) del padre. `hoyBogota()` se
  exporta para que el padre also la use como valor inicial.
- `AppointmentsClient` es dueño de `dia`. La lista pide
  `GET /api/appointments?fecha=${dia}` (la MISMA ruta que ya usaba el
  calendario) y guarda el resultado crudo; el filtro de estado
  ("Pendientes", "Confirmadas"…) pasa a aplicarse **del lado del
  cliente**, sobre esas pocas filas del día — sin ida y vuelta al
  servidor por cambiar de pestaña.
- Cambiar de día en el calendario (‹ › Hoy o el selector de fecha) ahora
  mueve también la lista de abajo, siempre mostrando el mismo día en las
  dos vistas.

De paso, se corrigió una frase que seguía diciendo "el servicio termine
antes de cerrar" en el texto de ayuda de "Cambiar hora" — quedó obsoleta
con el arreglo del §15.

### No verificado visualmente

Igual que el arreglo del calendario en el §13: sin herramienta de
captura de pantalla en esta sesión, este cambio se razonó contra el
flujo de estado de React (props controladas, un solo `useState` para
`dia`) y se verificó con `pnpm typecheck`/`pnpm lint`, no viendo la
página. Pendiente de que el dueño lo confirme visualmente tras
desplegar.

### Pruebas

Sin prueba automática: este proyecto no tiene pruebas de componentes de
React (solo unitarias de lógica de servidor e integración de base de
datos) — mismo criterio que ya aplicaba a `calendario-dia.tsx` en el
§13.

**Gate**: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅
**804 passed, 73 skipped (877)** — sin cambio en el conteo: es una
refactorización de UI, no toca ningún módulo con pruebas.

### Cómo revertir

Independiente del resto: en `calendario-dia.tsx`, devolver `dia` a
`useState(hoyBogota())` interno y quitar las props `dia`/`onDiaChange`;
en `appointments-client.tsx`, quitar el estado `dia` y volver a pedir
`GET /api/appointments?status=X` sin fecha. Ninguno de los dos toca el
servidor ni el esquema — es una capa de presentación.

---

## 17 · El AGENTE (no el backend) seguía rechazando citas a la hora de cierre

**Reportado por el dueño con dos capturas de WhatsApp real**, después de
desplegar el arreglo del §15: el backend ya aceptaba una cita de Press On
a las 18:30 (verificado con un script que llamó a `crearCita` de verdad
contra producción — ver más abajo), pero **el agente de WhatsApp seguía
rechazándola**, inventando una regla que nadie escribió:

> clienta: *"puedi agendar a las 6:30 pm"*
> agente: *"Lo siento, hermosa, el horario de atención para agendar es
> hasta las 6:30 PM. Las citas deben empezar antes de esa hora."*
> clienta: *"a las 6:29?"*
> agente: *"Jajaja, ¡casi! Las citas deben empezar como máximo a las
> 5:30 PM para poder cerrar a las 6:30 PM."*

### Diagnóstico: el modelo se inventó la regla, no la leyó de ningún lado

Se leyó la conversación real directamente de la base de datos
(`conversation` + `message`, filtrando por organización y fecha). Dos
datos la delatan:

1. La clienta **nunca nombró un servicio**, y el agente **nunca llamó
   `consult_availability`** (no hay línea `[SISTEMA]` en la conversación).
   El "5:30 PM" que citó no salió de ningún cálculo real — se lo inventó
   sobre la marcha.
2. Un grep de `src/server/ai/prompts.ts` contra "cerrar", "cierre",
   "empezar antes", "termine antes" no encontró NINGÚN texto que dijera
   esa regla. El modelo no la copió de una instrucción mal escrita: la
   trajo de su propio conocimiento general de cómo "suele" funcionar un
   negocio (agendar servicios que terminen antes del cierre es, en
   efecto, lo más común) — exactamente el mismo tipo de suposición
   razonable-pero-falsa que ya causó el error real del §15, solo que esta
   vez viviendo en la cabeza del modelo, no en el código.

**Lección**: arreglar la lógica del backend (§15) no basta cuando el
modelo trae su propia intuición sobre el negocio. Si la regla real es la
excepción a lo que "cualquier salón" haría, hay que decírselo de forma
explícita — dos veces, en los dos lugares donde el modelo lee o razona
sobre la hora de cierre.

### Arreglo: la regla correcta, en los dos sitios donde el cierre aparece

**1. `CONTRATO_DE_ACCIONES_CITAS`** (`prompts.ts`), nueva regla dura,
justo donde ya viven las demás reglas de citas:

> "El cierre del negocio es la hora límite para EMPEZAR una cita, NO para
> terminarla: cualquier servicio, sin importar cuánto dure, se puede
> agendar hasta la hora exacta de cierre — corre después si hace falta,
> y eso está bien. JAMÁS le digas al cliente que un servicio 'no cabe',
> 'no alcanza a terminar antes de cerrar' o que 'debe empezar antes de
> tal hora para poder cerrar' [...]. La única forma de saber si un
> horario está libre es consult_availability — nunca hagas tú la cuenta
> de la hora de cierre menos la duración del servicio."

**2. `horarioLegible`** (`prompts.ts`), que arma la línea "HORARIO DEL
NEGOCIO" — la primera vez que el modelo lee la hora de cierre en TODO el
prompt, y en este caso concreto la clienta preguntó por el horario ANTES
de llegar a mencionar un servicio. Dejar la regla solo en el contrato de
acciones (más abajo en el prompt) no bastó: el modelo ya se había
formado la idea equivocada al leer "de 9:30 a 18:30" a secas. Ahora
`horarioLegible` recibe un segundo parámetro `citas: boolean` — **derivado
de `Boolean(input.appointments)` en `buildAgentSystemPrompt`, nunca
hardcodeado** (el horario en sí sigue viniendo tal cual de `hours.open`/
`hours.close`, configurados en el CRM — el CRM sigue siendo la única
fuente de verdad, esto solo cambia cómo se EXPLICA ese dato) — y cuando
es `true` añade, pegado a la misma línea:

> "Para CITAS, esa hora de cierre es hasta cuándo se RECIBEN citas (el
> límite para EMPEZARLAS), no la hora en que el servicio debe estar
> terminado: se puede agendar hasta el cierre exacto y el servicio corre
> después si hace falta."

Es una capacidad genérica del vertical (categoría 2): ningún número de
Lashes Valen quedó escrito en el prompt, cualquier negocio de citas con
cualquier horario configurado en el CRM recibe la misma aclaración,
construida a partir de SU propio `hours.close`.

**De paso**, esta misma reescritura de `horarioLegible` responde al pedido
del dueño de que el agente explique el horario como "abrimos a las 9:30,
recibimos citas hasta las 6:30 pm" en vez de sonar a un cierre total: la
frase nueva enmarca el cierre como límite de recepción de citas, no como
un apagón del negocio — sin escribir esos números en ningún lado del
código, siguen viniendo del horario real configurado para cada cliente.

### Verificación del backend, aparte del prompt (previa a este arreglo)

Antes de tocar el prompt se comprobó, con un script desechable que
importó la función `crearCita` REAL y la corrió contra producción, que el
backend sí acepta una cita de Press On (120 min) con Laura a las 18:30 —
se creó la cita (`apt_hfy9nj4cusb9ffesbsji`, 120 minutos confirmados) y
se canceló de inmediato en el mismo script. Esto descartó el backend como
causa antes de mirar el prompt, y confirma que el arreglo del §15 sí
quedó bien desplegado — el bug reportado en este §17 es exclusivamente de
cómo razona el modelo, no de disponibilidad real.

### Pruebas

Sin cobertura automática posible: es texto de prompt que cambia el
razonamiento de un modelo de lenguaje, no lógica determinista. Este
proyecto no tiene "pruebas de alucinación" para casos puntuales fuera del
Laboratorio de escenarios — queda pendiente para el dueño confirmar en
WhatsApp real tras desplegar, igual que con cualquier ajuste de prompt.

**Gate**: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm test` ✅
**804 passed, 73 skipped (877)** — sin cambio en el conteo: es texto,
ninguna prueba lo ejercita.

### Cómo revertir

Quitar la regla nueva de `CONTRATO_DE_ACCIONES_CITAS` y devolver
`horarioLegible`/`estadoDelNegocio` a su firma de un solo parámetro
(`hours`) sin `citas`. No toca esquema, no toca ninguna cita agendada —
es texto de prompt puro.
