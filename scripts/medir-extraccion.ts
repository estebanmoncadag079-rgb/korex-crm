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
import { AgentAction } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
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
  // `coerce` y no `string`: el modelo devuelve `paso` como NÚMERO en cuanto el
  // prompt del negocio numera sus mensajes —"(1) presentaciones, (2) salsas…"—
  // y exigir texto rechazaba el 80 % de las respuestas. Normalizar el tipo es
  // trabajo del backend; rechazar por él es fabricar un handoff falso.
  paso: z.coerce.string(),
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

/**
 * Los turnos del cliente, cada uno con la conversación hasta ese punto.
 *
 * Se mide en CADA mensaje del cliente, que es lo que haría la Fase 2: el
 * backend rehace el estado en cada turno. Medir solo el final escondería justo
 * los turnos intermedios, que son los que más se equivocan — y de hecho el
 * error de `cantidad: 6` apareció en uno de ellos.
 */
async function cargarTurnos(): Promise<{ conversacion: string; historial: string }[]> {
  const turnos: { conversacion: string; historial: string }[] = [];
  for (const conv of conversaciones) {
    const mensajes = await db
      .select({ direction: schema.message.direction, text: schema.message.text })
      .from(schema.message)
      .where(eq(schema.message.conversationId, conv.id))
      .orderBy(asc(schema.message.createdAt));

    const utiles = mensajes.filter((m) => m.text?.trim());
    if (utiles.length < 3) continue;

    for (let i = 0; i < utiles.length; i++) {
      if (utiles[i].direction !== "in") continue;
      turnos.push({
        conversacion: conv.id,
        historial: utiles
          .slice(0, i + 1)
          .map((m) => `${m.direction === "in" ? "CLIENTE" : "NEGOCIO"}: ${m.text}`)
          .join("\n"),
      });
    }
  }
  return turnos;
}

const turnos = await cargarTurnos();

/**
 * REGLA 13 — comparar las dos estrategias antes de decidir.
 *
 *   A = la llamada del agente (como hoy) + una llamada aparte que extrae el estado
 *   B = una sola llamada que devuelve respuesta y estado juntos
 *
 * Se mide sobre los MISMOS turnos reales y con el prompt REAL del negocio: usar
 * un prompt de juguete abarataría la estrategia B artificialmente, porque su
 * ventaja es justamente no pagar dos veces esos 17.000 caracteres de entrada.
 */
