/**
 * Compara modelos de IA con las conversaciones REALES de un cliente.
 *
 * ## Por qué existe
 *
 * El Laboratorio evalúa con personas simuladas, y eso mide lo que IMAGINAMOS
 * que escriben los clientes. Para decidir si cambiar el modelo que atiende a un
 * negocio de verdad, lo que importa es cómo se comporta con lo que sus clientes
 * escribieron DE VERDAD: con sus faltas de ortografía, sus audios transcritos,
 * sus "sin toppings" repetidos y sus direcciones a medias.
 *
 * Este script toma los mensajes entrantes reales de un día, los vuelve a pasar
 * por el pipeline COMPLETO —mismo prompt, mismo catálogo, mismos
 * guardarraíles— y guarda lo que respondió el modelo, cuánto costó y cuánto
 * tardó. Corriéndolo con dos modelos distintos se comparan manzanas con
 * manzanas.
 *
 * ## Lo que NO hace
 *
 * **Nunca le escribe a un cliente real.** Cada réplica corre sobre una
 * conversación `is_test`, y el sandbox lanza excepción si algo intenta salir a
 * WhatsApp (`tests/unit/send-sandbox.test.ts`). El aviso al equipo también
 * queda simulado (`notify-team.ts`). De las conversaciones reales solo se LEE.
 *
 * ## Uso
 *
 *   # Un proceso por modelo: getEnv() cachea, no vale cambiarlo en caliente.
 *   OPENROUTER_MODEL=google/gemini-3.7-flash \
 *     corepack pnpm comparar:modelos org_xxx --salida=a.json
 *   OPENROUTER_MODEL=z-ai/glm-5.3-flash \
 *     corepack pnpm comparar:modelos org_xxx --salida=b.json
 *
 *   # Y el veredicto:
 *   corepack pnpm comparar:modelos --comparar a.json b.json
 *
 * Opciones: `--dias=N` (por defecto 1), `--max=N` conversaciones (por defecto
 * 15), `--limpiar` borra las conversaciones de prueba al terminar.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { and, asc, desc, eq, gt, sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { runAgentTurn } from "@/server/ai/pipeline";

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
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
  "OPENROUTER_API_TOKEN",
  "OPENROUTER_MODEL",
]) {
  const v = loadEnvVar(name);
  if (v && !process.env[name]) process.env[name] = v;
}

type Turno = {
  entrante: string;
  accion: string | null;
  respuesta: string | null;
  derivo: boolean;
  ms: number;
};
type Replica = { origen: string; turnos: Turno[] };
type Informe = {
  modelo: string;
  organizationId: string;
  generado: string;
  conversaciones: number;
  turnos: number;
  derivaciones: number;
  sinRespuesta: number;
  costoUsd: number;
  msPromedio: number;
  replicas: Replica[];
};

const args = process.argv.slice(2);

// ---------------------------------------------------------------- comparar
if (args[0] === "--comparar") {
  const informes = args.slice(1).map((f) => JSON.parse(readFileSync(f, "utf8")) as Informe);
  if (informes.length < 2) {
    console.error("Uso: --comparar a.json b.json [c.json ...]");
    process.exit(1);
  }
  const pesos = (usd: number) => `$${Math.round(usd * 4000).toLocaleString("es-CO")}`;
  console.log("\n┌─ COMPARACIÓN ────────────────────────────────────────────\n");
  console.log(
    ["modelo", "turnos", "derivó", "sin resp.", "USD", "USD/turno", "ms/turno"]
      .map((h, i) => (i === 0 ? h.padEnd(26) : h.padStart(11)))
      .join("")
  );
  for (const inf of informes) {
    const porTurno = inf.turnos ? inf.costoUsd / inf.turnos : 0;
    console.log(
      [
        inf.modelo.padEnd(26),
        String(inf.turnos).padStart(11),
        String(inf.derivaciones).padStart(11),
        String(inf.sinRespuesta).padStart(11),
        inf.costoUsd.toFixed(4).padStart(11),
        porTurno.toFixed(6).padStart(11),
        String(Math.round(inf.msPromedio)).padStart(11),
      ].join("")
    );
  }

  const base = informes[0]!;
  console.log("\n┌─ QUÉ SIGNIFICA AL MES ───────────────────────────────────\n");
  console.log("  Proyectado a 4.300 conversaciones/mes con estos turnos por conversación:\n");
  for (const inf of informes) {
    const porConv = inf.conversaciones ? inf.costoUsd / inf.conversaciones : 0;
    const mes = porConv * 4300;
    console.log(`  ${inf.modelo.padEnd(26)} US$${mes.toFixed(0).padStart(5)}   ${pesos(mes)}`);
  }

  console.log("\n┌─ RESPUESTAS LADO A LADO ─────────────────────────────────");
  console.log("  (para juzgar CALIDAD, que es lo que ningún número mide)\n");
  for (let c = 0; c < Math.min(base.replicas.length, 4); c++) {
    const orig = base.replicas[c]!.origen;
    console.log(`\n  ── conversación real ${orig} ──`);
    for (let t = 0; t < base.replicas[c]!.turnos.length; t++) {
      const entrante = base.replicas[c]!.turnos[t]!.entrante;
      console.log(`\n  CLIENTE: ${entrante.slice(0, 120)}`);
      for (const inf of informes) {
        const turno = inf.replicas[c]?.turnos[t];
        const etiqueta = turno?.derivo ? "[DERIVÓ] " : "";
        const texto = turno?.respuesta ?? "(sin respuesta)";
        console.log(
          `  ${inf.modelo.slice(0, 22).padEnd(24)}${etiqueta}${texto.replace(/\n/g, " ").slice(0, 150)}`
        );
      }
    }
  }
  console.log("");
  process.exit(0);
}

// ---------------------------------------------------------------- replicar
const organizationId = args.find((a) => !a.startsWith("--"));
if (!organizationId) {
  console.error("Uso: comparar:modelos <organizationId> [--dias=1] [--max=15] [--salida=informe.json] [--limpiar]");
  process.exit(1);
}
const opt = (nombre: string, pordefecto: string) =>
  args.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? pordefecto;
const dias = Number(opt("dias", "1"));
const maxConversaciones = Number(opt("max", "15"));
const salida = opt("salida", "");
const limpiar = args.includes("--limpiar");

const modelo = process.env.OPENROUTER_MODEL;
if (!modelo) {
  console.error("[comparar] Falta OPENROUTER_MODEL. Es lo que se está midiendo.");
  process.exit(1);
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[comparar] DATABASE_URL no está definida");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);

/**
 * Los mensajes ENTRANTES reales, agrupados por conversación. Solo lectura, y
 * solo de conversaciones que NO son de prueba: es el material auténtico.
 */
