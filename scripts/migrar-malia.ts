/**
 * Lleva la ficha de MALIA a lo que decidió el negocio el 21-sep-2026, para
 * que pueda pasar a `state_source='backend'` sin contradicciones.
 *
 * ## Por qué un script y no la pantalla
 *
 * Porque son cinco cambios que tienen que entrar JUNTOS o no entrar: si se
 * añade el mínimo de domicilio sin quitar la regla que lo decía en prosa, el
 * agente tiene dos fuentes para lo mismo. Y porque un cambio en producción
 * necesita respaldo, simulacro y verificación, que una pantalla no da.
 *
 * ## Qué hace, y de dónde sale cada cosa
 *
 * | Cambio | Origen |
 * |---|---|
 * | Requisito `direccion` solo en domicilio | el backend debe exigirla; hoy solo lo pedía la prosa |
 * | `observacionesHorario` con el horario de Chipichape | el dueño lo dictó: no estaba escrito en ninguna parte |
 * | `entrega.minimoDomicilioCents = 1.800.000` | decisión del dueño: que lo impida el backend |
 * | `reglasPropias` de 7 a 5 | lo que pasó a ser estructura sale de la prosa |
 *
 * **No inventa contenido de negocio.** El texto de Chipichape transcribe lo
 * que dictó el dueño; las reglas que se recortan conservan sus palabras y
 * solo pierden la parte que ahora decide el backend. Todo se enseña antes.
 *
 * ## Lo que NO hace
 *
 * No toca `state_source` (eso es `fase2`, y va después), ni el catálogo, ni
 * las zonas, ni `payment_source`, ni ningún otro negocio.
 *
 * Uso:
 *   pnpm migrar:malia             → enseña el antes y el después, NO escribe
 *   pnpm migrar:malia --aplicar   → escribe, con respaldo previo
 *
 * Rollback: restaurar la columna `ficha` desde `agent_profile_bk_malia_<fecha>`.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { leerFicha, serializarComoEstaba } from "@/server/ai/generador/leer-ficha";
import { conRegistro } from "@/server/registro-de-cambios";

function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    return readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .trim();
  } catch {
    return undefined;
  }
}
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const ORG = "org_kf1suh8q9dtbmcq3f3ba";
const aplicar = process.argv.includes("--aplicar");

/** El mínimo: $18.000 = un pavé de 16 oz, o dos de 8 oz. Ver la decisión. */
const MINIMO_DOMICILIO_CENTS = 1800000;

/** Dictado por el dueño el 21-sep-2026. Transcrito, no interpretado. */
const OBSERVACIONES_HORARIO =
  "Nuestro punto del CC Chipichape tiene un horario distinto al de la planta: " +
  "lunes a jueves de 12:00 m a 8:00 pm, y viernes, sábados, domingos y festivos " +
  "de 12:30 pm a 8:30 pm. La planta de Nueva Tequendama atiende de 11:00 am a 7:00 pm.";

/** Mismo formato exacto que el de La Churra, ya en producción. */
const REQUISITO_DIRECCION = {
  id: "direccion",
  tipo: "direccion",
  etiqueta: "la direccion de entrega",
  obligatorio: true,
  soloEnModalidades: ["domicilio"],
};

/**
 * Qué se hace con cada regla propia. El índice es el de HOY, verificado
 * contra producción antes de escribir: si la ficha cambió, el script se
 * detiene en vez de tocar la regla equivocada.
 */
