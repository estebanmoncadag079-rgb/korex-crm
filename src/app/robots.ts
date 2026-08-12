import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * robots.txt DINÁMICO: contesta distinto según el dominio que lo pida.
 *
 * Hace falta porque una sola aplicación sirve dos sitios muy distintos:
 *
 *   korexia.online      → la portada pública, que SÍ queremos en Google
 *   crm.korexia.online  → el CRM de los clientes, que NUNCA debe indexarse
 *
 * Antes esto era un `public/robots.txt` estático con `Disallow: /` para todo.
 * Protegía el CRM —bien— pero de paso le prohibía a Google la portada, así que
 * korexia.online no podía aparecer en ninguna búsqueda. Un archivo estático no
 * puede distinguir el dominio; este sí, porque lee la cabecera `Host`.
 *
 * ⚠️ Por eso `public/robots.txt` se borró: los archivos de `public/` ganan a
 * las rutas de la aplicación, así que mientras existiera, esto no se ejecutaba.
 *
 * La regla por defecto es CERRAR. Cualquier host que no reconozcamos (el CRM,
 * una IP suelta, el dominio propio de un cliente el día que lo haya) recibe
 * `Disallow: /`. Se abre solo lo que se nombra a propósito.
 */

export const dynamic = "force-dynamic";

/** El único dominio que debe salir en buscadores. */
const DOMINIO_PUBLICO = "korexia.online";

/**
 * Rutas del CRM. Se prohíben también en el dominio público por si alguna vez
 * queda un enlace suelto: son pantallas privadas, no contenido.
 */
const RUTAS_PRIVADAS = [
  "/admin",
  "/agent",
  "/appointments",
  "/contacts",
  "/inbox",
  "/lab",
  "/pipeline",
  "/services",
  "/settings",
  "/login",
  "/register",
  "/api/",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const cabeceras = await headers();
  // En local el Host trae puerto ("localhost:3000"); se compara solo el nombre.
  const host = (cabeceras.get("host") ?? "").toLowerCase().split(":")[0];

  const esPortadaPublica =
    host === DOMINIO_PUBLICO || host === `www.${DOMINIO_PUBLICO}`;

  if (!esPortadaPublica) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: RUTAS_PRIVADAS }],
    sitemap: `https://${DOMINIO_PUBLICO}/sitemap.xml`,
  };
}
