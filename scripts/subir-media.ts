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

const [orgId, ruta, etiqueta, kind] = process.argv.slice(2);

if (!orgId?.startsWith("org_") || !ruta || !etiqueta || !kind) {
  console.error(
    'Uso: pnpm subir:media <org_...> <ruta-del-archivo> "<etiqueta>" <producto|carta|otro>'
  );
  process.exit(1);
}
if (!["producto", "carta", "otro"].includes(kind)) {
  console.error(`kind inválido: "${kind}". Debe ser producto, carta u otro.`);
  process.exit(1);
}

const mimeType = MIME_POR_EXTENSION[extname(ruta).toLowerCase()];
if (!mimeType || !TIPOS_ACEPTADOS.has(mimeType)) {
  console.error(`Extensión no soportada: "${ruta}". Debe ser .jpg, .png, .webp o .pdf.`);
  process.exit(1);
}

async function main() {
  const bytes = readFileSync(ruta);
  if (bytes.length > MAX_BYTES) {
    console.error(
      `El archivo pesa ${(bytes.length / 1_000_000).toFixed(2)} MB; el límite es ${MAX_BYTES / 1_000_000} MB.`
    );
    process.exit(1);
  }
  const base64 = bytes.toString("base64");

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
      .set({ kind: kind as "producto" | "carta" | "otro", mimeType, datos: base64, tamano: bytes.length })
      .where(eq(schema.mediaAsset.id, existente[0].id));
    console.log(`Reemplazado: "${etiquetaLimpia}" (${existente[0].id}) — ${(bytes.length / 1_000_000).toFixed(2)} MB, ${mimeType}`);
  } else {
    const id = newId("mediaAsset");
    await db.insert(schema.mediaAsset).values({
      id,
      organizationId: orgId!,
      kind: kind as "producto" | "carta" | "otro",
      etiqueta: etiquetaLimpia,
      mimeType,
      datos: base64,
      tamano: bytes.length,
    });
    console.log(`Subido: "${etiquetaLimpia}" (${id}) — ${(bytes.length / 1_000_000).toFixed(2)} MB, ${mimeType}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
