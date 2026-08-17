import type { Vertical } from "@/server/vertical";
import {
  CIERRE,
  CIERRE_CITAS,
  ESTILO,
  FUERA_DE_HORARIO,
  meta,
  NO_ENCAJA,
  NUNCA,
} from "./conducta";
import { faltantesDeLaFicha, type FichaDelNegocio } from "./ficha";

/**
 * De la ficha del cliente al prompt completo.
 *
 * El prompt de cada negocio se arma **desde cero con sus datos**: no se copia
 * de otro cliente ni se adapta el de nadie. Lo único que se repite entre
 * clientes son las lecciones de conducta (`conducta.ts`), que no dependen del
 * negocio y por eso no tienen por qué reescribirse en cada alta.
 *
 * Lo que esto resuelve, y era el techo del proyecto: el alta pasa de horas a
 * minutos, deja de depender de que quien la haga recuerde todas las lecciones,
 * y el día que aparezca un fallo nuevo se corrige aquí una vez y **lo heredan
 * todos los clientes**, en vez de ir cazándolo negocio por negocio con el
 * dueño enfadado al teléfono.
 */

/** Lo que se guarda en `agent_profile`, ya listo para insertar. */
export type PerfilGenerado = {
  instructions: string;
  escalationRules: string;
  greeting: string;
};

/** Une trozos saltándose los vacíos, para no dejar huecos ni títulos huérfanos. */
function bloques(...partes: (string | null | undefined)[]): string {
  return partes
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join("\n\n");
}

/** Lista en viñetas. Vacía = no se escribe la sección entera. */
function vinetas(items: string[] | undefined): string | null {
  const limpios = (items ?? []).map((i) => i.trim()).filter(Boolean);
  if (limpios.length === 0) return null;
  return limpios.map((i) => `- ${i}`).join("\n");
}

/** Lo que el negocio vende y a qué precio. */
function queOfrece(
  ficha: FichaDelNegocio,
  vertical: Vertical,
  opciones?: { catalogoEnTabla?: boolean }
): string | null {
  // En el vertical de citas el catálogo llega aparte, desde la tabla `service`,
  // ya con precios y duraciones: repetirlo aquí sería una fuente de verdad
  // duplicada y la primera en quedarse vieja.
  if (vertical === "citas") return null;
  // Y desde el 15-ago-2026, lo mismo en pedidos para quien ya tiene su catálogo
  // en `product`: el pipeline lo renderiza fresco en cada turno. Dejarlo también
  // aquí es exactamente la doble fuente que este cambio viene a quitar.
  if (opciones?.catalogoEnTabla) return null;
  if (!ficha.catalogo?.trim()) return null;
  return bloques(
    "## Lo que vendes",
    ficha.catalogo.trim(),
    ficha.variantes?.trim()
      ? `**Opciones que elige el cliente:**\n${ficha.variantes.trim()}`
      : null
  );
}

/** Cómo recibe el cliente lo que pidió. */
function comoRecibe(ficha: FichaDelNegocio): string | null {
  const { entrega } = ficha;
  const partes: string[] = [];

  if (entrega.haceDomicilios) {
    const detalle: string[] = [];
    if (entrega.como?.trim()) detalle.push(entrega.como.trim());
    if (entrega.restricciones?.trim()) detalle.push(entrega.restricciones.trim());
    partes.push(
      bloques(
        "**Domicilio.**",
        detalle.join(" ") || null,
        // El dato que más caro sale si se omite: el cliente cree que el total
        // lo incluye y acaba discutiendo con el repartidor. En NEGRITA y con el
        // hecho por delante, porque en cursiva WhatsApp lo pinta tenue y pasa
        // desapercibido — se aprendió con Lis el 12-ago-2026.
        entrega.quienPagaElDomicilio?.trim()
          ? `⚠️ Esta línea va SIEMPRE en el resumen del pedido, en negrita y con el hecho primero — nunca la resumas con tus propias palabras ni la des solo de palabra en mitad de la charla:\n"🛵 *${entrega.quienPagaElDomicilio.trim()}*"`
          : null
      )
    );
  } else {
    partes.push("**No hay domicilios.** Si alguien lo pide, dilo con naturalidad y ofrécele recoger.");
  }

  if (entrega.recogerEnLocal?.trim()) {
    partes.push(
      `**Recoger en el local.** ${entrega.recogerEnLocal.trim()}\nSi el cliente recoge, NO le pidas dirección y no le prometas tiempos de entrega.`
    );
  }
  return bloques("## Cómo lo recibe", ...partes);
}

/** Cómo le pagan. */
function comoPagan(ficha: FichaDelNegocio, vertical: Vertical): string {
  const { pago } = ficha;
  // Un salón no tiene "pedidos" que dejar en firme, tiene citas. El vocabulario
  // de pedidos colándose en el vertical de citas ya se había visto en las
  // pruebas del 7-ago-2026 ("gracias por tu compra" en un salón de belleza).
  const loQueSeDejaEnFirme = vertical === "citas" ? "la cita" : "el pedido";
  return bloques(
    "## Cómo te pagan",
    `Formas de pago: ${pago.formas.trim()}`,
    pago.datosDeCuenta?.trim()
      ? `Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):\n${pago.datosDeCuenta.trim()}`
      : null,
    pago.compruebaUnaPersona
      ? `Pídele la foto del comprobante para dejar ${loQueSeDejaEnFirme} en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.`
      : null
  );
}