const PLAN_DE_REGLAS: {
  indice: number;
  empiezaPor: string;
  accion: "se_queda" | "se_recorta" | "se_elimina";
  nuevo?: string;
  porque: string;
}[] = [
  {
    indice: 0,
    empiezaPor: "Desde chipichape NO despachamos",
    accion: "se_recorta",
    nuevo: "Desde chipichape NO despachamos domicilios pero SI despachamos rappi.",
    porque: "la parte de horario pasa a observacionesHorario, con las horas reales",
  },
  {
    indice: 1,
    empiezaPor: "No hacemos domilicos para un solo pave",
    accion: "se_elimina",
    porque: "ahora lo impide el backend con entrega.minimoDomicilioCents",
  },
  { indice: 2, empiezaPor: "## PRESENTACIÓN DE OPCIONES", accion: "se_queda", porque: "es conducta" },
  {
    indice: 3,
    empiezaPor: "\nDOMICILIOS",
    accion: "se_recorta",
    nuevo:
      "DOMICILIOS\n\nCuando el cliente pida domicilio, pídele la dirección CON el barrio: " +
      "el barrio es lo que nos deja calcular la tarifa.\n\nSi su zona queda fuera de nuestra " +
      "cobertura, indícale de manera muy amable que puede enviar a alguien a recoger el " +
      "pedido o visitarnos en nuestros puntos físicos.",
    porque:
      "la dirección ya es requisito del backend y la cobertura la decide la tabla de zonas; " +
      "se conserva la conducta (pedir el barrio, ofrecer recogida con amabilidad)",
  },
  {
    indice: 4,
    empiezaPor: "Actualmente no manejamos venta al por mayor",
    accion: "se_recorta",
    nuevo:
      "Actualmente no manejamos venta al por mayor ni precios para reventa 😊\n\n" +
      "Sin embargo, si deseas hacer una compra en cantidad, tenemos un precio especial a " +
      "partir de 20 Pavés de 8 oz. Cuéntame cuántos necesitas y paso tu pedido al equipo " +
      "para que te confirmen el precio: los pedidos grandes los cotiza una persona, yo no " +
      "calculo ese total.",
    porque:
      "decisión del dueño: el precio mayorista lo cotiza una persona. Sale la cifra ($8.000) " +
      "porque contradice el catálogo ($10.000) y el backend calcularía la otra",
  },
  { indice: 5, empiezaPor: "Nuestros pavés se presentan", accion: "se_queda", porque: "es contexto" },
  { indice: 6, empiezaPor: "", accion: "se_elimina", porque: "cadena vacía: ruido" },
];

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const [fila] = await db
  .select({ nombre: schema.organization.name, ficha: schema.agentProfile.ficha })
  .from(schema.agentProfile)
  .innerJoin(schema.organization, eq(schema.organization.id, schema.agentProfile.organizationId))
  .where(eq(schema.agentProfile.organizationId, ORG));

if (!fila?.ficha) {
  console.error("[migrar-malia] ⛔ no existe o no tiene ficha.");
  await sql.end();
  process.exit(1);
}
const ficha = leerFicha(fila.ficha);
if (!ficha) {
  console.error("[migrar-malia] ⛔ su ficha no es JSON válido.");
  await sql.end();
  process.exit(1);
}

console.log("─".repeat(76));
console.log(`▸ ${fila.nombre}`);

// ── 1. Requisito direccion ───────────────────────────────────────────────
const requisitosViejos = ficha.cierre?.requisitos ?? [];
const yaTieneDireccion = requisitosViejos.some((r) => r.id === "direccion");
/*
 * Va PRIMERO y no al final: la propia regla de MALIA dice "cuando el cliente
 * pida domicilio, solicita primero dirección y barrio", y La Churra —el otro
 * negocio con este requisito— también lo tiene primero. El orden de esta
 * lista es el orden en que el agente pregunta.
 */
const requisitosNuevos = yaTieneDireccion
  ? requisitosViejos
  : [REQUISITO_DIRECCION as (typeof requisitosViejos)[number], ...requisitosViejos];
console.log(`\n1. REQUISITOS DE CIERRE  (${requisitosViejos.length} → ${requisitosNuevos.length})`);
console.log(`   antes:   ${requisitosViejos.map((r) => r.id).join(", ")}`);
console.log(`   después: ${requisitosNuevos.map((r) => r.id).join(", ")}`);
console.log(
  yaTieneDireccion
    ? "   (ya la tenía: no se toca)"
    : "   direccion es obligatoria SOLO en domicilio; quien recoge no la da"
);

// ── 2. Observaciones de horario ──────────────────────────────────────────
console.log(`\n2. OBSERVACIONES DE HORARIO`);
if (ficha.observacionesHorario?.trim()) {
  console.error("   ⛔ YA TIENE observaciones. Este script no concatena — revísalo a mano.");
  console.error(`      tiene: ${JSON.stringify(ficha.observacionesHorario)}`);
  await sql.end();
  process.exit(1);
}
console.log(`   antes:   (vacío)`);
console.log(`   después: ${JSON.stringify(OBSERVACIONES_HORARIO)}`);
console.log("   ⚠️ es CONTEXTO: no decide si el negocio está abierto. Eso lo decide porDia.");

// ── 3. Mínimo de domicilio ───────────────────────────────────────────────
console.log(`\n3. PEDIDO MÍNIMO PARA DOMICILIO`);
console.log(`   antes:   ${ficha.entrega?.minimoDomicilioCents ?? "(sin mínimo)"}`);
console.log(`   después: ${MINIMO_DOMICILIO_CENTS} centavos = $18.000`);
console.log("   equivale a: 1 pavé de 16 oz ($18.000) o 2 de 8 oz ($20.000). Uno de 8 oz no llega.");

