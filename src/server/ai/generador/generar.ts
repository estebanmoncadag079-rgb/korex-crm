import type { Vertical } from "@/server/vertical";
import {
  CIERRE,
  CIERRE_CITAS,
  ESTILO,
  FUERA_DE_HORARIO,
  meta,
  NO_ENCAJA,
  NUNCA,
  PREGUNTAS_FRECUENTES,
  VALIDACION_DE_ENLACES,
} from "./conducta";
import { faltantesDeLaFicha, pagoAntesDeLaCitaDe, type FichaDelNegocio } from "./ficha";

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

/**
 * Cuándo usar el menú guiado de WhatsApp (25-ago-2026) en vez de texto libre.
 *
 * Solo aparece cuando `menu_mode='guiado'` Y el negocio declaró opciones en
 * `ficha.menu` — sin eso, no hay nada que ofrecer y el agente sigue
 * saludando con su texto de siempre.
 */
function menuGuiadoParaElPrompt(
  ficha: FichaDelNegocio,
  opciones?: { menuGuiado?: boolean }
): string | null {
  if (!opciones?.menuGuiado || !ficha.menu?.opciones?.length) return null;
  return bloques(
    "## Cómo arrancas la conversación",
    'Este negocio tiene un menú guiado: cuando alguien te escriba por primera vez, o te salude sin pedir algo concreto, usa la acción `send_menu` con `tipo: "intenciones"` — el sistema arma la lista o los botones reales, tú no escribes el saludo a mano.',
    'Cuando pregunten qué vendes o qué tienes en la carta, usa `send_menu` con `tipo: "catalogo"` para mostrarles las opciones reales, en vez de describirlas en un párrafo.',
    'Si el catálogo es grande, `send_menu` te muestra primero categorías (Cremosos, Bebidas…) en vez de todos los productos de una vez. Cuando el cliente toque o mencione una de esas categorías EXACTAS, repite `send_menu` con `tipo: "catalogo"` y `categoria` igual a ese nombre, para que vea los productos de esa categoría. Si toca "⬅ Volver a categorías", repite `send_menu` con `tipo: "catalogo"` sin `categoria`, para regresar a la lista de categorías.',
    "Si el sistema no puede armar el menú, te llega tu propio `reply` como respuesta normal — no menciones que intentaste mandar un menú ni insistas."
  );
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

/**
 * Los otros sitios donde el cliente puede pedir o agendar.
 *
 * Corto a propósito: el agente **no** tiene que empujar a nadie fuera de
 * WhatsApp —aquí puede cerrar la venta él mismo— pero sí tiene que saber que
 * existen para no negarlos cuando le pregunten. Ese fue el fallo que lo
 * originó: negó una app de domicilios que el negocio sí tenía.
 */
function otrosCanales(ficha: FichaDelNegocio): string | null {
  const canales = (ficha.canales ?? []).filter((c) => c.nombre?.trim());
  if (canales.length === 0) return null;
  return bloques(
    "## También nos pueden pedir por aquí",
    canales
      .map((c) =>
        c.enlace?.trim()
          ? `- **${c.nombre.trim()}**: ${c.enlace.trim()}`
          : `- **${c.nombre.trim()}**`
      )
      .join("\n"),
    "Si preguntan por alguno, confírmalo y pásale el enlace tal cual. No lo ofrezcas por tu cuenta si puedes cerrar el pedido aquí mismo."
  );
}

/** Cómo recibe el cliente lo que pidió. */
function comoRecibe(
  ficha: FichaDelNegocio,
  opciones?: { domicilioEnTabla?: boolean }
): string | null {
  const { entrega } = ficha;
  const partes: string[] = [];

  if (entrega.haceDomicilios) {
    const detalle: string[] = [];
    if (entrega.como?.trim()) detalle.push(entrega.como.trim());
    if (entrega.restricciones?.trim()) detalle.push(entrega.restricciones.trim());
    const quienPaga = entrega.quienPagaElDomicilio?.trim();
    /*
     * CON LA TARIFA EN TABLAS, EL DINERO DEL DOMICILIO LO ESCRIBE EL BACKEND.
     *
     * `delivery_source='tabla'` significa que la tarifa sale de
     * `delivery_zone`, verificada por `consultar_domicilio`, y que el cierre
     * lleva adjunto el desglose que calculó el servidor —Subtotal /
     * Domicilio / Total— en vez del que redacte el modelo
     * (`bloqueDeCifrasVerificadas`, y `CONTRATO_DE_CONSULTA_DE_DOMICILIO`:
     * *"NO escribas el desglose... el servidor lo añade al final"*).
     *
     * Forzar ADEMÁS una frase de la ficha dentro de ese mismo resumen, en
     * negrita y "SIEMPRE", pone dos versiones del dinero del domicilio en el
     * mismo mensaje — y la del modelo sin nada que la respalde. Es el caso
     * real de MALIA (350 zonas cargadas, agente encendido): su ficha ordena
     * meter *"el domicilio... debe pagarlo junto con todo el pedido antes de
     * despachar"* mientras el backend afirma un único Total ya sumado.
     *
     * Lo que se retira es la ORDEN de citarla literal en el resumen, no la
     * política: cuándo y a quién se paga el domicilio no está en ninguna
     * tabla —`delivery_zone` solo guarda zona y tarifa—, así que el prompt
     * sigue siendo su única fuente y borrarla dejaría al agente sin saberlo.
     */
    if (quienPaga && opciones?.domicilioEnTabla) detalle.push(quienPaga);
    partes.push(
      bloques(
        "**Domicilio.**",
        detalle.join(" ") ||
          // Sin una sola línea debajo, el encabezado queda huérfano. Hoy no
          // pasa (la ficha exige `quienPagaElDomicilio` para quien reparte),
          // pero con la tarifa en tablas ese campo deja de ir en negrita y
          // podría no quedar nada.
          (opciones?.domicilioEnTabla ? "Sí hacemos domicilios." : null),
        // El dato que más caro sale si se omite: el cliente cree que el total
        // lo incluye y acaba discutiendo con el repartidor. En NEGRITA y con el
        // hecho por delante, porque en cursiva WhatsApp lo pinta tenue y pasa
        // desapercibido — se aprendió con Lis el 12-ago-2026.
        quienPaga && !opciones?.domicilioEnTabla
          ? `⚠️ Esta línea va SIEMPRE en el resumen del pedido, en negrita y con el hecho primero — nunca la resumas con tus propias palabras ni la des solo de palabra en mitad de la charla:\n"🛵 *${quienPaga}*"`
          : null
      )
    );
  } else if (ficha.canales?.length) {
    /*
     * No reparte por su cuenta, pero SÍ se le puede pedir por otro canal.
     *
     * "No hay domicilios" es un NO **declarado**, de los que el agente dice con
     * seguridad. Dárselo a un negocio que está en una app de domicilios sería
     * hacerle negar algo que sí existe, y con su propia ficha como culpable: el
     * mismo fallo del 20-ago-2026, pero causado por los datos en vez de por su
     * ausencia (ver `canales` en `ficha.ts`).
     */
    partes.push(
      "**No repartimos por nuestra cuenta**, pero sí se puede pedir por los otros canales que aparecen más abajo. Si preguntan por domicilio, ofrécelos — nunca digas que no hay domicilio a secas."
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
function comoPagan(
  ficha: FichaDelNegocio,
  vertical: Vertical,
  opciones?: { pagosEnFicha?: boolean }
): string | null {
  const { pago } = ficha;
  // Un salón no tiene "pedidos" que dejar en firme, tiene citas. El vocabulario
  // de pedidos colándose en el vertical de citas ya se había visto en las
  // pruebas del 7-ago-2026 ("gracias por tu compra" en un salón de belleza).
  const loQueSeDejaEnFirme = vertical === "citas" ? "la cita" : "el pedido";
  /*
   * En PEDIDOS, `compruebaUnaPersona` basta: el comprobante se pide siempre
   * al cerrar, no hay concepto de "pagar antes". En CITAS existe un segundo
   * interruptor, `cierre.pagoAntesDeLaCita` (server/ai/prompts.ts,
   * `pagoDeCitasParaElPrompt`), que decide si el negocio cobra por
   * adelantado. Un negocio puede declarar `compruebaUnaPersona: true` (revisa
   * los comprobantes que le llegan) sin exigir el pago como condición para
   * agendar — caso real, Lashes Valen (31-ago-2026): con
   * `pagoAntesDeLaCita` sin declarar (⇒ false), este bloque igual generaba
   * "Pídele la foto del comprobante para dejar la cita en firme", que
   * contradice textualmente al bloque estructurado ("NO pidas comprobante")
   * en el mismo prompt. Sin este segundo interruptor, "dejar la cita en
   * firme" con un comprobante es letra muerta para un negocio que no cobra
   * antes.
   */
  const pideComprobante =
    vertical === "citas"
      ? pago.compruebaUnaPersona && pagoAntesDeLaCitaDe(ficha)
      : pago.compruebaUnaPersona;
  /*
   * CON `payment_source='ficha'`, LOS DATOS DE PAGO NO VAN AQUÍ.
   *
   * El pipeline los lee de `ficha.pago` y los inyecta frescos en cada turno
   * (`pagoDePedidosParaElPrompt`, bajo "MÉTODOS DE PAGO ACEPTADOS"), con su
   * propio contrato `consultar_medio_pago`. Escribirlos TAMBIÉN aquí es la
   * doble fuente de siempre: dos copias del mismo número de cuenta, y la del
   * texto es la que se queda vieja el día que el negocio cambia de banco.
   *
   * Es el mismo patrón que ya usaba `catalogoEnTabla` desde la Fase 1 — lo
   * que faltaba era que el generador lo aplicara también a pagos, en vez de
   * dejárselo a `migrar:pago`, que corre una vez y la siguiente regeneración
   * deshace (ver `fuentes.ts`).
   *
   * La frase del comprobante SÍ se queda: es conducta ("tú nunca das un pago
   * por bueno"), no un dato de `ficha.pago`, y no la inyecta nadie más. Es el
   * mismo corte que ya hacía `quitarPagoDuplicado`, que se detenía justo
   * antes de ella.
   */
  const comprobante = pideComprobante
    ? `Pídele la foto del comprobante para dejar ${loQueSeDejaEnFirme} en firme. **Tú nunca das un pago por bueno**: lo revisa una persona del equipo.`
    : null;
  if (opciones?.pagosEnFicha) {
    // Sin datos y sin conducta no hay sección: un "## Cómo te pagan" vacío
    // solo le dice al modelo que mire un sitio donde no hay nada.
    return comprobante ? bloques("## Cómo te pagan", comprobante) : null;
  }
  return bloques(
    "## Cómo te pagan",
    `Formas de pago: ${pago.formas.trim()}`,
    pago.datosDeCuenta?.trim()
      ? `Datos para el pago (cópialos TAL CUAL, sin cambiar ni un dígito, y solo DESPUÉS de que confirme):\n${pago.datosDeCuenta.trim()}`
      : null,
    comprobante
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
     * `true` = `agent_profile.payment_source='ficha'`: el pipeline inyecta
     * las formas de pago y los datos de cuenta frescos en cada turno, así que
     * el prompt NO debe llevarlos. La conducta del comprobante sí se queda.
     *
     * Lo mismo que `catalogoEnTabla` hace con el catálogo. Hasta el
     * 20-sep-2026 esta decisión no existía aquí: la tomaba `migrar:pago` por
     * fuera, y cada regeneración la deshacía (ver `fuentes.ts`).
     */
    pagosEnFicha?: boolean;
    /**
     * `true` = `agent_profile.delivery_source='tabla'`: la tarifa sale de
     * `delivery_zone`, la verifica `consultar_domicilio` y el desglose del
     * cierre lo escribe el backend. El prompt deja entonces de forzar la
     * frase de la ficha dentro del resumen del pedido — la política de quién
     * paga se conserva como contexto, que eso no vive en ninguna tabla.
     */
    domicilioEnTabla?: boolean;
    /**
     * `true` = este negocio tiene `agent_profile.menu_mode='guiado'`: el
     * agente ofrece el menú guiado de WhatsApp en vez de texto libre. Igual
     * que `catalogoEnTabla`, lo decide `agent_profile`, no la ficha.
     */
    menuGuiado?: boolean;
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
    /*
     * El trato que escribió el negocio va ANTES que el estilo genérico y se
     * declara por encima de él (doc 198, 25-sep-2026). Iba como una línea
     * después de ESTILO —"Habla lo menos posible"— y perdía: Lis pedía "nunca
     * frío ni cortante" y el bot contestaba "¿Qué quieres y cuántos?". La
     * fuente de verdad del trato es la ficha de cada negocio.
     */
    [
      "# Tu trato con los clientes",
      "",
      `Así lo pidió ${ficha.nombre.trim()}: ${ficha.tono.trim()}`,
      "",
      "Este trato manda sobre cualquier otra instrucción de estilo de este prompt: si algo de lo que sigue te hace sonar frío, cortante o de formulario, gana el trato.",
    ].join("\n"),
    ESTILO,
    meta(vertical),
    vertical === "citas"
      ? "# Lo que ofreces y cómo te pagan"
      : "# Lo que ofreces y cómo se recibe",
    queOfrece(ficha, vertical, opciones),
    // Solo en pedidos: el menú guiado depende del catálogo en tablas, que en
    // citas ya llega aparte desde `service`.
    vertical === "citas" ? null : menuGuiadoParaElPrompt(ficha, opciones),
    // En un salón no hay nada que entregar: el bloque de domicilios acababa
    // diciéndole "no hacemos domicilios, ofrécele recoger" a quien viene a que
    // le hagan las pestañas.
    vertical === "citas" ? null : comoRecibe(ficha, opciones),
    // Fuera del bloque de entrega y SIN filtrar por vertical: un salón también
    // puede agendar por otra plataforma (ver `CanalExterno`).
    otrosCanales(ficha),
    comoPagan(ficha, vertical, opciones),
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
    VALIDACION_DE_ENLACES,
    vertical === "citas" ? CIERRE_CITAS : CIERRE,
    // Solo en pedidos: una cita fuera de hora no se "reagenda sola", se pide
    // para un día que el propio catálogo de horarios ya limita.
    vertical === "citas" ? null : FUERA_DE_HORARIO,
    NUNCA,
    NO_ENCAJA,
    PREGUNTAS_FRECUENTES,
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
