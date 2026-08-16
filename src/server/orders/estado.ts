/**
 * El estado del pedido, mantenido por el BACKEND — Fase 2.
 *
 * **La regla que gobierna todo este archivo**: el LLM propone, el backend
 * valida y es la fuente de verdad. Aquí no entra nada que no haya pasado por
 * `normalizarPedido`, y el total **siempre** lo recalcula el servidor.
 *
 * Se reemplaza la fila entera en cada turno: sin deltas ni merges. Es seguro
 * porque la cola garantiza un turno por conversación a la vez
 * ([34-COLA-DE-TURNOS.md](../../../docs/korexia/34-COLA-DE-TURNOS.md)) y elimina
 * una familia completa de bugs de fusión.
 *
 * ⚠️ **Nada de esto corre para ningún cliente todavía**: se lee solo cuando
 * `agent_profile.state_source = 'backend'`, y hoy los cuatro están en
 * `'prompt'`.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";
import { normalizarPedido, type EstadoPropuesto } from "./normalizar";
import type { Actor } from "@/server/registro-de-cambios";
import { paraLog } from "@/server/registro-de-cambios";

/** La forma del estado. Cambiarla obliga a subir `SCHEMA_VERSION`. */
export const SCHEMA_VERSION = 1;

export type EstadoDelPedido = {
  schema_version: number;
  producto: {
    /** Resuelto por el backend contra `product`. `null` = aún sin elegir. */
    id: string | null;
    /** Redundante a propósito: si el producto se borra, el estado sigue legible. */
    nombre: string | null;
    cantidad: number;
  };
  salsas: string[];
  recubierto: string | null;
  adiciones: string[];
  entrega: {
    nombre: string | null;
    telefono: string | null;
    direccion: string | null;
  };
  /** Lo calcula el servidor. NUNCA el número que diga el modelo. */
  totalCents: number | null;
  /** Texto libre: el modelo devuelve etiquetas que ningún enum previó. */
  paso: string;
  /** El cliente dijo que sí. Distinto de "el pedido está completo". */
  confirmado: boolean;
};

export function estadoVacio(): EstadoDelPedido {
  return {
    schema_version: SCHEMA_VERSION,
    producto: { id: null, nombre: null, cantidad: 1 },
    salsas: [],
    recubierto: null,
    adiciones: [],
    entrega: { nombre: null, telefono: null, direccion: null },
    totalCents: null,
    paso: "sin pedido",
    confirmado: false,
  };
}

/** Lo que el modelo propone, antes de que el backend decida nada. */
export type PropuestaDelModelo = EstadoPropuesto & {
  paso?: string | number | null;
  confirmado?: boolean;
};

export type Validacion = {
  /** `false` = NO se persiste. */
  ok: boolean;
  estado: EstadoDelPedido;
  /** Por qué se rechaza, en palabras que se puedan leer en un log. */
  rechazos: string[];
  /** Lo que el backend corrigió por su cuenta (mayúsculas, tildes, cantidad). */
  correcciones: string[];
  /** Lo que no puede decidir solo: hay que preguntárselo al cliente. */
  dudas: { campo: string; preguntar: string }[];
};

/**
 * Valida una propuesta del modelo contra el catálogo REAL de esa organización.
 *
 * Reutiliza `normalizarPedido`, que ya resuelve productos y opciones, corrige
 * nombres y recalcula el total. Aquí se añade lo que aquel no podía saber: si
 * el ESTADO en su conjunto es posible.
 */
