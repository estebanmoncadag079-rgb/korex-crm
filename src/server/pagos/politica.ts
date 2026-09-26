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
type Metodo = "transferencia" | "efectivo" | "tarjeta";

const NOMBRE: Record<Metodo, string> = {
  transferencia: "transferencia (incluye Nequi, Daviplata y llaves)",
  efectivo: "efectivo",
  tarjeta: "tarjeta",
};

export function textoDePoliticaDePago(input: {
  formas: string;
  metodo: string;
  modalidadDeEntrega: string | null | undefined;
  /**
   * Qué método es, dicho por el MODELO (él entiende al cliente; el backend no
   * interpreta el texto — doc 198). Solo con esto y `porModalidad` hay veredicto.
   */
  tipo?: Metodo | null;
  /** Las formas de pago de la ficha, por modalidad (doc 200). */
  porModalidad?: { domicilio?: Metodo[]; recoger?: Metodo[] };
}): string {
  /*
   * CON DATO ESTRUCTURADO, el backend responde con certeza (doc 200). Es lo que
   * la frase libre no permitía: MALIA escribió "efectivo pero solo recogiendo en
   * planta" y se aprobó efectivo contra entrega (caso Sofía).
   */
  const pm = input.porModalidad;
  if (input.tipo && pm && (pm.domicilio?.length || pm.recoger?.length)) {
    const vale = (lista?: Metodo[]) => Boolean(lista?.includes(input.tipo!));
    const lista = (l?: Metodo[]) => (l?.length ? l.map((m) => NOMBRE[m]).join(", ") : "ninguna declarada");
    const m = (input.modalidadDeEntrega ?? "").toLowerCase();
    const nombre = input.tipo;
    if (/domicilio|env[íi]o|entrega a/.test(m)) {
      return vale(pm.domicilio)
        ? `[SISTEMA] Este pedido es a domicilio y ${nombre} SÍ se acepta para domicilios (dato de la ficha del negocio).`
        : `[SISTEMA] Este pedido es a domicilio y ${nombre} NO se acepta para domicilios (dato de la ficha del negocio). Para domicilio se acepta: ${lista(pm.domicilio)}.${vale(pm.recoger) ? ` ${nombre} sí se acepta si pasa a recoger.` : ""}`;
    }
    if (/recog/.test(m)) {
      return vale(pm.recoger)
        ? `[SISTEMA] Este pedido es para recoger y ${nombre} SÍ se acepta al recoger (dato de la ficha del negocio).`
        : `[SISTEMA] Este pedido es para recoger y ${nombre} NO se acepta al recoger (dato de la ficha del negocio). Al recoger se acepta: ${lista(pm.recoger)}.`;
    }
    return `[SISTEMA] Según la ficha del negocio, ${nombre}: a domicilio ${vale(pm.domicilio) ? "sí" : "no"}; al recoger ${vale(pm.recoger) ? "sí" : "no"}. Todavía no sabes cómo lo recibe: díselo así, sin decidir por él.`;
  }

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
