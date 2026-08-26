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
 * `formasDeclaradas` es el texto libre que el negocio ya escribe en el CRM
 * (`ficha.pago.formas`, ej. "Transferencia bancaria, incluye Nequi"). No se
 * reinterpreta esa prosa con IA: solo se comprueba, por categoría y por
 * substring literal, si el método mencionado cae dentro de lo declarado.
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
    return { status: "recognized", method: mencionado, allowed: true };
  }

  const categoria = categoriaDe(mencionado);
  if (!categoria) return { status: "unknown" };

  const permitido = SINONIMOS.some(
    ({ patron, categoria: c }) => c === categoria && patron.test(declarado)
  );
  return { status: "recognized", method: mencionado, allowed: permitido };
}
