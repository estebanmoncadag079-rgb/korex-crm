import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Filtro de "eco" duplicado (auditoría de Lashes Valen, 30-ago-2026): con
 * coexistencia activada, WhatsApp le devuelve al webhook un "eco" de
 * CUALQUIER mensaje saliente — incluido el que el propio CRM acaba de
 * enviar — como si el negocio lo hubiera escrito desde el celular. Sin este
 * filtro, `ingestOutboundEcho` registraba ese eco como un mensaje nuevo
 * (duplicando el saludo en el hilo) y además cedía el turno a un humano que
 * nunca escribió nada.
 *
 * `esEcoDeMensajePropio` es la función pura de decisión: recibe los
 * candidatos que el SELECT real ya filtró (misma conversación, saliente,
 * `aiGenerated=true`, dentro de la ventana) y decide si alguno coincide en
 * texto con el eco entrante. El filtrado por conversación/ventana/autoría
 * es responsabilidad del WHERE de Postgres — aquí solo se prueba la
 * decisión de comparación de texto sobre lo que el mock dice que "ya pasó"
 * ese filtro, exactamente como lo vería la función en producción.
 */

vi.mock("@/lib/db", () => ({
  getDb: () => (globalThis as unknown as { __dbMock: unknown }).__dbMock,
  schema: {
    message: {
      id: "message.id",
      text: "message.text",
      conversationId: "message.conversationId",
      direction: "message.direction",
      aiGenerated: "message.aiGenerated",
      createdAt: "message.createdAt",
    },
  },
}));

function mockDbConRecientes(recientes: { id: string; text: string | null }[]) {
  (globalThis as unknown as { __dbMock: unknown }).__dbMock = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(recientes),
          }),
        }),
      }),
    }),
  };
}

describe("esEcoDeMensajePropio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mismo texto + candidato propio reciente en la ventana → descarta (devuelve el id)", async () => {
    mockDbConRecientes([{ id: "msg_saludo_real", text: "Hola, bienvenida al negocio." }]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const resultado = await esEcoDeMensajePropio("conv_1", "Hola, bienvenida al negocio.");

    expect(resultado).toBe("msg_saludo_real");
  });

  it("candidato fuera de la ventana (el SELECT ya lo excluyó): no descarta", async () => {
    // El SELECT real filtra por `gte(createdAt, desde)`: un candidato viejo
    // nunca llega hasta acá. Simular eso es simular una lista vacía.
    mockDbConRecientes([]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const resultado = await esEcoDeMensajePropio("conv_1", "Hola, bienvenida al negocio.");

    expect(resultado).toBeNull();
  });

  it("texto diferente al del candidato reciente: no descarta", async () => {
    mockDbConRecientes([{ id: "msg_saludo_real", text: "Hola, bienvenida al negocio." }]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const resultado = await esEcoDeMensajePropio("conv_1", "¿Tienen disponibilidad para mañana?");

    expect(resultado).toBeNull();
  });

  it("conversación distinta (el SELECT ya la excluyó): no descarta", async () => {
    // El WHERE real filtra por `eq(conversationId, ...)`. Una conversación
    // distinta nunca aparece en la lista que le llega a esta función.
    mockDbConRecientes([]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const resultado = await esEcoDeMensajePropio("conv_otra", "Hola, bienvenida al negocio.");

    expect(resultado).toBeNull();
  });

  it("mensaje humano legítimo repetido (aiGenerated=false, el SELECT ya lo excluyó): no se descarta por error", async () => {
    // El WHERE real filtra por `eq(aiGenerated, true)`. Un mensaje que un
    // OPERADOR escribió dos veces por su cuenta nunca entra en la lista —
    // así que nunca se confunde con el eco del propio agente.
    mockDbConRecientes([]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const resultado = await esEcoDeMensajePropio("conv_1", "Ya te separo el cupo, hermosa");

    expect(resultado).toBeNull();
  });

  it("múltiples ecos del mismo mensaje: cada uno se descarta por separado (comportamiento seguro)", async () => {
    mockDbConRecientes([{ id: "msg_saludo_real", text: "Bienvenida  a Lashes Valen Studio." }]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const primerEco = await esEcoDeMensajePropio("conv_1", "Bienvenida  a Lashes Valen Studio.");
    const segundoEco = await esEcoDeMensajePropio("conv_1", "Bienvenida  a Lashes Valen Studio.");

    expect(primerEco).toBe("msg_saludo_real");
    expect(segundoEco).toBe("msg_saludo_real");
  });

  it("sin texto (imagen sin pie): nunca compara, no descarta", async () => {
    mockDbConRecientes([{ id: "msg_saludo_real", text: "" }]);
    const { esEcoDeMensajePropio } = await import("@/server/inbox/ingest");

    const resultado = await esEcoDeMensajePropio("conv_1", null);

    expect(resultado).toBeNull();
  });
});
