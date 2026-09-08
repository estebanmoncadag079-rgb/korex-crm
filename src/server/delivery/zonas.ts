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
 * Fase 8H — mismo defecto que la Fase 8E encontró en `buscarProductos`, en
 * este matcher hermano: cuando dos zonas comparten el nombre de familia y lo
 * único que coincide es ESE nombre, el desempate por `ratio` elige en
 * silencio a la del nombre más corto, en vez de preguntar.
 *
 * Caso real de MALIA: una clienta escribió "poblado ll" (así, con L
 * minúsculas por "II"). El catálogo tiene "El Poblado" y "Poblado II", las
 * dos reales y las dos a $10.000. El matcher resolvía a "El Poblado" —
 * porque su nombre tiene un token y el del hermano dos— sin preguntar nada.
 * Aquí el precio coincidía por casualidad; con dos zonas de tarifa distinta,
 * el mismo camino cobra mal en silencio.
 *
 * La respuesta correcta para ZONAS es distinta que para productos: allá un
 * "pavé de oblea" inexistente se responde `not_found` ("no lo tenemos", y el
 * modelo ve el catálogo en el prompt para ofrecer alternativas). Aquí las dos
 * candidatas SÍ existen y el modelo NO tiene la lista de zonas — así que lo
 * útil es devolver las hermanas y que PREGUNTE cuál es, que es justo lo que
 * `textoDeResultadoDomicilio` ya sabe pedirle con `multiple_matches`.
 *
 * Devuelve las zonas hermanas cuando: (1) queda una palabra del cliente sin
 * explicar, y (2) NINGUNO de los tokens que coincidieron distingue a la
 * ganadora de las demás — todo lo que coincidió es apellido de familia.
 */
function hermanasDeLaMismaFamilia(
  zonas: ZonaDeEntrega[],
  ganadora: ZonaDeEntrega,
  qt: string[]
): ZonaDeEntrega[] | null {
  const zt = tokens(ganadora.nombre);
  const coincidieron = zt.filter((t) => qt.some((u) => coincide(t, u)));
  if (!coincidieron.length) return null;
  // Sin palabras sin explicar, el match cubre lo que pidió el cliente.
  const sinExplicar = qt.filter((u) => !zt.some((t) => coincide(t, u)));
  if (!sinExplicar.length) return null;
  const cuantasComparten = (t: string) =>
    zonas.filter((z) => tokens(z.nombre).some((o) => coincide(o, t))).length;
  // Basta que UNO de los tokens coincididos identifique de verdad.
  if (coincidieron.some((t) => cuantasComparten(t) < 2)) return null;
  const hermanas = zonas.filter((z) =>
    coincidieron.some((t) => tokens(z.nombre).some((o) => coincide(o, t)))
  );
  return hermanas.length > 1 ? hermanas : null;
}

/**
 * Mismo algoritmo que `buscarProductos` (match exacto → substring único →
 * tokens con tolerancia a tildes/plural), implementado aparte a propósito:
 * cada dominio tiene su propio matcher, mismo criterio que ya separa
 * productos de servicios de citas en todo el proyecto. NUNCA inventa una
 * zona ni una tarifa: si no hay un match seguro, `not_found` o
 * `multiple_matches` — el llamante debe preguntar, no asumir.
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
  if (candidatos.length === 1) {
    const hermanas = hermanasDeLaMismaFamilia(zonas, candidatos[0]!, qt);
    if (hermanas) return { status: "multiple_matches", zonas: hermanas };
    return { status: "found", zona: candidatos[0]! };
  }
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

/** Texto del hecho verificado tras `consultar_domicilio` con `recogida:true` — Fase 10V-X. */
export function textoDeResultadoRecogida(): string {
  return "[SISTEMA] Registrado: este pedido es de recogida en el local, sin domicilio. No cobres ni menciones ninguna tarifa de domicilio para este pedido.";
}
