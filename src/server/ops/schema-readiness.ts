import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

/**
 * Fase 6I — incidente real (8-sep-2026): `migrate.mjs` reportó
 * "migraciones aplicadas" (exit 0) sin que `agent_job.generation`,
 * `conversation_state.version` ni `appointment_booking_confirmation`
 * llegaran a existir en producción. Causa raíz (doc 166): el migrador de
 * Drizzle solo compara el `"when"` de cada migración contra la fila MÁS
 * RECIENTE de `__drizzle_migrations` — si un timestamp queda invertido, la
 * salta en silencio, sin lanzar ninguna excepción.
 *
 * Esto no verifica "¿qué migración faltó?" (eso depende de un detalle
 * interno de Drizzle que puede volver a fallar de una forma distinta) —
 * verifica la pregunta que de verdad importa: **¿el esquema real de
 * Postgres tiene, ahora mismo, cada tabla y cada columna que el código de
 * ESTA imagen espera?** La lista de lo esperado se deriva directamente de
 * `schema.ts` por introspección de Drizzle (`getTableConfig`) — nunca una
 * lista mantenida a mano, que se desactualizaría en el primer `db:generate`
 * que alguien olvide reflejar aquí.
 */

export type ColumnaEsperada = { tabla: string; columna: string };

/** `"tabla.columna"` — clave estable para comparar conjuntos. */
export function claveDeColumna(c: ColumnaEsperada): string {
  return `${c.tabla}.${c.columna}`;
}

/**
 * Todo lo que el código de este build espera que exista en Postgres,
 * leído directamente de las tablas que `schema.ts` declara — no de una
 * lista escrita a mano. Si mañana se agrega una tabla nueva a `schema.ts`,
 * esta función la incluye automáticamente sin tocar este archivo.
 */
export function columnasEsperadasPorElCodigo(): ColumnaEsperada[] {
  // Los valores exportados por schema.ts tienen tipos literales específicos
  // por tabla (`PgTableWithColumns<{name: "agent_job", ...}>`); un type
  // predicate contra el `PgTable` genérico no es asignable a cada uno de
  // esos tipos exactos. Se filtra en tiempo de ejecución con `is()` (el
  // chequeo real de Drizzle) y se trata el resultado como `PgTable[]`
  // genérico a propósito: aquí solo hace falta leer nombre/columnas, no el
  // tipo exacto de cada tabla.
  const tablas = (Object.values(schema) as unknown[]).filter((valor) =>
    is(valor, PgTable)
  ) as PgTable[];
  const resultado: ColumnaEsperada[] = [];
  for (const tabla of tablas) {
    const cfg = getTableConfig(tabla);
    for (const columna of cfg.columns) {
      resultado.push({ tabla: cfg.name, columna: columna.name });
    }
  }
  return resultado;
}

/**
 * Pura, sin I/O — comparación de conjuntos. Separada de
 * `columnasEsperadasPorElCodigo` para poder probarla con datos inventados,
 * sin depender del `schema.ts` real ni de una base de datos.
 *
 * Deliberadamente NO reporta columnas "de más" (una base con columnas que
 * el código todavía no conoce es exactamente el escenario normal de una
 * migración expandida desplegada antes que el código que la usa —
 * compatible hacia atrás por diseño, no un error).
 */
export function columnasFaltantes(
  esperadas: ColumnaEsperada[],
  existentesReales: ReadonlySet<string>
): ColumnaEsperada[] {
  return esperadas.filter((e) => !existentesReales.has(claveDeColumna(e)));
}
