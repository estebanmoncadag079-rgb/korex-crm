/**
 * Lo que el backend le responde al modelo cuando este pregunta por una forma de
 * pago (`consultar_medio_pago`) — doc 198, 25-sep-2026.
 *
 * Las formas de pago de un negocio son hoy TEXTO LIBRE (`ficha.pago.formas`).
 * El backend no puede interpretarlo: el verificador anterior buscaba la palabra
 * sin un "no" delante y así aprobó efectivo contra entrega en MALIA ("efectivo
 * pero solo recogiendo en planta") y efectivo en Lis ("No se recibe efectivo").
 * Y lo afirmaba como hecho verificado: "confírmalo con seguridad".
 *
 * Por eso aquí NO hay veredicto. El backend entrega lo que sí sabe con certeza:
 * la política literal del negocio y, si el estado del pedido la tiene, la
 * modalidad de entrega (dato estructurado). Quien entiende condiciones es el
 * modelo. El arreglo definitivo es que las formas de pago sean datos
 * estructurados por modalidad en el CRM; hasta entonces, el backend no afirma.
 */
export function textoDePoliticaDePago(input: {
  formas: string;
  metodo: string;
  modalidadDeEntrega: string | null | undefined;
}): string {
  const formas = input.formas.trim();
  if (!formas) {
    return `[SISTEMA] Este negocio no tiene formas de pago configuradas. No digas que sí ni que no a "${input.metodo}": dile al cliente que el equipo se lo confirma y sigue con el pedido.`;
  }
  const modalidad = (input.modalidadDeEntrega ?? "").toLowerCase();
  const contexto = /domicilio|env[íi]o|entrega a/.test(modalidad)
    ? " Según el estado guardado, este pedido es a domicilio."
    : /recog/.test(modalidad)
      ? " Según el estado guardado, este pedido es para recoger."
      : "";
  return (
    `[SISTEMA] El cliente pregunta por "${input.metodo}". Política de pago del negocio, tal cual la escribió: «${formas}».${contexto} ` +
    "Aplícala tú, con atención a sus condiciones (por ejemplo, un método que solo vale al recoger no vale para un domicilio). " +
    "Si la política no deja claro el caso, no lo afirmes: di que el equipo lo confirma."
  );
}
