import { beforeEach, describe, expect, it, vi } from "vitest";
import { tieneNombreReal, satisfecho } from "@/server/contacts";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * El componente que faltaba en la auditoría de
 * docs/korexia/102-REQUISITO-NOMBRE-EN-CITAS.md: `faltantes()` (lectura) y
 * `capturar()` (la única función que escribe) para los requisitos que un
 * negocio declara antes de cerrar. El guardarraíl del pipeline solo llama a
 * `faltantes()` — nunca a `capturar()` (Regla 10 y 11 de ese documento).
 */

describe("tieneNombreReal: distingue un nombre real del relleno automático", () => {
  /*
   * `contact.name` es NOT NULL, y cuando no hay nombre de perfil de WhatsApp
   * se rellena con el teléfono o el BSUID (ingest.ts:156). "existe
   * contact.name" NUNCA basta — sería el mismo bug disfrazado.
   */
  it("un nombre igual al teléfono es el relleno automático, no un nombre real", () => {
    expect(tieneNombreReal({ name: "573001112233", phone: "573001112233", waUserId: null })).toBe(
      false
    );
  });

  it("un nombre igual al BSUID tampoco cuenta", () => {
    expect(
      tieneNombreReal({ name: "CO.12345", phone: null, waUserId: "CO.12345" })
    ).toBe(false);
  });

  it("un nombre distinto del teléfono y del BSUID sí es real", () => {
    expect(
      tieneNombreReal({ name: "Valentina", phone: "573001112233", waUserId: null })
    ).toBe(true);
  });

  it("sin nombre en absoluto, no está satisfecho", () => {
    expect(tieneNombreReal({ name: "", phone: null, waUserId: null })).toBe(false);
  });
});

const REQ_NOMBRE: Requisito = { id: "nombre", tipo: "texto", etiqueta: "el nombre", obligatorio: true };
const REQ_TELEFONO: Requisito = { id: "telefono", tipo: "telefono", etiqueta: "el celular", obligatorio: true };
const REQ_SIN_SOPORTE: Requisito = { id: "documento", tipo: "documento", etiqueta: "el documento", obligatorio: true };

describe("satisfecho: cada requisito mira lo que puede comprobar", () => {
  it("nombre: satisfecho solo con un nombre real", () => {
    expect(satisfecho(REQ_NOMBRE, { name: "Valentina", phone: "573001112233", waUserId: null })).toBe(
      true
    );
    expect(
      satisfecho(REQ_NOMBRE, { name: "573001112233", phone: "573001112233", waUserId: null })
    ).toBe(false);
  });

  it("telefono: lo da WhatsApp casi siempre — satisfecho con phone O waUserId", () => {
    expect(satisfecho(REQ_TELEFONO, { name: "x", phone: "573001112233", waUserId: null })).toBe(true);
    expect(satisfecho(REQ_TELEFONO, { name: "x", phone: null, waUserId: "CO.1" })).toBe(true);
    expect(satisfecho(REQ_TELEFONO, { name: "x", phone: null, waUserId: null })).toBe(false);
  });

  /*
   * El caso negativo que importa: un requisito que el sistema no sabe LEER
   * todavía (fuera de CAMPO_DE_REQUISITO) no puede bloquear nada — bloquear
   * por algo que no se sabe comprobar sería peor que no declararlo.
   */
  it("un requisito que el sistema no sabe leer se da por satisfecho, no por bloqueado", () => {
    expect(satisfecho(REQ_SIN_SOPORTE, { name: "Valentina", phone: null, waUserId: null })).toBe(
      true
    );
  });
});

/* ============================================================
 * faltantes() y capturar(), con la base mockeada
 * ============================================================ */

const filaContact = vi.fn();
const updateSet = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(filaContact()),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSet(values);
        return { where: () => Promise.resolve([]) };
      },
    }),
  }),
  schema: new Proxy(
    {},
    { get: (_t, tableName) => new Proxy({}, { get: (_t2, col) => `${String(tableName)}.${String(col)}` }) }
  ),
}));

vi.mock("@/lib/db/tenant", () => ({ scoped: (...conds: unknown[]) => conds }));

