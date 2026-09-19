/**
 * Fase 11 (imágenes de productos del catálogo) — diagnóstico de SOLO
 * LECTURA: para cada organización, cruza sus `media_asset` que TODAVÍA no
 * tienen `product_id` contra su catálogo real, y clasifica cada uno.
 *
 * Ampliado el 19-sep-2026: mira TODOS los `kind`, no solo `producto`.
 *
 * El motivo es concreto. Desde la corrección de esa fecha, cuando el agente
 * pregunta por un artículo que SÍ está en el catálogo, el respaldo por texto
 * de `resolverFoto` solo acepta recursos `kind='producto'` — es lo que impide
 * que una imagen recién quitada de un producto vuelva por la puerta de atrás
 * (ver `server/ai/fotos.ts` y docs/korexia/178).
 *
 * Efecto lateral conocido: si alguien subió la foto de un producto desde
 * Recursos y eligió `carta` u `otro` como tipo, esa foto deja de responder al
 * nombre de ese producto. Es una clasificación equivocada de origen, pero el
 * negocio no tiene por qué enterarse por las malas — así que este diagnóstico
 * las lista aparte, con el tipo que tienen, para poder arreglarlas antes de
 * que alguien lo note en una conversación real.
 *
 * Reutiliza `buscarProductos` (`server/catalog/buscar.ts`) — el MISMO
 * matcher ya probado que usa `consultar_producto` en producción — en vez de
 * inventar un segundo algoritmo de coincidencia difusa con porcentajes
 * propios. Su vocabulario (`found`/`multiple_matches`/`not_found`) ya
 * distingue exactamente lo que pide esta fase:
 *
 *   found            -> candidato seguro (un producto real, sin ambigüedad)
 *   multiple_matches -> requiere intervención (varios candidatos posibles)
 *   not_found        -> requiere intervención (sin candidato claro)
 *
 * NO ESCRIBE NADA. No hace ningún UPDATE sobre `media_asset`, no vincula
 * nada automáticamente — eso es una decisión humana posterior, deliberada,
 * fuera del alcance de este script (ver docs/korexia, Fase 11 del plan).
 *
 * Uso:
 *   pnpm tsx scripts/diagnostico-imagenes-producto.ts [organizationId]
 *
 * Sin `organizationId`: recorre TODAS las organizaciones con al menos un
 * `media_asset` de tipo `producto` sin vincular.
 */
import { readFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { buscarProductos } from "@/server/catalog/buscar";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

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

const url = envVar("DATABASE_URL");
if (!url) {
  console.error("[diagnostico-imagenes] falta DATABASE_URL");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const [organizationIdArg] = process.argv.slice(2);

type FilaOrganizacion = { id: string; name: string };

async function organizacionesAAuditar(): Promise<FilaOrganizacion[]> {
  if (organizationIdArg) {
    const filas = await db
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationIdArg));
    return filas;
  }
  // Solo organizaciones con al menos un recurso `producto` sin vincular —
  // no tiene sentido listar las que no tienen nada que diagnosticar.
  const filas = await db
    .selectDistinct({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .innerJoin(schema.mediaAsset, eq(schema.mediaAsset.organizationId, schema.organization.id))
    .where(isNull(schema.mediaAsset.productId));
  return filas;
}

async function catalogoDe(organizationId: string): Promise<ProductoDelCatalogo[]> {
  const productos = await db
    .select({
      id: schema.product.id,
      nombre: schema.product.name,
      categoria: schema.product.category,
      precioCents: schema.product.priceCents,
      descripcion: schema.product.description,
    })
    .from(schema.product)
    .where(and(eq(schema.product.organizationId, organizationId), isNull(schema.product.archivedAt)));
  // El diagnóstico solo necesita nombres para hacer match — sin grupos.
  return productos.map((p) => ({ ...p, grupos: [] }));
}

async function mediaAssetsSinVincular(
  organizationId: string
): Promise<{ id: string; etiqueta: string; kind: "producto" | "carta" | "otro" }[]> {
  return db
    .select({
      id: schema.mediaAsset.id,
      etiqueta: schema.mediaAsset.etiqueta,
      kind: schema.mediaAsset.kind,
    })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, organizationId),
        isNull(schema.mediaAsset.productId)
      )
    );
}

async function main() {
  const orgs = await organizacionesAAuditar();
  if (orgs.length === 0) {
    console.log("[diagnostico-imagenes] nada que diagnosticar: ninguna organización tiene recursos sin vincular.");
    await sql.end();
    return;
  }

  let seguros = 0;
  let requierenIntervencion = 0;
  let malClasificados = 0;

  for (const org of orgs) {
    const [catalogo, recursos] = await Promise.all([catalogoDe(org.id), mediaAssetsSinVincular(org.id)]);
    if (recursos.length === 0) continue;

    console.log(`\n■ ${org.name} (${org.id}) — catálogo con ${catalogo.length} producto(s)`);
    for (const recurso of recursos) {
      const resultado = buscarProductos(catalogo, recurso.etiqueta);
      if (resultado.status === "found") {
        /*
         * Casa con un producto real PERO no está declarado como `producto`.
         * Desde la corrección del 19-sep-2026 el agente ya no lo manda cuando
         * preguntan por ese artículo (ver la cabecera de este script). No es
         * un candidato a vincular sin más: primero hay que decidir si de
         * verdad es la foto de ese producto o solo se llama parecido.
         */
        if (recurso.kind !== "producto") {
          malClasificados++;
          console.log(
            `  🔶 TIPO EQUIVOCADO — media_asset=${recurso.id} etiqueta="${recurso.etiqueta}" está como '${recurso.kind}' ` +
              `pero casa con el producto "${resultado.producto.nombre}" (id=${resultado.producto.id}). ` +
              `El agente YA NO lo manda al preguntar por ese producto.`
          );
          continue;
        }
        seguros++;
        console.log(
          `  ✅ CANDIDATO SEGURO — media_asset=${recurso.id} etiqueta="${recurso.etiqueta}" -> producto="${resultado.producto.nombre}" (id=${resultado.producto.id})`
        );
      } else if (recurso.kind !== "producto") {
        // La carta, una foto del local: no casa con ningún producto y no tiene
        // por qué hacerlo. Nada que diagnosticar aquí.
        continue;
      } else if (resultado.status === "multiple_matches") {
        requierenIntervencion++;
        const nombres = resultado.productos.map((p) => p.nombre).join(", ");
        console.log(
          `  ⚠️  REQUIERE INTERVENCIÓN — media_asset=${recurso.id} etiqueta="${recurso.etiqueta}" -> varios candidatos: ${nombres}`
        );
      } else {
        requierenIntervencion++;
        console.log(
          `  ⚠️  REQUIERE INTERVENCIÓN — media_asset=${recurso.id} etiqueta="${recurso.etiqueta}" -> sin ningún candidato claro`
        );
      }
    }
  }

  console.log(
    `\n[diagnostico-imagenes] total: ${seguros} candidato(s) seguro(s), ${requierenIntervencion} que requieren intervención humana, ` +
      `${malClasificados} con el tipo equivocado.`
  );
  if (malClasificados > 0) {
    console.log(
      "[diagnostico-imagenes] los marcados 🔶 se arreglan subiendo esa imagen desde la ficha del producto en /catalogo " +
        "(queda vinculada de verdad), o cambiándoles el tipo a 'producto' en Recursos."
    );
  }
  console.log(
    "[diagnostico-imagenes] este script NO vinculó nada — es solo el reporte, tal como pide la Fase 11."
  );
  await sql.end();
}

await main();
