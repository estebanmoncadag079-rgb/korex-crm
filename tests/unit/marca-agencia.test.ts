import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminLayout from "@/app/(app)/admin/layout";
import { DEFAULT_BRANDING } from "@/lib/branding";

/**
 * El panel de agencia lleva SIEMPRE la marca de korex.ia, también mientras un
 * superadmin está dentro de la cuenta de un cliente.
 *
 * Hasta el 13-ago-2026 el acento se resolvía solo en el layout raíz, así que
 * esta pantalla —que es la lista de TODOS los clientes— se vestía con el color
 * del último negocio en el que se hubiera entrado.
 */
describe("marca del panel de agencia", () => {
  it("redefine el acento con el de la agencia, no con el del cliente activo", () => {
    const html = renderToStaticMarkup(
      createElement(AdminLayout, { children: null })
    );

    expect(html).toContain(`--accent:${DEFAULT_BRANDING.accent}`);
    // Los tokens derivados también, o los botones quedarían a medio pintar.
    expect(html).toContain("--accent-hover:");
    expect(html).toContain("--accent-soft:");
    expect(html).toContain("--accent-tint:");
    expect(html).toContain("--accent-text:");
  });

  it("no deja colarse el rosa de Lis, que es lo que se veía", () => {
    const html = renderToStaticMarkup(
      createElement(AdminLayout, { children: null })
    );

    expect(html).not.toContain("#e91e8c");
  });
});