export function validarPropuesta(
  propuesta: PropuestaDelModelo,
  catalogo: ProductoDelCatalogo[],
  unidadesPorProducto?: Record<string, number>
): Validacion {
  const rechazos: string[] = [];

  const r = normalizarPedido(
    {
      producto: propuesta.producto,
      cantidad: propuesta.cantidad,
      salsas: propuesta.salsas ?? [],
      recubierto: propuesta.recubierto,
      adiciones: propuesta.adiciones ?? [],
      nombre: propuesta.nombre,
      telefono: propuesta.telefono,
      direccion: propuesta.direccion,
    },
    catalogo,
    unidadesPorProducto
  );

  /*
   * La cantidad se valida sobre lo que PROPUSO EL MODELO, no sobre lo
   * normalizado.
   *
   * `normalizarPedido` corrige a 1 cualquier cantidad menor —es lo correcto
   * para no tumbar una conversación—, pero eso significa que un `0` o un `-3`
   * llegarían aquí convertidos en un `1` perfectamente válido. Y una propuesta
   * negativa no es un detalle de formato: es señal de que la extracción se
   * torció, y quiero enterarme el día que empiece a pasar.
   */
  const cruda = propuesta.cantidad;
  if (cruda !== null && cruda !== undefined && (!Number.isInteger(cruda) || cruda < 1)) {
    rechazos.push(`cantidad inválida: ${cruda}`);
  }
  const cantidad = Number(r.estado.cantidad);

  const confirmado = propuesta.confirmado === true;
  const estado: EstadoDelPedido = {
    schema_version: SCHEMA_VERSION,
    producto: {
      id: r.estado.productoId,
      nombre: r.estado.producto,
      cantidad: Number.isInteger(cantidad) && cantidad >= 1 ? cantidad : 1,
    },
    salsas: r.estado.salsas,
    recubierto: r.estado.recubierto,
    adiciones: r.estado.adiciones,
    entrega: {
      nombre: propuesta.nombre ?? null,
      telefono: propuesta.telefono ?? null,
      direccion: propuesta.direccion ?? null,
    },
    totalCents: r.estado.totalCents,
    // `paso` llega como número cuando el prompt del negocio numera sus mensajes.
    paso: String(propuesta.paso ?? "sin pedido"),
    confirmado,
  };

  /*
   * ESTADOS IMPOSIBLES.
   *
   * Un pedido "confirmado" sin producto, sin destino o sin precio no es un
   * pedido: es una venta que nadie puede despachar ni cobrar. El modelo puede
   * proponerlo —dice que sí a todo— y el backend tiene que negarse.
   */
  if (confirmado) {
    if (!estado.producto.id) rechazos.push("confirmado sin producto resuelto");
    if (estado.totalCents === null) rechazos.push("confirmado sin total calculado");
    if (!estado.entrega.nombre?.trim()) rechazos.push("confirmado sin nombre");
    if (!estado.entrega.telefono?.trim()) rechazos.push("confirmado sin teléfono");
    if (!estado.entrega.direccion?.trim()) rechazos.push("confirmado sin dirección");
  }

  // Una salsa que no resolvió es una opción incompatible con ese producto.
  for (const d of r.dudas) {
    if (d.campo === "salsas" && d.porque.includes("no está entre las opciones")) {
      rechazos.push(d.porque);
    }
  }

  return {
    ok: rechazos.length === 0,
    estado,
    rechazos,
    correcciones: r.correcciones.map((c) => `${c.campo}: «${c.de}» → «${c.a}» (${c.regla})`),
    dudas: r.dudas.map((d) => ({ campo: d.campo, preguntar: d.preguntar })),
  };
}

/** El estado guardado, o `null` si esta conversación aún no tiene. */
export async function leerEstado(conversationId: string): Promise<EstadoDelPedido | null> {
  const db = getDb();
  const [fila] = await db
    .select()
    .from(schema.conversationState)
    .where(eq(schema.conversationState.conversationId, conversationId));
  if (!fila) return null;

  const guardado = fila.estado as EstadoDelPedido;
  /*
   * Una forma que no reconocemos NO se usa a medias.
   *
   * Con `schema_version` mayor que la nuestra, el estado lo escribió una
   * versión más nueva del código: leerlo sería inventarse los campos que
   * faltan. Se empieza limpio, que es recuperable, en vez de arrastrar basura.
   */
  if (!guardado || typeof guardado !== "object" || guardado.schema_version > SCHEMA_VERSION) {
    return null;
  }
  return guardado;
}

