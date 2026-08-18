# Selección múltiple en citas: una reserva con varios servicios, implementado

> **Dentro:** Objetivo · Archivos modificados · Dónde vive la reserva · El
> desacople deliberado (estado vs. acción real) · La migración · El mapa de
> refactor · Lo que NO cambió, y por qué · Las pruebas · Resultado del gate ·
> Riesgos y lo que queda pendiente · Cómo revertir · §12 Ajustes tras la
> auditoría (18-ago, mismo día) · §13 El calendario solo mostraba el
> servicio principal (18-ago, primer cliente real) · §14 La cascada de
> agenda solo comprobaba el servicio principal

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
