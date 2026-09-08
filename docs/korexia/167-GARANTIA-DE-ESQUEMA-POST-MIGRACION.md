# 167 — Garantía de esquema: "migrate() no lanzó" deja de ser suficiente

8-sep-2026. Fase 6I. Cierra el hueco real del pipeline que permitió el
incidente del doc 166: un contenedor podía quedar `healthy`, sirviendo el
commit correcto, sin que el esquema real tuviera lo que ese código
necesitaba.

## 1. Qué se protege

La causa raíz exacta del doc 166: el migrador de Drizzle puede saltar una
migración en silencio (sin lanzar ninguna excepción) si su `"when"` queda
por debajo del `created_at` de la última fila ya aplicada en
`__drizzle_migrations`. `migrate.mjs` solo capturaba excepciones — no tenía
forma de distinguir "no había nada que aplicar" de "se saltó algo que sí
hacía falta".

## 2. Mecanismo elegido

Extensión mínima del mecanismo que **ya existe y ya bloquea**: `migrate.mjs`
corre al arranque del contenedor, antes de `server.js` (`Dockerfile` CMD:
`node migrate.mjs && node server.js`). Se agrega, después de que `migrate()`
termina sin lanzar, una verificación adicional: **¿el esquema real de
Postgres tiene, ahora mismo, cada tabla y cada columna que `schema.ts`
declara?** Si falta algo, `migrate.mjs` sale con código distinto de cero.

No se creó ningún servicio nuevo, ninguna segunda base de datos, ningún
paso nuevo en el pipeline de CI/CD. La cadena de protección ya construida en
las Fases 3A-3M (`start-first` + `FailureAction: pause` de Docker Swarm,
verificado en el doc 164) queda intacta y ahora recibe una señal correcta:
si `migrate.mjs` sale con error, `server.js` nunca arranca, el healthcheck
nunca pasa, y Swarm pausa la actualización dejando el contenedor VIEJO
sirviendo — exactamente lo que debió pasar anoche y no pasó, porque
`migrate.mjs` mentía sin saberlo.

## 3. De dónde sale la lista de "lo que el código espera" — sin lista a mano

`src/server/ai/pipeline.ts` ya importa `schema.ts` para todo; `migrate.mjs`
ahora importa un módulo nuevo y pequeño,
`src/server/ops/schema-readiness.ts`, que usa la propia introspección de
Drizzle (`getTableConfig`, `is(valor, PgTable)` — verificadas contra el
código real de `drizzle-orm@0.38.4` instalado, no por memoria) para
enumerar, en tiempo de ejecución, cada tabla y cada columna que `schema.ts`
declara. Si mañana se agrega una tabla nueva a `schema.ts`, esta
verificación la incluye automáticamente — no hay una lista de columnas que
alguien tenga que recordar mantener.

```ts
export function columnasEsperadasPorElCodigo(): ColumnaEsperada[] {
  const tablas = (Object.values(schema) as unknown[]).filter((v) => is(v, PgTable));
  // getTableConfig(tabla).name / .columns[].name — nombres físicos reales
}
```

La comparación en sí (`columnasFaltantes`) es una función pura, sin I/O —
recibe "lo esperado" y "lo que existe realmente" (una sola consulta a
`information_schema.columns`, no una por tabla) y devuelve lo que falta.
Deliberadamente **no** reporta columnas de más: una base con columnas que
el código todavía no conoce es compatibilidad hacia atrás normal, no un
error (Caso 6 de las pruebas).

## 4. Los tres casos que el mecanismo distingue

| Caso | `migrate()` | Verificación de esquema | Resultado |
|---|---|---|---|
| A — migraciones realmente ejecutadas | aplica SQL nuevo | pasa (ya está completo) | `exit 0` |
| B — no había nada pendiente | no hace nada | pasa (ya estaba completo) | `exit 0` |
| C — el migrador omitió algo que el código necesita | no hace nada (bug de timestamp) | **detecta lo que falta** | `exit 1` |

El Caso C ya NO puede terminar en `exit 0` — es exactamente la garantía
pedida.

## 5. Por qué no una verificación PRE-deploy

