# 166 — Migraciones `0038-0040` saltadas en silencio: timestamp invertido contra `0041`

8-sep-2026. Incidente real de producción durante el primer deploy del
"Programa de mejora integral" (commit `2fade3a`), diagnosticado con
evidencia directa y corregido antes de reintentar el deploy.

## 1. Incidente

El workflow reportó `success`, `/api/health` reportó el commit correcto
(`2fade3a`), pero el worker de la cola empezó a fallar en bucle
inmediatamente:

```
[worker] no se pudo leer la cola: column agent_job.generation does not exist
[worker] rescate de huérfanos falló: column agent_job.generation does not exist
[worker] reintento de avisos de cita falló: relation "appointment_booking_confirmation" does not exist
```

**El agente dejó de procesar mensajes de WhatsApp de todos los clientes.**
Rollback inmediato a `007002b716f7cde17196c315f833bda71ea222e9` (el commit
estable anterior), confirmado exitoso: cola funcionando de nuevo sin
ningún error.

## 2. Causa raíz

Verificado leyendo el código **real** de `drizzle-orm@0.38.4`, tal como
está empaquetado dentro de la propia imagen que se desplegó (extraído del
contenedor detenido con `docker cp`, no una copia local ni una suposición).
`PgDialect.migrate()` (`drizzle-orm/pg-core/dialect.js`) decide qué
migraciones aplicar así:

```js
const dbMigrations = await session.all(
  sql`select id, hash, created_at from drizzle.__drizzle_migrations
      order by created_at desc limit 1`   // SOLO la más reciente
);
const lastDbMigration = dbMigrations[0];
for (const migration of migrations) {
  if (!lastDbMigration || lastDbMigration.created_at < migration.folderMillis) {
    // ejecuta el SQL + inserta la fila de control
  }
  // si no: la salta EN SILENCIO — sin log, sin error
}
```

**No compara cada migración contra el conjunto de hashes ya aplicados.**
Compara únicamente el `"when"` (`folderMillis`, de `meta/_journal.json`) de
cada migración contra el `created_at` de la **única fila más reciente** de
`__drizzle_migrations`.

La migración `0041` (`entrega_confiable_de_avisos`, commit `9b1f377`) se
escribió y se desplegó a producción **antes** de que `0038`/`0039`/`0040`
existieran como archivos comiteados — pero su `"when"` (`1789400000000`)
era **mayor** que el de las tres migraciones nuevas (`1789100000000` /
`1789200000000` / `1789300000000`), porque esos valores se escribieron a
mano (incrementos redondos de exactamente 100.000.000 ms) en vez de
generarse con `drizzle-kit generate` (que usa `Date.now()` real). Cuando
`migrate.mjs` corrió esta noche, comparó `0038/39/40` contra la fila de
`0041` (ya la más reciente en la tabla) — como sus `"when"` eran menores,
las tres se saltaron sin ejecutar ni una sola sentencia SQL.

## 3. Por qué reportó éxito

`migrate.mjs` solo captura si `migrate()` **lanza** una excepción. Saltar
una migración por timestamp menor **no es un error para Drizzle — es el
comportamiento esperado del algoritmo** (asume que los `"when"` siempre
reflejan el orden real de generación). `migrate()` resolvió sin lanzar
nada; `[migrate] migraciones aplicadas]` se imprimió exactamente igual que
en un despliegue exitoso de verdad. Nada en el pipeline de CI/CD verifica,
después del arranque, que el esquema real coincide con lo que el código
nuevo necesita — mismo patrón que "healthy no es suficiente" (incidentes de
código del 1-ago/5-ago), ahora en la superficie del esquema.

**Autocrítica**: en las Fases 6A/6B/6D de esta misma sesión se afirmó
"migraciones coherentes" verificando solo la correspondencia de columnas
contra `schema.ts` — nunca se verificó el comportamiento real del algoritmo
de aplicación contra el estado real de producción antes de autorizar el
deploy. Verificación insuficiente, corregida en esta fase con una prueba
aislada real.

## 4. Corrección

Únicos tres valores modificados en `drizzle/meta/_journal.json`:

| Migración | `when` anterior | `when` corregido |
|---|---|---|
| `0038_generacion_de_agent_job` | `1789100000000` | `1789500000000` |
| `0039_version_de_conversation_state` | `1789200000000` | `1789600000000` |
| `0040_idempotencia_book_appointment` | `1789300000000` | `1789700000000` |
| `0041_entrega_confiable_de_avisos` (sin tocar) | `1789400000000` | `1789400000000` |

