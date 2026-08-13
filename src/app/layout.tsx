import { cache } from "react";
import type { Metadata } from "next";
import { Geist, Manrope, Sora } from "next/font/google";
import {
  accentCssVariables,
  DEFAULT_BRANDING,
  type Branding,
} from "@/lib/branding";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import "./globals.css";

// next/font descarga la fuente en BUILD y la sirve self-hosted (sin CDN).
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

// Tipografía de la landing pública (no afecta al CRM, que usa `font-sans`).
// Manrope para el cuerpo y Sora para los titulares, expuestas como variables CSS.
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

export const dynamic = "force-dynamic";

/**
 * Marca de ESTA petición: la del tenant activo si hay sesión, la de la agencia
 * si no la hay. El acento se inyecta aquí y solo aquí, así que de esta
 * resolución depende el color de toda la aplicación: si no mira la sesión,
 * todos los clientes acaban viendo el mismo color.
 *
 * `cache` la resuelve una sola vez por petición, aunque la pidan el layout y
 * los metadatos.
 */
const brandingForRequest = cache(async (): Promise<Branding> => {
  const session = await getSessionOrNull();
  return getBranding(session?.organizationId).catch(() => DEFAULT_BRANDING);
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await brandingForRequest();
  return {
    title: `${branding.name} — CRM de WhatsApp`,
    description: "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await brandingForRequest();
  return (
    <html
      lang="es"
      className={`${geist.variable} ${manrope.variable} ${sora.variable}`}
    >
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
