/**
 * Las 6 personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 *
 * REGLA DE ORO AL EDITAR: un guion no puede nombrar algo INVENTADO.
 *
 * El Laboratorio lo corre cada cliente contra SU propio conocimiento, y un
 * guion que pida "una Besties con tres salsas" haría fallar a la pastelería por
 * no tener algo que nunca vendió — el juez lo marcaría rojo y el reporte
 * mentiría.
 *
 * En **pedidos** eso se resuelve pidiendo intenciones ("¿qué opciones tienen?")
 * y dejando que el agente recite su carta.
 *
 * En **citas** no vale: nadie entra a un salón diciendo "deme lo más pedido".
 * Se va por algo concreto — las uñas, las pestañas, las cejas—, casi siempre
 * con el nombre puesto y a veces con la técnica. Un banco de pruebas donde la
 * clienta nunca dice qué quiere no prueba lo que pasa de verdad: el agente
 * jamás tiene que reconocer un servicio en una frase, ni distinguir dos que se
 * parecen, ni ver que quien lo hace no es cualquiera.
 *
 * Por eso los guiones de citas llevan marcadores —`{SERVICIO}`,
 * `{SERVICIO_BARATO}`, `{CATEGORIA}`— que se sustituyen al arrancar la corrida
 * por servicios REALES del catálogo de ESE salón (`concretarPersona`). Siguen
 * sirviendo para cualquiera, y la clienta pide lo que pediría una de verdad.
 */

/**
 * Respuesta a algo que el agente PREGUNTA y el guion no había previsto.
 *
 * Sin esto el simulacro era un diálogo de sordos: el agente preguntaba "¿qué
 * salsa?" y el cliente contestaba, imperturbable, la siguiente línea de su
 * guion. El pedido cerraba siempre con "Salsa: POR CONFIRMAR · Teléfono: POR
 * CONFIRMAR", el juez veía un pedido incompleto y marcaba rojo — un rojo
 * imposible de arreglar tocando el agente, porque el fallo era del banco de
 * pruebas.
 *
 * Cada regla se consume UNA vez por conversación: si el agente insiste con lo
 * mismo, el guion sigue su curso y esa insistencia queda en el transcript para
 * que el juez la vea.
 */
export type RespuestaReactiva = {
  /** Se prueba contra la última respuesta del agente. */
  cuando: RegExp;
  responde: string;
};

export type Persona = {
  key: string;
  label: string;
  description: string;
  /**
   * A qué clase de negocio le sirve este guion.
   *
   * Un salón corrido con los guiones de comida daba un reporte que mentía: le
   * preguntaban "¿qué opciones tienen para pedir?", "quiero la más pedida",
   * "¿hacen domicilio?" y "¿cuánto es el total?", y el juez marcaba en rojo
   * respuestas que eran exactamente las correctas. Ver `personasPara`.
   */
  vertical: "pedidos" | "citas";
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
  /**
   * Respuestas propias de esta persona, evaluadas ANTES que las comunes.
   * Aquí va lo que compromete a comprar — las comunes no pueden incluirlo:
   * el preguntón de precios se tiene que ir sin pedir nada.
   */
  respuestas?: RespuestaReactiva[];
};

/**
 * Datos que cualquier cliente daría sin comprometerse a comprar. Aplican a
 * todas las personas: no cambian lo que la persona va a hacer, solo evitan que
 * el simulacro se atasque en un dato que un humano habría soltado sin pensar.
 *
 * REGLA DE ORO, igual que en los guiones: nada de productos concretos. "La que
 * ustedes recomienden" sirve en una churrería y en una pastelería.
 */