/**
 * Guarda el estado REEMPLAZANDO la fila entera, y deja rastro campo por campo.
 *
 * La instrumentación va aquí desde el primer commit (regla 6): un escritor
 * nuevo sin trazabilidad es exactamente lo que este proyecto acaba de cerrar.
 */
export async function guardarEstado(
  entrada: {
    conversationId: string;
    organizationId: string;
    estado: EstadoDelPedido;
    actor: Actor;
    proceso: string;
  }
): Promise<void> {
  const db = getDb();
  const anterior = await leerEstado(entrada.conversationId);

  await db
    .insert(schema.conversationState)
    .values({
      conversationId: entrada.conversationId,
      organizationId: entrada.organizationId,
      estado: entrada.estado,
      schemaVersion: entrada.estado.schema_version,
      paso: entrada.estado.paso,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.conversationState.conversationId,
      set: {
        estado: entrada.estado,
        schemaVersion: entrada.estado.schema_version,
        paso: entrada.estado.paso,
        updatedAt: new Date(),
      },
    });

  registrarCambioDeEstado({
    conversationId: entrada.conversationId,
    antes: anterior,
    despues: entrada.estado,
    actor: entrada.actor,
    proceso: entrada.proceso,
  });
}

/** Vacía el estado. Es lo que hace el `"0"` de La Churra. */
export async function borrarEstado(
  conversationId: string,
  opciones: { actor: Actor; proceso: string }
): Promise<void> {
  const db = getDb();
  const anterior = await leerEstado(conversationId);
  await db
    .delete(schema.conversationState)
    .where(eq(schema.conversationState.conversationId, conversationId));
  if (anterior) {
    registrarCambioDeEstado({
      conversationId,
      antes: anterior,
      despues: null,
      actor: opciones.actor,
      proceso: opciones.proceso,
    });
  }
}

/** Aplana el estado a `producto.cantidad`, `entrega.telefono`… */
function aplanar(e: EstadoDelPedido | null): Record<string, unknown> {
  if (!e) return {};
  return {
    "producto.id": e.producto.id,
    "producto.nombre": e.producto.nombre,
    "producto.cantidad": e.producto.cantidad,
    salsas: e.salsas.join(", "),
    recubierto: e.recubierto,
    adiciones: e.adiciones.join(", "),
    "entrega.nombre": e.entrega.nombre,
    "entrega.telefono": e.entrega.telefono,
    "entrega.direccion": e.entrega.direccion,
    totalCents: e.totalCents,
    paso: e.paso,
    confirmado: e.confirmado,
  };
}

/**
 * Un log por CAMPO del estado, no uno por escritura.
 *
 * "El estado cambió" no dice nada al investigar. "`producto.cantidad` pasó de 1
 * a 6" dice exactamente dónde mirar — y es la diferencia entre encontrar un
 * cobro de más en un minuto o en una auditoría forense.
 */
function registrarCambioDeEstado(entrada: {
  conversationId: string;
  antes: EstadoDelPedido | null;
  despues: EstadoDelPedido | null;
  actor: Actor;
  proceso: string;
}): void {
  try {
    const a = aplanar(entrada.antes);
    const b = aplanar(entrada.despues);
    const campos = new Set([...Object.keys(a), ...Object.keys(b)]);
    const timestamp = new Date().toISOString();

    for (const campo of campos) {
      if (a[campo] === b[campo]) continue;
      console.log(
        `[cambio] tabla=conversation_state registro=${entrada.conversationId} ` +
          `campo=${campo} valor_anterior=${paraLog(campo, a[campo])} ` +
          `valor_nuevo=${paraLog(campo, b[campo])} proceso=${entrada.proceso} ` +
          `actor=${entrada.actor} timestamp=${timestamp}`
      );
    }
  } catch (err) {
    console.warn(`[cambio] no se pudo registrar el estado: ${(err as Error).message}`);
  }
}

