import { resumirTexto } from "@/server/registro-de-cambios";

/**
 * Trazabilidad diagnóstica por turno (docs/korexia/145).
 *
 * **Por qué existe**: hasta ahora, reconstruir "por qué el bot respondió
 * esto" significaba leer a mano media docena de líneas de log con prefijos
 * distintos (`[producto]`, `[pago]`, `[agente]`, `[citas]`, `[metrica]`),
 * dispersas, sin nada que las una salvo el `conversationId` repetido en
 * cada una y la cercanía de sus timestamps — exactamente el trabajo manual
 * que costó reconstruir el incidente de "Luisa" (26-ago-2026, doc 144:
 * los dos saludos duplicados). Esto consolida, en UNA línea por turno, la
 * cadena completa: qué preguntó, qué se verificó contra el backend, qué
 * acción decidió el modelo, qué guardarraíl actuó, si hubo recuperación de
 * una salida parcial, y si terminó en handoff y por qué.
 *
 * **Mismo patrón que `registrarMetricaDeEstado`** (server/orders/estado.ts):
 * log estructurado, una línea, sin tabla nueva — la misma decisión que ya
 * se tomó dos veces en este proyecto (`registro-de-cambios.ts`,
 * `estado.ts`) y que aquí se repite por el mismo motivo: no toca el
 * esquema, no necesita migración, y responde la pregunta real ("¿en qué
 * parte del sistema ocurrió el fallo?") desde el primer despliegue.
 *
 * **Nunca vuelca el texto del cliente.** El mensaje real ya vive en
 * `message.text` — quien investiga un incidente lo busca ahí por
 * `conversationId` (que esta traza sí lleva) o por `mensajeId` (el id de
 * ese mismo mensaje, un identificador técnico, no un dato personal). Volcar
 * el texto en un log aparte sería duplicar exactamente el riesgo que
 * `registro-de-cambios.ts` ya documentó (el teléfono de un cliente
 * terminando en un log de servidor) sin ganar nada que `message` no diera
 * ya. Por eso aquí solo se guarda `resumirTexto(mensaje)` — longitud y
 * huella, suficiente para confirmar "es el mismo mensaje" sin escribirlo.
 */

/**
 * Categorías del resultado de un turno. Una traza puede llevar varias a la
 * vez (un hecho verificado que además disparó un guardarraíl, por
 * ejemplo) — por eso es un conjunto, no un valor único.
 */
export type CategoriaDeTraza =
  | "normal"
  | "fact_verified"
  | "guardrail_corrected"
  | "model_output_partial_recovered"
  | "model_output_invalid"
  | "provider_error"
  | "backend_error"
  | "handoff";

/** De dónde salió un hecho que el agente usó para responder. */
export type OrigenDelHecho = "backend" | "crm" | "llm";

export type HechoConsultado = {
  tipo: "producto" | "medio_pago" | "disponibilidad";
  /** La consulta tal cual se le pidió al backend — nombre de producto o método, nunca datos del cliente. */
  consulta: string;
  resultado: string;
  origen: OrigenDelHecho;
};

export type EventoDeGuardarrail = {
  nombre: string;
  /** `true` si detectó el problema y la corrección tuvo éxito; `false` si detectó pero no logró corregir. */
  corrigio: boolean;
};

export type EventoDeRecuperacion = {
  /** Nivel 1 = normalización determinista; Nivel 2 = regeneración acotada (docs/korexia/144). */
  nivel: 1 | 2;
  exito: boolean;
};

/**
 * El acumulador de un turno. Se crea una sola vez al principio de
 * `runAgentTurn` (justo antes de la primera llamada al modelo — antes de
 * eso no hay decisión que trazar) y se va completando en los mismos
 * puntos donde el pipeline ya boy genera sus logs de hoy, sin alterar
 * ninguna decisión: es solo la anotación de lo que ya iba a pasar.
 */