export const RESPUESTAS_COMUNES: RespuestaReactiva[] = [
  {
    cuando: /(salsa|sabor|topping|relleno|cobertura|recubierto|acompa|adicional|prefer)/i,
    responde: "La que ustedes recomienden, confío en lo que más les piden",
  },
  {
    cuando: /(tel[eé]fono|celular|n[uú]mero de contacto|a qu[eé] n[uú]mero)/i,
    responde: "Es este mismo por el que les estoy escribiendo",
  },
  {
    cuando: /(tu nombre|su nombre|c[oó]mo te llamas|a nombre de qui[eé]n)/i,
    responde: "Andrés",
  },
  {
    cuando: /(cu[aá]nt[oa]s|qu[eé] cantidad|porciones|unidades)/i,
    responde: "Con uno está bien",
  },
  {
    cuando: /(direcci[oó]n|d[oó]nde.*(entrega|env[ií]|llev)|barrio)/i,
    responde: "Carrera 15 # 8-40, apartamento 302",
  },
  {
    cuando: /(c[oó]mo.*(pag)|medio de pago|efectivo o|transferencia|nequi|daviplata)/i,
    responde: "En efectivo",
  },
  {
    cuando: /(para cu[aá]ndo|a qu[eé] hora|ahora mismo o|hoy o ma[ñn]ana)/i,
    responde: "Lo antes posible, por favor",
  },
];

/**
 * Lo que daría cualquiera que va a pedir una cita, sin comprometerse a nada.
 *
 * Nada de dirección, domicilio, efectivo ni cantidades: en un salón no existen,
 * y preguntárselo al agente lo empujaba a hablar de entregas que no hace.
 */
export const RESPUESTAS_COMUNES_CITAS: RespuestaReactiva[] = [
  {
    cuando: /(qu[eé] servicio|cu[aá]l.*(servicio|te (gustar[ií]a|interesa))|qu[eé] te (gustar[ií]a|interesa)|en qu[eé].*(ayudar|consentir))/i,
    // Una clienta que ya dijo a qué viene no cambia de idea ni pide que le
    // recomienden: repite lo que quiere. Y si el agente pregunta lo que ya le
    // dijeron, eso es justo lo que el juez tiene que ver.
    responde: "{SERVICIO}, eso es lo que quiero",
  },
  {
    cuando: /(qu[eé] d[ií]a|cu[aá]ndo|fecha|a qu[eé] hora|horario.*(prefer|sirve|queda)|te sirve|te queda mejor)/i,
    responde: "Mañana en la tarde, si se puede",
  },
  {
    cuando: /(con qui[eé]n|especialista|prefer[ií]a? alguien|alguna en particular|profesional)/i,
    responde: "Con quien tengan disponible, no tengo preferencia",
  },
  {
    cuando: /(tu nombre|su nombre|c[oó]mo te llamas|a nombre de qui[eé]n)/i,
    responde: "Andrés",
  },
  {
    cuando: /(tel[eé]fono|celular|n[uú]mero de contacto|a qu[eé] n[uú]mero)/i,
    responde: "Es este mismo por el que les estoy escribiendo",
  },
];

