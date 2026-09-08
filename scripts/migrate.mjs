/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 *
 * Fase 6I (8-sep-2026, doc 166/167) — incidente real: `migrate()` puede
 * terminar SIN lanzar ninguna excepción aunque no haya aplicado una
 * migración que el código de este build necesita (Drizzle solo compara
 * contra la fila más reciente de `__drizzle_migrations`; un `"when"`
 * invertido la salta en silencio). "migrate() no lanzó" dejó de ser
 * suficiente evidencia de "el esquema está listo". Tras cada intento
 * exitoso de `migrate()`, se verifica el esquema REAL contra lo que
 * `schema.ts` declara (`verificarEsquemaListo`, derivado por introspección
 * de Drizzle — nunca una lista a mano). Si falta algo, este proceso sale
 * con código distinto de cero: el `CMD` del Dockerfile (`migrate.mjs &&
 * server.js`) nunca llega a arrancar `server.js`, el healthcheck del
 * contenedor nunca pasa, y la política de Swarm ya verificada
 * (`start-first` + `FailureAction: pause`, doc 164) deja el contenedor
 * VIEJO sirviendo tráfico en vez de completar el despliegue con un esquema
 * incompleto.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  claveDeColumna,
  columnasEsperadasPorElCodigo,
  columnasFaltantes,
} from "@/server/ops/schema-readiness";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

/**
 * UNA sola consulta trae todas las columnas reales del esquema `public` —
 * mucho más barato que una consulta por tabla, y evita N+1 en un esquema
 * con decenas de tablas.
 */
async function verificarEsquemaListo(sql) {
  const filas = await sql`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
  `;
  const existentesReales = new Set(
    filas.map((f) => claveDeColumna({ tabla: f.table_name, columna: f.column_name }))
  );
  const esperadas = columnasEsperadasPorElCodigo();
  return { faltantes: columnasFaltantes(esperadas, existentesReales), totalEsperadas: esperadas.length };
}

const maxAttempts = 15;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder });

    const { faltantes, totalEsperadas } = await verificarEsquemaListo(sql);
    if (faltantes.length > 0) {
      console.error(
        `[migrate] ESQUEMA INCOMPLETO tras migrar: faltan ${faltantes.length} de ${totalEsperadas} columnas que el código de este build necesita. ` +
          `migrate() no lanzó ningún error (posible timestamp invertido en meta/_journal.json — ver docs/korexia/166) pero el esquema real no coincide. ` +
          `No se arranca el servidor.`
      );
      for (const f of faltantes.slice(0, 30)) {
        console.error(`  - ${f.tabla}.${f.columna}`);
      }
      if (faltantes.length > 30) {
        console.error(`  ... y ${faltantes.length - 30} más`);
      }
      await sql.end().catch(() => {});
      process.exit(1);
    }

    console.log(`[migrate] migraciones aplicadas — esquema verificado (${totalEsperadas} columnas OK)`);
    await sql.end();
    process.exit(0);
  } catch (err) {
    await sql.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error("[migrate] falló tras varios intentos:", err);
      process.exit(1);
    }
    console.log(
      `[migrate] BD no lista (intento ${attempt}/${maxAttempts}), reintento en 2s…`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
