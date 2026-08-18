# Paso 4: recursos y reservas, implementado

> **Dentro:** Objetivo · Archivos modificados · Las cinco correcciones a la
> premisa · La decisión de esquema · La migración · El mapa de refactor · Lo
> que NO cambió, y por qué · Las pruebas · Resultado del gate · Riesgos y lo
> que queda pendiente · Cómo revertir

**18-ago-2026.** Implementación completa del paso 4 auditado el 17-ago en
[83-RECURSOS-Y-RESERVAS.md](83-RECURSOS-Y-RESERVAS.md): un profesional deja
de ser el único tipo de recurso posible en el esquema. Motivado por
`REGLAS-DE-ARQUITECTURA.md` (raíz del repo, 18-ago): *"los profesionales
pertenecen al sistema de recursos y reservas"*, no a una tabla especial
hardcodeada.

---

## 1 · Objetivo

Que Lashes Valen (`org_novxv78s08h12arzatr2`) — 17 citas, 5 profesionales, 45
servicios, con citas confirmadas el mismo día en que se hizo este cambio —
quede modelada sobre conceptos genéricos del núcleo (recurso, reserva), no
sobre "profesional" hardcodeado. El dueño pidió los tres sub-pasos (4a, 4b,
4c… menos 4c, ver §9) el mismo día, incluida la migración, aceptando el
riesgo y comprometiéndose a un respaldo manual verificado antes de
desplegar.

**Trabajo local únicamente**: código + migración escrita y gateada. Las
migraciones de `drizzle/` solo se aplican al arrancar el contenedor, y el
despliegue lo hace el dueño en EasyPanel — nunca el asistente. En ningún
momento de este trabajo se tocó la base de producción ni se ejecutó
`pnpm db:migrate`.

---

## 2 · Archivos modificados

| Archivo | Qué |
|---|---|
| `src/server/appointments/logic.ts` | `calcularDisponibilidad`: `staffIds`→`recursoIds`, `CitaDelDia.staffId`→`recursoId` (4a, función pura) |
| `src/lib/db/schema.ts` | `staffMember`→`resource` (+`type`), `staffService`→`resourceService`, `appointment` pierde `staffId`, tabla nueva `appointmentResource` |
| `src/lib/db/ids.ts` | Prefijos: quita `staffMember`/`staffService`, añade `resource`(`rsc`)/`resourceService`(`rsv`)/`appointmentResource`(`aptr`) |
| `src/server/appointments/queries.ts` | 31 funciones auditadas; 12 tocadas (ver §5). Firmas públicas sin cambios |
| `drizzle/0024_recursos_y_reservas.sql` | La migración — escrita, no ejecutada |
| `drizzle/meta/_journal.json` | Entrada `idx: 24` |
| `tests/unit/appointments-logic.test.ts` | Rename mecánico en el bloque de `calcularDisponibilidad` |
| `tests/unit/cascada-agenda.test.ts` | Un `expect` — `staffId`→`resourceId` en lo que actualiza `reasignarAgenda` |
| `tests/integration/citas-motor.test.ts` | Siembra actualizada + prueba nueva del EXCLUDE directo |
| `scripts/probar-estado.ts` | Bloque B (citas): mismo rename, sin gate automático (ver §3.2) |

**No tocado, verificado explícitamente**: `src/server/ai/pipeline.ts`, las 6
rutas de `/api/appointments/*` y `/api/staff/*`, los 6 componentes de React
que las consumen, `tests/unit/pipeline-appointments-dispatch.test.ts`,
`src/server/registro-de-cambios.ts`.

---

## 3 · Cinco correcciones a la premisa, encontradas al auditar

1. `queries.ts` tiene 31 funciones exportadas, no 30 como se asumió al
   empezar.
2. **`scripts/` está fuera de `tsconfig.json` y de `eslint.config.mjs`.** El
   gate de hoy (`typecheck`+`lint`+`test`) **no verifica**
   `scripts/probar-estado.ts` — se corrigió a mano, sin red automática. Deuda
   viva ya anotada en [93](93-PENDIENTES-17AGO.md) desde el 17-ago.
3. **`registro-de-cambios.ts` no clasificaba, y sigue sin clasificar**,
   `appointment`/`staff_member`/`staff_service`/`service`: verificado que
   solo `agent_profile` y `product_option_group` llaman a `conRegistro`. El
   vertical de citas nunca se instrumentó — `resource`/`appointment_resource`
   heredan ese mismo estado, sin regresión. Cablearlo es trabajo aparte.
4. El SQL de ejemplo del doc 83 usaba nombres en español
   (`recurso_id`/`inicio`/`fin`); las 31 tablas de `schema.ts` están en
   inglés sin excepción — se usó `resource_id`/`starts_at`/`ends_at`.
5. **`reasignarAgenda` no tenía `try/catch` sobre su `UPDATE`**, a
   diferencia de `crearCita`. Hueco preexistente, no introducido hoy;
   corregido de paso porque se tocaba esa línea de todos modos (§5).

