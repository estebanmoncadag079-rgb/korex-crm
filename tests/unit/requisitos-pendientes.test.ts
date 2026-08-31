/**
 * Bug real, auditoría de citas (Lashes Valen, 31-ago-2026), reproducido de
 * forma determinista en 5 guiones distintos (`runAgentTurn` contra un clon):
 * el prompt volvía a listar "nombre" turno tras turno aunque
 * `conversation_state.datos.nombre` ya tuviera un valor — con una
 * instrucción que decía "si el cliente ya te dio esto, EN ESTE MENSAJE O
 * ANTES EN LA CONVERSACIÓN, emítelo", condición que una vez cierta se queda
 * cierta para siempre. El modelo repetía `provide_requirement` con el mismo
 * valor en cada turno, sin avanzar nunca a `consult_availability`/
 * `book_appointment`.
 *
 * `requisitosPendientesDe` es el fix: filtra, con el MISMO criterio que ya
 * usa `loQueFalta` (`!estado.datos[r.id]?.trim()`), lo que el PROMPT debe
 * seguir pidiendo — nunca lo que ya está en `estado.datos`.
 */
import { describe, expect, it } from "vitest";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import { requisitosPendientesDe } from "@/server/orders/extraer";
import type { Requisito } from "@/server/ai/generador/ficha";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

const REQUISITOS: Requisito[] = [
  { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true },
  { id: "telefono", tipo: "telefono", etiqueta: "el celular de contacto", obligatorio: true },
];

function estadoCon(datos: Record<string, string | null>): EstadoDelPedido {
  return { ...estadoVacio(), datos };
}

describe("requisitosPendientesDe", () => {
  it("1. Requisito ausente (sin estado todavía): se sigue pidiendo, sin cambios", () => {
    const pendientes = requisitosPendientesDe(null, REQUISITOS);
    expect(pendientes).toEqual(REQUISITOS);
  });

  it("2. Requisito presente en el estado: NO se vuelve a pedir", () => {
    const estado = estadoCon({ nombre: "Ana Prueba", telefono: null });
    const pendientes = requisitosPendientesDe(estado, REQUISITOS);
    expect(pendientes?.map((r) => r.id)).toEqual(["telefono"]);
  });

  it("3. Varios requisitos, algunos completos y otros pendientes: solo listan los pendientes", () => {
    const estado = estadoCon({ nombre: "Ana Prueba", telefono: "3000000000" });
    const pendientes = requisitosPendientesDe(estado, REQUISITOS);
    expect(pendientes).toEqual([]);
  });

  it("4. Todos completos: lista vacía, no bloquea nada por sí sola", () => {
    const estado = estadoCon({ nombre: "Ana", telefono: "300" });
    const pendientes = requisitosPendientesDe(estado, REQUISITOS);
    expect(pendientes).toHaveLength(0);
  });

  it("5. Un valor vacío o solo espacios sigue contando como pendiente", () => {
    const estado = estadoCon({ nombre: "   ", telefono: "" });
    const pendientes = requisitosPendientesDe(estado, REQUISITOS);
    expect(pendientes?.map((r) => r.id)).toEqual(["nombre", "telefono"]);
  });

  it("6. Sin estado backend (stateSource='prompt', estado=null): comportamiento IDÉNTICO al de siempre", () => {
    expect(requisitosPendientesDe(null, REQUISITOS)).toBe(REQUISITOS);
  });

  it("7. requisitos undefined: no revienta, devuelve undefined", () => {
    expect(requisitosPendientesDe(estadoCon({}), undefined)).toBeUndefined();
    expect(requisitosPendientesDe(null, undefined)).toBeUndefined();
  });
});

describe("buildAgentSystemPrompt — efecto end-to-end del filtro", () => {
  type Profile = Parameters<typeof buildAgentSystemPrompt>[0]["profile"];
  const profileBase = {
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
  } as unknown as Profile;

  it("8. Con el requisito YA capturado (lista pre-filtrada), el prompt deja de listarlo", () => {
    const prompt = buildAgentSystemPrompt({
      profile: profileBase,
      kb: [],
      stages: [{ name: "Nuevo" }],
      appointments: { catalog: [] },
      requisitos: [], // ya filtrado: nada pendiente
    });
    expect(prompt).not.toMatch(/DATOS QUE ESTE NEGOCIO NECESITA ANTES DE CERRAR/);
  });

  it("9. Con el requisito TODAVÍA pendiente, el prompt lo sigue pidiendo (no regresión)", () => {
    const prompt = buildAgentSystemPrompt({
      profile: profileBase,
      kb: [],
      stages: [{ name: "Nuevo" }],
      appointments: { catalog: [] },
      requisitos: REQUISITOS,
    });
    expect(prompt).toMatch(/DATOS QUE ESTE NEGOCIO NECESITA ANTES DE CERRAR/);
    expect(prompt).toMatch(/- nombre: el nombre de quien lo pide/);
    expect(prompt).toMatch(/- telefono: el celular de contacto/);
  });

  it("10. Con solo uno pendiente, el prompt lista SOLO ese — no regresión de pedidos con varios requisitos", () => {
    const prompt = buildAgentSystemPrompt({
      profile: profileBase,
      kb: [],
      stages: [{ name: "Nuevo" }],
      requisitos: [REQUISITOS[1]!], // solo "telefono" sigue pendiente
    });
    expect(prompt).toMatch(/- telefono: el celular de contacto/);
    expect(prompt).not.toMatch(/- nombre: el nombre de quien lo pide/);
  });
});
