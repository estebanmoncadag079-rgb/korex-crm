/**
 * Sube un archivo (foto o PDF) a `media_asset` de una organización, por la
 * línea de comandos — para cuando hace falta cargarlo antes de que exista
 * una pantalla de "Configuración → Fotos" post-onboarding (hoy solo existe
 * `FotosDeProductos` dentro del asistente de alta,
 * `src/components/onboarding/onboarding-wizard.tsx`).
 *
 * Escribe exactamente lo mismo que escribiría `POST /api/media`
 * (`src/app/api/media/route.ts`): misma tabla, mismos tipos aceptados, y la
 * misma regla de "subir la misma etiqueta reemplaza" — para que no importe
 * si el archivo se subió por aquí o por el CRM más adelante.
 *
 * Uso:
 *   pnpm subir:media <organizationId> <ruta-del-archivo> "<etiqueta>" <kind>
 *   pnpm subir:media <organizationId> <https://...>      "<etiqueta>" <kind>
 *   pnpm subir:media <organizationId> <ruta> "<etiqueta>" <kind> --enlace=<https://...>
 *
 * La primera forma guarda un ARCHIVO (lo de siempre); la segunda, solo un
 * ENLACE, para cuando el negocio prefiere que el cliente abra el recurso en
 * vez de descargarlo; la tercera, AMBOS. Lo que decide es el recurso, no el
 * agente: el modelo pide la misma etiqueta en los tres casos y nunca sabe qué
 * hay detrás (docs/korexia/47-FOTOS-DEL-AGENTE.md).
 *
 * `<kind>` es "producto" | "carta" | "otro" (ver `mediaAsset.kind` en el
 * esquema). Tipos aceptados: JPG, PNG, WEBP, PDF. Límite: 6 MB de archivo
 * real (~8 MB ya en base64), igual que la API.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";

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
for (const n of ["DATABASE_URL"]) {
  const v = envVar(n);
  if (v && !process.env[n]) process.env[n] = v;
}

const MIME_POR_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const TIPOS_ACEPTADOS = new Set(Object.values(MIME_POR_EXTENSION));
const MAX_BYTES = 6_000_000; // igual que el límite real de /api/media (8 MB en base64)

const args = process.argv.slice(2);
const flagEnlace = args.find((a) => a.startsWith("--enlace="));
const [orgId, origen, etiqueta, kind] = args.filter((a) => !a.startsWith("--"));

/*
 * Tres formas de entrega, decididas por lo que se pasa (18-ago-2026):
 *
 *   <ruta>                        → archivo (lo de siempre, no cambia nada)
 *   <https://...>                 → enlace: no se guarda archivo
 *   <ruta> --enlace=<https://...> → ambos: el archivo y el enlace
 *
 * El núcleo no sabe si el recurso es un catálogo, un menú o un tarifario: solo
 * si se entrega como archivo, como enlace o como las dos cosas.
 */
const esUrl = /^https:\/\//i.test(origen ?? "");
const urlEnlace = esUrl ? origen : flagEnlace?.slice("--enlace=".length);
const entrega: "archivo" | "enlace" | "ambos" = esUrl
  ? "enlace"
  : urlEnlace
    ? "ambos"
    : "archivo";

if (!orgId?.startsWith("org_") || !origen || !etiqueta || !kind) {
  console.error(
    'Uso: pnpm subir:media <org_...> <ruta-o-https://...> "<etiqueta>" <producto|carta|otro> [--enlace=https://...]'
  );
  process.exit(1);
}
if (!["producto", "carta", "otro"].includes(kind)) {
  console.error(`kind inválido: "${kind}". Debe ser producto, carta u otro.`);
  process.exit(1);
}
if (urlEnlace && !/^https:\/\//i.test(urlEnlace)) {
  console.error(`El enlace debe empezar por https:// — llegó "${urlEnlace}".`);
  process.exit(1);
}

// Solo hay tipo de archivo que validar si de verdad se va a subir un archivo.
const mimeType = esUrl ? null : MIME_POR_EXTENSION[extname(origen).toLowerCase()];
if (!esUrl && (!mimeType || !TIPOS_ACEPTADOS.has(mimeType))) {
  console.error(`Extensión no soportada: "${origen}". Debe ser .jpg, .png, .webp o .pdf.`);
  process.exit(1);
}

async function main() {
  // Un recurso que solo es enlace no tiene archivo que leer ni que pesar.
  const bytes = esUrl ? null : readFileSync(origen!);
  if (bytes && bytes.length > MAX_BYTES) {
    console.error(
      `El archivo pesa ${(bytes.length / 1_000_000).toFixed(2)} MB; el límite es ${MAX_BYTES / 1_000_000} MB.`
    );
    process.exit(1);
  }
  const base64 = bytes ? bytes.toString("base64") : null;
  const valores = {
    kind: kind as "producto" | "carta" | "otro",
    entrega,
    mimeType,
    datos: base64,
    tamano: bytes ? bytes.length : null,
    url: urlEnlace ?? null,
  };
  const resumen = bytes
    ? `${(bytes.length / 1_000_000).toFixed(2)} MB, ${mimeType}${urlEnlace ? ` + enlace` : ""}`
    : `enlace: ${urlEnlace}`;

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });

  const etiquetaLimpia = etiqueta!.trim();
  const existente = await db
    .select({ id: schema.mediaAsset.id })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, orgId!),
        eq(schema.mediaAsset.etiqueta, etiquetaLimpia)
      )
    )
    .limit(1);

  if (existente[0]) {
    await db
      .update(schema.mediaAsset)
      .set(valores)
      .where(eq(schema.mediaAsset.id, existente[0].id));
    console.log(`Reemplazado: "${etiquetaLimpia}" (${existente[0].id}) — ${resumen}`);
  } else {
    const id = newId("mediaAsset");
    await db.insert(schema.mediaAsset).values({
      id,
      organizationId: orgId!,
      etiqueta: etiquetaLimpia,
      ...valores,
    });
    console.log(`Subido: "${etiquetaLimpia}" (${id}) — ${resumen}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
