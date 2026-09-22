import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { modeloDeRescate } from "@/lib/ai/modelos";
import { AgentAction, type AgentActionType } from "@/server/ai/actions";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import { puedeConfirmarCita } from "@/server/appointments/policy";
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
 * backend YA sabe la respuesta**. Gemini no arbitra nada — solo responde la
 * única pregunta que quedó sin resolver: ¿este mensaje es la acción de
 * cierre? Y ni siquiera esa respuesta se usa literal: los datos que de
 * verdad importan (montos, fecha, hora) SIEMPRE salen de `estadoGuardado`,
 * nunca de lo que escriba ningún modelo.
 *
 * ## Alcance ampliado (21-sep-2026, sobre la versión original de este archivo)
 *
 * La primera versión cubría solo `notify_order`. El dueño pidió generalizar
 * a los cuatro casos de la arquitectura: intención conocida no resuelta,
 * handoff evitable, acción ejecutable no identificada, cierre que el backend
 * puede validar. Los cuatro son, en este código, la MISMA condición aplicada
 * a dos acciones distintas — no cuatro detectores independientes, porque eso
 * sí sería inventar cuatro heurísticas sin respaldo:
 *
 * | Acción de cierre | Autoridad backend reutilizada | ¿Nueva? |
 * |---|---|---|
 * | `notify_order` (pedidos) | `puedeConfirmarPedido` (`orders/policy.ts`) | no, ya existía |
 * | `book_appointment` (citas) | `puedeConfirmarCita` (`appointments/policy.ts`) | sí, añadida aquí |
 *
 * **Deliberadamente FUERA de alcance, y por qué**: `reschedule_appointment`
 * y `cancel_appointment` no tienen una función de "¿está completo?" que
 * invertir — su Policy (doc 156, Fase 3) solo cubre idempotencia (no
 * repetir la MISMA reprogramación/cancelación), no una noción de "hoja
 * lista". Sin ese hecho backend, activar un salvavidas ahí sería la
 * heurística de texto que este archivo existe para evitar. Cualquier
 * handoff que NO tenga un pedido o una cita backend-completos detrás sigue
 * siendo, siempre, un handoff legítimo — el mecanismo no lo toca.
 */

// ============================================================ pedidos ====

/**
 * ¿Esta acción —tal como quedó DESPUÉS de todos los guardarraíles
 * existentes— es un cierre evitable de un PEDIDO que el backend ya
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

// =============================================================== citas ====

/**
 * El equivalente exacto de `accionEvitablementeNoCerrada`, para CITAS.
 *
 * Reutiliza `puedeConfirmarCita` sin modificarla — la misma autoridad que
 * hoy solo se consulta DENTRO de `case "book_appointment"` para decidir si
 * una reserva YA propuesta puede agendarse. Aquí se usa ANTES, para detectar
 * que el modelo no la propuso.
 *
 * `puedeConfirmarCita` es síncrona (no consulta la base): por eso esta
 * función no necesita ser `async` para nada más que mantener la misma forma
 * que su par de pedidos — se deja `async` de todos modos para que quien
 * llame no tenga que distinguir cuál de las dos está usando.
 */
export function citaEvitablementeNoCerrada(input: {
  action: AgentActionType;
  estadoGuardado?: EstadoDelPedido | null;
  requisitos?: Requisito[];
}): boolean {
  if (!input.estadoGuardado) return false;
  if (input.action.action === "book_appointment") return false;

  const veredicto = puedeConfirmarCita({
    estadoGuardado: input.estadoGuardado,
    requisitos: input.requisitos,
  });
  return veredicto.ok;
}

// ===================================================== motor compartido ====

/** Lo que este intento dejó, para la traza y las métricas — nunca para decidir nada más. */
export type ResultadoDeRescate = {
  exito: boolean;
  /** Qué se intentó rescatar. */
  objetivo: "pedido" | "cita";
  /** Para el log y la traza: qué pasó, en una palabra estable. */
  motivo: "sin_modelo_configurado" | "gemini_no_confirmo" | "gemini_fallo" | "rescatado";
  /** El modelo que se usó para el juicio, si se llegó a llamar. */
  modelo?: string;
  /** Si la redacción final (summary/farewell) vino de GPT o, en su defecto, de Gemini. */
  redactadoPor?: "principal" | "salvavidas";
};

/** Un resumen del PEDIDO, hecho con texto plano — nunca con un modelo. */
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

/** Un resumen de la CITA, hecho con texto plano — nunca con un modelo. */
export function resumenDeLaReserva(estado: EstadoDelPedido, requisitos: Requisito[]): string {
  const servicios = estado.items.map((i) => i.ofrecible.nombre ?? "(servicio)").join(", ");
  const fecha = estado.reserva?.fecha ?? "sin fecha";
  const hora = estado.reserva?.hora ?? "sin hora";
  const especialista = estado.reserva?.recursoNombre;
  const datos = requisitos
    .filter((r) => estado.datos[r.id]?.trim())
    .map((r) => `${r.etiqueta}: ${estado.datos[r.id]}`)
    .join(", ");
  return (
    `${servicios || "(sin servicio)"}, ${fecha} ${hora}` +
    `${especialista ? ` con ${especialista}` : ""}.` +
    `${datos ? ` Datos ya dados: ${datos}.` : ""}`
  );
}

