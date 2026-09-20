/**
 * Lleva el horario de cada negocio al modelo canónico por día.
 *
 * ## Qué hace, y por qué en este orden
 *
 * Hasta el 20-sep-2026 el horario vivía en dos sitios que podían
 * contradecirse: las columnas `hours_*` (lo que usaba producción) y
 * `ficha.horario` (lo que el cliente respondió el día del alta). El domingo
 * tenía además sus propias columnas, y una franja de domingo huérfana abría
 * un día que su dueña había desmarcado — el incidente de Lis.
 *
 * Esta migración escribe `ficha.horario.porDia`, que pasa a ser el canónico,
 * y **recalcula desde él** los campos viejos de la ficha y las columnas. A
 * partir de aquí no hay dos datos: hay uno y sus proyecciones.
 *
 * ## De dónde sale el horario que se escribe
 *
 * Del **efectivo**, no del que uno preferiría: `horarioDeLaFila` — es decir,
 * las columnas, porque son las que el prompt, el estado del negocio y el
 * motor de citas vienen usando. Una migración no puede cambiarle el horario
 * a nadie; si alguien quiere otro, lo cambia después desde su pantalla.
 *
 * ## Cuándo se detiene
 *
 * Si la ficha vieja y las columnas **no dicen lo mismo**, ese cliente NO se
 * migra: es una decisión de negocio (¿cuál de los dos es el bueno?) y nadie
 * puede tomarla leyendo la base. Se informa y se sigue con el resto — una
 * ambigüedad de un cliente no puede frenar a los demás.
 *
 * Uso:
 *   pnpm migrar:horario                    → enseña qué cambiaría, NO escribe
 *   pnpm migrar:horario --aplicar          → escribe, con respaldo previo
 *   pnpm migrar:horario <organizationId> [--aplicar]
 */