Se evaluó (Parte 4 del encargo) si el propio `scripts/deploy.sh`/el
workflow de GitHub Actions podían detectar, antes de construir la imagen,
que el commit objetivo requiere migraciones que producción todavía no
tiene. Requeriría darle al runner de CI (o al usuario `deploy`, sin acceso
a la base hoy por diseño — Fase 3A) credenciales de solo lectura contra la
base de producción: un secreto nuevo, una superficie de acceso nueva, y una
segunda implementación —en el cliente— de la MISMA lógica de "qué está
aplicado" que ya vive en Drizzle, con el riesgo real de que ambas
implementaciones diverjan (el mismo tipo de problema que causó este
incidente, solo que en un lugar distinto). La verificación post-migración,
dentro del propio contenedor, logra el mismo resultado (un deploy con
esquema incompatible nunca llega a servir tráfico) sin ninguna de esas dos
desventajas — se prioriza esta, tal como pedía el encargo si la opción
pre-deploy no era simple.

## 6. Cambios

- `src/server/ops/schema-readiness.ts` (nuevo) — introspección + comparación pura.
- `scripts/migrate.mjs` — llama la verificación tras `migrate()`, antes de dar el turno por bueno.
- `Dockerfile` — el bundle de `migrate.mjs` ahora se construye con `--alias:@=./src` (ya lo tenía `seed-demo.bundle.mjs`; hacía falta para poder importar el módulo nuevo).
- `tests/unit/schema-readiness.test.ts` (nuevo, 7 pruebas) — la lógica pura de comparación, con datos inventados.

Ningún archivo de negocio tocado. Ninguna migración SQL tocada.

## 7. Pruebas

**Unitarias** (`tests/unit/schema-readiness.test.ts`, sin base de datos):
escenarios 1 (esquema correcto), 4 (tabla ausente), 5 (columna ausente), 6
(esquema ampliado con código viejo) — los 4 cubiertos con datos inventados,
más una prueba de que la introspección real sobre `schema.ts` sí encuentra
las 3 piezas del incidente (`agent_job.generation`,
`conversation_state.version`, `appointment_booking_confirmation`) sin
haberlas escrito a mano en el test.

**Integración real** (Postgres real, mismo `drizzle-orm@0.38.4` de
producción, el `migrate.mjs` real construido con el `Dockerfile` real —
base de prueba `test_6i`, creada y eliminada en el mismo servidor,
`vocero` nunca tocada):

1. Se estableció el estado base exacto de anoche (`0041` aplicada, `38-40`
   inexistentes) — confirmado idéntico al incidente real.
2. **Escenario 3 (el incidente, reproducido con los timestamps ORIGINALES
   rotos)**: `migrate()` volvió a saltar `38/39/40` en silencio — el mismo
   bug de Drizzle, sin tocar — pero esta vez la verificación nueva lo
   detectó: `[migrate] ESQUEMA INCOMPLETO... No se arranca el servidor.`,
   listando las 14 columnas/tabla faltantes, `exit 1`. Con esto en el
   `Dockerfile` de anoche, el contenedor nuevo nunca habría llegado a
   `healthy` y el viejo habría seguido sirviendo.
3. **Escenario 2 (timestamps corregidos, migración pendiente)**: las tres
   migraciones se aplicaron de verdad, la verificación pasó limpia:
   `[migrate] migraciones aplicadas — esquema verificado (438 columnas OK)`,
   `exit 0`.
4. **Caso B (re-ejecutar sin nada pendiente)**: mismo resultado limpio,
   `exit 0` — idempotente.

Esquema final verificado con `\d`/`\dt` directos: `agent_job.generation`,
`conversation_state.version` y `appointment_booking_confirmation` (12
columnas) presentes y correctos.

## 8. Qué NO se hizo

- No se implementó la verificación pre-deploy (sección 5, justificado).
- No se tocó `2fade3a` ni se reintentó su deploy.
- No se aplicó nada contra la base `vocero` real en ningún momento.
- No se creó ningún microservicio ni segunda base de datos permanente — la
  base de prueba fue temporal y se eliminó al terminar.

## 9. Estado de producción al cierre

```
docker ps --filter name=korex-crm_crm: Up, healthy
/api/health: {"ok":true,"commit":"007002b716f7cde17196c315f833bda71ea222e9"}
```

Sin interrupciones. Ningún deploy nuevo se ha ejecutado todavía.

## 10. Rollback

```bash
git checkout -- scripts/migrate.mjs Dockerfile
git rm src/server/ops/schema-readiness.ts tests/unit/schema-readiness.test.ts
```

Revierte al comportamiento de antes de esta fase (sin la verificación
post-migración) — no se recomienda, deja reabierto el hueco que causó el
incidente del doc 166.