/** Restringido a propósito: aquí GPT no puede volver a proponer una acción. */
const RedaccionDeCierre = z.object({
  /** El texto que verá el EQUIPO por WhatsApp. */
  summary: z.string().min(1),
  /** La despedida para el CLIENTE. */
  farewell: z.string().min(1),
});

/** El único juicio que se le pide al salvavidas: ¿esto es la acción de cierre? */
function hechoDeHojaCompleta(resumen: string, accion: "notify_order" | "book_appointment"): ChatMessage {
  const sustantivo = accion === "notify_order" ? "El pedido" : "La cita";
  const ejemploAccion = accion === "notify_order" ? "notify_order" : "book_appointment";
  return {
    role: "system",
    content:
      `[SISTEMA] ${sustantivo} de esta conversación está COMPLETO/A según el backend: ${resumen} ` +
      `Si el ÚLTIMO mensaje del cliente es una confirmación —aunque sea informal o corta ` +
      `("listo", "sip", "siii", "sí", "así está bien", "confirmo", "dale")—, usa la acción ` +
      `${ejemploAccion}. Si no lo es, responde con la acción que de verdad corresponda.`,
  };
}

function hechoParaRedactar(resumen: string, accion: "notify_order" | "book_appointment"): ChatMessage {
  const sustantivo = accion === "notify_order" ? "Este pedido" : "Esta cita";
  return {
    role: "system",
    content:
      `[SISTEMA] ${sustantivo} ya fue verificado/a y confirmado/a por el sistema: ${resumen} ` +
      `Redacta el resumen para el equipo (summary) y la despedida para el cliente (farewell), ` +
      `en el tono habitual de este negocio. No repitas cifras ni datos que no aparezcan arriba.`,
  };
}

/**
 * El juicio + la redacción, compartidos entre pedidos y citas: como máximo
 * una llamada a Gemini (¿es esto una confirmación?) y, si confirma, como
 * máximo una llamada más a GPT para redactar. Sin loops, sin reintentos
 * encadenados.
 *
 * Devuelve `null` cuando Gemini no confirma o falla — quien llama debe
 * entonces dejar la acción original de GPT intacta.
 */
async function juicioYRedaccion(input: {
  messages: ChatMessage[];
  resumenParaJuicio: string;
  resumenParaRedactar: string;
  accionEsperada: "notify_order" | "book_appointment";
  objetivo: "pedido" | "cita";
}): Promise<
  | { ok: true; summary: string; farewell: string; redactadoPor: "principal" | "salvavidas"; modelo: string }
  | { ok: false; info: ResultadoDeRescate }
