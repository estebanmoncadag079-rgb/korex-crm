/**
 * Pasa el catálogo de un negocio de pedidos del prompt a las tablas (Fase 1).
 *
 * Uso:
 *   pnpm migrar:catalogo <organizationId>              # revisar, no escribe
 *   pnpm migrar:catalogo <organizationId> --aplicar    # escribe las filas
 *   pnpm migrar:catalogo <organizationId> --encender   # pone catalog_source='tabla'
 *   pnpm migrar:catalogo <organizationId> --apagar     # ROLLBACK a 'prompt'
 *
 * Sin `--aplicar` solo enseña lo que entendió. Es a propósito: en el catálogo
 * del salón se colaron 12 precios equivocados que nadie revisó
 * (`docs/korexia/32-CATALOGO-SALON.md`), y un precio mal aquí se repite en cada
 * conversación durante meses.
 *
 * `--encender` es lo último y va aparte de `--aplicar`: primero se miran las
 * filas, después se le dice al agente que las use. `--apagar` lo devuelve al
 * prompt sin perder nada, porque el texto original nunca se borra de la ficha.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  escribirCatalogo,
  fichaDe,
  leerCatalogoDeTexto,
} from "@/server/catalog/sembrar";
import { catalogoDePedidos } from "@/server/catalog/queries";
import { renderCatalogoDePedidos } from "@/server/catalog/render";

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
// `getDb()` valida el entorno ENTERO al primer uso, no solo lo que este script
// toca: sin las cuatro últimas, aquí se muere con "Variables de entorno
// inválidas" aunque solo vaya a leer y escribir filas.
for (const n of [
  "DATABASE_URL",
  "ENCRYPTION_KEY",
  "BETTER_AUTH_SECRET",
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const orgId = process.argv[2];
if (!orgId || orgId.startsWith("--")) {
  console.error("Falta el organizationId. Uso: pnpm migrar:catalogo <orgId> [--aplicar|--encender|--apagar]");
  process.exit(1);
}
const aplicar = process.argv.includes("--aplicar");
const encender = process.argv.includes("--encender");
const apagar = process.argv.includes("--apagar");

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const perfil = (
  await db
    .select({
      nombre: schema.organization.name,
      fuente: schema.agentProfile.catalogSource,
      citas: schema.agentProfile.appointmentsEnabled,
    })
    .from(schema.agentProfile)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.agentProfile.organizationId)
    )
    .where(eq(schema.agentProfile.organizationId, orgId))
    .limit(1)
)[0];

if (!perfil) {
  console.error(`[catalogo] no existe ninguna organización con id ${orgId}`);
  await sql.end();
  process.exit(1);
}

console.log(`[catalogo] ${perfil.nombre} · fuente actual: ${perfil.fuente}`);
if (perfil.citas) {
  console.error("[catalogo] ⛔ es un negocio de CITAS: su catálogo ya vive en `service`, no aplica.");
  await sql.end();
  process.exit(1);
}

if (apagar) {
  await db
    .update(schema.agentProfile)
    .set({ catalogSource: "prompt", updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, orgId));
  console.log("[catalogo] ✅ ROLLBACK: vuelve a usar el catálogo del prompt.");
  await sql.end();
  process.exit(0);
}

if (encender) {
  const productos = await catalogoDePedidos(orgId);
  if (productos.length === 0) {
    console.error("[catalogo] ⛔ no hay productos cargados: encenderlo dejaría al agente sin carta.");
    await sql.end();
    process.exit(1);
  }
  await db
    .update(schema.agentProfile)
    .set({ catalogSource: "tabla", updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, orgId));
  console.log(`[catalogo] ✅ ENCENDIDO con ${productos.length} productos. Rollback: --apagar`);
  await sql.end();
  process.exit(0);
}

const ficha = await fichaDe(orgId);
if (!ficha?.catalogo?.trim()) {
  console.error(
    "[catalogo] ⛔ este negocio no tiene ficha guardada (prompt manual): su catálogo hay que cargarlo a mano."
  );
  await sql.end();
  process.exit(1);
}

const leido = leerCatalogoDeTexto(ficha.catalogo, ficha.variantes);

console.log(`\n=== PRODUCTOS (${leido.productos.length}) ===`);
for (const p of leido.productos) {
  const precio =
    p.precioCents === null
      ? "⚠️  SIN PRECIO"
      : `$${(p.precioCents / 100).toLocaleString("es-CO")}`;
  console.log(
    `  ${p.nombre.padEnd(28)} ${precio.padStart(14)}` +
      `${p.categoria ? `  [${p.categoria}]` : ""}${p.descripcion ? `  (${p.descripcion})` : ""}`
  );
}

console.log(`\n=== OPCIONES (${leido.grupos.length} grupos) ===`);
for (const g of leido.grupos) {
  const aQuien = g.producto ? `[solo ${g.producto}]` : "[todos los productos]";
  const cuantas = g.maximo > 1 ? ` elige ${g.maximo}` : "";
  console.log(
    `  ${g.nombre} ${aQuien}${cuantas} ${g.minimo >= 1 ? "(obligatorio)" : "(opcional)"}:`
  );
  for (const o of g.opciones) {
    const extra = o.precioExtraCents > 0 ? ` +$${(o.precioExtraCents / 100).toLocaleString("es-CO")}` : "";
    console.log(`      - ${o.nombre}${extra}`);
  }
}

if (leido.sinInterpretar.length) {
  console.log(`\n=== ⚠️  NO SE PUDO INTERPRETAR (${leido.sinInterpretar.length}) ===`);
  for (const l of leido.sinInterpretar) console.log(`  ${l}`);
}

const sinPrecio = leido.productos.filter((p) => p.precioCents === null).length;
if (sinPrecio) {
  console.log(`\n⚠️  ${sinPrecio} producto(s) sin precio. NO valen 0: el agente los preguntará.`);
}

if (!aplicar) {
  console.log("\n[catalogo] NO se escribió nada (falta --aplicar). Revisa la lista de arriba primero.");
  await sql.end();
  process.exit(0);
}

const res = await escribirCatalogo(orgId, leido);
console.log(
  `\n[catalogo] ✅ escrito: ${res.productos} productos · ${res.grupos} grupos · ${res.opciones} opciones`
);
console.log("[catalogo] fuente sigue en 'prompt'. Para que el agente lo use: --encender\n");

console.log("=== ASÍ LO VERÁ EL AGENTE ===");
console.log(renderCatalogoDePedidos(await catalogoDePedidos(orgId)));

await sql.end();
process.exit(0);