// ── 4. Reglas propias ────────────────────────────────────────────────────
const reglasViejas = ficha.reglasPropias ?? [];
console.log(`\n4. REGLAS PROPIAS  (${reglasViejas.length} → ?)`);
if (reglasViejas.length !== PLAN_DE_REGLAS.length) {
  console.error(
    `   ⛔ el plan se escribió para ${PLAN_DE_REGLAS.length} reglas y hay ${reglasViejas.length}. ` +
      "La ficha cambió: revisa el plan antes de tocar nada."
  );
  await sql.end();
  process.exit(1);
}
const reglasNuevas: string[] = [];
for (const p of PLAN_DE_REGLAS) {
  const actual = reglasViejas[p.indice] ?? "";
  // Que el índice siga apuntando a la regla que el plan creyó: un desfase
  // silencioso aquí reescribe la regla equivocada.
  if (!actual.startsWith(p.empiezaPor)) {
    console.error(
      `   ⛔ la regla [${p.indice}] no empieza por ${JSON.stringify(p.empiezaPor)}.\n` +
        `      encontrada: ${JSON.stringify(actual.slice(0, 60))}`
    );
    await sql.end();
    process.exit(1);
  }
  const etiqueta =
    p.accion === "se_queda" ? "✔ SE QUEDA" : p.accion === "se_elimina" ? "✖ SE ELIMINA" : "✎ SE RECORTA";
  console.log(`\n   [${p.indice}] ${etiqueta} — ${p.porque}`);
  if (p.accion !== "se_queda") console.log(`        antes:   ${JSON.stringify(actual.slice(0, 120))}`);
  if (p.accion === "se_queda") reglasNuevas.push(actual);
  if (p.accion === "se_recorta") {
    console.log(`        después: ${JSON.stringify(p.nuevo!.slice(0, 160))}`);
    reglasNuevas.push(p.nuevo!);
  }
}
console.log(`\n   total: ${reglasViejas.length} → ${reglasNuevas.length}`);

// ── El objeto final ──────────────────────────────────────────────────────
const fichaNueva = {
  ...ficha,
  observacionesHorario: OBSERVACIONES_HORARIO,
  cierre: { ...(ficha.cierre ?? {}), requisitos: requisitosNuevos },
  entrega: { ...ficha.entrega, minimoDomicilioCents: MINIMO_DOMICILIO_CENTS },
  reglasPropias: reglasNuevas,
};
const serializada = serializarComoEstaba(fila.ficha, fichaNueva);

/*
 * Y antes de escribir: que no se haya movido nada más. Se comparan las dos
 * fichas SIN los cuatro campos que esto puede tocar — si difieren en algo
 * más, no se escribe. Una migración que de paso se come un dato del negocio
 * es peor que no migrar. (Misma red que `mover:regla`.)
 */
const resto = (f: unknown) => {
  const x = { ...((f ?? {}) as Record<string, unknown>) };
  delete x.observacionesHorario;
  delete x.cierre;
  delete x.reglasPropias;
  const e = { ...((x.entrega ?? {}) as Record<string, unknown>) };
  delete e.minimoDomicilioCents;
  x.entrega = e;
  return JSON.stringify(x, Object.keys(x).sort());
};
if (resto(ficha) !== resto(leerFicha(serializada))) {
  console.error("\n🔴 la reserialización cambiaría algo más que esos cuatro campos: NO se escribe.");
  await sql.end();
  process.exit(1);
}
console.log("\n✔ ningún otro campo de la ficha cambia.");

if (!aplicar) {
  console.log("\n[migrar-malia] no se escribió nada (falta --aplicar)");
  await sql.end();
  process.exit(0);
}

const sufijo = new Date().toISOString().slice(0, 10).replace(/-/g, "");
await sql.unsafe(
  `CREATE TABLE IF NOT EXISTS agent_profile_bk_malia_${sufijo} AS SELECT * FROM agent_profile`
);
console.log(`\n[migrar-malia] respaldo: agent_profile_bk_malia_${sufijo}`);

const leerFilaCompleta = async () => {
  const [f] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, ORG));
  return (f as unknown as Fila) ?? null;
};
await conRegistro(
  {
    tabla: "agent_profile",
    registro: ORG,
    leerFila: leerFilaCompleta,
    declarados: ["ficha", "updatedAt"],
    proceso: "migrar:malia",
    actor: "script:migrar:malia",
  },
  async () =>
    db
      .update(schema.agentProfile)
      .set({ ficha: serializada, updatedAt: new Date() })
      .where(eq(schema.agentProfile.organizationId, ORG))
);

// ── Verificación releyendo de la base ────────────────────────────────────
const [despues] = await db
  .select({ ficha: schema.agentProfile.ficha })
  .from(schema.agentProfile)
  .where(eq(schema.agentProfile.organizationId, ORG));
const r = leerFicha(despues!.ficha);
const ok =
  r?.observacionesHorario === OBSERVACIONES_HORARIO &&
  r?.entrega?.minimoDomicilioCents === MINIMO_DOMICILIO_CENTS &&
  (r?.cierre?.requisitos ?? []).some((x) => x.id === "direccion") &&
  (r?.reglasPropias ?? []).length === reglasNuevas.length;
console.log(ok ? "✅ migrado y verificado releyendo de la base." : "🔴 la verificación NO cuadra.");

await sql.end();
process.exit(ok ? 0 : 1);