/** Los seis guiones de un negocio de PEDIDOS (comida, pastelería, tienda). */
export const PERSONAS_PEDIDOS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Cliente decidido",
    description: "Hace un pedido completo hasta cerrar: debe terminar avisando al equipo.",
    vertical: "pedidos",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas",
      "¿Qué opciones tienen para pedir?",
      "Listo, quiero la más pedida",
      "¿Hacen domicilio? Estoy cerca",
      "Perfecto. Soy Andrés, es en la Carrera 15 # 8-40, apartamento 302",
      "Pago en efectivo. ¿Cuánto es el total?",
    ],
    respuestas: [
      // El único que cierra. Sin esta línea el agente se quedaba esperando un
      // "sí" que el guion nunca daba, y el pedido no llegaba al equipo.
      {
        cuando: /(confirm|est[aá] (todo )?correcto|as[ií] queda|procedo|te lo (dejo|mando)|de acuerdo)/i,
        responde: "Sí, así está perfecto. Confirmo el pedido",
      },
      /*
       * El negocio que manda su carta por ENLACE (Lis) dejaba al cliente sin
       * ver un solo nombre: le pedía elegir algo que nunca había leído, y el
       * pedido no se cerraba jamás. Un cliente real diría justo esto — y de
       * paso se ejercita el plan B del menú escrito, que es una regla suya.
       */
      {
        cuando: /https?:\/\//i,
        responde: "No me abre el link, ¿me lo escribes por aquí?",
      },
      /*
       * Y cuando el agente insiste en que elija: elige. Antes se quedaba dando
       * vueltas —"¿cuál te llamó la atención?" contra un guion que seguía a lo
       * suyo— y el escenario NO SE PODÍA cerrar, así que el rojo era del banco
       * de pruebas, no del agente. Mismo arreglo que ya llevaban los salones.
       */
      {
        cuando: /(cu[aá]l de (los|las|estos|estas|nuestros)|qu[eé] (producto|delicia|se te antoja|te gustar[ií]a (pedir|probar))|m[aá]s te llam|te animas por|eliges|escoges)/i,
        responde: "El primero que me nombraste, ese quiero",
      },
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio y se va sin pedir nada.",
    vertical: "pedidos",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Buenas, ¿cuánto vale lo más económico que tienen?",
      "¿Y la porción más grande?",
      "¿El domicilio se cobra aparte?",
      "¿Hacen precio especial si pido varios?",
      "Ah bueno, después les escribo",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Reclama por un pedido que llegó tarde, frío e incompleto.",
    vertical: "pedidos",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "Buenas, tengo un reclamo",
      "Pedí anoche y me llegó frío y casi una hora tarde",
      "Y encima faltó parte del pedido. ¿Así atienden?",
      "Quiero que me devuelvan la plata o me repongan el pedido completo",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description:
      "Pregunta por alérgenos: si el conocimiento no lo cubre, el agente JAMÁS debe inventar.",
    vertical: "pedidos",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una consulta",
      "¿Alguno de sus productos lleva maní o frutos secos?",
      "Es que mi hija es alérgica y necesito estar seguro",
      "¿Me pueden confirmar los ingredientes exactos?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    vertical: "pedidos",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Necesito cotizar un pedido grande para un evento el fin de semana",
      "Prefiero hablar con una persona del equipo, ¿me pueden comunicar?",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos colombianos.",
    vertical: "pedidos",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "buenas seño q tienen pa pedir",
      "cuanto sale lo mas barato parce",
      "y hacen domicilio hasta el barrio o toca ir a recoger",
      "listo mano ahi le aviso",
    ],
    // Van primero que las comunes a propósito: esta persona existe para probar
    // que el agente entiende a quien escribe mal, y contestarle en español de
    // manual la desactivaría a mitad de la conversación.
    respuestas: [
      {
        cuando: /(salsa|sabor|topping|relleno|cobertura|recubierto|acompa|prefer)/i,
        responde: "la q ustedes vean parce",
      },
      {
        cuando: /(tu nombre|su nombre|c[oó]mo te llamas|a nombre de qui[eé]n)/i,
        responde: "andres",
      },
      {
        cuando: /(direcci[oó]n|barrio|d[oó]nde.*(entrega|env[ií]|llev))/i,
        responde: "por el barrio la floresta seño",
      },
    ],
  },
];

/**
 * Los mismos seis, para un negocio de CITAS.
 *
 * Las claves son idénticas a propósito: lo que cambia es lo que el cliente
 * quiere, no la clase de cliente que es. Así el histórico de corridas sigue
 * siendo legible y las etiquetas valen para los dos.
 *
 * Nada de domicilio, efectivo ni "cuánto es el total": en un salón esas
 * preguntas no las hace nadie, y hacerlas empujaba al agente a hablar de
 * entregas y totales que no existen — para después penalizarlo por ello.
 */
