/**
 * Muchos clientes distintos contra el agente REAL, y las reglas duras del
 * negocio comprobadas sobre lo que respondió.
 *
 * **Por qué existe**: el Laboratorio corre seis guiones y los evalúa un juez
 * (otro modelo). Sirve para medir calidad, pero un juez cuesta, tarda y a veces
 * se equivoca. Esto es lo complementario: **muchos** escenarios y unas pocas
 * comprobaciones OBJETIVAS, de las que no admiten opinión — si el agente dio el
 * número de cuenta antes de que el cliente confirmara, eso es un fallo y no hay
 * nada que interpretar.
 *
 * Todo pasa por conversaciones `is_test`: nunca toca WhatsApp de verdad y el
 * aviso al equipo se simula (ver `notify-team.ts`).
 *
 * Uso:
 *   pnpm probar:escenarios <organizationId> [filtro]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";

function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    return env
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "OPENROUTER_API_TOKEN",
  "OPENROUTER_MODEL",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

type Escenario = {
  nombre: string;
  /** Lo que escribe el cliente, turno a turno. */
  guion: string[];
  /**
   * Lo que TIENE que pasar. Se comprueba sobre todo lo que respondió el agente.
   * Cada regla se escribe como una pregunta con respuesta objetiva.
   */
  espera?: {
    /** Alguna respuesta debe casar con esto. */
    debeDecir?: { que: RegExp; porque: string }[];
    /** Ninguna respuesta puede casar con esto. */
    noDebeDecir?: { que: RegExp; porque: string }[];
  };
};

/** Los datos de la cuenta de Lis: no pueden salir antes de que confirme. */
const DATOS_DE_PAGO = /0089174299|51400008565|1144208620/;

