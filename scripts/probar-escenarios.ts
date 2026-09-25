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
// Diagnóstico (DIAG=1): se reutilizan las MISMAS funciones que corre el
// pipeline — no se reimplementa ninguna decisión.
import { leerIntencion, planDelTurno, bloqueDelPlan } from "@/server/orders/intencion";
import { requisitosPendientesDe } from "@/server/orders/extraer";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import { leerFicha } from "@/server/ai/generador/leer-ficha";
import { requisitosDe } from "@/server/ai/generador/ficha";
import { catalogoDePedidos } from "@/server/catalog/queries";
import { verticalDe, contrataCitas } from "@/server/vertical";

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
    /**
     * Lo que tiene que haber quedado GUARDADO al terminar la conversación.
     *
     * 24-sep-2026. Hasta hoy esto solo miraba el texto que salió, y por eso no
     * cazó nada de lo que se arregló en esta tanda: el bot decía «anotado» y
     * el estado quedaba vacío, o guardaba como nombre del cliente el del
     * perfil de WhatsApp. Las dos cosas dan un transcript impecable.
     *
     * `estado` llega tal cual está en `conversation_state`, o `null` si no
     * quedó ninguno — que a veces es justo lo que se espera (el reinicio).
     */
    estadoFinal?: { que: (estado: Record<string, unknown> | null) => boolean; porque: string }[];
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
    /**
     * Esta prueba decía lo contrario hasta el 9-sep-2026: exigía que el agente
     * NO diera la cuenta antes de que el cliente confirmara. Se invirtió por
     * decisión del dueño, después de ver a un cliente preguntar por los medios
     * de pago y llevarse una derivación: *"si el cliente está pidiendo el
     * número de la cuenta se lo puedes dar sin ningún problema, simplemente le
     * dices que le recomiendas no pagar hasta tener el valor total de los
     * productos + el domicilio"*.
     *
     * Lo que sigue prohibido es MANDARLOS SIN QUE LOS PIDAN dentro del resumen
     * —eso junta los dos momentos del cierre y es la lección del 12-ago—, y de
     * eso se encarga el escenario del resumen, no este.
     */
    guion: [
      "hola, a qué cuenta les transfiero?",
      "es que quiero adelantar el pago",
    ],
    espera: {
      debeDecir: [
        {
          que: /(total|domicilio)/i,
          porque: "hay que avisarle que espere el total con el domicilio antes de transferir",
        },
      ],
      noDebeDecir: [
        {
          que: /(cuando|una vez|apenas|en cuanto)[^.]{0,30}confirm[^.]{0,40}(te (los )?(paso|env[íi]o|comparto|doy))/i,
          porque:
            "preguntó por la cuenta: hacerlo esperar por un dato que ya tenemos es lo que lo manda a otro lado",
        },
      ],
    },
  },
  {
    nombre: "pregunta cuál es la más pedida",
    guion: ["hola", "cuál es la más pedida?"],
    espera: {
      noDebeDecir: [
        {
          /*
           * Solo cuando lo AFIRMA. Decir "el favorito… pero no tenemos esa
           * información" es la respuesta correcta, y la versión anterior la
           * marcaba en rojo por nombrar la palabra.
           */
          que: /(es (uno de |el )?(los )?(m[aá]s (pedid|vendid)|favorit)|a todos les encanta|de los que m[aá]s (salen|piden|venden))/i,
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
      // Un turno más que antes: con cuatro, el resumen caía justo fuera del
      // guion y el escenario marcaba en rojo algo que aún no había pasado.
      "sí, confirmo",
    ],
    espera: {
      debeDecir: [{ que: /22\.?000/, porque: "el precio del Cremoso 16 oz" }],
      noDebeDecir: [
        { que: /12\.?000/, porque: "ya no quiere el de 7 oz" },
        {
          /*
           * Salió midiendo otra cosa: la clienta escribió "soy Sofía" y el
           * agente le contestó "*¿CUÁL ES TU NOMBRE?*". Volver a pedir un dato
           * que acaban de darte es la forma más rápida de que alguien abandone
           * un pedido, y su prompt ya lo prohíbe.
           */
          que: /(cu[aá]l es tu nombre|tu nombre completo|c[oó]mo te llamas)/i,
          porque: "ya dijo su nombre: no se vuelve a preguntar",
        },
      ],
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
  /**
   * MALIA, 22-sep-2026 — el muro de preguntas (la conversación de Yuli).
   *
   * Tres frases de una clienta, y el agente le devolvió en UN mensaje: las
   * opciones de cada producto, si era regalo, el nombre, el celular, cómo lo
   * recibía y la forma de pago. Seis puntos del orden de golpe.
   *
   * Las comprobaciones son objetivas a propósito, como el resto de este
   * archivo: no preguntan si la conversación «se siente natural» —eso es del
   * Laboratorio y su juez—, sino si en un mismo mensaje conviven peticiones
   * de puntos distintos del orden. Eso se lee o no se lee.
   *
   * ⚠️ **Solo tiene sentido DESPUÉS de `pnpm regenerar:flota --aplicar`.** El
   * agente contesta con el prompt guardado en `agent_profile.instructions`,
   * no con `conducta.ts`: sin regenerar, esto mide el prompt viejo.
   *
   * Uso:  pnpm probar:escenarios <organizationId de MALIA> malia
   */
  {
    nombre: "MALIA · muro de preguntas (Yuli)",
    guion: [
      "Hola buen día cómo estás?",
      "Para encargar por fa dos cremosos de 7 onzas",
      "Para un detalle",
    ],
    espera: {
      noDebeDecir: [
        {
          // Nombre y modalidad de entrega son los puntos 4 y 5 del orden.
          // Juntos en un mensaje, sin que la clienta haya dado ninguno de
          // los dos, es el muro. (Aquí no puede haber resumen todavía: el
          // guion no da ni un dato, así que no hay falso positivo posible.)
          que: /(nombre[sS]{0,500}(a domicilio|domicilio o|recoger)|(a domicilio|domicilio o|recoger)[sS]{0,500}nombre)/i,
          porque: "el nombre y la entrega son puntos distintos: no van en el mismo mensaje",
        },
        {
          // La forma de pago es el punto 7. Con la clienta todavía eligiendo
          // producto, preguntarla es saltarse media lista.
          que: /(forma de pago|cómo (vas a |)pagar|medio de pago)/i,
          porque: "el pago es lo último del orden, no se pregunta al elegir el producto",
        },
        {
          // El formato viejo del catálogo: las opciones aplastadas en una
          // línea con separador de punto medio.
          que: / · [A-ZÁÉÍÓÚÑ]{3,}[sS]{0,40} · /,
          porque: "las opciones se presentan como lista, no en una sola línea",
        },
      ],
    },
  },

  /* ------------------------------------------------------------------ *
   * A–J — intención, contexto y estado (24-sep-2026).
   *
   * Los diez escenarios del plan. Casi todos comprueban el ESTADO además
   * del texto, y ese es el punto: los fallos que vinieron a cerrar daban
   * transcripts impecables. El bot decía «¡anotado!» y no anotaba nada.
   * ------------------------------------------------------------------ */
  {
    nombre: "A. pedido normal de principio a fin",
    guion: [
      "hola, quiero un cremoso de 7 oz",
      "con milo",
      "es para mí",
      "Laura Gómez, 3151112233, paso por él al local",
      "confirmo",
    ],
    espera: {
      estadoFinal: [
        {
          que: (e) => Array.isArray(e?.items) && (e.items as unknown[]).length > 0,
          porque: "un pedido que se cerró tiene que haber quedado guardado",
        },
        {
          que: (e) => Boolean((e?.datos as Record<string, unknown> | undefined)?.nombre),
          porque: "el nombre que ella misma escribió sí se guarda",
        },
      ],
    },
  },
  {
    nombre: "B. pregunta por el domicilio en mitad del pedido",
    /*
     * El caso de MALIA, conv cv_zgm286k69bz1hmprf87a: preguntó el costo del
     * domicilio y le contestaron «¿qué quieres y cuántos?». Dieciséis
     * segundos después, sin carrera de turnos de por medio.
     */
    guion: ["hola, quiero un cremoso de 7 oz", "y cuánto cuesta el domicilio?"],
    espera: {
      debeDecir: [
        { que: /domicilio|env[íi]o|yango/i, porque: "preguntó por el domicilio: eso se contesta" },
      ],
      noDebeDecir: [
        {
          que: /(forma de pago|c[oó]mo (vas a |)pagar|medio de pago)/i,
          porque: "contestar una consulta no autoriza a saltar al último punto del orden",
        },
      ],
      estadoFinal: [
        {
          que: (e) => Array.isArray(e?.items) && (e.items as unknown[]).length > 0,
          porque: "contestar la consulta no puede borrar lo que ya había pedido",
        },
      ],
    },
  },
  {
    nombre: "C. pregunta por el horario en mitad del pedido",
    guion: ["hola, quiero un cremoso de 7 oz", "hasta qué hora atienden hoy?"],
    espera: {
      debeDecir: [{ que: /\d{1,2}[:.]?\d{0,2}\s*(am|pm|a\.m|p\.m|h)/i, porque: "preguntó una hora" }],
      noDebeDecir: [
        {
          que: /(forma de pago|c[oó]mo (vas a |)pagar|medio de pago)/i,
          porque: "una consulta de horario no adelanta el pago",
        },
      ],
    },
  },
  {
    nombre: "D. pregunta el precio en mitad del pedido",
    guion: ["hola, quiero un cremoso de 7 oz", "cuánto vale eso?"],
    espera: {
      debeDecir: [{ que: /\$|\d\.?\d{3}/, porque: "preguntó un precio: se le da la cifra" }],
    },
  },
  {
    nombre: "E. dice que es para regalo",
    // El topping va en el primer mensaje (como pide mucha gente): así el pedido
    // queda COMPLETO y se persiste, y el regalo se valida sobre un pedido real,
    // no sobre uno vacío. Decisión "Opción 2" del incidente de agregar_item.
    guion: ["hola, quiero un cremoso de 7 oz con milo", "es para un regalo"],
    espera: {
      estadoFinal: [
        {
          que: (e) => Array.isArray(e?.items) && (e.items as unknown[]).length > 0,
          porque: "el pedido con su topping tiene que haber quedado persistido",
        },
        {
          que: (e) => e?.paraRegalo === true,
          porque: "«es para un regalo» es un hecho del pedido, y tiene que sobrevivir al turno",
        },
      ],
    },
  },
  {
    nombre: "F. el nombre del perfil de WhatsApp no es el del cliente",
    /*
     * El script crea el contacto con `name = "[Escenario] …"`, así que si el
     * agente usa el perfil para rellenar el pedido, queda escrito y visible.
     * Es el caso real de MALIA: `datos.nombre = "Luisa Duque"` sin que Luisa
     * lo hubiera dicho nunca.
     */
    guion: ["hola, quiero un cremoso de 7 oz para un amigo secreto", "con milo"],
    espera: {
      estadoFinal: [
        {
          que: (e) =>
            !String((e?.datos as Record<string, unknown> | undefined)?.nombre ?? "").includes(
              "Escenario"
            ),
          porque: "el nombre del perfil de WhatsApp no es un dato que el cliente haya confirmado",
        },
      ],
    },
  },
  {
    nombre: "G. da la modalidad de entrega desde el primer mensaje",
    guion: [
      "hola, quiero un cremoso de 7 oz a domicilio",
      "con milo",
      "Laura Gómez, 3151112233, Calle 5 #12-34",
    ],
    espera: {
      noDebeDecir: [
        {
          que: /(c[oó]mo (lo|la) (recibes|quieres recibir)|domicilio o (lo )?recoges|lo recoges o)/i,
          porque: "lo dijo en el primer mensaje: volver a preguntarlo es el fallo de Lis y La Churra",
        },
      ],
      estadoFinal: [
        {
          que: (e) => Boolean(e?.modalidadDeEntrega),
          porque: "la modalidad que eligió tiene que quedar registrada, no solo entendida",
        },
      ],
    },
  },
  {
    nombre: "H. domicilio elegido pero sin tarifa verificada",
    /*
     * Con `delivery_source='prompt'` el backend NO tiene zonas que consultar,
     * así que `entrega` debe seguir en null. Es la regla del plan aplicada al
     * revés: que la modalidad se vea NO autoriza a inventar la tarifa.
     */
    guion: ["hola, quiero un cremoso de 7 oz a domicilio", "con milo"],
    espera: {
      estadoFinal: [
        {
          que: (e) => e?.entrega === null || e?.entrega === undefined,
          porque: "sin zona verificada, `entrega` se queda en null: no se rellena por inferencia",
        },
      ],
    },
  },
  {
    nombre: "I. reinicio con 0",
    guion: ["hola, quiero un cremoso de 7 oz", "es para un regalo", "0"],
    espera: {
      estadoFinal: [
        {
          que: (e) => e === null,
          porque: "el reinicio borra el pedido entero — el regalo y la modalidad incluidos",
        },
      ],
    },
  },
  {
    nombre: "J. pide un tamaño que no existe",
    guion: ["hola, me das 2 cremosos de 9 oz"],
    espera: {
      noDebeDecir: [
        {
          que: /(perfecto|listo|anotado|de una)[^.!?]{0,40}9\s*oz/i,
          porque: "no existe el de 9 oz: confirmarlo es venderle algo que no se le puede entregar",
        },
      ],
    },
  },
  /*
   * MALIA · Bug 5 (24-sep-2026): con la hoja lista, el bot decía "ahora preparo
   * el resumen" y se quedaba (Diana Manrique) o cerraba a ciegas sobre un "está
   * bien" (aymara cruz). Domicilio a Floralia (que en producción verifica una
   * tarifa real), producto real de 8 oz, y todos los datos: la hoja queda lista
   * (domicilio verificado). El backend debe forzar el resumen —con su total— en
   * el mismo turno, en vez de aplazarlo.
   *
   * ⚠️ Es de MALIA: correr con el filtro `malia` contra su organizationId.
   */
  /*
   * MALIA · Bug 4 (25-sep-2026): "¿hacen domicilio?" recibía la ficha entera
   * (restricciones de conjuntos, quién paga, apps de reparto) en vez de una
   * respuesta corta. La política completa está bien PARA EL RESUMEN; no para
   * una pregunta suelta a mitad del pedido.
   */
  {
    nombre: "MALIA · pregunta corta de domicilio, respuesta corta",
    guion: ["hola, quiero un pavé cremoso de 8 oz de leche klim", "hacen domicilio?"],
    espera: {
      debeDecir: [
        { que: /domicilio/i, porque: "preguntó por el domicilio: eso se contesta" },
      ],
      noDebeDecir: [
        {
          que: /conjuntos|centros comerciales|recepci[oó]n|apartamento/i,
          porque: "las restricciones de entrega van en el resumen, no en una pregunta suelta",
        },
        {
          que: /debe pagarlo junto con todo el pedido|antes de despachar/i,
          porque: "la política de quién paga va en el resumen, no en una pregunta suelta",
        },
      ],
    },
  },
  {
    nombre: "MALIA · la hoja lista no aplaza el resumen",
    guion: [
      "hola, quiero un pavé cremoso de 8 oz de leche klim",
      "es para mí, a domicilio",
      "Calle 72 -1 # 3 n 45 barrio floralia",
      "cuánto me queda con el domicilio?",
      "Diana Torres, 3145602573",
    ],
    espera: {
      debeDecir: [
        {
          que: /total\b[^\n$]{0,40}\$\s*[\d]/i,
          porque: "con la hoja lista, muestra el resumen con su total en el mismo turno — no lo aplaza",
        },
      ],
      estadoFinal: [
        {
          que: (e) => Array.isArray(e?.items) && (e.items as unknown[]).length > 0,
          porque: "el pedido tiene que haber quedado guardado",
        },
      ],
    },
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

/*
 * Modo diagnóstico (DIAG=1): además del veredicto de reglas, imprime por cada
 * turno la cadena que el auditor quiere observar sobre el sistema REAL —
 * intención, plan, estado antes/después, requisitos pendientes y posibilidad
 * de confirmar—, calculada con las MISMAS funciones que usa el pipeline. No
 * reimplementa nada: `runAgentTurn` es quien de verdad corre el modelo y aplica
 * las operaciones; esto solo observa las entradas reales y el estado real que
 * quedó. La operación EXACTA que propuso el modelo y el bloque literal viven
 * dentro de `runAgentTurn`; aquí se ve su efecto neto (estado antes → después).
 */
const DIAG = process.env.DIAG === "1";
type Diag = { catalogo: Awaited<ReturnType<typeof catalogoDePedidos>>; requisitos: ReturnType<typeof requisitosDe>; exigir: boolean; minimoDomicilioCents?: number };
let diag: Diag | null = null;
if (DIAG) {
  const prof = (
    await db.select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, organizationId))
  )[0];
  const ficha = prof?.ficha ? leerFicha(prof.ficha) : null;
  const vertical = verticalDe(prof?.appointmentsEnabled ?? false);
  diag = {
    catalogo: await catalogoDePedidos(organizationId),
    requisitos: ficha ? requisitosDe(ficha) : [],
    exigir: prof?.stateSource === "backend" && !contrataCitas(vertical),
    minimoDomicilioCents: (ficha as { entrega?: { minimoDomicilioCents?: number } } | null)?.entrega
      ?.minimoDomicilioCents,
  };
}

async function leerEstado(conversationId: string): Promise<Record<string, unknown> | null> {
  const filas = await db
    .select({ estado: schema.conversationState.estado })
    .from(schema.conversationState)
    .where(eq(schema.conversationState.conversationId, conversationId));
  return (filas[0]?.estado as Record<string, unknown> | undefined) ?? null;
}

async function imprimirDiagnostico(
  conversationId: string,
  mensaje: string,
  estadoDespues: Record<string, unknown> | null,
  historia: { direction: string; text: string | null; createdAt: Date }[],
  respuesta: string
) {
  if (!diag) return;
  const lectura = leerIntencion(mensaje, diag.catalogo);
  const hayPedido = Array.isArray(estadoDespues?.items) && (estadoDespues!.items as unknown[]).length > 0;
  const plan = planDelTurno(lectura, hayPedido);
  const bloque = bloqueDelPlan(lectura, plan, diag.exigir);
  const pend = requisitosPendientesDe(estadoDespues as never, diag.requisitos, diag.exigir) ?? [];
  const cierre = await puedeConfirmarPedido({
    conversationId,
    productosDelPedido: diag.catalogo,
    history: historia,
    estadoGuardado: estadoDespues as never,
    requisitos: diag.requisitos,
    ...(diag.minimoDomicilioCents ? { minimoDomicilioCents: diag.minimoDomicilioCents } : {}),
  });
  const l = (k: string, v: unknown) => console.log(`      ${k.padEnd(22)} ${v}`);
  console.log(`   ── diagnóstico del turno ──`);
  l("mensaje", mensaje);
  l("intención", `${lectura.intencion} (${lectura.porque})${lectura.productoMencionado ? ` · producto: ${lectura.productoMencionado}` : ""}`);
  l("plan", bloque ? `responderPrimero=${plan.responderPrimero} continuar=${plan.continuarEnElMismoMensaje}` : "(ninguno)");
  l("requisitos pendientes", pend.map((r) => r.id).join(", ") || "(ninguno)");
  l("¿puede confirmar?", cierre.ok ? "SÍ" : `NO — ${cierre.motivo}`);
  l("procedenciaDelNombre", (estadoDespues?.procedenciaDelNombre as string) ?? "(sin procedencia)");
  l("paraRegalo", String(estadoDespues?.paraRegalo ?? false));
  l("respuesta", respuesta.slice(0, 120).replace(/\n/g, " | "));
}

type Falla = { escenario: string; regla: string; evidencia: string };
const fallas: Falla[] = [];
const transcripciones: Record<string, { quien: string; texto: string }[]> = {};
/** El estado que quedó guardado en cada escenario, para el reporte. */
const estados: Record<string, Record<string, unknown> | null> = {};

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

    if (DIAG) {
      const historia = dialogo.map((d) => ({
        direction: d.quien === "CLIENTE" ? "in" : "out",
        text: d.texto,
        createdAt: new Date(),
      }));
      await imprimirDiagnostico(
        conversation.id,
        texto,
        await leerEstado(conversation.id),
        historia,
        nuevas.map((m) => m.text ?? "").join(" | ")
      );
    }
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

  if (esc.espera?.estadoFinal?.length) {
    const filas = await db
      .select({ estado: schema.conversationState.estado })
      .from(schema.conversationState)
      .where(eq(schema.conversationState.conversationId, conversation.id));
    const estado = (filas[0]?.estado as Record<string, unknown> | undefined) ?? null;
    estados[esc.nombre] = estado;
    for (const r of esc.espera.estadoFinal) {
      if (!r.que(estado)) {
        fallas.push({
          escenario: esc.nombre,
          regla: `el estado guardado no cumple: ${r.porque}`,
          evidencia: JSON.stringify(estado)?.slice(0, 220) ?? "(sin estado)",
        });
      }
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
  JSON.stringify({ fallas, transcripciones, estados }, null, 2),
  "utf8"
);
await sql.end();
process.exit(0);
