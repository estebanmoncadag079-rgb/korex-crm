/**
 * Mide la TASA DE EXTRACCIÓN FALLIDA sobre conversaciones REALES.
 *
 * **Por qué existe**: es la cuarta medición de la Fase 0, la única que quedó
 * pendiente, y la condición de entrada de la Fase 2
 * ([62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md](../docs/korexia/62-ARQUITECTURA-ESTADO-Y-CAPACIDADES.md)).
 *
 * La objeción que responde es la #1, y es seria: el estado estructurado obliga
 * al modelo a emitir JSON válido **en cada turno**. Cada campo obligatorio nuevo
 * es otra forma de rechazo duro → reintentos agotados → **handoff falso
 * silencioso**, el peor fallo del sistema porque no aparece en ningún log. Si la
 * tasa de fallo es <1-2 %, la objeción cae y la Fase 2 puede empezar. Si es
 * alta, el plan cambia ANTES de escribir la arquitectura, no después.
 *
 * De paso mide la objeción #2 (nadie ha calculado el coste): `chatJson` informa
 * el importe exacto que cobra OpenRouter —no una estimación por tarifa— y aquí
 * se cronometra cada llamada, porque YCloud exige responder en menos de 6 s.
 *
 * **No escribe nada**: solo lee conversaciones y llama al modelo.
 *
 * Uso:
 *   pnpm medir:extraccion <organizationId>
 *   pnpm medir:extraccion <organizationId> --conversaciones 30 --max-llamadas 200
 *   pnpm medir:extraccion <organizationId> --modelo openai/gpt-4.1-mini
 */
import { readFileSync, writeFileSync } from "node:fs";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai";
import * as schema from "@/lib/db/schema";
import { catalogoDePedidos } from "@/server/catalog/queries";
import { renderCatalogoDePedidos } from "@/server/catalog/render";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}
for (const name of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "OPENROUTER_API_TOKEN",
  "OPENROUTER_MODEL",
]) {
  const v = loadEnvVar(name);
  if (v && !process.env[name]) process.env[name] = v;
}

function argOf(nombre: string, pordefecto: number): number {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i === -1) return pordefecto;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : pordefecto;
}

const organizationId = process.argv[2];
if (!organizationId || organizationId.startsWith("--")) {
  console.error("Uso: pnpm medir:extraccion <organizationId> [--conversaciones N] [--max-llamadas N] [--modelo X]");
  process.exit(1);
}
const CUANTAS_CONVERSACIONES = argOf("conversaciones", 25);
// Tope duro de gasto: cada llamada cuesta dinero real y el saldo de OpenRouter
// ya dejó al bot mudo una vez (29-jul). Mejor una medición corta que una
// factura sorpresa.
const MAX_LLAMADAS = argOf("max-llamadas", 150);
const iModelo = process.argv.indexOf("--modelo");
const modelo = iModelo === -1 ? undefined : process.argv[iModelo + 1];

/**
 * DOS contratos, una sola llamada.
 *
 * La primera corrida de esta medición dio 75 % de fallo, y el motivo no era que
 * el modelo no supiera extraer el pedido: era que `paso` se pidió como enum
 * cerrado y el modelo devolvía otra etiqueta. Es la objeción #1 en vivo — el
 * rechazo lo causa la severidad del contrato, no la capacidad del modelo — y es
 * exactamente el incidente del 13-ago (`"label"` en vez de `"etiqueta"`), cuyo
 * arreglo NO fue exigirle mejor el campo, sino aceptar lo que manda y comprobar
 * el hecho.
 *
 * Así que se llama con el contrato TOLERANTE (una llamada, un coste) y después,
 * en local y gratis, se comprueba si esa misma respuesta habría pasado el
 * contrato ESTRICTO. Una medición, los dos números.
 */
const PASOS = [
  "saludo",
  "eligiendo_producto",
  "eligiendo_opciones",
  "datos_de_entrega",
  "resumen",
  "confirmado",
  "otro",
] as const;

const EstadoTolerante = z.object({
  producto: z.string().nullable(),
  cantidad: z.number().int().positive().nullable(),
  salsas: z.array(z.string()),
  recubierto: z.string().nullable(),
  adiciones: z.array(z.string()),
  nombre: z.string().nullable(),
  telefono: z.string().nullable(),
  direccion: z.string().nullable(),
  paso: z.string(),
});
type EstadoPedido = z.infer<typeof EstadoTolerante>;

