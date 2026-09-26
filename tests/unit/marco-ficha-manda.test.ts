import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, CONTRATO_DE_ACCIONES, pagoDePedidosParaElPrompt } from "@/server/ai/prompts";

/**
 * Doc 200 (26-sep-2026): el marco que se arma en cada mensaje tampoco puede
 * contradecir lo que decidió el negocio en su ficha (auditoría, doc 199).
 */
type Profile = Parameters<typeof buildAgentSystemPrompt>[0]["profile"];

const perfil = (extra: Record<string, unknown> = {}) =>
  ({
    name: "Negocio de prueba",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    hoursOpen: null,
    hoursClose: null,
    hoursDays: null,
    hoursOpenSunday: null,
    hoursCloseSunday: null,
    ficha: null,
    ...extra,
  }) as unknown as Profile;

const prompt = (p: Profile, now?: Date) =>
  buildAgentSystemPrompt({ profile: p, kb: [], stages: [{ name: "Nuevo" }], now });

describe("la primera línea no pisa el trato de la ficha", () => {
  it("ya no ordena 'español neutro' ni 'mensajes breves'", () => {
    const t = prompt(perfil());
    expect(t).not.toMatch(/español neutro/i);
    expect(t).not.toMatch(/mensajes breves/i);
  });

  it("el tono no va dos veces cuando el prompt ya trae el trato del negocio", () => {
    const t = prompt(
      perfil({ tone: "TONO DE PRUEBA", instructions: "# Tu trato con los clientes\n\nAsí lo pidió X: TONO DE PRUEBA" })
    );
    expect(t.split("TONO DE PRUEBA").length - 1).toBe(1);
  });

  it("sin ese bloque (negocio sin ficha), el tono se sigue dando", () => {
    expect(prompt(perfil({ tone: "TONO DE PRUEBA" }))).toContain("Tono: TONO DE PRUEBA");
  });
});

describe("cuándo se da la cuenta, según el negocio", () => {
  const PAGO = { formas: "transferencia", datosDeCuenta: "Bancolombia 123" };

  it("por defecto no contradice 'si preguntan cómo pagar, contesta'", () => {
    expect(pagoDePedidosParaElPrompt(PAGO)).not.toMatch(/solo DESPUÉS de que confirme/);
  });

  it("si el negocio eligió 'nunca antes de confirmar', se dice aquí también", () => {
    expect(pagoDePedidosParaElPrompt({ ...PAGO, cuentaAntesDeConfirmar: "nunca" })).toMatch(
      /solo DESPUÉS de que confirme/
    );
  });
});

describe("respuestas a publicaciones", () => {
  it("por defecto se responde lo que se pueda, no se pasa al equipo de una", () => {
    const linea = CONTRATO_DE_ACCIONES.split("\n").find((l) => l.includes("RESPONDE A UNA PUBLICACIÓN"))!;
    expect(linea).not.toMatch(/escala con handoff/i);
    expect(linea).toMatch(/conocimiento/i);
  });
});

describe("el aviso de 'aún no abre' respeta si el negocio toma pedidos cerrado", () => {
  const TODOS_LOS_DIAS = Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), { abre: "10:00", cierra: "20:00" }])
  );
  // 7:00 a. m. en Bogotá = 12:00 UTC: todavía no abre hoy.
  const TEMPRANO = new Date("2026-09-24T12:00:00.000Z");

  it("por defecto: se toma el pedido y se prepara al abrir", () => {
    const t = prompt(perfil({ ficha: JSON.stringify({ horario: { porDia: TODOS_LOS_DIAS } }) }), TEMPRANO);
    expect(t).toMatch(/tómale el pedido/i);
  });

  it("si el negocio NO toma pedidos cerrado, no se le ordena tomarlo", () => {
    const t = prompt(
      perfil({
        ficha: JSON.stringify({ horario: { porDia: TODOS_LOS_DIAS }, fueraDeHorario: { tomaPedidos: false } }),
      }),
      TEMPRANO
    );
    expect(t).not.toMatch(/tómale el pedido/i);
    expect(t).toMatch(/no toma pedidos/i);
  });
});