if (process.argv.includes("--comparar")) {
  const CUANTOS_TURNOS = argOf("turnos", 15);

  // El prompt REAL, armado como lo arma el pipeline. Usar solo
  // `agent_profile.instructions` no vale: las instrucciones del formato de
  // acción viven en `buildAgentSystemPrompt`, no en la ficha, y sin ellas el
  // modelo no sabe que debe contestar con `{"action": …}` — 17 fallos de 20 en
  // la corrida anterior, todos causados por medir un prompt que no existe.
  const [perfil] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId));
  if (!perfil?.instructions) {
    console.error("[medir] este negocio no tiene prompt guardado");
    process.exit(1);
  }
  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const promptDelAgente = buildAgentSystemPrompt({
    profile: perfil,
    kb,
    stages,
    catalogoDePedidos: perfil.catalogSource === "tabla" ? carta : undefined,
  });

  // El contrato REAL del agente, el mismo que usa `pipeline.ts`. Pedirle otro
  // formato mediría lo bien que adivina un esquema que su prompt no describe:
  // la primera corrida de esta comparación dio 15 fallos de 15 justo por eso.
  //
  // Para B se añade una clave más al JSON que ya devuelve, y se comprueba
  // aparte si la parte de acción habría pasado `AgentAction` — porque el riesgo
  // de B no es el coste, es contaminar el contrato que hoy funciona.
  const AccionConEstado = z.object({ estado: EstadoTolerante }).passthrough();

  const PEDIR_ESTADO = `

Además de la acción, añades al MISMO objeto JSON una clave "estado" con el estado del pedido:
"estado": {"producto": …, "cantidad": …, "salsas": [], "recubierto": …, "adiciones": [], "nombre": …, "telefono": …, "direccion": …, "paso": …}
Lo que el cliente todavía NO haya dicho va en null (o lista vacía). No inventes nada.`;

  type Acumulado = { coste: number; ms: number[]; fallos: number; porque: string[] };
  const nuevo = (): Acumulado => ({ coste: 0, ms: [], fallos: 0, porque: [] });
  const base = nuevo();
  const extra = nuevo();
  const unaSola = nuevo();
  let coincideProducto = 0;
  let coincideCantidad = 0;
  let comparables = 0;
  let fueraDeCartaB = 0;
  let accionRotaEnB = 0;
  const discrepancias: unknown[] = [];

  for (const turno of turnos.slice(0, CUANTOS_TURNOS)) {
    const opts = modelo ? { model: modelo } : undefined;

    // --- A, primera mitad: la llamada que el agente ya hace hoy ---
    let t = Date.now();
    const rBase = await chatJson(
      AgentAction,
      [
        { role: "system", content: promptDelAgente },
        { role: "user", content: turno.historial },
      ],
      opts
    );
    base.ms.push(Date.now() - t);
    if (rBase.usage) base.coste += rBase.usage.costUsd;
    if (!rBase.ok) base.fallos++;

    // --- A, segunda mitad: la extracción aparte ---
    t = Date.now();
    const rExtra = await chatJson(
      EstadoTolerante,
      [
        { role: "system", content: SISTEMA },
        { role: "user", content: `Conversación hasta ahora:\n\n${turno.historial}\n\nDevuelve el estado del pedido.` },
      ],
      opts
    );
    extra.ms.push(Date.now() - t);
    if (rExtra.usage) extra.coste += rExtra.usage.costUsd;
    if (!rExtra.ok) extra.fallos++;

    // --- B: todo en una ---
    t = Date.now();
    const rUna = await chatJson(
      AccionConEstado,
      [
        { role: "system", content: promptDelAgente + PEDIR_ESTADO },
        { role: "user", content: turno.historial },
      ],
      opts
    );
    unaSola.ms.push(Date.now() - t);
    if (rUna.usage) unaSola.coste += rUna.usage.costUsd;
    if (!rUna.ok) {
      unaSola.fallos++;
      // Un porcentaje de fallo no dice qué arreglar; el motivo, sí.
      if (unaSola.porque.length < 3) unaSola.porque.push(rUna.detail.slice(0, 200));
    }
    // ¿Le costó la acción el haber pedido el estado también?
    if (rUna.ok) {
      const { estado: _estado, ...accion } = rUna.data;
      if (!AgentAction.safeParse(accion).success) accionRotaEnB++;
    }

    // Precisión: ¿dicen lo mismo las dos estrategias sobre el mismo turno?
    if (rExtra.ok && rUna.ok) {
      comparables++;
      const a = rExtra.data;
      const b = rUna.data.estado;
      const mismoProducto =
        (a.producto ?? "").toLowerCase().trim() === (b.producto ?? "").toLowerCase().trim();
      if (mismoProducto) coincideProducto++;
      if (a.cantidad === b.cantidad) coincideCantidad++;
      if (b.producto && !nombresDeProducto.has(b.producto.toLowerCase().trim())) fueraDeCartaB++;
      // Donde discrepan es donde hay que mirar: el script no sabe cuál acierta,
      // y elegir estrategia por un porcentaje de coincidencia sería elegir a
      // ciegas. Van al archivo con su conversación entera (regla 11).
      if (!mismoProducto || a.cantidad !== b.cantidad) {
        discrepancias.push({
          conversacion: turno.conversacion,
          historial: turno.historial,
          A: { producto: a.producto, cantidad: a.cantidad, paso: a.paso },
          B: { producto: b.producto, cantidad: b.cantidad, paso: b.paso },
        });
      }
    }
  }

  const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  const n = Math.min(CUANTOS_TURNOS, turnos.length);
  const costeA = base.coste + extra.coste;
  const msA = media(base.ms) + media(extra.ms);
  const pctC = (x: number) => (comparables ? ((x / comparables) * 100).toFixed(1) : "0");

  console.log(`\n${"=".repeat(72)}`);
  console.log(`REGLA 13 — estrategia A (dos llamadas) contra B (una sola)`);
  console.log(`modelo: ${modelo ?? process.env.OPENROUTER_MODEL} · turnos reales: ${n}`);
  console.log(`${"=".repeat(72)}`);
  console.log(`\n              coste/turno     latencia     JSON inválido`);
  console.log(`  A (2 llamadas)  $${(costeA / n).toFixed(6)}    ${msA} ms      ${base.fallos + extra.fallos}`);
  console.log(`  B (1 llamada)   $${(unaSola.coste / n).toFixed(6)}    ${media(unaSola.ms)} ms      ${unaSola.fallos}`);
  console.log(`\n  de los cuales, en A:`);
  console.log(`    respuesta del agente : $${(base.coste / n).toFixed(6)}  ${media(base.ms)} ms`);
  console.log(`    extracción aparte    : $${(extra.coste / n).toFixed(6)}  ${media(extra.ms)} ms`);
  console.log(`\n--- Precisión: ¿dicen lo mismo? (sobre ${comparables} turnos comparables) ---`);
  console.log(`  mismo producto : ${coincideProducto} (${pctC(coincideProducto)} %)`);
  console.log(`  misma cantidad : ${coincideCantidad} (${pctC(coincideCantidad)} %)`);
  console.log(`  B saca un producto fuera de la carta: ${fueraDeCartaB}`);
  console.log(`\n  ⛔ acciones de B que NO pasarían el contrato del agente: ${accionRotaEnB}`);
  console.log(`     (el riesgo de B no es el coste: es romper el contrato que hoy funciona)`);
  if (unaSola.porque.length) {
    console.log(`\n--- Por qué falla B ---`);
    for (const p of unaSola.porque) console.log(`  ${p}`);
  }
  if (discrepancias.length) {
    const iSal = process.argv.indexOf("--salida");
    const ruta = iSal === -1 ? `discrepancias-${organizationId}.json` : process.argv[iSal + 1];
    writeFileSync(ruta, JSON.stringify(discrepancias, null, 2), "utf8");
    console.log(`\n  ${discrepancias.length} turnos donde A y B NO dicen lo mismo, con su conversación:`);
    console.log(`  ${ruta}`);
  }
  console.log(`\n  ⚠️ Coincidir no es acertar: si las dos se equivocan igual, esto sale 100 %.`);

  await sql.end();
  process.exit(0);
}

{
  for (const turno of turnos) {
    if (llamadas >= MAX_LLAMADAS) break;
    const conv = { id: turno.conversacion };
    const historial = turno.historial;

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
