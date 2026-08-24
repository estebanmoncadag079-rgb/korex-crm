import type { AgentActionType } from "@/server/ai/actions";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * Contenido literal que el propio negocio escribió en el CRM (una reglaPropia
 * o una respuesta de conocimiento) y que DEBE llegar al cliente cuando su
 * mensaje coincide con el tema — verificado por código, no por confianza en
 * el modelo (24-ago-2026, docs/korexia/125).
 *
 * **El caso que lo originó**: Lis Pastelería ya tenía escrita la regla
 * "SIEMPRE que el cliente pregunte por los productos envíale el link del
 * catálogo…", y el modelo la incumplía 1 de cada 3 veces — no porque el dato
 * faltara (estaba en el prompt, completo, en cada turno), sino porque una
 * INSTRUCCIÓN en texto libre no es una garantía: el modelo decide si la sigue.
 *
 * **Genérico, no de un cliente**: no hay ni una palabra de "catálogo" ni de
 * comida en este archivo. Cualquier regla propia o entrada de conocimiento de
 * CUALQUIER negocio que contenga un enlace queda protegida por el mismo
 * mecanismo, sin código nuevo por cliente.
 */

export type ContenidoObligatorio = {
  id: string;
  fuente: "conocimiento" | "reglaPropia";
  /** Raíces (4 letras) de las palabras significativas del disparador. */
  raices: string[];
  /** La URL exacta que debe aparecer, tal cual, en la respuesta. */
  literal: string;
};

const URL_RE = /https?:\/\/[^\s)\]}"'<>]+/g;

/**
 * Palabras vacías del ESPAÑOL, no del negocio — la distinción que importa
 * (docs/korexia/93, "no deducir reglas de negocio del vocabulario"). Ni una
 * palabra de comida, pestañas ni ningún sector: solo gramática.
 */
const PALABRAS_VACIAS = new Set([
  "para", "por", "que", "con", "los", "las", "una", "uno", "unos", "unas",
  "del", "esta", "esto", "estas", "estos", "ese", "esa", "esos", "esas",
  "eres", "sois", "son", "hay", "muy", "mas", "pero", "como", "cuando",
  "donde", "aqui", "alli", "todo", "toda", "todos", "todas", "algo",
  "sobre", "entre", "hasta", "desde", "antes", "despues", "cada", "cual",
  "cuales", "quien", "quienes", "nuestro", "nuestra", "nuestros", "nuestras",
]);

/**
 * Solo para texto de `reglasPropias`: son las palabras del MOLDE con que el
 * dueño redacta una instrucción ("siempre que…, envíale…"), no el tema que la
 * dispara. Sin esto, "tienes" o "envíale" — presentes en casi cualquier
 * regla — dispararían con cualquier mensaje que las contenga.
 */
const PALABRAS_DE_INSTRUCCION = new Set([
  "siempre", "cliente", "envia", "enviale", "enviaselo", "enviarle",
  "primero", "tienes", "tiene", "hacer", "este", "esta", "mensaje",
  "bonito", "cordial", "texto", "lista", "debes", "debe", "hazlo",
  "diga", "quiere", "pregunte", "eso", "antes", "despues",
]);

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Una "raíz" de 4 letras, para que "pedir" (la pregunta del negocio) y
 * "pedido" (lo que escribe el cliente) se reconozcan como la misma palabra
 * sin necesitar un diccionario de conjugaciones. Heurística, no gramática —
 * documentado así porque es a propósito, no un descuido.
 */
function raiz(palabra: string): string {
  return palabra.length <= 4 ? palabra : palabra.slice(0, 4);
}

function raicesSignificativas(texto: string, extra: Set<string> = new Set()): string[] {
  const palabras = normalizar(texto)
    .split(" ")
    .filter((p) => p.length >= 4 && !PALABRAS_VACIAS.has(p) && !extra.has(p));
  return [...new Set(palabras.map(raiz))];
}

/**
 * Lee todo lo que el negocio configuró (conocimiento + reglas propias) y
 * separa lo que trae un enlace de lo que no. Solo eso se protege: un enlace
 * es un literal verificable sin ambigüedad; una frase de tono ("sé cálida")
 * no lo es, y forzarla no tendría sentido.
 */
