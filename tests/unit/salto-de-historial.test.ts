import { describe, expect, it } from "vitest";

/**
 * Contexto temporal en el historial (docs/korexia/151).
 *
 * Incidente real: una clienta con un pedido cerrado 11 días antes escribió
 * "Hola" y el bot respondió como si el pedido siguiera en curso —
 * `toChatHistory` no llevaba ninguna marca de tiempo, así que 11 días de
 * silencio se veían exactamente igual que 11 segundos para el modelo.
 *
 * El umbral es `WINDOW_MS` (24h, la ventana de servicio de WhatsApp) — no un
 * número inventado para este caso: pasado ese punto WhatsApp mismo ya no
 * deja mandar texto libre sin plantilla.
 */

import { mayorSaltoDeHistorial, toChatHistory } from "@/server/ai/pipeline";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const BASE = new Date("2026-08-16T20:45:35.000Z").getTime();

function msg(
  offsetMs: number,
  direction: "in" | "out",
  text: string,
  extra: { aiGenerated?: boolean } = {}
) {
  return { direction, text, createdAt: new Date(BASE + offsetMs), ...extra };
}

describe("toChatHistory: contexto temporal (docs/korexia/151)", () => {
  it("Caso 1 — sin ruptura: mensajes cercanos, sin marcador", () => {
    const historial = [
      msg(0, "in", "Quiero hacer un pedido"),
      msg(5_000, "out", "Claro, ¿qué deseas?", { aiGenerated: true }),
      msg(30 * 60 * 1000, "in", "Una torta de chocolate"),
    ];
    const turnos = toChatHistory(historial);
    expect(turnos).toHaveLength(3);
    expect(turnos.some((t) => t.content.includes("[SISTEMA]"))).toBe(false);
  });

  it("Caso 2 — pausa normal de 4 horas: por debajo del umbral, sin marcador", () => {
    const historial = [
      msg(0, "in", "Hola"),
      msg(60_000, "out", "¿En qué te ayudo?", { aiGenerated: true }),
      msg(4 * HORA, "in", "Sigo interesada, cuánto cuesta"),
    ];
    const turnos = toChatHistory(historial);
    expect(turnos.some((t) => t.content.includes("[SISTEMA]"))).toBe(false);
  });

  it("Caso 3 — ruptura larga de 11 días: aparece el marcador, sin fingir ser un mensaje del cliente", () => {
    const historial = [
      msg(0, "out", "*Ya va en camino tu pedido* ✨", { aiGenerated: false }),
      msg(10 * 60 * 1000, "in", "Gracias"),
      msg(10 * 60 * 1000 + 11 * DIA, "in", "Hola"),
    ];
    const turnos = toChatHistory(historial);
    const marcador = turnos.find((t) => t.content.includes("[SISTEMA]"));
    expect(marcador).toBeTruthy();
    expect(marcador!.role).toBe("user");
    expect(marcador!.content).toContain("11 días");
    expect(marcador!.content).toContain("interacción NUEVA");
    // El marcador va DESPUÉS del "Gracias" viejo y ANTES del "Hola" nuevo.
    const indiceGracias = turnos.findIndex((t) => t.content === "Gracias");
    const indiceMarcador = turnos.findIndex((t) => t.content.includes("[SISTEMA]"));
    const indiceHola = turnos.findIndex((t) => t.content === "Hola");
    expect(indiceGracias).toBeLessThan(indiceMarcador);
    expect(indiceMarcador).toBeLessThan(indiceHola);
  });

  it("Caso 4 — pedido reciente con pausa corta: NO pierde el contexto útil", () => {
    const historial = [
      msg(0, "out", "Tu pedido está confirmado, gracias por elegirnos", { aiGenerated: true }),
      msg(20 * 60 * 1000, "in", "Hola"),
    ];
    const turnos = toChatHistory(historial);
    expect(turnos.some((t) => t.content.includes("[SISTEMA]"))).toBe(false);
    expect(turnos).toHaveLength(2);
  });

  it("umbral exacto: justo en 24h SÍ marca, un milisegundo antes NO", () => {
    const conSalto = toChatHistory([
      msg(0, "in", "a"),
      msg(1 * DIA, "in", "b"),
    ]);
    expect(conSalto.some((t) => t.content.includes("[SISTEMA]"))).toBe(true);

    const sinSalto = toChatHistory([
      msg(0, "in", "a"),
      msg(1 * DIA - 1, "in", "b"),
    ]);
    expect(sinSalto.some((t) => t.content.includes("[SISTEMA]"))).toBe(false);
  });

  it("Caso 5 — retrocompatibilidad: sin createdAt, el comportamiento es IDÉNTICO al de siempre", () => {
    const historial = Array.from({ length: 20 }, (_, i) => ({
      direction: i % 2 === 0 ? ("in" as const) : ("out" as const),
      text: `mensaje ${i}`,
      aiGenerated: true,
    }));
    const turnos = toChatHistory(historial);
    expect(turnos).toHaveLength(20);
    expect(turnos.some((t) => t.content.includes("[SISTEMA]"))).toBe(false);
    expect(turnos.map((t) => t.role)).toEqual(
      historial.map((m) => (m.direction === "in" ? "user" : "assistant"))
    );
  });

  it("no rompe la curación de cierre falso ni el marcado de mensajes de una persona", () => {
    const turnos = toChatHistory(
      [
        msg(0, "out", "El día de hoy abrimos a la 1pm", { aiGenerated: false }),
        msg(60_000, "in", "hola"),
      ],
      "abierto"
    );
    expect(turnos[0]!.role).toBe("user");
    expect(turnos[0]!.content).toContain("una persona del negocio");
  });
});

describe("mayorSaltoDeHistorial: para la traza (docs/korexia/151)", () => {
  it("devuelve null sin ningún salto por encima del umbral", () => {
    expect(
      mayorSaltoDeHistorial([
        msg(0, "in", "a"),
        msg(4 * HORA, "in", "b"),
      ])
    ).toBeNull();
  });

  it("devuelve los días del salto más grande", () => {
    expect(
      mayorSaltoDeHistorial([
        msg(0, "in", "a"),
        msg(2 * DIA, "in", "b"),
        msg(2 * DIA + 11 * DIA, "in", "c"),
      ])
    ).toBe(11);
  });

  it("devuelve null sin createdAt en los mensajes (Laboratorio)", () => {
    expect(
      mayorSaltoDeHistorial([
        { text: "a" },
        { text: "b" },
      ])
    ).toBeNull();
  });
});