const EstadoEstricto = EstadoTolerante.extend({ paso: z.enum(PASOS) });

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[medir] DATABASE_URL no está definida");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const productos = await catalogoDePedidos(organizationId);
if (productos.length === 0) {
  console.error("[medir] esta organización no tiene catálogo en tablas: la medición no aplica");
  process.exit(1);
}
const carta = renderCatalogoDePedidos(productos);

// Conversaciones REALES: las de prueba no valen para medir nada, y la sesión
// de 26 mensajes que disparó la alarma en la Fase 0 resultó ser del propio
// dueño probando.
const conversaciones = await db
  .select({ id: schema.conversation.id })
  .from(schema.conversation)
  .where(
    and(
      eq(schema.conversation.organizationId, organizationId),
      eq(schema.conversation.isTest, false)
    )
  )
  .orderBy(desc(schema.conversation.lastInboundAt))
  .limit(CUANTAS_CONVERSACIONES);

const SISTEMA = `Extraes el estado de un pedido a partir de una conversación de WhatsApp.

Devuelves SOLO un objeto JSON con estas claves exactas:
producto, cantidad, salsas, recubierto, adiciones, nombre, telefono, direccion, paso.

Reglas:
- Lo que el cliente todavía NO haya dicho va en null (o lista vacía).
- "producto" es el nombre tal como aparece en la carta.
- "paso" es en qué punto va la conversación.
- No inventes nada que no esté dicho en la conversación.

La carta de este negocio:
${carta}`;

type Fallo = {
  conversacion: string;
  motivo: string;
  detalle: string;
};

let llamadas = 0;
let fallosEstructura = 0;
let noResuelveCatalogo = 0;
let rechazadosPorElEstricto = 0;
const pasosDesconocidos = new Map<string, number>();
const fallos: Fallo[] = [];
const latencias: number[] = [];
let costeTotal = 0;
let tokensIn = 0;
let tokensOut = 0;
const muestras: { conversacion: string; ultimo: string; estado: EstadoPedido }[] = [];

const nombresDeProducto = new Map(productos.map((p) => [p.nombre.toLowerCase(), p]));
const salsasValidas = new Set(
  productos.flatMap((p) => p.grupos.flatMap((g) => g.opciones.map((o) => o.nombre.toLowerCase())))
);

for (const conv of conversaciones) {
  if (llamadas >= MAX_LLAMADAS) break;

  const mensajes = await db
    .select({
      direction: schema.message.direction,
      text: schema.message.text,
    })
    .from(schema.message)
    .where(eq(schema.message.conversationId, conv.id))
    .orderBy(asc(schema.message.createdAt));

  const utiles = mensajes.filter((m) => m.text?.trim());
  if (utiles.length < 3) continue;

  // Se extrae en CADA mensaje del cliente, que es lo que haría la Fase 2: el
  // backend rehace el estado en cada turno. Medir solo el final escondería
  // justo los turnos intermedios, que son los que más se equivocan.
  for (let i = 0; i < utiles.length; i++) {
    if (utiles[i].direction !== "in") continue;
    if (llamadas >= MAX_LLAMADAS) break;

    const historial = utiles
      .slice(0, i + 1)
      .map((m) => `${m.direction === "in" ? "CLIENTE" : "NEGOCIO"}: ${m.text}`)
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: SISTEMA },
      { role: "user", content: `Conversación hasta ahora:\n\n${historial}\n\nDevuelve el estado del pedido.` },
    ];

    const t0 = Date.now();
    const res = await chatJson(EstadoTolerante, messages, modelo ? { model: modelo } : undefined);
    latencias.push(Date.now() - t0);
    llamadas++;
    if (res.usage) {
      costeTotal += res.usage.costUsd;
      tokensIn += res.usage.tokensIn;
      tokensOut += res.usage.tokensOut;
    }

    if (!res.ok) {
      // Esto es exactamente lo que la objeción #1 teme: en producción sería
      // reintentos agotados y una conversación derivada a una persona sin que
      // nadie se entere.
      fallosEstructura++;
      fallos.push({ conversacion: conv.id, motivo: res.error, detalle: res.detail.slice(0, 160) });
      continue;
    }

    // ¿Habría sobrevivido al contrato estricto? Gratis, en local, sobre la
    // misma respuesta: es la diferencia entre "el modelo no sabe" y "se lo
    // pedimos con demasiada severidad".
    const e = res.data;
    if (!EstadoEstricto.safeParse(e).success) {
      rechazadosPorElEstricto++;
      pasosDesconocidos.set(e.paso, (pasosDesconocidos.get(e.paso) ?? 0) + 1);
    }

    // Segundo nivel: que el JSON sea válido no basta. Un producto que no existe
    // en ESTA organización o una salsa inventada es un pedido mal tomado, y el
    // backend tendría que rechazarlo igual.
    const problemas: string[] = [];
    if (e.producto && !nombresDeProducto.has(e.producto.toLowerCase().trim())) {
      problemas.push(`producto fuera de la carta: "${e.producto}"`);
    }
    for (const s of e.salsas) {
      if (!salsasValidas.has(s.toLowerCase().trim())) problemas.push(`salsa fuera de la carta: "${s}"`);
    }
    if (problemas.length) {
      noResuelveCatalogo++;
      fallos.push({ conversacion: conv.id, motivo: "no_resuelve", detalle: problemas.join(" · ") });
    }

    // La muestra lleva el historial ENTERO, no solo el último mensaje: sin el
    // contexto no se puede juzgar si un `producto` relleno es un acierto (lo
    // eligió tres mensajes atrás) o una alucinación. Juzgar por el último
    // mensaje es como culpar al modelo sin leer la conversación. Va a un
    // archivo aparte porque en consola ahoga el resumen.
    if (e.producto) {
      muestras.push({ conversacion: conv.id, ultimo: historial, estado: e });
    }
  }
}