> {
  const modelo = modeloDeRescate();
  if (!modelo) {
    return {
      ok: false,
      info: { exito: false, objetivo: input.objetivo, motivo: "sin_modelo_configurado" },
    };
  }

  const juicio = await chatJson(
    AgentAction,
    [...input.messages, hechoDeHojaCompleta(input.resumenParaJuicio, input.accionEsperada)],
    { model: modelo }
  );

  if (!juicio.ok || juicio.data.action !== input.accionEsperada) {
    return {
      ok: false,
      info: {
        exito: false,
        objetivo: input.objetivo,
        motivo: juicio.ok ? "gemini_no_confirmo" : "gemini_fallo",
        modelo,
      },
    };
  }

  // La redacción final: se intenta con GPT (el principal, la voz del
  // negocio) y solo si eso falla se usa la de Gemini como respaldo — nunca
  // al revés, y nunca las dos a la vez.
  const redaccion = await chatJson(RedaccionDeCierre, [
    ...input.messages,
    hechoParaRedactar(input.resumenParaRedactar, input.accionEsperada),
  ]);

  /**
   * El respaldo de Gemini, cuando la redacción de GPT falla.
   *
   * `notify_order` sí trae `summary`/`farewell` propios (los pidió el mismo
   * esquema `AgentAction` que Gemini usó para el juicio). `book_appointment`
   * NO tiene `summary` en absoluto —no es un campo de esa acción— y
   * `farewell` es opcional, así que puede venir vacío. Para no arriesgar un
   * mensaje en blanco al cliente, el ÚLTIMO recurso —solo si ni Gemini
   * escribió nada usable— es el resumen determinista: nunca inventado por
   * un modelo, siempre trazable a `estadoGuardado`.
   */
  const juicioConTexto = juicio.data as AgentActionType & { summary?: string; farewell?: string };
  const respaldoSummary = juicioConTexto.summary?.trim() || `Confirmado: ${input.resumenParaRedactar}`;
  const respaldoFarewell =
    juicioConTexto.farewell?.trim() || `¡Listo! Quedó confirmado: ${input.resumenParaRedactar} 🎉`;

  return {
    ok: true,
    summary: redaccion.ok ? redaccion.data.summary : respaldoSummary,
    farewell: redaccion.ok ? redaccion.data.farewell : respaldoFarewell,
    redactadoPor: redaccion.ok ? "principal" : "salvavidas",
    modelo,
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

/** Rescate de PEDIDO — API sin cambios respecto a la versión original. */
export async function intentarRescateDeCierre(input: {
  messages: ChatMessage[];
  estadoGuardado: EstadoDelPedido;
  requisitos: Requisito[];
}): Promise<RescateDeCierre> {
  const resumen = resumenDeLaHoja(input.estadoGuardado, input.requisitos);
  const resultado = await juicioYRedaccion({
    messages: input.messages,
    resumenParaJuicio: resumen,
    resumenParaRedactar: resumen,
    accionEsperada: "notify_order",
    objetivo: "pedido",
  });
  if (!resultado.ok) return { rescatado: false, info: resultado.info };

  // Los montos SIEMPRE salen del backend — nunca de lo que Gemini escribió,
  // aunque su respuesta traiga cifras propias.
  return {
    rescatado: true,
    accion: {
      action: "notify_order",
      summary: resultado.summary,
      farewell: resultado.farewell,
      subtotalCents: input.estadoGuardado.totalCents ?? undefined,
      totalCents: input.estadoGuardado.totalCents ?? undefined,
    },
    info: {
      exito: true,
      objetivo: "pedido",
      motivo: "rescatado",
      modelo: resultado.modelo,
      redactadoPor: resultado.redactadoPor,
    },
  };
}

/** Rescate de CITA — mismo motor, la acción reconstruida desde `estadoGuardado`. */
export async function intentarRescateDeCita(input: {
  messages: ChatMessage[];
  estadoGuardado: EstadoDelPedido;
  requisitos: Requisito[];
}): Promise<RescateDeCierre> {
  const resumen = resumenDeLaReserva(input.estadoGuardado, input.requisitos);
  const resultado = await juicioYRedaccion({
    messages: input.messages,
    resumenParaJuicio: resumen,
    resumenParaRedactar: resumen,
    accionEsperada: "book_appointment",
    objetivo: "cita",
  });
  if (!resultado.ok) return { rescatado: false, info: resultado.info };

  // Fecha, hora y servicio SIEMPRE salen del backend — `puedeConfirmarCita`
  // ya garantizó que `estado.reserva.fecha/hora` existen, y son justo la
  // condición que activó este rescate.
  const reserva = input.estadoGuardado.reserva!;
  return {
    rescatado: true,
    accion: {
      action: "book_appointment",
      reservas: [
        {
          servicios: input.estadoGuardado.items.map((i) => i.ofrecible.nombre ?? "servicio"),
          fecha: reserva.fecha!,
          hora: reserva.hora!,
          ...(reserva.recursoNombre ? { especialista: reserva.recursoNombre } : {}),
        },
      ],
      farewell: resultado.farewell,
    },
    info: {
      exito: true,
      objetivo: "cita",
      motivo: "rescatado",
      modelo: resultado.modelo,
      redactadoPor: resultado.redactadoPor,
    },
  };
}

/**
 * El punto de entrada ÚNICO que usa `pipeline.ts`.
 *
 * Prueba primero el pedido y, solo si ahí no hay nada que rescatar, prueba
 * la cita — nunca las dos: en cuanto una condición aplica, se intenta esa y
 * se devuelve, así que **como mucho una llamada de juicio y una de
 * redacción por turno**, sin importar cuántas categorías de la arquitectura
 * cubra el resultado.
 */
export async function intentarRescatarTurno(input: {
  action: AgentActionType;
  conversationId: string;
  productosDelPedido: ProductoDelCatalogo[];
  history: { direction: string; text: string | null; createdAt: Date }[];
  messages: ChatMessage[];
  estadoGuardado?: EstadoDelPedido | null;
  requisitos?: Requisito[];
  minimoDomicilioCents?: number;
}): Promise<RescateDeCierre | null> {
  const esPedidoEvitable = await accionEvitablementeNoCerrada(input);
  if (esPedidoEvitable) {
    return intentarRescateDeCierre({
      messages: input.messages,
      estadoGuardado: input.estadoGuardado!,
      requisitos: input.requisitos ?? [],
    });
  }

  const esCitaEvitable = citaEvitablementeNoCerrada(input);
  if (esCitaEvitable) {
    return intentarRescateDeCita({
      messages: input.messages,
      estadoGuardado: input.estadoGuardado!,
      requisitos: input.requisitos ?? [],
    });
  }

  // Ninguna de las dos categorías aplica: no hay nada que rescatar. `null`,
  // no un `RescateDeCierre` con `rescatado:false`, para que quien llama no
  // tenga que fabricar un `info` que no describe nada real.
  return null;
}
