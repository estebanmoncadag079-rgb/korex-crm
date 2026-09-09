/**
 * Carga una lista de barrios como zonas de domicilio, **sin precio y sin
 * activar**, para que el negocio las revise y les ponga tarifa.
 *
 * ## Por qué inactivas y en $0
 *
 * `zonasDeEntregaQuery` solo devuelve las ACTIVAS: una zona inactiva es
 * invisible para el agente, así que cargar trescientas de golpe no cambia en
 * nada lo que el bot cotiza hoy. Ese es el punto — se cargan todas, el negocio
 * les pone precio con calma, y solo entonces empiezan a existir para el bot.
 *
 * $0 no significa "domicilio gratis" aquí: significa "todavía sin definir".
 * Como `delivery_zone.fee_cents` no admite nulo, no hay otra forma de decirlo
 * en la base — por eso la pantalla marca las de $0 como **Sin precio** y avisa
 * antes de dejar activar una.
 *
 * ## Lo que NO hace
 *
 * No toca las zonas que ya existen: ni su precio, ni su estado, ni su nombre.
 * Compara sin tildes ni mayúsculas (`normalizarNombreDeZona`, el mismo criterio
 * del buscador de la pantalla), así que "Cañasgordas" y "canasgordas" son la
 * misma y no se duplica.
 *
 * ## Uso
 *
 *   corepack pnpm cargar:zonas <organizationId> <archivo.txt> [--aplicar]
 *
 * Sin `--aplicar` solo dice qué haría. Una línea por barrio; las líneas que
 * parecen encabezado ("Barrios estrato 3") se ignoran.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { normalizarNombreDeZona } from "@/lib/zonas-busqueda";

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
for (const n of ["DATABASE_URL", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "APP_BASE_URL", "META_WEBHOOK_VERIFY_TOKEN"]) {
  const v = loadEnvVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const [organizationId, archivo] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const aplicar = process.argv.includes("--aplicar");
if (!organizationId || !archivo) {
  console.error("Uso: cargar:zonas <organizationId> <archivo.txt> [--aplicar]");
  process.exit(1);
}

/** Las líneas que son títulos de sección, no barrios. */
const ES_ENCABEZADO = /^barrios?\s+estrato|^estrato\s|^comuna\s/i;

const lineas = readFileSync(archivo, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !ES_ENCABEZADO.test(l));

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[zonas] DATABASE_URL no está definida");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const existentes = await db
  .select({ id: schema.deliveryZone.id, name: schema.deliveryZone.name })
  .from(schema.deliveryZone)
  .where(eq(schema.deliveryZone.organizationId, organizationId));

const yaEsta = new Map(existentes.map((z) => [normalizarNombreDeZona(z.name), z.name]));

const nuevas: string[] = [];
const repetidasEnLaLista: string[] = [];
const yaExistian: { pedido: string; existente: string }[] = [];
const vistas = new Set<string>();

for (const nombre of lineas) {
  const clave = normalizarNombreDeZona(nombre);
  if (!clave) continue;
  if (vistas.has(clave)) {
    repetidasEnLaLista.push(nombre);
    continue;
  }
  vistas.add(clave);
  const existente = yaEsta.get(clave);
  if (existente) {
    yaExistian.push({ pedido: nombre, existente });
    continue;
  }
  nuevas.push(nombre);
}

console.log(`\n  en el archivo   : ${lineas.length} líneas`);
console.log(`  ya existían     : ${yaExistian.length}  (no se tocan)`);
console.log(`  repetidas       : ${repetidasEnLaLista.length}  (dentro del mismo archivo)`);
console.log(`  A CREAR         : ${nuevas.length}  (sin precio, inactivas)\n`);

if (yaExistian.length) {
  console.log("  Ya existían:");
  for (const y of yaExistian) {
    console.log(`    · ${y.pedido}${y.existente !== y.pedido ? `  → ya cargada como "${y.existente}"` : ""}`);
  }
  console.log("");
}
if (repetidasEnLaLista.length) {
  console.log(`  Repetidas en el archivo: ${repetidasEnLaLista.join(", ")}\n`);
}

if (!aplicar) {
  console.log("  (simulación — agrega --aplicar para escribir de verdad)\n");
  await sql.end();
  process.exit(0);
}

/** La posición sigue después de las que ya hay, para no reordenar nada. */
const desde = existentes.length;
let creadas = 0;
for (const [i, nombre] of nuevas.entries()) {
  const id = newId("deliveryZone");
  await db.insert(schema.deliveryZone).values({
    id,
    organizationId,
    name: nombre,
    feeCents: 0,
    active: false,
    position: desde + i,
  });
  console.log(
    `[cambio] tabla=delivery_zone registro=${id} campo=<fila nueva> valor_anterior=ausente ` +
      `valor_nuevo=<creada sin precio, inactiva> proceso=script:cargar-zonas actor=sistema ` +
      `timestamp=${new Date().toISOString()}`
  );
  creadas++;
}

console.log(`\n  ✅ ${creadas} zonas creadas, todas SIN PRECIO y DESACTIVADAS.`);
console.log(`     El agente no las cotiza hasta que alguien les ponga tarifa y las active.\n`);
await sql.end();