/** Cómo acabó el turno para el estado. */
export type ResultadoDelTurno = "guardado" | "rechazado" | "sin_propuesta" | "error";

export type MetricaDeEstado = {
  organizationId: string;
  conversationId: string;
  resultado: ResultadoDelTurno;
  /** Ausente cuando el modelo no propuso estado, o cuando la validación ni corrió. */
  validacion?: Validacion;
  /** Milisegundos de la llamada al modelo que trae la propuesta. */
  msModelo?: number;
  /** Milisegundos que tarda el BACKEND en validar y persistir. */
  msBackend: number;
  /** El error, cuando `resultado = "error"`. */
  detalle?: string;
};

/**
 * Las seis métricas de la regla 10, en UNA línea por turno.
 *
 * **Por qué una línea y no seis contadores**: un contador dice *cuántos*, y la
 * pregunta del piloto es *cuál* — qué conversación, qué se corrigió y por qué se
 * rechazó. Con la línea completa las seis se derivan grepeando, y no hace falta
 * decidir hoy qué agregación se querrá mañana. Es la misma decisión que ya se
 * tomó para el registro de cambios: log estructurado antes que tabla.
 *
 * Cómo se saca cada una de las seis:
 *
 * | Regla 10 | De dónde sale |
 * |---|---|
 * | Estados inválidos | `resultado=rechazado` · el porqué en `motivos=` |
 * | Estados corregidos | `correcciones=N` · qué campos en `campos_corregidos=` |
 * | Turnos por pedido | líneas con el mismo `conv=` hasta `confirmado=true` |
 * | Pedidos abandonados | un `conv=` que nunca llega a `confirmado=true` |
 * | Coste por conversación | ya existía: `registrarUsoIa(…, "conv:<id>")` |
 * | Tiempo de extracción | `ms_modelo=` (la llamada) y `ms_backend=` (validar y persistir) |
 *
 * **Nunca lanza y nunca vuelca valores del cliente**: van los NOMBRES de los
 * campos corregidos, no lo que el cliente escribió. Un log de métricas se acaba
 * pegando en un chat, y ahí no puede aparecer la dirección de nadie.
 */
export function registrarMetricaDeEstado(m: MetricaDeEstado): void {
  try {
    const v = m.validacion;
    // Solo el nombre del campo: `correcciones` viene como "campo: «de» → «a»".
    const campos = (v?.correcciones ?? []).map((c) => c.split(":")[0]!.trim());
    const linea =
      `[metrica] evento=estado org=${m.organizationId} conv=${m.conversationId} ` +
      `resultado=${m.resultado} ` +
      `paso=${paraLog("paso", v?.estado.paso ?? "-")} ` +
      `confirmado=${v?.estado.confirmado ?? "-"} ` +
      `producto=${paraLog("producto", v?.estado.producto.nombre ?? "-")} ` +
      `total_cents=${v?.estado.totalCents ?? "-"} ` +
      `correcciones=${campos.length} ` +
      `campos_corregidos=${campos.length ? campos.join("|") : "-"} ` +
      `rechazos=${v?.rechazos.length ?? 0} ` +
      `motivos=${v?.rechazos.length ? paraLog("motivos", v.rechazos.join(" · ")) : "-"} ` +
      `dudas=${v?.dudas.length ?? 0} ` +
      `ms_modelo=${m.msModelo ?? "-"} ms_backend=${m.msBackend} ` +
      (m.detalle ? `detalle=${paraLog("detalle", m.detalle)} ` : "") +
      `timestamp=${new Date().toISOString()}`;

    // Rechazado y error se ven en `warn`: son lo que hay que mirar a diario
    // durante el piloto. El resto es material de análisis, no una alarma.
    if (m.resultado === "rechazado" || m.resultado === "error") console.warn(linea);
    else console.log(linea);
  } catch (err) {
    console.warn(`[metrica] no se pudo registrar: ${(err as Error).message}`);
  }
}
