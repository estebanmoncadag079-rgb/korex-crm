import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { modeloDeRescate } from "@/lib/ai/modelos";
import { AgentAction, type AgentActionType } from "@/server/ai/actions";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import type { EstadoDelPedido } from "@/server/orders/estado";
import { enPesos } from "@/server/orders/minimo-de-domicilio";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * El salvavidas de RECUPERACIÓN DE TURNO — no un segundo modelo conversacional.
 *
 * ## Por qué existe (docs/korexia/189)
 *
 * `openai/gpt-5-mini`, medido contra las mismas 325 entradas que
 * `google/gemini-3.7-flash`, cerró **0 de 6** pedidos donde el cliente
 * confirmó con una frase coloquial ("Listo", "Sip", "Siii", "Si correcto").
 * En los seis casos el backend YA tenía el pedido listo para cerrar
 * (`puedeConfirmarPedido` habría devuelto `{ok:true}`); lo que faltó fue que
 * el modelo reconociera la confirmación y llamara a `notify_order`.
 *
 * ## Por qué esto NO es el "orquestador de intención" que
 * `docs/korexia/156` descartó
 *
 * Ese documento rechazó un segundo modelo que reinterprete CUALQUIER turno
 * ambiguo, por falta de una fuente de verdad contra la que validar su
 * juicio — es exactamente el "problema C" de esa auditoría (inferencia
 * confundida con confirmación), solo que con dos modelos opinando en vez de
 * uno. Este archivo evita ese defecto por diseño: **solo se activa cuando el
 * backend YA sabe la respuesta** (`estadoGuardado` completo, verificado por
 * `puedeConfirmarPedido`, la misma función que hoy solo se usa para
 * RECHAZAR un cierre mal disparado). Gemini no arbitra nada — solo responde
 * la única pregunta que quedó sin resolver: ¿este mensaje es una
 * confirmación? Y ni siquiera esa respuesta se usa literal: los montos que
 * de verdad importan (`subtotalCents`/`deliveryFeeCents`/`totalCents`)
 * SIEMPRE salen de `estadoGuardado`, nunca de lo que escriba ningún modelo.
 *
 * Fuera de esta única categoría (pedido backend-completo, acción distinta de
 * `notify_order`), este archivo no hace nada: un handoff sin un pedido
 * backend-verificado detrás sigue siendo un handoff legítimo.
 */

/**
 * ¿Esta acción —tal como quedó DESPUÉS de todos los guardarraíles
 * existentes— es un cierre evitable de un pedido que el backend ya
 * considera listo?
 *
 * Reutiliza `puedeConfirmarPedido` sin modificarla: es la MISMA autoridad
 * que decide si un `notify_order` YA propuesto puede ejecutarse. Usarla aquí
 * al revés —para detectar que faltó proponerlo— garantiza que las dos
 * lecturas nunca puedan divergir con el tiempo, porque son la misma función.
 *
 * Devuelve `false` sin llamar a nada más cuando:
 * - no hay autoridad backend (`estadoGuardado` ausente: `state_source !==
 *   'backend'`, el caso de Lashes Valen hoy) — no se inventa una señal donde
 *   no existe;
 * - la acción YA es `notify_order` (va por su camino normal, sin cambios);
 * - no hay catálogo real (`productosDelPedido` vacío) — mismo requisito que
 *   `puedeConfirmarPedido` exige para su propio chequeo de idempotencia.
 */
export async function accionEvitablementeNoCerrada(input: {
  action: AgentActionType;
  conversationId: string;
  productosDelPedido: ProductoDelCatalogo[];
  history: { direction: string; text: string | null; createdAt: Date }[];
  estadoGuardado?: EstadoDelPedido | null;
  requisitos?: Requisito[];
  minimoDomicilioCents?: number;
}): Promise<boolean> {
  if (!input.estadoGuardado) return false;
  if (input.action.action === "notify_order") return false;
  if (input.productosDelPedido.length === 0) return false;

  const veredicto = await puedeConfirmarPedido({
    conversationId: input.conversationId,
    productosDelPedido: input.productosDelPedido,
    history: input.history,
    estadoGuardado: input.estadoGuardado,
    requisitos: input.requisitos,
    ...(input.minimoDomicilioCents
      ? { minimoDomicilioCents: input.minimoDomicilioCents }
      : {}),
  });
  return veredicto.ok;
}

/** Lo que este intento dejó, para la traza y las métricas — nunca para decidir nada más. */
export type ResultadoDeRescate = {
  exito: boolean;
  /** Para el log y la traza: qué pasó, en una palabra estable. */
  motivo:
    | "sin_modelo_configurado"
    | "gemini_no_confirmo"
    | "gemini_fallo"
    | "rescatado";
  /** El modelo que se usó para el juicio de confirmación, si se llegó a llamar. */
  modelo?: string;
  /** Si la redacción final (summary/farewell) vino de GPT o, en su defecto, de Gemini. */
  redactadoPor?: "principal" | "salvavidas";
};

