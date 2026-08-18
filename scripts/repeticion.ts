/**
 * Consultar y cambiar si un grupo de opciones **admite repetir** la misma.
 *
 * **Por qué existe, y por qué es temporal.**
 *
 * La regla vive en el catálogo desde el paso 3A (`product_option_group.
 * permite_repeticion`), que es donde tiene que estar: un Mega Box lleva cinco
 * salsas de cuatro sabores y solo se completa repitiendo; en un salón,
 * "esmaltado tradicional + tradicional" no significa nada. Lo decide cada
 * negocio, no el núcleo.
 *
 * Pero **el CRM todavía no tiene esa casilla** (es el paso 3B), así que hoy no
 * hay forma de cambiarla sin tocar la base. Este programa es ese puente: el día
 * que la casilla exista en `/admin`, esto sobra y se borra.
 *
 * La migración `0023` solo puso `true` donde la aritmética lo exigía
 * —`max_select > COUNT(opciones)`—, que resuelve el caso imposible pero **no la
 * decisión del negocio**: La Churra decidió el 16-ago que sus salsas se repiten
 * en las CUATRO presentaciones, y en tres de ellas repetir no es obligatorio,
 * solo permitido. Eso no lo puede deducir una migración. Ver
 * [86-DOS-PRODUCTOS-EN-UN-PEDIDO.md](../docs/korexia/86-DOS-PRODUCTOS-EN-UN-PEDIDO.md).
 *
 * Uso:
 *   pnpm repeticion <organizationId>                        → solo mira
 *   pnpm repeticion <organizationId> <GRUPO> --si           → simula
 *   pnpm repeticion <organizationId> <GRUPO> --si --aplicar
 *   pnpm repeticion <organizationId> <GRUPO> --no --aplicar
 *
 * `<GRUPO>` es el nombre del grupo, sin distinguir mayúsculas ni tildes, y
 * aplica a **todos los productos que lo tengan**: "SALSA" en La Churra son los
 * cuatro. Sin `--aplicar` no se escribe nada.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { conRegistro } from "@/server/registro-de-cambios";

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
  "APP_BASE_URL",
  "META_WEBHOOK_VERIFY_TOKEN",
]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

/** Sin tildes ni mayúsculas: comparar nombres, no ortografías. */
const llave = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const orgId = process.argv[2];
const grupoPedido = process.argv[3]?.startsWith("--") ? undefined : process.argv[3];
const aplicar = process.argv.includes("--aplicar");
const quiere = process.argv.includes("--si") ? true : process.argv.includes("--no") ? false : null;

if (!orgId?.startsWith("org_")) {
  console.error("Falta el organizationId. Uso: pnpm repeticion <org_...> [GRUPO] [--si|--no] [--aplicar]");
  process.exit(1);
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });

  const grupos = await db
    .select({
      id: schema.productOptionGroup.id,
      nombre: schema.productOptionGroup.name,
      minimo: schema.productOptionGroup.minSelect,
      maximo: schema.productOptionGroup.maxSelect,
      repite: schema.productOptionGroup.permiteRepeticion,
      productoId: schema.productOptionGroup.productId,
    })
    .from(schema.productOptionGroup)
    .where(eq(schema.productOptionGroup.organizationId, orgId!));

  if (grupos.length === 0) {
    console.log(`\n${orgId}: no tiene grupos de opciones cargados.\n`);
    await sql.end();
    return;
  }

  const productos = await db
    .select({ id: schema.product.id, nombre: schema.product.name })
    .from(schema.product)
    .where(eq(schema.product.organizationId, orgId!));
  const nombreDe = (id: string) => productos.find((p) => p.id === id)?.nombre ?? "?";

  // Cuántas opciones tiene cada grupo: es lo que hace que un máximo sea
  // imposible de completar sin repetir.
  const opciones = await db
    .select({ groupId: schema.productOption.groupId })
    .from(schema.productOption)
    .where(eq(schema.productOption.organizationId, orgId!));
  const cuantas = (id: string) => opciones.filter((o) => o.groupId === id).length;

  console.log(`\n=== GRUPOS DE ${orgId} ===\n`);
  for (const g of grupos) {
    const n = cuantas(g.id);
    // Se marca el caso que NO se puede cerrar sin repetir: es aritmética, no
    // una preferencia, y con `permite_repeticion = false` el pedido más caro de
    // un negocio se queda sin poder confirmarse.
    const imposible = g.maximo > n ? "  ⛔ pide más de las que hay: SIN repetir no se puede cerrar" : "";
    console.log(
      `  ${nombreDe(g.productoId).padEnd(14)} · ${g.nombre.padEnd(12)} ` +
        `min=${g.minimo} max=${g.maximo} opciones=${n}  repite=${g.repite ? "SÍ" : "no"}${imposible}`
    );
  }

  if (!grupoPedido || quiere === null) {
    console.log(
      "\nPara cambiarlo: pnpm repeticion <org> <GRUPO> --si|--no [--aplicar]\n"
    );
    await sql.end();
    return;
  }

  const objetivo = grupos.filter((g) => llave(g.nombre) === llave(grupoPedido));
  if (objetivo.length === 0) {
    console.log(`\n⛔ Ningún grupo se llama "${grupoPedido}".\n`);
    await sql.end();
    return;
  }

  const cambian = objetivo.filter((g) => g.repite !== quiere);
  console.log(
    `\n${aplicar ? "APLICANDO" : "SIMULACIÓN (sin --aplicar no se escribe nada)"}: ` +
      `"${grupoPedido}" → repite=${quiere ? "SÍ" : "no"}`
  );
  for (const g of objetivo) {
    const estado = g.repite === quiere ? "ya estaba así" : `${g.repite ? "SÍ" : "no"} → ${quiere ? "SÍ" : "no"}`;
    console.log(`  ${nombreDe(g.productoId).padEnd(14)} · ${g.nombre}  ${estado}`);
  }

  if (!aplicar || cambian.length === 0) {
    console.log(
      cambian.length === 0
        ? "\nNada que cambiar.\n"
        : "\nRepite con --aplicar cuando la lista de arriba te parezca correcta.\n"
    );
    await sql.end();
    return;
  }

  for (const g of cambian) {
    await conRegistro(
      {
        tabla: "product_option_group",
        registro: g.id,
        leerFila: async () => {
          const [f] = await db
            .select()
            .from(schema.productOptionGroup)
            .where(eq(schema.productOptionGroup.id, g.id));
          return (f as unknown as Record<string, unknown>) ?? null;
        },
        declarados: ["permiteRepeticion"],
        proceso: "repeticion",
        actor: "script:repeticion",
      },
      async () =>
        db
          .update(schema.productOptionGroup)
          .set({ permiteRepeticion: quiere })
          .where(eq(schema.productOptionGroup.id, g.id))
    );
  }

  console.log(
    `\n✅ ${cambian.length} grupo(s) actualizado(s).` +
      "\n⚠️ El PROMPT no cambia por esto: la regla la lee el validador desde el catálogo.\n"
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
