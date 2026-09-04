import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Fase 10N-J — fuente única de verdad para "¿cuánto cuesta el domicilio a
 * esta zona?", con el mismo patrón que `server/catalog/buscar.ts` ya probó
 * para productos: función de resolución PURA (sin DB adentro) + consulta
 * aparte, para que el pipeline pueda cargar las zonas una sola vez por
 * turno y reusarlas tanto para el prompt como para el bucle de
 * `consultar_domicilio`.
 *
 * Nace del incidente real de Kachipay: el cliente escuchó "$12.000" y el
 * resumen del pedido cerró con "$8.000" — sin ninguna tabla de zonas, cada
 * mención de un precio de domicilio era una generación de texto libre
 * independiente, sin ningún ancla compartida entre turnos.
 */

export type ZonaDeEntrega = {
  id: string;
  nombre: string;
  feeCents: number;
};

export type ResultadoBusquedaZona =
  | { status: "found"; zona: ZonaDeEntrega }
  | { status: "multiple_matches"; zonas: ZonaDeEntrega[] }
  | { status: "not_found" };

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .toLowerCase()
    .trim();
}

const STOP_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "con", "y", "o", "en", "para", "al", "por",
  "un", "una", "unos", "unas", "domicilio", "domi", "envio", "envío", "zona",
  "cuanto", "cuánto", "vale", "cuesta", "hasta", "a",
]);

function tokens(s: string): string[] {
  return normalizar(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function coincide(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= 5 || (i === min && min >= 4);
}

/**
 * Mismo algoritmo que `buscarProductos` (match exacto → substring único →
 * tokens con tolerancia a tildes/plural), implementado aparte a propósito:
 * cada dominio tiene su propio matcher, mismo criterio que ya separa
 * productos de servicios de citas en todo el proyecto. NUNCA inventa una
 * zona ni una tarifa: si no hay un match seguro, `not_found` — el llamante
 * debe preguntar, no asumir.
 */
export function resolverZonaDeEntrega(
  zonas: ZonaDeEntrega[],
  consulta: string
): ResultadoBusquedaZona {
  const q = normalizar(consulta);
  if (!q || zonas.length === 0) return { status: "not_found" };

  const exacto = zonas.filter((z) => normalizar(z.nombre) === q);
  if (exacto.length === 1) return { status: "found", zona: exacto[0]! };
  if (exacto.length > 1) return { status: "multiple_matches", zonas: exacto };

  const porSubstring = zonas.filter(
    (z) => normalizar(z.nombre).includes(q) || q.includes(normalizar(z.nombre))
  );
  if (porSubstring.length === 1) return { status: "found", zona: porSubstring[0]! };

  const universo = porSubstring.length > 1 ? porSubstring : zonas;
  const qt = tokens(consulta);
  if (!qt.length) return { status: "not_found" };

  let mejorPuntaje = { overlap: 0, ratio: 0 };
  let candidatos: ZonaDeEntrega[] = [];
  for (const z of universo) {
    const zt = tokens(z.nombre);
    if (!zt.length) continue;
    const overlap = zt.filter((t) => qt.some((u) => coincide(t, u))).length;
    if (!overlap) continue;
    const ratio = overlap / zt.length;
    if (
      overlap > mejorPuntaje.overlap ||
      (overlap === mejorPuntaje.overlap && ratio > mejorPuntaje.ratio)
    ) {
      mejorPuntaje = { overlap, ratio };
      candidatos = [z];
    } else if (overlap === mejorPuntaje.overlap && ratio === mejorPuntaje.ratio) {
      candidatos.push(z);
    }
  }

  if (candidatos.length === 0) return { status: "not_found" };
  if (candidatos.length === 1) return { status: "found", zona: candidatos[0]! };
  return { status: "multiple_matches", zonas: candidatos };
}

/**
 * Las zonas de entrega activas de una organización — SIEMPRE `scoped()`
 * (Constitución III): una organización nunca puede resolver ni ver la
 * tarifa de otra.
 */
export async function zonasDeEntregaQuery(organizationId: string): Promise<ZonaDeEntrega[]> {
  const db = getDb();
  const filas = await db
    .select({
      id: schema.deliveryZone.id,
      nombre: schema.deliveryZone.name,
      feeCents: schema.deliveryZone.feeCents,
    })
    .from(schema.deliveryZone)
    .where(
      scoped(
        schema.deliveryZone.organizationId,
        organizationId,
        eq(schema.deliveryZone.active, true)
      )
    )
    .orderBy(asc(schema.deliveryZone.position), asc(schema.deliveryZone.name));
  return filas;
}

/** Texto del hecho verificado que vuelve al modelo tras `consultar_domicilio` — mismo criterio que `textoDeResultadoProducto`. */
export function textoDeResultadoDomicilio(consulta: string, resultado: ResultadoBusquedaZona): string {
  if (resultado.status === "found") {
    const pesos = (resultado.zona.feeCents / 100).toLocaleString("es-CO", { maximumFractionDigits: 0 });
    return `[SISTEMA] La tarifa de domicilio a "${resultado.zona.nombre}" es $${pesos}. Este dato es real y verificado: úsalo tal cual, no lo cambies ni lo redondees.`;
  }
  if (resultado.status === "multiple_matches") {
    const nombres = resultado.zonas.map((z) => z.nombre).join(", ");
    return `[SISTEMA] "${consulta}" coincide con varias zonas registradas (${nombres}). Pregúntale al cliente cuál es, no asumas ninguna.`;
  }
  return `[SISTEMA] No encontré "${consulta}" entre las zonas de domicilio registradas. No inventes una tarifa: dile al cliente que vas a confirmar el valor del domicilio a esa zona, o pregúntale por una zona conocida.`;
}