/** Un resumen de la hoja, hecho con texto plano — nunca con un modelo. */
export function resumenDeLaHoja(estado: EstadoDelPedido, requisitos: Requisito[]): string {
  const items = estado.items
    .map((i) => {
      const nombre = i.ofrecible.nombre ?? "(producto)";
      const opciones = i.seleccion.length
        ? ` (${i.seleccion.map((o) => o.nombre).join(", ")})`
        : "";
      return `${i.cantidad}x ${nombre}${opciones}`;
    })
    .join(", ");
  const datos = requisitos
    .filter((r) => estado.datos[r.id]?.trim())
    .map((r) => `${r.etiqueta}: ${estado.datos[r.id]}`)
    .join(", ");
  const total = estado.totalCents !== null ? enPesos(estado.totalCents) : "sin calcular";
  return `${items || "(sin ítems)"}. Total: ${total}.${datos ? ` Datos ya dados: ${datos}.` : ""}`;
}

/** El único juicio que se le pide al salvavidas: ¿esto es una confirmación? */
function hechoDeHojaCompleta(resumen: string): ChatMessage {
  return {
    role: "system",
    content:
      `[SISTEMA] El pedido de esta conversación está COMPLETO según el backend: ${resumen} ` +
      `Si el ÚLTIMO mensaje del cliente es una confirmación —aunque sea informal o corta ` +
      `("listo", "sip", "siii", "sí", "así está bien", "confirmo", "dale")—, usa la acción ` +
      `notify_order. Si no lo es, responde con la acción que de verdad corresponda.`,
  };
}

/** Restringido a propósito: aquí GPT no puede volver a proponer una acción. */
const RedaccionDeCierre = z.object({
  /** El texto que verá el EQUIPO por WhatsApp. */
  summary: z.string().min(1),
  /** La despedida para el CLIENTE. */
  farewell: z.string().min(1),
});

function hechoParaRedactar(resumen: string): ChatMessage {
  return {
    role: "system",
    content:
      `[SISTEMA] Este pedido ya fue verificado y confirmado por el sistema: ${resumen} ` +
      `Redacta el resumen para el equipo (summary) y la despedida para el cliente (farewell), ` +
      `en el tono habitual de este negocio. No repitas cifras que no aparezcan arriba.`,
  };
}

/**
 * El veredicto del intento de rescate. `rescatado: false` significa
 * exactamente "no hagas nada": quien llama debe seguir con la acción
 * original de GPT, intacta — nunca hay una acción "vacía" que interpretar.
 */
export type RescateDeCierre =
  | { rescatado: true; accion: AgentActionType; info: ResultadoDeRescate }
  | { rescatado: false; info: ResultadoDeRescate };

/**
 * El intento de rescate completo: como máximo una llamada a Gemini y, si
 * confirma, como máximo una llamada más a GPT para redactar. Sin loops, sin
 * reintentos encadenados — un `chatJson` que falla o discrepa simplemente
 * termina el intento, nunca lo repite.
 */
export async function intentarRescateDeCierre(input: {
  /** El historial + prompt que YA vio GPT — Gemini ve exactamente lo mismo, más un hecho. */
  messages: ChatMessage[];
  estadoGuardado: EstadoDelPedido;
  requisitos: Requisito[];
}): Promise<RescateDeCierre> {
  const modelo = modeloDeRescate();
  if (!modelo) {
    // Rollback de una variable: sin OPENROUTER_FALLBACK_MODEL, este mecanismo
    // completo queda apagado, sin tocar código ni dato.
    return { rescatado: false, info: { exito: false, motivo: "sin_modelo_configurado" } };
  }

  const resumen = resumenDeLaHoja(input.estadoGuardado, input.requisitos);

  const juicio = await chatJson(AgentAction, [...input.messages, hechoDeHojaCompleta(resumen)], {
    model: modelo,
  });

  if (!juicio.ok || juicio.data.action !== "notify_order") {
    return {
      rescatado: false,
      info: {
        exito: false,
        motivo: juicio.ok ? "gemini_no_confirmo" : "gemini_fallo",
        modelo,
      },
    };
  }

  // Gemini confirmó. Los montos SIEMPRE salen del backend — nunca de lo que
  // Gemini escribió, aunque su respuesta traiga cifras propias.
  const montos = {
    subtotalCents: input.estadoGuardado.totalCents ?? undefined,
    totalCents: input.estadoGuardado.totalCents ?? undefined,
  };

  // La redacción final: se intenta con GPT (el principal, la voz del
  // negocio) y solo si eso falla se usa la de Gemini como respaldo — nunca
  // al revés, y nunca las dos a la vez.
  const redaccion = await chatJson(RedaccionDeCierre, [...input.messages, hechoParaRedactar(resumen)]);

  const summary = redaccion.ok ? redaccion.data.summary : juicio.data.summary;
  const farewell = redaccion.ok ? redaccion.data.farewell : juicio.data.farewell;

  return {
    rescatado: true,
    accion: {
      action: "notify_order",
      summary,
      farewell,
      ...montos,
    },
    info: {
      exito: true,
      motivo: "rescatado",
      modelo,
      redactadoPor: redaccion.ok ? "principal" : "salvavidas",
    },
  };
}