const reales = await db
  .select({
    conversationId: schema.message.conversationId,
    text: schema.message.text,
    createdAt: schema.message.createdAt,
  })
  .from(schema.message)
  .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
  .where(
    and(
      eq(schema.message.organizationId, organizationId),
      eq(schema.message.direction, "in"),
      eq(schema.conversation.isTest, false),
      gt(schema.message.createdAt, desde)
    )
  )
  .orderBy(asc(schema.message.createdAt));

const porConversacion = new Map<string, string[]>();
for (const m of reales) {
  if (!m.text?.trim()) continue;
  const lista = porConversacion.get(m.conversationId) ?? [];
  lista.push(m.text);
  porConversacion.set(m.conversationId, lista);
}
// Las más largas primero: son las que de verdad ponen a prueba al modelo.
const guiones = [...porConversacion.entries()]
  .filter(([, ms]) => ms.length >= 2)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, maxConversaciones);

if (guiones.length === 0) {
  console.error(`[comparar] No hay conversaciones reales de los últimos ${dias} día(s).`);
  await sql.end();
  process.exit(1);
}

console.log(`\n[comparar] modelo=${modelo}`);
console.log(`[comparar] ${guiones.length} conversaciones reales, ${guiones.reduce((n, [, m]) => n + m.length, 0)} turnos`);
console.log(`[comparar] Las réplicas son is_test: NUNCA salen a WhatsApp.\n`);

