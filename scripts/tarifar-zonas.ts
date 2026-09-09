/**
 * Pone tarifa a las zonas de domicilio desde una lista de precios, y las
 * activa.
 *
 * Complemento de `cargar-zonas.ts`: aquel crea los barrios sin precio y sin
 * activar; este les pone el valor y los enciende. Se separan a propósito —
 * cargar nombres es inocuo, poner precios es dinero.
 *
 * ## Formato del archivo
 *
 *     # 8000
 *     Nueva Tequendama
 *     San Fernando Viejo
 *     # 10000
 *     Granada
 *
 * `# N` fija el precio EN PESOS para las líneas que siguen.
 *
 * ## Lo que comprueba antes de escribir
 *
 * Corre en simulación por defecto y reporta, sin tocar nada:
 *
 * - **Barrios en dos precios distintos** dentro del mismo archivo. Pasó en la
 *   primera lista real (Santa Isabel a $8.000 en la zona 1 y otra vez en la 3,
 *   Santa Mónica Popular en la 2 y la 3): elegir uno por el orden del archivo
 *   sería decidir un precio por accidente. Se marcan y se dejan fuera.
 * - **Barrios de la lista que no existen** en el catálogo.
 * - **Precios que CAMBIAN uno ya puesto.** Es lo más delicado: alguien del
 *   negocio ya reviso esas tarifas a mano, y pisarlas sin decirlo sería
 *   deshacer su trabajo en silencio.
 *
 * ## Uso
 *
 *   corepack pnpm tarifar:zonas <organizationId> <archivo.txt> [--aplicar]
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
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
/**
 * Deja fuera las que YA tenían un precio puesto a mano. Existe porque la
 * primera lista real cambiaba 14 tarifas que la dueña había curado el día
 * anterior —cuatro de ellas a la BAJA, hasta $4.000 menos por pedido— y eso no
 * lo decide un script: se aplica lo que no tiene discusión y esas se preguntan.
 */
const soloNuevos = process.argv.includes("--solo-nuevos");
if (!organizationId || !archivo) {
  console.error("Uso: tarifar:zonas <organizationId> <archivo.txt> [--aplicar]");
  process.exit(1);
}

// --- El archivo: precio actual + barrios que le siguen ---------------------
const pedido = new Map<string, { nombre: string; pesos: number }>();
const enDosPrecios = new Map<string, { nombre: string; precios: Set<number> }>();
let precioActual: number | null = null;