Condición resultante: `when(0041) < when(0038) < when(0039) < when(0040)` —
la migración ya aplicada en producción queda con el `"when"` más bajo del
grupo, así que el algoritmo de "solo la más reciente" ya no la confunde con
"todavía no llegamos ahí". Se verificó además, programáticamente, que
ningún otro par de migraciones del journal completo (42 entradas) quedó con
el orden invertido por este cambio — el único caso de `when` decreciente
entre entradas consecutivas es, deliberadamente, `0040 → 0041` (el punto
exacto de la corrección).

## 5. Prueba aislada (Postgres real, mismo Drizzle que producción)

Sin tocar la base `vocero` en ningún momento. Base temporal
`test_migracion_6g`, creada y eliminada en el mismo Postgres de producción
(aislada por nombre de base, no por instancia — la instancia ya está
compartida y no hay otra disponible), usando el `migrate.mjs` **extraído
directamente de la imagen `2fade3a` ya construida** (mismo bundle
esbuild, mismo `drizzle-orm@0.38.4`), corrido dentro de un contenedor
`node:22-alpine` efímero conectado a la red `korex-crm_default`.

**Paso 1 — reproducir el estado real anterior al incidente**: journal con
las 39 migraciones `0000-0037` + `0041` (sin `0038/39/40`, que en ese
momento de la historia real todavía no existían). Resultado, verificado:

```
agent_job.generation            → no existe
conversation_state.version      → no existe
appointment_booking_confirmation → no existe
order_confirmation.notify_status → SÍ existe (de 0041)
__drizzle_migrations: última fila created_at = 1789400000000
```

Coincide exactamente con lo encontrado en producción real — confirma que la
réplica es fiel.

**Paso 2 — aplicar el journal completo corregido** (42 entradas, con los
`when` de la sección 4) contra la MISMA base, sin recrearla. Resultado:

```
agent_job.generation             → integer, default 0, not null   ✅
conversation_state.version       → integer, default 0, not null   ✅
appointment_booking_confirmation → tabla completa, 12 columnas,
                                    FKs e índices correctos         ✅

__drizzle_migrations, filas con created_at >= 1789400000000:
 id=39  hash=6abe4e2a...(=0041, SIN cambiar)   created_at=1789400000000
 id=40  hash=c0400d69...(=0038)                created_at=1789500000000
 id=41  hash=d2d63404...(=0039)                created_at=1789600000000
 id=42  hash=9464bd1e...(=0040)                created_at=1789700000000

Total de filas: 39 → 42  (+3, ni una repetida)
```

`0041` conserva su fila original (`id=39`, mismo hash, mismo `created_at`)
— el migrador no la volvió a tocar. `0038`/`0039`/`0040` se aplicaron con
sus SQL reales, cada una con su propia fila nueva. Base de prueba eliminada
al terminar (`DROP DATABASE test_migracion_6g`).

## 6. Qué NO se hizo

- No se aplicó nada contra `vocero` (la base real).
- No se modificó `migrate.mjs`.
- No se implementó todavía el guard de esquema post-deploy propuesto en el
  doc de la Fase 6F (queda como mejora futura, fuera de este alcance).
- No se tocaron los archivos SQL de las migraciones — solo sus timestamps
  declarados en `meta/_journal.json`.

## 7. Riesgo que queda abierto, documentado a propósito

El mecanismo de Drizzle usado aquí (`solo compara contra la última fila`)
es sensible a que **todo `"when"` futuro se genere con `drizzle-kit
generate`**, nunca a mano. Mientras eso no se automatice o se verifique en
CI, el mismo error de fondo (asignar un timestamp menor a una migración que
se comiteará/desplegará después de otra ya aplicada) puede repetirse. La
corrección estructural (verificación pre-deploy contra el estado real de
`__drizzle_migrations`) sigue pendiente, tal como se dejó anotado en la
Fase 6F.

## 8. Estado de producción al cierre

```
docker ps --filter name=korex-crm_crm: Up, healthy
/api/health: {"ok":true,"commit":"007002b716f7cde17196c315f833bda71ea222e9"}
```

Sin interrupciones desde el rollback. Ningún deploy nuevo se ha ejecutado
todavía con la corrección de esta fase.

## 9. Rollback de esta corrección

```bash
git checkout -- drizzle/meta/_journal.json
```

Antes de comitear, es un cambio local únicamente — revertirlo es descartar
el archivo modificado.
