/**
 * Cuánto cuesta atender a un cliente y cuánto cobrarle.
 *
 * Nació de un error de bulto en la primera tabla de precios: cobrar "por
 * conversación". Dos negocios con el mismo número de conversaciones pueden
 * costar el doble uno que otro, porque lo que se paga NO es la conversación
 * sino **cada respuesta**. Una pastelería que cierra en 8 mensajes y una
 * inmobiliaria que necesita 20 no se parecen en nada, y ya se nota entre los
 * dos clientes actuales: La Churra manda 6,7 mensajes por conversación y Lis
 * 8,3.
 *
 * Aquí solo hay aritmética, sin dependencias: así se puede probar de verdad y
 * la pantalla se limita a pintar el resultado.
 */

/**
 * Lo que cuesta una respuesta del agente, medido — no estimado.
 *
 * Sale de las 38 llamadas reales registradas en `usage_event`: La Churra
 * 0,00197 USD por llamada y Lis 0,00202. Que coincidan tanto no es casualidad:
 * lo que domina el costo es el prompt del sistema, que se manda entero en cada
 * turno y pesa mucho más que lo que se hablan cliente y agente. Por eso una
 * conversación larga no sale más cara por respuesta.
 */
export const COSTO_RESPUESTA_IA_USD = 0.002;

/** Tarifa de Meta por mensaje de servicio en Colombia, desde el 1-oct-2026.
 * Rate card de abril-2026: reverificar cuando Meta publique la definitiva. */
export const TARIFA_MENSAJE_USD = 0.0008;

/** Plantilla de marketing: 15 veces más cara que una respuesta normal. Es el
 * único gasto capaz de arruinar un plan, y por eso se cotiza aparte. */
export const TARIFA_MARKETING_USD = 0.0125;

/**
 * Lo que le cuesta al negocio una persona a jornada completa contestando
 * WhatsApp: salario mínimo 2026 (1.750.905 COP) + auxilio de transporte
 * (249.095) + prestaciones ≈ 2.900.000 COP al mes.
 *
 * Es el número contra el que se compara el precio. El costo de los tokens no
 * sirve para poner precio: el cliente no compra tokens, compra que alguien
 * conteste a las once de la noche.
 */
export const COSTO_PERSONA_MES_COP = 2_900_000;

export type EntradasCotizacion = {
  /** Conversaciones al mes. Se pide por día en la pantalla y se multiplica. */
  conversacionesMes: number;
  /** Mensajes que envía EL BOT en una conversación. La variable que más pesa. */
  mensajesBotPorConversacion: number;
  /** Mensajes que envía UNA PERSONA desde la bandeja o el celular. Cuestan
   * WhatsApp pero no IA: quien los escribe no cobra por token. */
  mensajesPersonaPorConversacion: number;
  campanasPorMes: number;
  contactosPorCampana: number;
  costoVpsUsd: number;
  /** Entre cuántos clientes se reparte el servidor. Con pocos, pesa. */
  clientesEnVps: number;
  trm: number;
  /** Tarifas, ajustables porque Meta las cambia y el modelo puede cambiar. */
  costoRespuestaIaUsd?: number;
  tarifaMensajeUsd?: number;
  tarifaMarketingUsd?: number;
};

export type Cotizacion = {
  respuestasIa: number;
  mensajesSalientes: number;
  mensajesMarketing: number;
  costoIaUsd: number;
  costoWhatsappUsd: number;
  costoMarketingUsd: number;
  costoServidorUsd: number;
  costoTotalUsd: number;
  costoTotalCop: number;
  /** Lo que cuesta atender UNA conversación, con todo repartido. */
  costoPorConversacionUsd: number;
  /** Lo que sube el costo del mes por cada mensaje más en cada conversación.
   * Es la respuesta a "¿y si en vez de 10 mensajes son 20?". */
  costoPorMensajeExtraUsd: number;
};

const positivo = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function cotizar(e: EntradasCotizacion): Cotizacion {
  const costoIa = e.costoRespuestaIaUsd ?? COSTO_RESPUESTA_IA_USD;
  const tarifaMsg = e.tarifaMensajeUsd ?? TARIFA_MENSAJE_USD;
  const tarifaMkt = e.tarifaMarketingUsd ?? TARIFA_MARKETING_USD;

  const conversaciones = positivo(e.conversacionesMes);
  const msgBot = positivo(e.mensajesBotPorConversacion);
  const msgPersona = positivo(e.mensajesPersonaPorConversacion);

  const respuestasIa = conversaciones * msgBot;
  const mensajesSalientes = conversaciones * (msgBot + msgPersona);
  const mensajesMarketing = positivo(e.campanasPorMes) * positivo(e.contactosPorCampana);

  const costoIaUsd = respuestasIa * costoIa;
  const costoWhatsappUsd = mensajesSalientes * tarifaMsg;
  const costoMarketingUsd = mensajesMarketing * tarifaMkt;
  // Un servidor no se puede repartir entre menos de un cliente.
  const costoServidorUsd = positivo(e.costoVpsUsd) / Math.max(1, positivo(e.clientesEnVps));

  const costoTotalUsd =
    costoIaUsd + costoWhatsappUsd + costoMarketingUsd + costoServidorUsd;

  return {
    respuestasIa,
    mensajesSalientes,
    mensajesMarketing,
    costoIaUsd,
    costoWhatsappUsd,
    costoMarketingUsd,
    costoServidorUsd,
    costoTotalUsd,
    costoTotalCop: costoTotalUsd * positivo(e.trm),
    costoPorConversacionUsd: conversaciones > 0 ? costoTotalUsd / conversaciones : 0,
    costoPorMensajeExtraUsd: conversaciones * (costoIa + tarifaMsg),
  };
}

/** Precio que deja el margen pedido. `margen` va en tanto por uno (0,85 = 85 %). */
export function precioParaMargen(costoUsd: number, margen: number): number {
  const m = Math.min(Math.max(margen, 0), 0.99);
  return costoUsd / (1 - m);
}

/** El margen que deja un precio, en tanto por uno. Negativo = se pierde plata. */
export function margenDe(precioUsd: number, costoUsd: number): number {
  if (precioUsd <= 0) return 0;
  return (precioUsd - costoUsd) / precioUsd;
}

/**
 * Cuántas conversaciones al mes aguanta un precio antes de dejar de ganar.
 *
 * Sirve para poner el tope del plan con criterio: se pone bastante por debajo
 * de este número, no pegado a él, porque el mes que el cliente tenga un pico
 * no se puede acabar el margen.
 */
export function conversacionesDeEquilibrio(
  precioUsd: number,
  e: EntradasCotizacion
): number {
  const costoIa = e.costoRespuestaIaUsd ?? COSTO_RESPUESTA_IA_USD;
  const tarifaMsg = e.tarifaMensajeUsd ?? TARIFA_MENSAJE_USD;
  const msgBot = positivo(e.mensajesBotPorConversacion);
  const msgPersona = positivo(e.mensajesPersonaPorConversacion);

  const porConversacion = msgBot * costoIa + (msgBot + msgPersona) * tarifaMsg;
  if (porConversacion <= 0) return Infinity;

  const fijos =
    positivo(e.costoVpsUsd) / Math.max(1, positivo(e.clientesEnVps)) +
    positivo(e.campanasPorMes) *
      positivo(e.contactosPorCampana) *
      (e.tarifaMarketingUsd ?? TARIFA_MARKETING_USD);

  const disponible = precioUsd - fijos;
  return disponible <= 0 ? 0 : disponible / porConversacion;
}