for (const cruda of readFileSync(archivo, "utf8").split(/\r?\n/)) {
  const linea = cruda.trim();
  if (!linea) continue;
  const cabecera = linea.match(/^#\s*(\d+)\s*$/);
  if (cabecera) {
    precioActual = Number(cabecera[1]);
    continue;
  }
  if (linea.startsWith("#")) continue;
  if (precioActual === null) {
    console.error(`[tarifas] "${linea}" aparece antes de cualquier precio (# N)`);
    process.exit(1);
  }
  const clave = normalizarNombreDeZona(linea);
  if (!clave) continue;
  const yaVisto = pedido.get(clave);
  if (yaVisto && yaVisto.pesos !== precioActual) {
    const conflicto = enDosPrecios.get(clave) ?? { nombre: linea, precios: new Set<number>() };
    conflicto.precios.add(yaVisto.pesos);
    conflicto.precios.add(precioActual);
    enDosPrecios.set(clave, conflicto);
    continue;
  }
  if (!yaVisto) pedido.set(clave, { nombre: linea, pesos: precioActual });
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[tarifas] DATABASE_URL no está definida");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const zonas = await db
  .select({
    id: schema.deliveryZone.id,
    name: schema.deliveryZone.name,
    feeCents: schema.deliveryZone.feeCents,
    active: schema.deliveryZone.active,
  })
  .from(schema.deliveryZone)
  .where(eq(schema.deliveryZone.organizationId, organizationId));

const porClave = new Map(zonas.map((z) => [normalizarNombreDeZona(z.name), z]));

type Cambio = { zona: (typeof zonas)[number]; pesos: number };
const aPonerPrecio: Cambio[] = [];
const aCambiarPrecio: Cambio[] = [];
const soloActivar: Cambio[] = [];
const yaCorrectas: string[] = [];
const noExisten: string[] = [];

for (const [clave, { nombre, pesos }] of pedido) {
  if (enDosPrecios.has(clave)) continue;
  const z = porClave.get(clave);
  if (!z) {
    noExisten.push(nombre);
    continue;
  }
  const cents = pesos * 100;
  if (z.feeCents === cents) {
    if (z.active) yaCorrectas.push(z.name);
    else soloActivar.push({ zona: z, pesos });
  } else if (z.feeCents === 0) {
    aPonerPrecio.push({ zona: z, pesos });
  } else {
    aCambiarPrecio.push({ zona: z, pesos });
  }
}

const sinTocar = zonas.filter((z) => !pedido.has(normalizarNombreDeZona(z.name)));

console.log(`\n  en el archivo        : ${pedido.size + enDosPrecios.size} barrios`);
console.log(`  ── van a cambiar ──`);
console.log(`  se les pone precio   : ${aPonerPrecio.length}  (estaban sin precio)`);
console.log(`  CAMBIAN de precio    : ${aCambiarPrecio.length}  ⚠️  ya tenían uno puesto`);
console.log(`  solo se activan      : ${soloActivar.length}  (precio ya correcto)`);
console.log(`  ── no cambian ──`);
console.log(`  ya estaban bien      : ${yaCorrectas.length}`);
console.log(`  en dos precios       : ${enDosPrecios.size}  ⚠️  se dejan FUERA`);
console.log(`  no existen           : ${noExisten.length}`);
console.log(`  del catálogo, sin instrucción: ${sinTocar.length}\n`);

if (enDosPrecios.size) {
  console.log("  ⚠️  EN DOS PRECIOS — el archivo les da dos valores, no se tocan:");
  for (const c of enDosPrecios.values()) {
    console.log(`     · ${c.nombre}: $${[...c.precios].sort((a, b) => a - b).join(" y $")}`);
  }
  console.log("");
}
if (aCambiarPrecio.length) {
  console.log("  ⚠️  CAMBIAN DE PRECIO — alguien ya los había puesto a mano:");
  for (const c of aCambiarPrecio) {
    console.log(`     · ${c.zona.name}: $${c.zona.feeCents / 100} → $${c.pesos}`);
  }
  console.log("");
}
if (noExisten.length) {
  console.log(`  No existen en el catálogo: ${noExisten.join(", ")}\n`);
}
if (sinTocar.length) {
  console.log(
    `  Del catálogo pero sin instrucción en el archivo (se quedan como están):\n     ${sinTocar
      .map((z) => `${z.name} ($${z.feeCents / 100}${z.active ? "" : ", inactiva"})`)
      .join(", ")}\n`
  );
}

if (!aplicar) {
  console.log("  (simulación — agrega --aplicar para escribir de verdad)\n");
  await sql.end();
  process.exit(0);
}

let n = 0;
const aEscribir = soloNuevos
  ? [...aPonerPrecio, ...soloActivar]
  : [...aPonerPrecio, ...aCambiarPrecio, ...soloActivar];
if (soloNuevos && aCambiarPrecio.length) {
  console.log(`  (--solo-nuevos: se dejan sin tocar las ${aCambiarPrecio.length} que ya tenían precio)
`);
}
for (const { zona, pesos } of aEscribir) {
  await db
    .update(schema.deliveryZone)
    .set({ feeCents: pesos * 100, active: true, updatedAt: new Date() })
    .where(eq(schema.deliveryZone.id, zona.id));
  console.log(
    `[cambio] tabla=delivery_zone registro=${zona.id} campo=fee_cents ` +
      `valor_anterior=${zona.feeCents} valor_nuevo=${pesos * 100} activa=true ` +
      `proceso=script:tarifar-zonas actor=sistema timestamp=${new Date().toISOString()}`
  );
  n++;
}

const activas = (
  await db
    .select({ active: schema.deliveryZone.active, feeCents: schema.deliveryZone.feeCents })
    .from(schema.deliveryZone)
    .where(eq(schema.deliveryZone.organizationId, organizationId))
).filter((z) => z.active);

console.log(`\n  ✅ ${n} zonas actualizadas y activadas.`);
console.log(`     El agente ahora cotiza ${activas.length} zonas.`);
const gratis = activas.filter((z) => z.feeCents === 0).length;
if (gratis) console.log(`     ⚠️  ${gratis} activas quedaron en $0: revísalas, el domicilio saldría gratis.`);
console.log("");
await sql.end();