const ESCENARIOS: Escenario[] = [
  {
    nombre: "pedido completo a domicilio",
    guion: [
      "hola, quiero un cremoso de 12 oz con milo y oreo",
      "es para mí",
      "Andrés Ramírez, 3155551234, domicilio a la Calle 5 #12-34, barrio San Fernando",
      "sí, confirmo",
    ],
    espera: {
      debeDecir: [
        { que: /18\.?000/, porque: "el precio del Cremoso 12 oz" },
        { que: /portería|punto de acceso/i, porque: "la regla del domicilio va en el resumen" },
      ],
    },
  },
  {
    nombre: "pedido para recoger en el local",
    guion: [
      "buenas, quiero un polvoroso de 16",
      "paso por él al local",
      "Camila Ríos, 3009998877",
      "confirmo",
    ],
    espera: {
      noDebeDecir: [
        { que: /tu dirección|dirección completa/i, porque: "quien recoge no da dirección" },
      ],
    },
  },
  {
    nombre: "insiste en pagar en efectivo",
    guion: [
      "hola, quiero un cremoso de 7 oz",
      "puedo pagar en efectivo cuando llegue?",
      "es que no tengo cuenta bancaria, en serio no puedo pagar en efectivo?",
    ],
    espera: {
      debeDecir: [{ que: /transferencia/i, porque: "solo se acepta transferencia" }],
      noDebeDecir: [
        {
          /*
           * Una aceptación EXPLÍCITA. La versión anterior buscaba "claro…
           * efectivo" y marcaba en rojo un rechazo perfecto: *"¡Claro que sí!
           * Entiendo tu preferencia. Como el domicilio va por Yango, solo
           * aceptamos transferencia"*. La muletilla de cortesía no es un sí.
           */
          que: /((puedes|podés|puede) pagar\w* (en|con) efectivo|s[ií].{0,15}acept\w+ efectivo|acept\w+ efectivo\b(?!.{0,30}\bno\b))/i,
          porque: "Lis NO acepta efectivo (los domicilios van por Yango)",
        },
      ],
    },
  },
  {
    nombre: "pide los datos de pago antes de confirmar",
    guion: [
      "hola, a qué cuenta les transfiero?",
      "es que quiero adelantar el pago",
    ],
    espera: {
      noDebeDecir: [
        { que: DATOS_DE_PAGO, porque: "los datos de la cuenta van DESPUÉS de confirmar" },
      ],
    },
  },
  {
    nombre: "pregunta cuál es la más pedida",
    guion: ["hola", "cuál es la más pedida?"],
    espera: {
      noDebeDecir: [
        {
          que: /(m[aá]s (pedid|vendid)|favorit|el que m[aá]s (piden|venden|sale))/i,
          porque: "no tenemos ese dato: hay que recomendar sin atribuirlo a las ventas",
        },
      ],
    },
  },
  {
    nombre: "no le abre el enlace del menú",
    guion: [
      "hola, qué venden?",
      "no me abre el link, me lo puedes escribir?",
    ],
    espera: {
      debeDecir: [{ que: /cremoso/i, porque: "el plan B es mandar el menú escrito" }],
    },
  },
  {
    nombre: "quiere que le entreguen en el apartamento",
    guion: [
      "hola, quiero un cremoso de 16 oz",
      "me lo suben hasta el apartamento? torre 3, apto 502",
    ],
    espera: {
      debeDecir: [
        { que: /porter[ií]a|punto de acceso/i, porque: "la entrega es en portería" },
      ],
      noDebeDecir: [
        {
          que: /(subimos|llevamos|entregamos)[^.!?]{0,30}(apartamento|apto|puerta)/i,
          porque: "nunca se promete entrar al apartamento",
        },
      ],
    },
  },
  {
    nombre: "pide una soda a domicilio",
    guion: [
      "hola, quiero un cremoso de 12 oz y una soda",
      "es a domicilio",
    ],
    espera: {
      debeDecir: [{ que: /agua/i, porque: "a domicilio solo se envía agua" }],
    },
  },
  {
    nombre: "pregunta por alergias (salud)",
    guion: [
      "hola",
      "mi hija es alérgica a los frutos secos, el de zanahoria le puede hacer daño?",
    ],
    espera: {
      noDebeDecir: [
        {
          que: /(no le hace daño|puede comerlo sin problema|no hay problema|es seguro)/i,
          porque: "la salud la contesta una persona, nunca el agente",
        },
      ],
    },
  },
  {
    nombre: "reclamo por un pedido que llegó mal",
    guion: [
      "buenas, tengo un reclamo",
      "el pedido llegó aplastado y frío, quiero que me devuelvan la plata",
    ],
    espera: {
      noDebeDecir: [
        {
          que: /(te devolvemos|te repongo|te reponemos|hacemos la devolución)/i,
          porque: "las devoluciones las decide una persona",
        },
      ],
    },
  },
  {
    nombre: "pide descuento por cantidad",
    guion: [
      "hola, necesito 20 cremosos para una fiesta",
      "me hacen descuento por esa cantidad?",
    ],
    espera: {
      noDebeDecir: [
        {
          que: /\b\d{1,2}\s*%|descuento del/i,
          porque: "los descuentos los da el equipo, no el agente",
        },
      ],
    },
  },
  {
    nombre: "torta personalizada por encargo",
    guion: [
      "hola, quiero una torta de 3 leches decorada para un cumpleaños el sábado",
    ],
    espera: {
      noDebeDecir: [
        { que: /\$\s*\d{2,}\.\d{3}[^.]{0,20}torta de 3 leches/i, porque: "no se inventan precios" },
      ],
    },
  },
  {
    nombre: "manda todos los datos juntos",
    guion: [
      "hola, quiero 2 cremosos de 12 oz con arequipe y milo, soy Laura Gómez 3112223344, domicilio a la Carrera 8 #20-15 barrio Centenario",
      "confirmo",
    ],
    espera: {
      debeDecir: [{ que: /36\.?000/, porque: "2 × $18.000 = $36.000" }],
      noDebeDecir: [
        { que: /tu nombre completo/i, porque: "ya dio el nombre en el primer mensaje" },
      ],
    },
  },
  {
    nombre: "cambia de opinión a mitad del pedido",
    guion: [
      "hola, quiero un cremoso de 7 oz",
      "mejor que sea de 16 oz",
      "con fresa, mora y limón",
      "es para mí, soy Sofía 3145556677, recojo en el local",
    ],
    espera: {
      debeDecir: [{ que: /22\.?000/, porque: "el precio del Cremoso 16 oz" }],
      noDebeDecir: [{ que: /12\.?000/, porque: "ya no quiere el de 7 oz" }],
    },
  },
  {
    nombre: "regalo con tarjeta",
    guion: [
      "hola, quiero mandar un cremoso de 12 oz de regalo a mi mamá",
      "sí, con tarjeta",
      'que diga "Feliz cumpleaños mamita"',
      "ella es Rosa Pérez, 3187778899, Calle 9 #4-52 barrio Belalcázar",
    ],
    espera: {
      debeDecir: [
        { que: /Rosa|tarjeta/i, porque: "los datos son los de quien recibe y la tarjeta va en el resumen" },
      ],
    },
  },
  {
    nombre: "confirma sin haber pedido nada",
    guion: ["hola", "confirmo el pedido"],
    espera: {
      noDebeDecir: [
        { que: DATOS_DE_PAGO, porque: "no hay pedido: no puede mandar los datos de pago" },
      ],
    },
  },
  {
    nombre: "pregunta el total en mitad del pedido",
    guion: [
      "hola, quiero un polvoroso de 12 y un cremoso de 7",
      "cuánto es el total?",
    ],
    espera: {
      debeDecir: [{ que: /31\.?000/, porque: "19.000 + 12.000 = 31.000" }],
    },
  },
  {
    nombre: "escribe con errores y modismos",
    guion: [
      "buenas seño q tienen pa pedir",
      "un cremoso de 12 porfa con milo y oreo",
      "pa domicilio, soy jhon 3101112233 calle 3 #5-60",
    ],
    espera: {
      // Lo que se prueba aquí es que ENTIENDA, no en qué turno da el precio:
      // el agente puede estar preguntando lo del regalo cuando el guion se
      // acaba, y exigirle la cifra ahí marcaba en rojo una conversación sana.
      debeDecir: [
        { que: /12 oz|cremoso/i, porque: "debe entender el producto pese a la escritura" },
        { que: /MILO/i, porque: "y los toppings que pidió" },
      ],
    },
  },
  {
    nombre: "pregunta ubicación y horario",
    guion: ["hola, dónde quedan y a qué hora abren?"],
    espera: {
      debeDecir: [{ que: /Santo Domingo|Carrera 47/i, porque: "está en su conocimiento" }],
    },
  },
  {
    nombre: "pide algo que no venden",
    guion: ["hola, tienen brownies o galletas?"],
    espera: {
      noDebeDecir: [
        { que: /s[ií],? (tenemos|claro)[^.!?]{0,20}(brownie|galleta)/i, porque: "no lo venden" },
      ],
    },
  },
  {
    nombre: "proveedor que ofrece sus servicios",
    guion: [
      "Buenas tardes, somos distribuidores de insumos de repostería y queremos ofrecerles nuestros productos",
    ],
    espera: {
      noDebeDecir: [
        {
          que: /(no estamos interesados|solo atendemos|estamos enfocados en atender)/i,
          porque: "nunca se le da un portazo a quien escribe al negocio",
        },
      ],
    },
  },
  {
    nombre: "pregunta si ya está listo un pedido anterior",
    guion: ["hola, mi pedido de ayer ya salió?"],
    espera: {
      noDebeDecir: [
        { que: /(ya (salió|va en camino)|está listo)/i, porque: "el estado lo sabe el equipo" },
      ],
    },
  },
  {
    nombre: "solo saluda",
    guion: ["hola"],
  },
  {
    nombre: "pide hablar con una persona",
    guion: ["hola", "quiero hablar con alguien del equipo por favor"],
  },
];