---

## 4 · La decisión de esquema

| Antes | Después | Cómo |
|---|---|---|
| `staff_member` | `resource` (+`type` text, `DEFAULT 'persona'`, sin enum) | `RENAME` atómico — 5 filas, sin copiar datos |
| `staff_service` | `resource_service` (`staff_id`→`resource_id`) | `RENAME` atómico — 111 filas |
| — | `appointment_resource` | `CREATE TABLE` + `INSERT...SELECT` desde las 17 citas vivas |
| `appointment.staff_id` | retirada | migrada a `appointment_resource`, luego `DROP COLUMN` |

No se añadió `activo` (el proyecto ya usa `archivedAt` nullable en las 31
tablas, incluida esta) ni `horario` por recurso (es el 4c, aditivo, dejado
para cuando haga falta — mezclarlo aquí violaba "no generalices sin
necesidad" de `REGLAS-DE-ARQUITECTURA.md`).

### El problema del EXCLUDE constraint

Un `EXCLUDE USING gist` de Postgres solo puede referenciar columnas de su
propia tabla. `appointment_resource` **duplica** `starts_at`/`ends_at`/`status`
de `appointment` porque el chequeo de solape vive ahí, no en `appointment`. Un
**TRIGGER** (`sincronizar_appointment_resource`, `AFTER UPDATE` en
`appointment`) los mantiene sincronizados — el primer trigger de este
proyecto, justificado por la misma razón que ya justificó el EXCLUDE
original de la 0018: no puede depender de que nadie se acuerde de tocar las
dos tablas. Con él, `reprogramarCita`/`cancelarCita`/`updateAppointmentStatus`/
`liberarAgenda` no cambiaron ni una línea de SQL.

**Verificado, no supuesto**: leído `pg-core/dialect.js` del paquete
`drizzle-orm@0.38.4` instalado — el método `migrate` envuelve TODAS las
sentencias de TODOS los archivos de migración pendientes en una única
`session.transaction()`. Si el nuevo `EXCLUDE` fallara al crearse, la
transacción entera se revierte y el viejo (sobre `staff_id`) sigue intacto,
porque se crea el nuevo antes de retirar el viejo. También se verificó que el
separador de sentencias es el marcador literal `--> statement-breakpoint`
(no el punto y coma), así que el cuerpo `$$...$$` del trigger no se parte
mal.

---

## 5 · Mapa de refactor de `queries.ts`

Decisión central: **las firmas públicas no cambian** (nombres de función,
parámetros como `staffId`/`staffIdPreferido`, formas de retorno como
`staffName`). Solo cambian los cuerpos. Verificado que ni `pipeline.ts`, ni
las rutas, ni los componentes importan `schema.staffMember` directamente —
todos consumen la interfaz pública de `queries.ts`.

- **Sin cambios (15)**: `appointmentsEnabledFor`, `listServices`,
  `createService`, `updateService`, `registrarOfrecidos`,
  `ofrecidosDeConversacion`, `estaEntreLosOfrecidos`, `limpiarOfrecidos`,
  `horarioDeLaOrganizacion`, `marcarCitaRecordada`, `proximasFechasConCupo`,
  `reprogramarCita`, `cancelarCita`, `updateAppointmentStatus`,
  `liberarAgenda`.
- **Cambia la tabla, mismo patrón (9)**: `listStaff`,
  `listStaffServiceLinks`, `setEspecialistasDeServicio`, `createStaff`,
  `updateStaff`, `catalogoParaPrompt`, `resolverEspecialista`,
  `staffIdsForService`, `staffIdsDeLaOrg`. Se añadió
  `eq(schema.resource.type, "persona")` en cada lectura — no-op hoy, real el
  día que exista otro tipo de recurso.
- **Un join más (6)**: `citasActivasDeContacto`, `listAppointments`,
  `getCitaParaRecordar`, `citasDelDia`, `agendaDelDia`, `moverCita`. El join
  directo a `staffMember` pasa por `appointmentResource`→`resource`.
- **Cambio de lógica real (3)**: `crearCita` (envuelta en `db.transaction()`;
  inserta `appointment` y `appointment_resource` juntos), `disponibilidadReal`
  (deja de leer `appointment`, lee `appointment_resource` directo — sin
  joins, más simple que antes), `reasignarAgenda`+`haySolapamiento` (el
  `UPDATE` pasa a `appointmentResource.resourceId`, con el `try/catch`
  añadido).

**Efecto secundario anotado, no oculto**: `appointment.updatedAt` deja de
moverse cuando `reasignarAgenda` reasigna (esa escritura ahora solo toca
`appointment_resource`, que no tiene `updatedAt`). Nada ordena por ese campo
en citas — sin efecto observable.

---

## 6 · Lo que NO cambió, y por qué

`pipeline.ts` (4 usos de `staffId`) y las 6 rutas de `/api/appointments/*` y
`/api/staff/*` **no se tocaron**. `REGLAS-DE-ARQUITECTURA.md` separa *qué
representa el dato* (genérico — ya lo es) de *cómo se llama de cara al
negocio* (puede seguir siendo "profesional"/"staff": vocabulario del
vertical de citas, igual que `product`/`service` lo son de los suyos).
Renombrar rutas o campos del JSON hoy habría sido "generalizar sin
necesidad" y roto los 6 componentes de React sin ganar nada arquitectónico.

---

## 7 · Pruebas

- `tests/unit/appointments-logic.test.ts` — 32/32 ✅, corrida aislada antes
  de tocar nada más (el 4a puro).
- `tests/unit/cascada-agenda.test.ts` — 6/6 ✅.
- `tests/unit/pipeline-appointments-dispatch.test.ts` — 4/4 ✅, **sin tocar
  una línea**: confirma que el mock por nombre de función seguía siendo
  válido.
- `tests/integration/citas-motor.test.ts` — siembra actualizada (`resource`
  con `type:"persona"`, `resourceService`). **Prueba nueva**: inserta un
  segundo `appointment_resource` solapado de forma directa (sin pasar por
  `crearCita`) y espera `code: "23P01"` — prueba la restricción de la base
  de forma independiente del código de aplicación, complementando la prueba
  existente de "dos peticiones simultáneas".
- `scripts/probar-estado.ts` (Bloque B) — actualizado; **sin verificación
  automática** (fuera de `tsconfig`/`eslint`, corrección §3.2).

### ⚠️ `citas-motor.test.ts` completa sigue SIN ejecutarse

Se salta sola sin `TEST_DATABASE_URL`: no hay Docker ni base desechable en
esta máquina, solo el túnel SSH a producción — mismo caso ya documentado el
17-ago en [94](94-BITACORA-PERMITE-REPETICION-CRM.md). Queda **escrita y
revisada, no ejecutada**. Para correrla: una base desechable (receta en
[34-COLA-DE-TURNOS.md](34-COLA-DE-TURNOS.md)) y
`TEST_DATABASE_URL=postgres://…base-desechable… pnpm test`.

---

## 8 · Resultado del gate

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | ✅ limpio en todo el árbol |
| `pnpm lint` | ✅ limpio |
| `pnpm test` | ✅ **782 passed, 67 skipped (849)** — una prueba más saltada que antes de hoy: la nueva del EXCLUDE, correctamente reconocida y saltada sin `TEST_DATABASE_URL` |

La migración `.sql` **no se ejecutó**: revisada a mano, statement por
statement, contra `schema.ts` y contra el estilo real de
`drizzle/0009_premium_mauler.sql` (donde nació `staff_member`) y
`drizzle/0018_citas_sin_solape.sql` (donde nació el `EXCLUDE` que aquí se
mueve). No hay forma de correr `pnpm db:migrate` en esta máquina hoy.

---

## 9 · Riesgos y lo que queda pendiente

| | Qué |
|---|---|
| 🔴 | **La migración no se ha ejecutado contra ninguna base**, ni de pruebas ni de producción. La revisión es manual. Antes de desplegar: **respaldo manual verificado**, no el automático de 6h (compromiso ya asumido por el dueño) |
| 🟠 | **`citas-motor.test.ts` sin ejecutar** — incluida la prueba nueva del EXCLUDE. Es la única verificación real de que la restricción movida funciona contra Postgres de verdad |
| 🟠 | **`scripts/probar-estado.ts` fuera del gate** — su corrección de hoy no tiene red automática |
| 🟠 | **`registro-de-cambios.ts` sigue sin clasificar el vertical de citas** — deuda heredada, no nueva |
| ⬜ | **4c (horario por recurso) no se implementó** — quedó fuera a propósito, es aditivo y sin caso de uso hoy |
| 🟢 | **`pipeline.ts` y las rutas API no necesitaron ningún cambio** — confirma que el vertical de citas ya estaba bien separado del núcleo desde antes |

---

## 10 · Cómo revertir

**Antes de desplegar**: `git revert` del commit (o borrar/deshacer los
archivos de §2). La base no se toca — nada de esto se ejecutó contra
producción.

**Si hiciera falta revertir después de desplegar**, sin migración de bajada
automática (no hay base de pruebas para generarla):

1. Re-añadir `appointment.staff_id`.
2. Poblarlo: `resource_id` de la fila de `appointment_resource` de esa cita
   — válido mientras cada cita tenga como máximo un recurso, cierto hoy.
3. Re-crear el `EXCLUDE`/FK/índice viejos sobre `appointment`.
4. Borrar el trigger, la función `sincronizar_appointment_resource` y la
   tabla `appointment_resource`.
5. Renombrar `resource`→`staff_member` y `resource_service`→`staff_service`
   de vuelta.

El respaldo manual verificado que hará el dueño antes de desplegar sigue
siendo la defensa principal; esto es el plan B si hiciera falta revertir sin
restaurar el respaldo completo.