const pct = (n: number) => (llamadas === 0 ? "0" : ((n / llamadas) * 100).toFixed(1));
const percentil = (p: number) => {
  if (latencias.length === 0) return 0;
  const orden = [...latencias].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((p / 100) * orden.length))];
};

console.log(`\n${"=".repeat(72)}`);
console.log(`MEDICIÓN 4 — tasa de extracción fallida`);
console.log(`modelo: ${modelo ?? process.env.OPENROUTER_MODEL}`);
console.log(`${"=".repeat(72)}`);
console.log(`conversaciones reales : ${conversaciones.length}`);
console.log(`extracciones (turnos) : ${llamadas}`);
console.log(`\n--- Objeción #1: ¿falla la extracción? ---`);
console.log(`  contrato TOLERANTE, JSON inválido : ${fallosEstructura}  (${pct(fallosEstructura)} %)   ← el umbral es 1-2 %`);
console.log(`  contrato ESTRICTO lo rechazaría   : ${rechazadosPorElEstricto}  (${pct(rechazadosPorElEstricto)} %)`);
console.log(`  no resuelve la carta              : ${noResuelveCatalogo}  (${pct(noResuelveCatalogo)} %)`);
if (pasosDesconocidos.size) {
  const lista = [...pasosDesconocidos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `"${p}" ×${n}`)
    .join(" · ");
  console.log(`  etiquetas de "paso" fuera del enum: ${lista}`);
}
console.log(`\n--- Objeción #2: ¿cuánto cuesta y cuánto tarda? ---`);
console.log(`  coste total          : $${costeTotal.toFixed(4)} USD`);
console.log(`  coste por extracción : $${(llamadas ? costeTotal / llamadas : 0).toFixed(6)} USD`);
console.log(`  tokens               : ${tokensIn} entrada · ${tokensOut} salida`);
console.log(`  latencia p50 / p90   : ${percentil(50)} ms / ${percentil(90)} ms   ← YCloud corta a 6000 ms`);

if (fallos.length) {
  console.log(`\n--- Los fallos, uno a uno ---`);
  for (const f of fallos.slice(0, 15)) {
    console.log(`  [${f.motivo}] ${f.conversacion}: ${f.detalle}`);
  }
  if (fallos.length > 15) console.log(`  … y ${fallos.length - 15} más`);
}

/**
 * Lo que valida no siempre es correcto, y esa parte no la decide un script.
 *
 * Un `producto` relleno puede ser un acierto (lo eligió tres mensajes atrás) o
 * una alucinación, y las dos cosas pasan el esquema Y la carta. Por eso las
 * extracciones se vuelcan enteras —con su conversación— para que una persona
 * las mire: el mismo criterio que impide escribir un catálogo sin revisarlo.
 */
const iSalida = process.argv.indexOf("--salida");
const salida =
  iSalida === -1 ? `extraccion-${organizationId}.json` : process.argv[iSalida + 1];
writeFileSync(salida, JSON.stringify(muestras, null, 2), "utf8");
console.log(`\n--- Para revisar a ojo ---`);
console.log(`  ${muestras.length} extracciones con producto, volcadas con su conversación en:`);
console.log(`  ${salida}`);
console.log(`  Lo que hay que mirar: si el producto lo pidió el cliente o lo puso el modelo.`);

await sql.end();
process.exit(0);
