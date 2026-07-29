/**
 * Las 6 personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 *
 * REGLA DE ORO AL EDITAR: los guiones NO nombran productos concretos.
 *
 * El Laboratorio lo corre cada cliente contra SU propio conocimiento, y un
 * guión que pida "una Besties con tres salsas" haría fallar a la pastelería por
 * no tener algo que nunca vendió — el juez lo marcaría rojo y el reporte
 * mentiría. Por eso se piden INTENCIONES ("¿qué opciones tienen?", "quiero la
 * más pedida") y es el agente quien recita su propio catálogo. Así el mismo
 * guión sirve para una churrería, una pastelería o un restaurante.
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

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Hace un pedido completo hasta cerrar: debe terminar avisando al equipo.",
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
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio y se va sin pedir nada.",
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

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);

/** Las reglas de una persona, con las comunes de respaldo detrás. */
export function reglasDe(persona: Persona): RespuestaReactiva[] {
  return [...(persona.respuestas ?? []), ...RESPUESTAS_COMUNES];
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