describe("faltantes: lectura pura contra el contacto real", () => {
  beforeEach(() => {
    filaContact.mockReset();
    updateSet.mockReset();
  });

  it("sin requisitos obligatorios declarados, no falta nada (ni se toca la base)", async () => {
    const { faltantes } = await import("@/server/contacts");
    const resultado = await faltantes({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [],
    });
    expect(resultado).toEqual([]);
    expect(filaContact).not.toHaveBeenCalled();
  });

  it("con nombre real, el requisito nombre no aparece entre los faltantes", async () => {
    filaContact.mockResolvedValue([{ name: "Valentina", phone: "573001112233", waUserId: null }]);
    const { faltantes } = await import("@/server/contacts");
    const resultado = await faltantes({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [REQ_NOMBRE],
    });
    expect(resultado).toEqual([]);
  });

  it("con el nombre relleno con el teléfono, el requisito nombre SÍ falta", async () => {
    filaContact.mockResolvedValue([
      { name: "573001112233", phone: "573001112233", waUserId: null },
    ]);
    const { faltantes } = await import("@/server/contacts");
    const resultado = await faltantes({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [REQ_NOMBRE],
    });
    expect(resultado.map((r) => r.id)).toEqual(["nombre"]);
  });

  it("sin contacto en la base, no exige nada (no hay a quién exigirle)", async () => {
    filaContact.mockResolvedValue([]);
    const { faltantes } = await import("@/server/contacts");
    const resultado = await faltantes({
      organizationId: "org_1",
      contactId: "ct_inexistente",
      requisitos: [REQ_NOMBRE],
    });
    expect(resultado).toEqual([]);
  });
});

describe("capturar: la única función que escribe", () => {
  beforeEach(() => {
    updateSet.mockReset();
  });

  it("guarda el nombre en contact.name cuando el requisito está declarado", async () => {
    const { capturar } = await import("@/server/contacts");
    const resultado = await capturar({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [REQ_NOMBRE],
      requisitoId: "nombre",
      valor: "Valentina",
    });
    expect(resultado).toEqual({ ok: true });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Valentina" })
    );
  });

  it("rechaza un requisitoId que el negocio no declaró — nunca inventa un campo", async () => {
    const { capturar } = await import("@/server/contacts");
    const resultado = await capturar({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [REQ_NOMBRE],
      requisitoId: "documento",
      valor: "123456",
    });
    expect(resultado.ok).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rechaza un requisito declarado pero sin destino conocido en la base", async () => {
    const { capturar } = await import("@/server/contacts");
    const resultado = await capturar({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [REQ_SIN_SOPORTE],
      requisitoId: "documento",
      valor: "123456",
    });
    expect(resultado.ok).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rechaza un valor vacío", async () => {
    const { capturar } = await import("@/server/contacts");
    const resultado = await capturar({
      organizationId: "org_1",
      contactId: "ct_1",
      requisitos: [REQ_NOMBRE],
      requisitoId: "nombre",
      valor: "   ",
    });
    expect(resultado.ok).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe("correccionDeRequisitoFaltante: el mensaje del octavo guardarraíl", () => {
  it("lista el id exacto de cada requisito, para que el modelo lo copie tal cual", async () => {
    const { correccionDeRequisitoFaltante } = await import("@/server/ai/anuncio-de-cierre");
    const texto = correccionDeRequisitoFaltante([REQ_NOMBRE]);
    expect(texto).toContain("nombre");
    expect(texto).toContain("provide_requirement");
    expect(texto).toContain("acción de cierre");
  });

  it("junta varios requisitos faltantes en una sola corrección", async () => {
    const { correccionDeRequisitoFaltante } = await import("@/server/ai/anuncio-de-cierre");
    const texto = correccionDeRequisitoFaltante([REQ_NOMBRE, REQ_TELEFONO]);
    expect(texto).toContain("nombre");
    expect(texto).toContain("telefono");
  });
});

describe("provide_requirement: el esquema de la acción", () => {
  it("acepta requisitoId y valor, con reply opcional", async () => {
    const { AgentAction } = await import("@/server/ai/actions");
    expect(
      AgentAction.safeParse({
        action: "provide_requirement",
        requisitoId: "nombre",
        valor: "Valentina",
      }).success
    ).toBe(true);
    expect(
      AgentAction.safeParse({
        action: "provide_requirement",
        requisitoId: "nombre",
        valor: "Valentina",
        reply: "¡Gracias, Valentina!",
      }).success
    ).toBe(true);
  });

  it("rechaza sin requisitoId o sin valor", async () => {
    const { AgentAction } = await import("@/server/ai/actions");
    expect(AgentAction.safeParse({ action: "provide_requirement", valor: "x" }).success).toBe(
      false
    );
    expect(
      AgentAction.safeParse({ action: "provide_requirement", requisitoId: "nombre" }).success
    ).toBe(false);
  });

  it("no rompe las demás acciones del contrato", async () => {
    const { AgentAction } = await import("@/server/ai/actions");
    expect(AgentAction.safeParse({ action: "reply", text: "hola" }).success).toBe(true);
    expect(
      AgentAction.safeParse({ action: "update_lead", note: "n" }).success
    ).toBe(true);
  });
});