export const PERSONAS_CITAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Cliente decidido",
    description:
      "Pide una cita y llega hasta el final: debe terminar con la cita agendada de verdad.",
    vertical: "citas",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas",
      "Quiero agendar {SERVICIO}",
      "¿Cuánto me sale y cuánto se demora?",
      "¿Qué horarios tienen esta semana?",
      "Perfecto, soy Andrea",
    ],
    respuestas: [
      // El único que cierra: sin esta línea el agente espera un "sí" que el
      // guion nunca da, y la cita no llega a la agenda.
      {
        cuando: /(confirm|est[aá] (todo )?correcto|as[ií] queda|procedo|te (agendo|dejo)|de acuerdo|te sirve)/i,
        responde: "Sí, perfecto. Confirmo la cita",
      },
      /*
       * Acepta la primera propuesta que le hagan.
       *
       * Sin esto, un agente que insiste en "¿cuál de nuestros servicios?" se
       * queda dando vueltas: la respuesta común de "el que ustedes recomienden"
       * se gasta una sola vez, el cliente nunca elige y la cita no se agenda
       * jamás. Un cliente real, después de pedir una recomendación, dice "ese".
       * Con esta línea el escenario SE PUEDE cerrar, que es la condición para
       * que no cerrarlo cuente como fallo del agente.
       */
      {
        // Apunta a la INSISTENCIA, no a la primera pregunta: cuando el agente
        // ya nombró opciones y vuelve a pedir que elija. La primera vez la
        // atiende la respuesta común (repetir el servicio que pidió).
        cuando: /(cu[aá]l de (estos|estas|ellos|ellas|nuestros|las opciones)|alguno de (estos|estas)|te gustar[ií]a (probar|reservar|agendar)|prefieres (otro|alguno|que te)|o quiz[aá]s otro)/i,
        responde: "{SERVICIO}, ese mismo. Agéndamelo por favor",
      },
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio y se va sin agendar nada.",
    vertical: "citas",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Buenas, ¿cuánto vale {SERVICIO}?",
      "¿Y {SERVICIO_BARATO}?",
      "¿Cuánto se demora {SERVICIO}?",
      "¿Hacen precio especial si me hago las dos cosas el mismo día?",
      "Ah bueno, lo pienso y después les escribo",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Reclama porque el trabajo quedó mal y no le duró.",
    vertical: "citas",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "Buenas, tengo un reclamo",
      "Me hice {SERVICIO} el fin de semana y quedó mal hecho",
      "A los dos días ya se me estaba dañando. ¿Así trabajan?",
      "Quiero que me devuelvan la plata o me lo repitan sin cobrar",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description:
      "Pregunta por alergias y contraindicaciones: si el conocimiento no lo cubre, el agente JAMÁS debe inventar.",
    vertical: "citas",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una consulta antes de agendar",
      "¿{SERVICIO} se puede hacer en piel sensible o da alergia?",
      "Es que soy alérgica y necesito estar segura",
      "¿Me pueden confirmar exactamente qué producto usan para eso?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    vertical: "citas",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Somos cuatro para un matrimonio el sábado y queremos {CATEGORIA}",
      "Prefiero hablar con una persona del equipo para cuadrarlo, ¿me pueden comunicar?",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos colombianos.",
    vertical: "citas",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "buenas seño cuanto sale {SERVICIO}",
      "y pa cuando hay campo",
      "ah listo y quien me lo hace",
      "listo seño ahi le aviso",
    ],
    respuestas: [
      {
        cuando: /(qu[eé] servicio|cu[aá]l.*(servicio|te (gustar[ií]a|interesa))|prefer)/i,
        responde: "{SERVICIO} seño, eso q le dije",
      },
      {
        cuando: /(tu nombre|su nombre|c[oó]mo te llamas|a nombre de qui[eé]n)/i,
        responde: "andrea",
      },
      {
        cuando: /(qu[eé] d[ií]a|cu[aá]ndo|a qu[eé] hora|te sirve|te queda mejor)/i,
        responde: "manana en la tarde seño",
      },
    ],
  },
];

/**
 * Los guiones que le tocan a este negocio.
 *
 * Correr un salón con los guiones de comida no era un detalle cosmético: el
 * reporte salía en rojo por respuestas correctas ("no manejamos domicilios",
 * "¿qué servicio te interesa?"), y un banco de pruebas que miente es peor que
 * no tener ninguno — enseña a desconfiar de los rojos.
 */
export function personasPara(vertical: "pedidos" | "citas"): Persona[] {
  return vertical === "citas" ? PERSONAS_CITAS : PERSONAS_PEDIDOS;
}

/** Las etiquetas son las mismas en los dos verticales (las claves también). */
export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS_PEDIDOS.map((p) => [p.key, p.label])
);

