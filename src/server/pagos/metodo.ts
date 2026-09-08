/**
 * Resuelve si un método de pago que mencionó el cliente está permitido,
 * contra lo que el negocio declaró en `ficha.pago.formas` — mismo espíritu
 * que `buscarProductos`: convertir un hecho que hoy se decide leyendo prosa
 * en un hecho que el backend calcula.
 *
 * Nace del caso Nequi (24-ago-2026, Lis): la única forma declarada era
 * "transferencia" y el modelo respondió que no se aceptaba Nequi — sin
 * reconocer que en Colombia pagar por Nequi ES transferir. El primer arreglo
 * fue una instrucción en el prompt (`pagoDePedidosParaElPrompt`, que sigue
 * existiendo tal cual, como respaldo para lo que este diccionario no
 * reconozca); esto es la mitad que lo hace un hecho verificado en vez de una
 * súplica de texto.
 */

export type ResultadoMetodoDePago =
  | { status: "recognized"; method: string; allowed: true }
  | { status: "recognized"; method: string; allowed: false }
  | { status: "unknown" };

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .toLowerCase()
    .trim();
}

/**
 * Sinónimos conocidos en Colombia. Deliberadamente pequeño y plano — no es
 * un tesauro general, es lo que ya ha causado un incidente real o es de
 * sentido común en pagos de comercio (billeteras que en la práctica son
 * transferencias, y las dos formas más comunes que no lo son).
 */
const SINONIMOS: { patron: RegExp; categoria: string }[] = [
  { patron: /nequi|daviplata|bancolombia a la mano|dale|movii/, categoria: "transferencia" },
  { patron: /transferencia|consignacion|pse/, categoria: "transferencia" },
  { patron: /efectivo|contraentrega|cash/, categoria: "efectivo" },
  { patron: /tarjeta|credito|debito|datafono/, categoria: "tarjeta" },
];

function categoriaDe(mencionado: string): string | null {
  const m = normalizar(mencionado);
  for (const { patron, categoria } of SINONIMOS) {
    if (patron.test(m)) return categoria;
  }
  return null;
}

/**
 * Fase 10S — bug real (4-sep-2026): "No aceptamos efectivo, solo
 * transferencia" hacía `declarado.includes("efectivo")` == true y devolvía
 * `allowed: true` — el substring no distingue mención de negación. Detecta
 * una negación ("no aceptamos", "no manejamos"...) inmediatamente antes de
 * la aparición del término; ya lo usa el negocio como frase real (ver
 * docs/korexia/118-NO-NIEGUES-LO-QUE-NO-SABES.md).
 */
const NEGACION_CERCA =
  /\bno\s+(aceptamos|acepto|aceptan|acepta|manejamos|manejo|manejan|maneja|recibimos|recibo|reciben|recibe|permitimos|permito|permiten|permite|trabajamos\s+con|hay)\b/;

/**
 * La negación solo cuenta dentro de la MISMA cláusula que el término — no
 * basta una ventana de caracteres: "No aceptamos efectivo, solo
 * transferencia" no debe negar "transferencia" solo por estar cerca del
 * "no" de la cláusula anterior. Se parte el texto por los separadores que
 * cierran una cláusula (coma, punto, punto y coma, "pero", "sino").
 */
const SEPARADOR_DE_CLAUSULA = /[,.;]|\bpero\b|\bsino\b/g;

function inicioDeClausula(declarado: string, index: number): number {
  const sep = new RegExp(SEPARADOR_DE_CLAUSULA.source, "g");
  let inicio = 0;
  let m: RegExpExecArray | null;
  while ((m = sep.exec(declarado)) !== null) {
    if (m.index >= index) break;
    inicio = m.index + m[0].length;
  }
  return inicio;
}

function negadoAntesDe(declarado: string, index: number): boolean {
  const inicio = inicioDeClausula(declarado, index);
  return NEGACION_CERCA.test(declarado.slice(inicio, index));
}

/** Recorre TODAS las apariciones de `buscado`; basta una sin negar para permitir. */
function algunaAparicionSinNegar(declarado: string, buscado: string): boolean {
  let desde = 0;
  for (;;) {
    const idx = declarado.indexOf(buscado, desde);
    if (idx === -1) return false;
    if (!negadoAntesDe(declarado, idx)) return true;
    desde = idx + buscado.length;
  }
}

/** Igual que `algunaAparicionSinNegar` pero para un patrón de sinónimo (regex). */
function algunaCoincidenciaSinNegar(declarado: string, patron: RegExp): boolean {
  const global = new RegExp(patron.source, patron.flags.includes("g") ? patron.flags : patron.flags + "g");
  let match: RegExpExecArray | null;
  while ((match = global.exec(declarado)) !== null) {
    if (!negadoAntesDe(declarado, match.index)) return true;
    if (match.index === global.lastIndex) global.lastIndex++;
  }
  return false;
}

/**
 * `formasDeclaradas` es el texto libre que el negocio ya escribe en el CRM
 * (`ficha.pago.formas`, ej. "Transferencia bancaria, incluye Nequi"). No se
 * reinterpreta esa prosa con IA: solo se comprueba, por categoría y por
 * substring literal, si el método mencionado cae dentro de lo declarado —
 * y si esa mención está negada en el propio texto del negocio.
 */
export function resolverMetodoDePago(
  formasDeclaradas: string,
  mencionado: string
): ResultadoMetodoDePago {
  const declarado = normalizar(formasDeclaradas);
  const m = normalizar(mencionado);
  if (!m.trim()) return { status: "unknown" };

  // Coincidencia literal: el negocio ya nombró exactamente ese método.
  if (declarado.includes(m)) {
    const allowed = algunaAparicionSinNegar(declarado, m);
    return { status: "recognized", method: mencionado, allowed };
  }

  const categoria = categoriaDe(mencionado);
  if (!categoria) return { status: "unknown" };

  const permitido = SINONIMOS.some(
    ({ patron, categoria: c }) => c === categoria && algunaCoincidenciaSinNegar(declarado, patron)
  );
  return { status: "recognized", method: mencionado, allowed: permitido };
}
