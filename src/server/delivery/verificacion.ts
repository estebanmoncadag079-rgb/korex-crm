import type { EntregaVerificada } from "@/server/orders/estado";
import {
  resolverZonaDeEntrega,
  siguientePasoDelDomicilio,
  textoDePedirBarrio,
  textoDeResultadoDomicilio,
  textoDeResultadoRecogida,
  type ResultadoBusquedaZona,
  type ZonaDeEntrega,
} from "./zonas";

/**
 * Qué pasa con el domicilio tras una consulta — la ÚNICA decisión, usada por
 * la búsqueda normal del turno y por la corrección antes de cerrar
 * (`pipeline.ts`). Hasta el 25-sep-2026 eran dos copias del mismo bloque.
 *
 * Regla del dueño para negocios con tabla de zonas (hoy MALIA):
 *  - zona encontrada → se cobra; el hecho para el modelo ya trae productos +
 *    domicilio = total, calculado aquí (el modelo copia, no suma);
 *  - no está en la tabla / varias posibles → se pide el barrio, UNA vez;
 *  - ya se pidió en un mensaje anterior y sigue sin resolverse → equipo.
 *
 * Sin tabla (`sin-tabla`), comportamiento de siempre: el domicilio se cotiza
 * aparte y aquí no se pide barrio ni se deriva por él.
 */
export type PasoTrasVerificar = "cobrar" | "pedir-barrio" | "pasar-al-equipo" | "recogida" | "sin-tabla";

export function verificarDomicilio(input: {
  consulta: { zona: string; recogida?: boolean };
  zonas: ZonaDeEntrega[];
  hayTablaDeZonas: boolean;
  /** La dirección que el cliente dio para este pedido (requisito de tipo dirección). */
  direccionDelCliente: string | null;
  /** Lo último verificado en esta conversación, antes de esta consulta. */
  entregaPrevia: EntregaVerificada | null;
  /** Subtotal de productos calculado por el backend, si ya lo hay. */
  subtotalCents: number | null | undefined;
  /** El mensaje del cliente que se está atendiendo. */
  mensajeId: string | null;
  /** Doc 200: la pregunta propia del negocio para pedir el barrio. */
  mensajePedirBarrio?: string;
}): {
  resultado: ResultadoBusquedaZona | null;
  paso: PasoTrasVerificar;
  infoZona: string;
  entrega: EntregaVerificada;
} {
  const ahora = new Date().toISOString();
  if (input.consulta.recogida === true) {
    return {
      resultado: null,
      paso: "recogida",
      infoZona: textoDeResultadoRecogida(),
      entrega: {
        tipo: "recogida",
        zonaId: null,
        zonaNombre: null,
        feeCents: null,
        verificadoEnMensajeId: input.mensajeId,
        verificadoEn: ahora,
      },
    };
  }

  let resultado = resolverZonaDeEntrega(input.zonas, input.consulta.zona);
  const previa = input.entregaPrevia;

  /**
   * El cliente ya dijo su barrio en este pedido (una consulta anterior lo
   * encontró) y después dio una dirección que por sí sola no lo nombra: esa
   * zona sigue valiendo. Volver a pedirle el barrio sería preguntarle lo que
   * ya contestó. Solo con una verificación SIN dirección asociada — es decir,
   * hecha por el barrio que el cliente nombró, no por otra dirección.
   */
  if (
    input.hayTablaDeZonas &&
    resultado.status !== "found" &&
    previa?.tipo === "domicilio" &&
    typeof previa.feeCents === "number" &&
    previa.zonaId &&
    !previa.direccion
  ) {
    const zona = input.zonas.find((z) => z.id === previa.zonaId);
    if (zona) resultado = { status: "found", zona };
  }

  const entregaBase: EntregaVerificada = {
    tipo: "domicilio",
    zonaId: resultado.status === "found" ? resultado.zona.id : null,
    zonaNombre: resultado.status === "found" ? resultado.zona.nombre : null,
    feeCents: resultado.status === "found" ? resultado.zona.feeCents : null,
    verificadoEnMensajeId: input.mensajeId,
    verificadoEn: ahora,
    direccion: input.direccionDelCliente,
  };

  if (!input.hayTablaDeZonas) {
    return {
      resultado,
      paso: "sin-tabla",
      infoZona: textoDeResultadoDomicilio(input.consulta.zona, resultado),
      entrega: { ...entregaBase, direccion: undefined },
    };
  }

  /**
   * ¿Ya se agotó pedir el barrio? Medido con el modelo real (25-sep-2026): se
   * pidió el barrio, la clienta contestó con su nombre y teléfono, y el modelo
   * volvió a buscar LA MISMA dirección — derivar ahí era demasiado pronto: no
   * se negó a dar el barrio, contestó otra cosa. Se agota solo si:
   *  - el cliente trajo un lugar NUEVO que tampoco está en la tabla, o
   *  - ya se le pidió en dos mensajes distintos y sigue sin barrio.
   * Dos búsquedas dentro del mismo mensaje nunca cuentan como dos respuestas.
   */
  const pendiente =
    previa?.tipo === "domicilio" && previa.feeCents === null && previa.barrioPedido === true
      ? previa
      : null;
  const mismoMensaje = pendiente?.verificadoEnMensajeId === input.mensajeId;
  const vecesPrevias = pendiente ? (pendiente.vecesPedidoBarrio ?? 1) : 0;
  const consultaAnterior = pendiente ? (pendiente.consultaSinZona ?? pendiente.direccion ?? null) : null;
  const esLaMismaBusqueda = mismaConsulta(consultaAnterior, input.consulta.zona);
  const barrioYaPedido =
    !!pendiente && !mismoMensaje && (!esLaMismaBusqueda || vecesPrevias >= 2);
  const vecesPedidoBarrio = !pendiente ? 1 : mismoMensaje ? vecesPrevias : vecesPrevias + 1;

  const paso = siguientePasoDelDomicilio({ resultado, barrioYaPedido });

  if (paso === "cobrar" && resultado.status === "found") {
    let infoZona = textoDeResultadoDomicilio(resultado.zona.nombre, resultado);
    if (typeof input.subtotalCents === "number") {
      const fee = resultado.zona.feeCents;
      infoZona += ` Cifras del pedido, calculadas por el sistema: productos ${enPesos(input.subtotalCents)} + domicilio ${enPesos(fee)} = total ${enPesos(input.subtotalCents + fee)}. El resumen y el total que le des al cliente deben incluir ese domicilio.`;
    }
    return { resultado, paso, infoZona, entrega: entregaBase };
  }

  const opciones = resultado.status === "multiple_matches" ? resultado.zonas : undefined;
  if (paso === "pedir-barrio") {
    return {
      resultado,
      paso,
      infoZona: textoDePedirBarrio(input.consulta.zona, opciones, input.mensajePedirBarrio),
      entrega: {
        ...entregaBase,
        barrioPedido: true,
        vecesPedidoBarrio,
        consultaSinZona: input.consulta.zona,
      },
    };
  }
  return {
    resultado,
    paso,
    infoZona: `[SISTEMA] Ya se le pidió el barrio al cliente y "${input.consulta.zona}" sigue sin estar en la tabla de domicilios. El equipo le confirmará el valor del domicilio.`,
    entrega: { ...entregaBase, barrioPedido: true },
  };
}

function mismaConsulta(a: string | null, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return a !== null && n(a) !== "" && n(a) === n(b);
}

function enPesos(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("es-CO", { minimumFractionDigits: 0 })}`;
}