import { readFileSync } from "node:fs";
import { and, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import type { Fila } from "@/server/ai/generador/comparar-fila";
import { leerFicha, serializarComoEstaba } from "@/server/ai/generador/leer-ficha";
import { conRegistro } from "@/server/registro-de-cambios";
import {
  columnasDesdeHorario,
  diasAbiertos,
  horarioDeLaFila,
  horarioNormalizado,
  horarioSemanalDesdeLegacy,
  NOMBRE_DEL_DIA,
  sinHorarioConfigurado,
  type HorarioSemanal,
} from "@/server/horario";

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
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const aplicar = process.argv.includes("--aplicar");
/**
 * La discrepancia ficha/columnas de ESTE cliente ya la resolvió una persona,
 * a favor de lo que las columnas vienen usando.
 *
 * Existe porque el bloqueo por discrepancia es correcto —nadie puede decidir
 * desde la base cuál de los dos valores es el bueno— pero no puede ser
 * permanente: cuando el negocio responde, hace falta una forma de decirlo.
 *
 * Exige un `organizationId`: resolver "todas las discrepancias a la vez" es
 * exactamente lo que no se puede hacer, porque cada una es una pregunta
 * distinta a un negocio distinto.
 *
 * Caso real (Lashes Valen, 20-sep-2026): su ficha decía `cierra: "22:30"` y
 * sus columnas `18:30`. No eran dos opiniones sobre lo mismo — eran las
 * respuestas a dos preguntas distintas. El cuestionario preguntaba "¿hasta
 * qué hora?" y alguien contestó pensando en cuándo terminan de trabajar; el
 * horario de una agenda es **hasta qué hora se RECIBEN citas**. Su servicio
 * más largo dura 150 minutos: empezando a las 18:30 termina a las 21:00.
 */
const resolverConColumnas = process.argv.includes("--resolver-con-columnas");
const soloEsteCliente = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (resolverConColumnas && !soloEsteCliente) {
  console.error(
    "[migrar-horario] ⛔ --resolver-con-columnas exige un organizationId. " +
      "Cada discrepancia es una pregunta a un negocio concreto: resolverlas todas de golpe " +
      "sería decidir por ellos."
  );
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

/** Legible: "lun-sáb 10:00-19:00 · dom CERRADO". */
function legible(h: HorarioSemanal): string {
  if (sinHorarioConfigurado(h)) return "(sin horario)";
  const abiertos = diasAbiertos(h);
  const cerrados = ([1, 2, 3, 4, 5, 6, 7] as const).filter((d) => !h[d]);
  const partes = abiertos.map(
    (d) => `${NOMBRE_DEL_DIA[d].slice(0, 3)} ${h[d]!.abre}-${h[d]!.cierra}`
  );
  if (cerrados.length) {
    partes.push(`CERRADO: ${cerrados.map((d) => NOMBRE_DEL_DIA[d].slice(0, 3)).join(",")}`);
  }
  return partes.join(" · ");
}

const perfiles = await db
  .select({
    organizationId: schema.agentProfile.organizationId,
    nombre: schema.organization.name,
    ficha: schema.agentProfile.ficha,
    hoursDays: schema.agentProfile.hoursDays,
    hoursOpen: schema.agentProfile.hoursOpen,
    hoursClose: schema.agentProfile.hoursClose,
    hoursOpenSunday: schema.agentProfile.hoursOpenSunday,
    hoursCloseSunday: schema.agentProfile.hoursCloseSunday,
  })
  .from(schema.agentProfile)
  .innerJoin(
    schema.organization,
    eq(schema.organization.id, schema.agentProfile.organizationId)
  )
  .where(
    soloEsteCliente
      ? and(
          isNotNull(schema.agentProfile.ficha),
          eq(schema.agentProfile.organizationId, soloEsteCliente)
        )
      : isNotNull(schema.agentProfile.ficha)
  );

if (soloEsteCliente && perfiles.length === 0) {
  console.error(`[migrar-horario] ⛔ ${soloEsteCliente} no existe o no tiene ficha guardada.`);
  await sql.end();
  process.exit(1);
}

if (aplicar) {
  const sufijo = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS agent_profile_bk_horario_${sufijo} AS SELECT * FROM agent_profile`
  );
  console.log(`[migrar-horario] respaldo: agent_profile_bk_horario_${sufijo}\n`);
}

let migrados = 0;
let yaEstaban = 0;
const requierenDecision: string[] = [];
const sinHorario: string[] = [];

for (const p of perfiles) {
  console.log("─".repeat(74));
  console.log(`▸ ${p.nombre}`);

  /*
   * Se lee con el lector tolerante y se escribirá con `serializarComoEstaba`,
   * que es la única forma permitida de persistir una ficha en este proyecto:
   * una ficha por secciones sigue por secciones y una plana sigue plana. Ya
   * hubo un cliente que perdió sus secciones por guardarla desde otra
   * representación, y hay una prueba que lo vigila
   * (`ficha-ida-y-vuelta.test.ts`).
   */
  const fichaLeida = leerFicha(p.ficha);
  if (!fichaLeida) {
    console.log("   🔴 su ficha no es JSON válido: se salta");
    continue;
  }
  const horarioViejo = (fichaLeida.horario ?? null) as Record<string, unknown> | null;

  if (horarioViejo?.porDia) {
    yaEstaban++;
    console.log("   ✅ ya migrado (su ficha tiene `porDia`)");
    continue;
  }

  /** Lo que producción usa HOY. No se cambia: solo se pasa al modelo nuevo. */
  const efectivo = horarioDeLaFila(p);

  if (sinHorarioConfigurado(efectivo)) {
    // Sin horario no se inventa uno. Un negocio puede estar a medio dar de
    // alta, y rellenarle el hueco con un horario cualquiera sería peor que
    // dejarlo vacío: el agente empezaría a afirmar que está abierto.
    sinHorario.push(p.nombre);
    console.log("   ⚪ sin horario configurado: no se migra, y NO se inventa ninguno");
    continue;
  }

  /*
   * ¿La ficha vieja y las columnas dicen lo mismo? Si no, esto es una
   * decisión de negocio: alguien corrigió una de las dos y no la otra, y
   * desde aquí no hay forma de saber cuál era la intención.
   *
   * Caso real: Lashes Valen, `ficha.cierra = "22:30"` contra
   * `hours_close = "18:30"`. Cuatro horas de agenda.
   */
  const deLaFichaVieja = horarioSemanalDesdeLegacy({
    dias: horarioViejo?.dias,
    abre: horarioViejo?.abre as string | null,
    cierra: horarioViejo?.cierra as string | null,
    abreDomingo: horarioViejo?.abreDomingo as string | null,
    cierraDomingo: horarioViejo?.cierraDomingo as string | null,
  });
  const discrepan =
    !sinHorarioConfigurado(deLaFichaVieja) &&
    JSON.stringify(deLaFichaVieja) !== JSON.stringify(efectivo);

  console.log(`   ficha (respuesta del alta) : ${legible(deLaFichaVieja)}`);
  console.log(`   columnas (lo que se usa)   : ${legible(efectivo)}`);

  if (discrepan && !resolverConColumnas) {
    requierenDecision.push(p.nombre);
    console.log("   🟠 REQUIERE DECISIÓN DE NEGOCIO — la ficha y las columnas no coinciden.");
    console.log("      No se migra este cliente. Nada cambia: sigue funcionando con las columnas.");
    console.log("      Si el negocio ya respondió y manda lo que usan las columnas:");
    console.log(`      pnpm migrar:horario ${p.organizationId} --resolver-con-columnas --aplicar`);
    continue;
  }
  if (discrepan) {
    console.log("   ✔ discrepancia RESUELTA por decisión de negocio: manda lo que usan las columnas.");
    console.log(`      se descarta de la ficha: ${legible(deLaFichaVieja)}`);
  }

  const normalizado = horarioNormalizado(efectivo);
  const columnas = columnasDesdeHorario(efectivo);
  console.log(`   → canónico                 : ${legible(efectivo)}`);
  console.log(`   → ficha.horario.porDia     : ${JSON.stringify(normalizado.porDia)}`);
  console.log(
    `   → columnas                 : days=${columnas.hoursDays} open=${columnas.hoursOpen} ` +
      `close=${columnas.hoursClose} openSun=${columnas.hoursOpenSunday} closeSun=${columnas.hoursCloseSunday}`
  );

  const cambiaColumnas =
    (p.hoursDays ?? null) !== columnas.hoursDays ||
    (p.hoursOpen ?? null) !== columnas.hoursOpen ||
    (p.hoursClose ?? null) !== columnas.hoursClose ||
    (p.hoursOpenSunday ?? null) !== columnas.hoursOpenSunday ||
    (p.hoursCloseSunday ?? null) !== columnas.hoursCloseSunday;
  console.log(
    `   diferencias                : ficha +porDia · columnas ${cambiaColumnas ? "CAMBIAN" : "idénticas"}`
  );

  if (!aplicar) {
    migrados++;
    continue;
  }

  const fichaNueva = serializarComoEstaba(p.ficha, {
    ...fichaLeida,
    horario: normalizado,
  });

  /*
   * Y ANTES DE ESCRIBIR: que no se haya perdido nada por el camino.
   *
   * Una migración que arregla el horario y de paso se come un campo del
   * negocio es peor que no migrar. Se comparan las dos fichas **sin el
   * horario** —lo único que esto puede tocar—: si difieren en algo más, este
   * cliente no se migra y se dice por qué.
   */
  const todoMenosElHorario = (f: unknown) => {
    const { horario: _h, ...resto } = (f ?? {}) as Record<string, unknown>;
    void _h;
    return JSON.stringify(resto, Object.keys(resto).sort());
  };
  if (todoMenosElHorario(fichaLeida) !== todoMenosElHorario(leerFicha(fichaNueva))) {
    console.log("   🔴 la reserialización cambiaría algo más que el horario: NO se migra");
    continue;
  }

  const leerFila = async () => {
    const [f] = await db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, p.organizationId));
    return (f as unknown as Fila) ?? null;
  };
  await conRegistro(
    {
      tabla: "agent_profile",
      registro: p.organizationId,
      leerFila,
      declarados: [
        "ficha",
        "hoursDays",
        "hoursOpen",
        "hoursClose",
        "hoursOpenSunday",
        "hoursCloseSunday",
        "updatedAt",
      ],
      proceso: "migrar:horario",
      actor: "script:migrar:horario",
    },
    async () =>
      db
        .update(schema.agentProfile)
        .set({ ficha: fichaNueva, ...columnas, updatedAt: new Date() })
        .where(eq(schema.agentProfile.organizationId, p.organizationId))
  );
  migrados++;
  console.log("   ✅ migrado");
}

console.log("\n" + "═".repeat(74));
console.log(
  `[migrar-horario] ${migrados} ${aplicar ? "migrado(s)" : "se migrarían"} · ` +
    `${yaEstaban} ya estaban · ${sinHorario.length} sin horario · ` +
    `${requierenDecision.length} requieren decisión`
);
if (sinHorario.length) {
  console.log(`   sin horario (no se toca, no se inventa): ${sinHorario.join(", ")}`);
}
if (requierenDecision.length) {
  console.log(`   🟠 REQUIEREN DECISIÓN DE NEGOCIO: ${requierenDecision.join(", ")}`);
}
if (!aplicar) console.log("\n[migrar-horario] no se escribió nada (falta --aplicar)");

await sql.end();
process.exit(0);