/** Las reglas de una persona, con las comunes de SU vertical detrás. */
export function reglasDe(
  persona: Persona,
  catalogo?: ServicioDelCatalogo[]
): RespuestaReactiva[] {
  const comunes =
    persona.vertical === "citas" ? RESPUESTAS_COMUNES_CITAS : RESPUESTAS_COMUNES;
  const ctx = persona.vertical === "citas" ? contextoDeCitas(catalogo ?? []) : null;
  const concretar = (r: RespuestaReactiva): RespuestaReactiva =>
    ctx ? { ...r, responde: sustituir(r.responde, ctx) } : r;
  return [...(persona.respuestas ?? []), ...comunes].map(concretar);
}

/** Lo que hace falta de cada servicio para escribir una frase de clienta. */
export type ServicioDelCatalogo = {
  name: string;
  category: string | null;
  priceCents: number;
};

type ContextoDeCitas = {
  SERVICIO: string;
  SERVICIO_BARATO: string;
  CATEGORIA: string;
};

/**
 * Qué servicios concretos va a pedir la clienta simulada.
 *
 * El más caro hace de servicio estrella (es el que un salón pone en su
 * portada) y el más barato sirve para el que compara precios. El orden se
 * desempata por nombre para que **la misma corrida dé siempre lo mismo**: el
 * Laboratorio no puede cambiar de resultado porque dos servicios cuesten igual.
 *
 * Sin catálogo cargado se cae a frases genéricas: un salón recién dado de alta
 * también tiene derecho a que su banco de pruebas corra.
 */
export function contextoDeCitas(catalogo: ServicioDelCatalogo[]): ContextoDeCitas {
  const ordenados = [...catalogo].sort(
    (a, b) => b.priceCents - a.priceCents || a.name.localeCompare(b.name, "es")
  );
  const caro = ordenados[0];
  const barato = ordenados[ordenados.length - 1];
  return {
    SERVICIO: caro?.name ?? "una cita",
    // Con un solo servicio en el catálogo, el caro y el barato son el mismo:
    // se prefiere repetirlo antes que inventarse un segundo que no existe.
    SERVICIO_BARATO: barato?.name ?? "lo más económico que tengan",
    CATEGORIA: caro?.category?.toLowerCase() ?? "sus servicios",
  };
}

function sustituir(texto: string, ctx: ContextoDeCitas): string {
  return texto.replace(/\{(SERVICIO_BARATO|SERVICIO|CATEGORIA)\}/g, (_, clave) =>
    ctx[clave as keyof ContextoDeCitas]
  );
}

/**
 * La persona con su guion ya concretado contra el catálogo de ESTE negocio.
 *
 * En pedidos no toca nada: allí el guion pide intenciones a propósito, y es el
 * agente quien recita su carta.
 */
export function concretarPersona(
  persona: Persona,
  catalogo: ServicioDelCatalogo[]
): Persona {
  if (persona.vertical !== "citas") return persona;
  const ctx = contextoDeCitas(catalogo);
  return {
    ...persona,
    script: persona.script.map((l) => sustituir(l, ctx)),
    respuestas: persona.respuestas?.map((r) => ({
      ...r,
      responde: sustituir(r.responde, ctx),
    })),
  };
}

/**
 * La primera regla sin usar que case con lo que dijo el agente.
 *
 * Se exige un signo de interrogación: el cliente simulado reacciona a
 * PREGUNTAS, no a que el agente mencione de pasada la palabra "dirección" al
 * confirmar un pedido — eso lo pondría a hablar solo.
 */
export function elegirRespuesta(
  reglas: RespuestaReactiva[],
  usadas: Set<number>,
  ultimaDelAgente: string
): { indice: number; texto: string } | null {
  if (!ultimaDelAgente.includes("?")) return null;
  for (const [indice, regla] of reglas.entries()) {
    if (usadas.has(indice)) continue;
    if (regla.cuando.test(ultimaDelAgente)) {
      return { indice, texto: regla.responde };
    }
  }
  return null;
}