export function extraerContenidoObligatorio(
  ficha: Pick<FichaDelNegocio, "reglasPropias"> | null | undefined,
  kb: readonly { id: string; kind: string; question: string | null; answer: string | null; content: string | null }[]
): ContenidoObligatorio[] {
  const resultado: ContenidoObligatorio[] = [];

  for (const entrada of kb) {
    const texto = entrada.kind === "qa" ? entrada.answer : entrada.content;
    if (!texto) continue;
    const urls = texto.match(URL_RE);
    if (!urls?.length) continue;
    // La pregunta es el disparador natural: literalmente representa "cuándo
    // el cliente quiere esto". El contenido libre (`content`) no trae
    // pregunta, así que se usa a sí mismo.
    const base = entrada.kind === "qa" ? entrada.question ?? "" : texto;
    const raices = raicesSignificativas(base);
    if (!raices.length) continue;
    for (const url of new Set(urls)) {
      resultado.push({ id: `kb:${entrada.id}:${url}`, fuente: "conocimiento", raices, literal: url });
    }
  }

  for (const [i, regla] of (ficha?.reglasPropias ?? []).entries()) {
    const urls = regla.match(URL_RE);
    if (!urls?.length) continue;
    const clausula = clausulaDelDisparador(regla);
    // Sin un disparador explícito, no hay de dónde sacar palabras de la
    // INTENCIÓN del cliente sin arriesgar chocar con otra regla — ver el
    // caso de Rappi más abajo.
    if (!clausula) continue;
    const raices = raicesSignificativas(clausula, PALABRAS_DE_INSTRUCCION);
    if (!raices.length) continue;
    for (const url of new Set(urls)) {
      resultado.push({ id: `regla:${i}:${url}`, fuente: "reglaPropia", raices, literal: url });
    }
  }

  return resultado;
}

/**
 * Marcadores de un disparador CONDICIONAL — del español, no del negocio.
 * Sin uno de estos, una reglaPropia es una AFIRMACIÓN ("tenemos domicilios
 * por Rappi, aquí el link"), no una instrucción de "cuando pase X, haz Y".
 */
const MARCADORES_DE_DISPARADOR = [
  "siempre que", "cada vez que", "cuando", "si el cliente", "si te preguntan",
  "si preguntan", "si pregunta", "en caso de que", "en caso de",
];

/**
 * La parte de la regla que describe LA INTENCIÓN DEL CLIENTE, no cómo
 * responder. 24-ago-2026: sin este corte, la regla de Rappi de Lis
 * ("…este es el link para hacer tu pedido: <url>") comparte la palabra
 * "pedido" con la regla del catálogo y las dos se disparaban con "quiero
 * hacer un pedido" — el enlace de Rappi le llegaba a cualquiera que
 * quisiera pedir, sin haber preguntado por domicilios.
 *
 * Corta en la primera coma o en el primer verbo de acción ("envía",
 * "manda", "comparte", "dile"): lo de antes es el disparador, lo de después
 * es cómo ejecutar la acción — y ahí es donde se cuela vocabulario que no
 * tiene nada que ver con lo que el cliente escribió.
 */
function clausulaDelDisparador(regla: string): string | null {
  const normalizado = normalizar(regla);
  const tieneMarcador = MARCADORES_DE_DISPARADOR.some((m) => normalizado.includes(normalizar(m)));
  if (!tieneMarcador) return null;

  const corte = regla.search(/,|\benv[ií]a|\bmanda|\bcomparte|\bdile\b/i);
  return corte > 0 ? regla.slice(0, corte) : regla;
}

/** `true` si algo de lo que el cliente escribió coincide con el disparador. */
export function disparadoPor(mensajesDelCliente: readonly string[], contenido: ContenidoObligatorio): boolean {
  const normalizado = normalizar(mensajesDelCliente.join(" "));
  return contenido.raices.some((r) => normalizado.includes(r));
}

/** El texto de corrección, listando exactamente qué falta — nunca "algo". */
export function correccionDeContenidoFaltante(faltantes: readonly ContenidoObligatorio[]): string {
  const enlaces = faltantes.map((f) => f.literal).join(", ");
  return (
    "ALTO. El cliente preguntó por algo que el negocio configuró con una respuesta obligatoria, " +
    `y tu respuesta NO incluye el enlace que debía llevar: ${enlaces}. Reescribe tu respuesta e ` +
    "incluye ese enlace tal cual, sin acortarlo ni cambiarlo. Responde ÚNICAMENTE el objeto JSON."
  );
}

/**
 * Última red: si el modelo insiste en omitirlo tras el reintento, el servidor
 * lo añade él mismo — sin una tercera llamada al modelo. Es seguro hacerlo
 * así porque lo único que se fuerza es un literal que el propio negocio
 * escribió (un enlace), nunca un dato inventado por el sistema.
 */
export function agregarContenidoFaltante(
  action: AgentActionType,
  faltantes: readonly ContenidoObligatorio[]
): AgentActionType {
  if (faltantes.length === 0) return action;
  const extra = faltantes.map((f) => f.literal).join("\n");

  switch (action.action) {
    case "none":
      return { action: "reply", text: extra };
    case "reply":
      return { ...action, text: `${action.text}\n\n${extra}` };
    case "update_lead":
    case "move_stage":
    case "provide_requirement":
    case "send_image":
      return { ...action, reply: action.reply ? `${action.reply}\n\n${extra}` : extra };
    case "handoff":
    case "notify_order":
    case "book_appointment":
    case "reschedule_appointment":
    case "cancel_appointment":
      return { ...action, farewell: action.farewell ? `${action.farewell}\n\n${extra}` : extra };
    default:
      return action;
  }
}
