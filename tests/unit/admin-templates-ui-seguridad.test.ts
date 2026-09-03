import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fase 9M, secciones 26/27 — el proyecto usa vitest en entorno `node` puro,
 * sin jsdom/React Testing Library (`vitest.config.ts`): renderizar
 * componentes React no es posible sin agregar herramientas nuevas, que la
 * fase pide explícitamente NO introducir. En su lugar, estas pruebas
 * verifican ESTÁTICAMENTE (mismo patrón que
 * `tests/unit/ycloud-templates.test.ts`, describe "acoplamiento de
 * imports") que ningún componente cliente de plantillas puede llegar a
 * llamar a YCloud/Meta directamente: si alguien agrega por error un import
 * del adaptador server-only o una URL de proveedor externo, este archivo
 * falla.
 */

function leer(rutaRelativa: string): string {
  return readFileSync(join(process.cwd(), rutaRelativa), "utf8");
}

const ADMIN_TEMPLATES_UI = "src/components/admin/admin-templates.tsx";
const SETTINGS_TEMPLATES_UI = "src/components/settings/templates-client.tsx";

describe("admin-templates.tsx: nunca llama a YCloud/Meta directamente", () => {
  const codigo = leer(ADMIN_TEMPLATES_UI);

  it("no importa el adaptador server-only de YCloud", () => {
    expect(codigo).not.toMatch(/from\s+["']@\/server\/whatsapp\/ycloud-templates["']/);
  });

  it("no importa el cliente de envío de YCloud ni Meta Graph", () => {
    expect(codigo).not.toMatch(/from\s+["']@\/lib\/ycloud\/client["']/);
    expect(codigo).not.toMatch(/from\s+["']@\/lib\/meta\/client["']/);
  });

  it("no contiene ninguna URL de dominio externo de YCloud/Meta", () => {
    expect(codigo).not.toMatch(/ycloud\.com/i);
    expect(codigo).not.toMatch(/graph\.facebook\.com/i);
  });

  it("toda llamada fetch() apunta a una ruta propia /api/, nunca a un dominio externo", () => {
    const llamadas = [...codigo.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g)].map((m) => m[1]);
    expect(llamadas.length).toBeGreaterThan(0); // confirma que el test realmente encontró llamadas, no que quedó vacío por error
    for (const llamada of llamadas) {
      expect(llamada).toMatch(/^[`"']\/api\//);
    }
  });
});

describe("templates-client.tsx (vista cliente): solo lectura, sin creación", () => {
  const codigo = leer(SETTINGS_TEMPLATES_UI);

  it("no hace ningún POST de creación a /api/templates", () => {
    // El único POST permitido en esta vista es /api/templates/sync (ya
    // existente, de solo sincronización de estado — nunca crea nada).
    const posts = [...codigo.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*"|'[^']*')[^)]*method:\s*["']POST["']/gs)];
    for (const m of posts) {
      expect(m[1]).toMatch(/\/sync/);
    }
  });

  it("filtra el listado a solo plantillas approved", () => {
    expect(codigo).toMatch(/status\s*===\s*["']approved["']/);
  });

  it("no importa el adaptador server-only de YCloud", () => {
    expect(codigo).not.toMatch(/from\s+["']@\/server\/whatsapp\/ycloud-templates["']/);
  });
});
