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

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
};

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
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
