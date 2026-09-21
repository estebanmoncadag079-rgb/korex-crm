/**
 * El pedido mínimo para que salga un domicilio.
 *
 * ## Qué problema resuelve
 *
 * Un negocio que reparte pierde dinero cuando manda un domiciliario por un
 * pedido pequeño. Hasta hoy eso solo se podía escribir como una frase en las
 * reglas propias —*"no hacemos domicilios para un solo pavé de 8 oz"*— y
 * quien la hacía cumplir era el modelo. Es justo lo que el Principio 7
 * prohíbe: un dato que decide, decidido por el LLM.
 *
 * ## El contrato, aprobado por el negocio el 21-sep-2026
 *
 * **El mínimo es MONETARIO y se compara contra el SUBTOTAL de productos.**
 * Esa frase es el contrato entero, y las dos mitades importan:
 *
 * - **Monetario**: no hay ninguna regla por número de unidades ni por tamaño
 *   de producto. La única autoridad es `ficha.entrega.minimoDomicilioCents`
 *   más esta función. No se debe añadir lógica de "dos de X o uno de Y".
 * - **Contra el subtotal**: la tarifa de domicilio NUNCA cuenta para
 *   alcanzar el mínimo.
 *
 * El negocio aceptó explícitamente la consecuencia: **un solo producto
 * pequeño puede superar el mínimo a base de opciones de pago adicional**
 * (en MALIA, un pavé de 8 oz con 4 toppings llega a $18.000). Es deliberado,
 * no un hueco: el domicilio se paga a sí mismo igual, que es el fin de la
 * regla. No hay que "arreglarlo" añadiendo una condición de unidades.
 *
 * ## Por qué un IMPORTE, y no "dos unidades del producto X"
 *
 * Porque la regla del negocio, traducida, es económica: *un domicilio no sale
 * a cuenta por menos de X*. Un mínimo por unidades ni siquiera puede
 * expresarla —«uno de 16 oz» es UNA unidad y sí vale— y ataría el núcleo al
 * catálogo de un cliente concreto, que es exactamente lo que
 * `REGLAS-DE-ARQUITECTURA.md` no permite.
 *
 * Un importe es la forma general: cualquier negocio del CRM entiende "pedido
 * mínimo para domicilio". Y reproduce la regla real de MALIA sin inventar
 * nada, con su catálogo tal como está:
 *
 * | Pedido | Subtotal | ¿Sale? |
 * |---|---|---|
 * | 2 × pavé 8 oz | $20.000 | ✅ |
 * | 1 × pavé 16 oz | $18.000 | ✅ (iguala el mínimo) |
 * | 1 × pavé 8 oz | $10.000 | ❌ faltan $8.000 |
 *
 * ## Se compara contra el SUBTOTAL, nunca contra el total con domicilio
 *
 * Cobrar el envío para alcanzar el mínimo del envío es circular, y dejaría
 * pasar justo los pedidos que la regla quiere frenar: $10.000 de producto más
 * $10.000 de tarifa superarían cualquier mínimo razonable. `estado.totalCents`
 * es la suma de los ítems y NO incluye la tarifa (`normalizar.ts:818`), que es
 * precisamente lo que hace falta aquí.
 */
import { MODALIDAD_DOMICILIO } from "@/server/ai/generador/ficha";

/** Lo que falta para que el domicilio sea posible. Todo en centavos. */
export type FaltaParaElMinimo = {
  minimoCents: number;
  subtotalCents: number;
  faltanCents: number;
};

/**
 * `null` = este pedido puede salir a domicilio (o el mínimo no le aplica).
 * Un objeto = no llega, y dice por cuánto.
 *
 * Devuelve `null` —deja pasar— en todos los casos en que no hay una razón
 * clara para frenar:
 *
 * - el negocio no configuró mínimo;
 * - el pedido no es a domicilio, o todavía no se sabe cómo lo quiere recibir
 *   (frenar antes de saberlo sería pedirle al cliente que añada productos que
 *   quizá no necesita: puede estar recogiendo);
 * - el subtotal aún no está calculado, que significa "el backend todavía no
 *   puede sumar", no "vale cero" — ese caso ya tiene su propio guardarraíl en
 *   `puedeConfirmarPedido`.
 */
export function faltaParaElMinimoDeDomicilio(input: {
  minimoCents: number | null | undefined;
  modalidadDeEntrega: string | null | undefined;
  subtotalCents: number | null;
}): FaltaParaElMinimo | null {
  const minimoCents = input.minimoCents ?? 0;
  if (!Number.isFinite(minimoCents) || minimoCents <= 0) return null;

  // La modalidad viaja como texto libre desde el modelo y se normaliza antes
  // de llegar aquí — pero un guardarraíl no debe depender de que eso haya
  // ocurrido, así que compara como comparan las personas.
  const modalidad = (input.modalidadDeEntrega ?? "").trim().toLowerCase();
  if (modalidad !== MODALIDAD_DOMICILIO) return null;

  const subtotalCents = input.subtotalCents;
  if (subtotalCents === null || !Number.isFinite(subtotalCents)) return null;

  // Inclusivo: un pedido que iguala el mínimo lo cumple. Un `<` mal puesto
  // aquí cambiaría la regla del negocio sin que nadie lo pidiera.
  if (subtotalCents >= minimoCents) return null;

  return { minimoCents, subtotalCents, faltanCents: minimoCents - subtotalCents };
}

/** El importe en pesos, para escribirlo en un mensaje. */
export function enPesos(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("es-CO")}`;
}