/**
 * Arma el prompt del negocio.
 *
 * Lanza si faltan datos sin los que el agente no puede trabajar: es mejor
 * frenar el alta que dejar en producción un agente que cierra pedidos y no
 * sabe cobrarlos.
 */
export function generarPerfil(
  ficha: FichaDelNegocio,
  /**
   * `catalogoEnTabla: true` = este negocio ya tiene su menú en `product` y el
   * pipeline se lo inyecta fresco en cada turno, así que el prompt NO debe
   * llevarlo. Lo decide `agent_profile.catalog_source`, no la ficha.
   */
  opciones?: {
    catalogoEnTabla?: boolean;
    /**
     * El vertical CONTRATADO, que sale de `agent_profile.appointments_enabled`
     * — no de la ficha (ver `@/server/vertical`).
     *
     * Se cae a `ficha.vertical` solo cuando no se pasa, que es el caso de las
     * herramientas fuera de línea (`simular:ficha`, `regenerar:flota`). Todo lo
     * que corre en producción lo pasa.
     */
    vertical?: Vertical;
  }
): PerfilGenerado {
  const vertical: Vertical = opciones?.vertical ?? (ficha.vertical as Vertical);
  const faltan = faltantesDeLaFicha(ficha);
  if (faltan.length > 0) {
    throw new Error(
      `No se puede generar el prompt, falta en la ficha: ${faltan.join(", ")}.`
    );
  }

  const instructions = bloques(
    // `trim` en el nombre porque el del cuestionario suele venir con un espacio
    // al final, y ahí se convierte en "**Lashen Valen **": el asterisco queda
    // separado y WhatsApp deja de pintarlo en negrita.
    `Eres la voz de **${ficha.nombre.trim()}**${ficha.ubicacion?.trim() ? ` (${ficha.ubicacion.trim()})` : ""} en WhatsApp. ${ficha.queVende.trim()}`,
    ESTILO,
    `**El tono de este negocio:** ${ficha.tono.trim()}`,
    meta(vertical),
    vertical === "citas"
      ? "# Lo que ofreces y cómo te pagan"
      : "# Lo que ofreces y cómo se recibe",
    queOfrece(ficha, vertical, opciones),
    // En un salón no hay nada que entregar: el bloque de domicilios acababa
    // diciéndole "no hacemos domicilios, ofrécele recoger" a quien viene a que
    // le hagan las pestañas.
    vertical === "citas" ? null : comoRecibe(ficha),
    comoPagan(ficha, vertical),
    ficha.regalos?.trim()
      ? bloques(
          "## Regalos",
          ficha.regalos.trim(),
          "Si es un regalo, los datos de entrega son los de QUIEN RECIBE, no los de quien compra."
        )
      : null,
    // Las reglas propias van ANTES del cierre y de las prohibiciones
    // universales: son del día a día de este negocio y el modelo las necesita
    // mientras atiende, no al final entre las advertencias.
    /*
     * La cabecera dice que MANDAN, y no es un adorno.
     *
     * 15-ago-2026: La Churra tenía escrito que su primer mensaje lleva las
     * cuatro presentaciones, y el agente seguía saludando y esperando. El orden
     * general (`## El orden en que preguntas`) cae en la línea 22 del prompt y
     * estas reglas en la 89: cuando dos instrucciones se contradicen, gana la
     * que el modelo leyó primero.
     *
     * Decir aquí quién manda **no impone ningún flujo** —cada negocio sigue
     * escribiendo el suyo—, solo resuelve el empate a favor de quien conoce su
     * negocio. Es la diferencia con subir el flujo de un cliente a la conducta
     * universal, que encasillaría a toda la flota en el orden de una churrería.
     */
    vinetas(ficha.reglasPropias)
      ? `## Reglas propias de este negocio\n\nEstas reglas **mandan sobre todo lo anterior**. Si alguna contradice el orden de preguntas o la forma de escribir que te dije más arriba, haz lo que dice esta sección: son las de este negocio en concreto.\n\n${vinetas(ficha.reglasPropias)}`
      : null,
    vertical === "citas" ? CIERRE_CITAS : CIERRE,
    // Solo en pedidos: una cita fuera de hora no se "reagenda sola", se pide
    // para un día que el propio catálogo de horarios ya limita.
    vertical === "citas" ? null : FUERA_DE_HORARIO,
    NUNCA,
    NO_ENCAJA,
    // Lo propio del negocio se añade al final del bloque universal, no lo
    // sustituye: son prohibiciones suyas que se suman a las de siempre.
    vinetas(ficha.nuncaPrometer)
      ? `## Además, en este negocio nunca:\n${vinetas(ficha.nuncaPrometer)}`
      : null
  );

  const escalationRules = bloques(
    "Pasa la conversación a una persona del equipo en estos casos:",
    vinetas(ficha.escalarSiempre),
    "- Si el cliente pide hablar con alguien del equipo.\n- Si te pide algo que no sabes resolver y no está en tu conocimiento.",
    "Cuando escales, dilo en UNA línea y sin prometer tiempos ('te comunico con alguien del equipo 😊'). No te quedes callado: un cliente esperando sin respuesta es lo peor que puede pasar."
  );

  const greeting =
    ficha.saludoInicial?.trim() ||
    `¡Hola! 👋 Soy el asistente de ${ficha.nombre}. ¿En qué te puedo ayudar?`;

  return { instructions, escalationRules, greeting };
}
