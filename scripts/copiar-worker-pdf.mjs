import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Deja el worker de pdf.js en `public/`, para leer catálogos en PDF.
 *
 * El PDF se abre en el NAVEGADOR, no en el servidor: el del salón pesa 36 MB
 * por las fotos, y subirlo entero para sacar dos páginas de texto sería
 * absurdo. Solo viaja el texto ya extraído, que son unos pocos KB.
 *
 * El worker se copia desde `node_modules` en cada build en vez de versionarlo:
 * así no hay un binario de 1 MB en el repo y la versión del worker SIEMPRE
 * coincide con la de la librería. Un worker desparejado falla en tiempo de
 * ejecución y solo en el navegador del cliente, que es el peor sitio para
 * enterarse.
 */

const require = createRequire(import.meta.url);
const origen = join(
  dirname(require.resolve("pdfjs-dist/package.json")),
  "build",
  "pdf.worker.min.mjs"
);
const destino = join(process.cwd(), "public", "pdf.worker.min.mjs");

mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origen, destino);
console.log(`[pdf] worker copiado a ${destino}`);