const gastoAntes = await db
  .select({ total: raw<number>`coalesce(sum(cost_usd),0)` })
  .from(schema.usageEvent)
  .where(eq(schema.usageEvent.organizationId, organizationId));
const costoPrevio = Number(gastoAntes[0]?.total ?? 0);

const replicas: Replica[] = [];
const creadas: string[] = [];
let totalMs = 0;
let totalTurnos = 0;
let derivaciones = 0;
let sinRespuesta = 0;

for (const [origen, mensajes] of guiones) {
  const contacto = (
    await db
      .insert(schema.contact)
      .values({
        id: newId("contact"),
        organizationId,
        phone: `cmp${Date.now()}${Math.floor(Math.random() * 1000)}`,
        name: "Réplica de medición",
      })
      .returning()
  )[0]!;
  const conv = (
    await db
      .insert(schema.conversation)
      .values({
        id: newId("conversation"),
        organizationId,
        contactId: contacto.id,
        isTest: true,
        aiEnabled: true,
      })
      .returning()
  )[0]!;
  creadas.push(conv.id);

  const turnos: Turno[] = [];
  process.stdout.write(`  ${origen.slice(0, 24)} `);
  for (const texto of mensajes) {
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId: conv.id,
      direction: "in",
      type: "text",
      text: texto,
      status: "delivered",
      waTimestamp: new Date(),
    });
    const t0 = Date.now();
    let accion: string | null = null;
    let derivo = false;
    try {
      const r = await runAgentTurn(conv.id, { immediate: true });
      accion = r?.action ?? null;
      derivo = r?.action === "handoff";
    } catch (err) {
      accion = `error:${(err as Error).message.slice(0, 60)}`;
    }
    const ms = Date.now() - t0;
    totalMs += ms;
    totalTurnos++;
    if (derivo) derivaciones++;

    const ultima = await db
      .select({ text: schema.message.text })
      .from(schema.message)
      .where(and(eq(schema.message.conversationId, conv.id), eq(schema.message.direction, "out")))
      .orderBy(desc(schema.message.createdAt))
      .limit(1);
    const respuesta = ultima[0]?.text ?? null;
    if (!respuesta) sinRespuesta++;

    turnos.push({ entrante: texto, accion, respuesta, derivo, ms });
    process.stdout.write(derivo ? "!" : respuesta ? "." : "x");
  }
  process.stdout.write("\n");
  replicas.push({ origen, turnos });
}

const gastoDespues = await db
  .select({ total: raw<number>`coalesce(sum(cost_usd),0)` })
  .from(schema.usageEvent)
  .where(eq(schema.usageEvent.organizationId, organizationId));
const costoUsd = Number(gastoDespues[0]?.total ?? 0) - costoPrevio;

const informe: Informe = {
  modelo,
  organizationId,
  generado: new Date().toISOString(),
  conversaciones: replicas.length,
  turnos: totalTurnos,
  derivaciones,
  sinRespuesta,
  costoUsd,
  msPromedio: totalTurnos ? totalMs / totalTurnos : 0,
  replicas,
};

console.log(`\n  turnos=${totalTurnos}  derivó=${derivaciones}  sin respuesta=${sinRespuesta}`);
console.log(`  costo=US$${costoUsd.toFixed(4)}  (US$${(costoUsd / (totalTurnos || 1)).toFixed(6)}/turno)`);
console.log(`  latencia=${Math.round(informe.msPromedio)} ms/turno\n`);

if (salida) {
  writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(`  informe → ${salida}\n`);
}

if (limpiar) {
  for (const id of creadas) {
    await db.delete(schema.message).where(eq(schema.message.conversationId, id));
    await db.delete(schema.conversationState).where(eq(schema.conversationState.conversationId, id));
    await db.delete(schema.conversation).where(eq(schema.conversation.id, id));
  }
  console.log(`  ${creadas.length} conversaciones de prueba borradas\n`);
}

await sql.end();