export type TrazaDelTurno = {
  organizationId: string;
  conversationId: string;
  /** El id del mensaje entrante que disparó el turno — la referencia real hacia `message.text`. */
  mensajeId: string;
  mensajeResumen: string;
  deteccionFactual: string | null;
  hechos: HechoConsultado[];
  guardarrailes: EventoDeGuardarrail[];
  recuperacion: EventoDeRecuperacion | null;
  categorias: Set<CategoriaDeTraza>;
  accionFinal: string | null;
  handoffCausa: string | null;
};

export function crearTraza(input: {
  organizationId: string;
  conversationId: string;
  mensajeId: string;
  mensajeTexto: string | null;
}): TrazaDelTurno {
  return {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    mensajeId: input.mensajeId,
    mensajeResumen: resumirTexto(input.mensajeTexto ?? ""),
    deteccionFactual: null,
    hechos: [],
    guardarrailes: [],
    recuperacion: null,
    categorias: new Set(),
    accionFinal: null,
    handoffCausa: null,
  };
}

export function agregarHecho(t: TrazaDelTurno, h: HechoConsultado): void {
  t.hechos.push(h);
  t.categorias.add("fact_verified");
}

export function agregarGuardarrail(t: TrazaDelTurno, nombre: string, corrigio: boolean): void {
  t.guardarrailes.push({ nombre, corrigio });
  if (corrigio) t.categorias.add("guardrail_corrected");
}

export function registrarRecuperacion(t: TrazaDelTurno, nivel: 1 | 2, exito: boolean): void {
  t.recuperacion = { nivel, exito };
  t.categorias.add(exito ? "model_output_partial_recovered" : "model_output_invalid");
}

export function registrarHandoff(t: TrazaDelTurno, causa: string): void {
  t.handoffCausa = causa;
  t.categorias.add("handoff");
  if (causa === "provider_error") t.categorias.add("provider_error");
  if (causa === "invalid_output") t.categorias.add("model_output_invalid");
  if (causa === "backend_error") t.categorias.add("backend_error");
}

/**
 * Emite la línea `[traza]` de este turno. Nunca lanza — instrumentar un
 * turno no puede tumbar la respuesta que ya se decidió, mismo criterio que
 * `registrarCambios`/`registrarMetricaDeEstado`.
 */
export function registrarTrazaDelTurno(t: TrazaDelTurno): void {
  try {
    const categorias = t.categorias.size ? [...t.categorias].join("|") : "normal";
    const hechos = t.hechos.length
      ? t.hechos.map((h) => `${h.tipo}:"${h.consulta}"=${h.resultado}@${h.origen}`).join(" · ")
      : "-";
    const guardarrailes = t.guardarrailes.length
      ? t.guardarrailes.map((g) => `${g.nombre}:${g.corrigio ? "corrigio" : "disparado"}`).join(" · ")
      : "-";
    const recuperacion = t.recuperacion
      ? `nivel${t.recuperacion.nivel}:${t.recuperacion.exito ? "exito" : "fallo"}`
      : "no";

    const linea =
      `[traza] org=${t.organizationId} conv=${t.conversationId} msg=${t.mensajeId} ` +
      `mensaje=${t.mensajeResumen} ` +
      `deteccion_factual=${t.deteccionFactual ? `"${t.deteccionFactual}"` : "no"} ` +
      `hechos=${hechos} ` +
      `accion=${t.accionFinal ?? "-"} ` +
      `categorias=${categorias} ` +
      `guardarrailes=${guardarrailes} ` +
      `recuperacion=${recuperacion} ` +
      `handoff=${t.handoffCausa ? "si" : "no"} ` +
      `causa_handoff=${t.handoffCausa ?? "-"} ` +
      `timestamp=${new Date().toISOString()}`;

    // Lo que hay que poder encontrar mirando solo advertencias/errores del
    // día: cualquier turno que no terminó "normal" — corrección, salida
    // inválida o handoff. El resto (la mayoría) va en info.
    if (t.categorias.size === 0) {
      console.log(linea);
    } else {
      console.warn(linea);
    }
  } catch (err) {
    console.warn(`[traza] no se pudo registrar: ${(err as Error).message}`);
  }
}