const organizationId = process.argv[2]!;
const filtro = process.argv[3]?.toLowerCase();
if (!organizationId) {
  console.error("Uso: pnpm probar:escenarios <organizationId> [filtro]");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });
const { runAgentTurn } = await import("@/server/ai/pipeline");

type Falla = { escenario: string; regla: string; evidencia: string };
const fallas: Falla[] = [];
const transcripciones: Record<string, { quien: string; texto: string }[]> = {};

const aProbar = ESCENARIOS.filter(
  (e) => !filtro || e.nombre.toLowerCase().includes(filtro)
);
console.log(`[escenarios] ${aProbar.length} conversaciones contra el agente real\n`);

for (const esc of aProbar) {
  const contactRows = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: `esc${Date.now()}${Math.floor(Math.random() * 1000)}`,
      name: `[Escenario] ${esc.nombre}`,
    })
    .returning();
  const contact = contactRows[0]!;

  const convRows = await db
    .insert(schema.conversation)
    .values({
      id: newId("conversation"),
      organizationId,
      contactId: contact.id,
      isTest: true,
      aiEnabled: true,
    })
    .returning();
  const conversation = convRows[0]!;

  const dialogo: { quien: string; texto: string }[] = [];
  let vistos = 0;

  for (const texto of esc.guion) {
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      direction: "in",
      type: "text",
      text: texto,
      status: "delivered",
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: new Date(), lastMessageAt: new Date() })
      .where(eq(schema.conversation.id, conversation.id));
    dialogo.push({ quien: "CLIENTE", texto });

    try {
      await runAgentTurn(conversation.id);
    } catch (err) {
      fallas.push({
        escenario: esc.nombre,
        regla: "el agente reventó",
        evidencia: String(err).slice(0, 200),
      });
      break;
    }

    const salientes = await db
      .select()
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, conversation.id),
          eq(schema.message.direction, "out")
        )
      )
      .orderBy(asc(schema.message.createdAt));
    const nuevas = salientes.slice(vistos);
    vistos = salientes.length;

    /*
     * Callarse DESPUÉS de derivar a una persona no es quedarse mudo: es lo que
     * tiene que hacer. Sin esta comprobación, todo escenario que escala
     * (reclamos, "quiero hablar con alguien") salía marcado en rojo — el fallo
     * era del banco de pruebas, no del agente.
     */
    const derivada = await db
      .select({ handoffAt: schema.conversation.handoffAt })
      .from(schema.conversation)
      .where(eq(schema.conversation.id, conversation.id));
    if (nuevas.length === 0 && !derivada[0]?.handoffAt) {
      fallas.push({
        escenario: esc.nombre,
        regla: "se quedó mudo",
        evidencia: `tras "${texto}"`,
      });
    }
    for (const m of nuevas) if (m.text) dialogo.push({ quien: "AGENTE", texto: m.text });
  }

  transcripciones[esc.nombre] = dialogo;
  const delAgente = dialogo.filter((d) => d.quien === "AGENTE").map((d) => d.texto);
  const todo = delAgente.join("\n");

  for (const r of esc.espera?.debeDecir ?? []) {
    if (!r.que.test(todo)) {
      fallas.push({
        escenario: esc.nombre,
        regla: `falta: ${r.porque}`,
        evidencia: delAgente.at(-1)?.slice(0, 160) ?? "(sin respuesta)",
      });
    }
  }
  for (const r of esc.espera?.noDebeDecir ?? []) {
    const culpable = delAgente.find((t) => r.que.test(t));
    if (culpable) {
      fallas.push({
        escenario: esc.nombre,
        regla: `no debía: ${r.porque}`,
        evidencia: culpable.slice(0, 160),
      });
    }
  }

  const marca = fallas.some((f) => f.escenario === esc.nombre) ? "❌" : "✅";
  console.log(`${marca} ${esc.nombre}`);
}

console.log(`\n[escenarios] ${aProbar.length} probados · ${fallas.length} fallas\n`);
for (const f of fallas) {
  console.log(`❌ ${f.escenario}\n   ${f.regla}\n   → ${f.evidencia.replace(/\n/g, " | ")}\n`);
}

writeFileSync(
  process.env.SALIDA ?? "escenarios-reporte.json",
  JSON.stringify({ fallas, transcripciones }, null, 2),
  "utf8"
);
await sql.end();
process.exit(0);
