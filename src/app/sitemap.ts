import type { MetadataRoute } from "next";

/**
 * Sitemap del sitio público.
 *
 * Hoy la portada es UNA sola página (`/`), así que el sitemap tiene una sola
 * entrada. Se deja igualmente porque es lo que Search Console pide para saber
 * qué rastrear, y porque el día que se añada contenido (un blog, casos de
 * cliente, una página por servicio) el sitio ya sabe publicarlo.
 *
 * Aquí NO se listan las pantallas del CRM: son privadas y el robots.txt las
 * prohíbe. Un sitemap solo debe traer páginas que quieres que la gente
 * encuentre desde Google.
 */

const BASE = "https://korexia.online";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
