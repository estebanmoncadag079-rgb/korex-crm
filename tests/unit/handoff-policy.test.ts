import { describe, expect, it } from "vitest";

/**
 * Quién habla: agente o persona. Lo crítico es que el agente NO interrumpa
 * mientras el equipo atiende, y que vuelva solo cuando le toca — si se queda
 * mudo, el cliente escribe al vacío.
 */

import {
  isResumeCommand,
  isReturnShortcut,
  isReturnToAgentPhrase,
  resumeReason,
  shouldResumeByInactivity,
} from "@/server/inbox/handoff-policy";

const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000);

describe("el operador devuelve el turno", () => {
  it("reconoce las formas naturales de decirlo", () => {
    expect(isReturnToAgentPhrase("Listo, te dejo con el asistente")).toBe(true);
    expect(isReturnToAgentPhrase("Sigue tú, bot")).toBe(true);
    expect(isReturnToAgentPhrase("continúa el agente por favor")).toBe(true);
    expect(isReturnToAgentPhrase("te atiende el asistente")).toBe(true);
  });

  it("acepta el atajo escrito", () => {
    expect(isReturnToAgentPhrase("#bot")).toBe(true);
    expect(isReturnToAgentPhrase(" #IA ")).toBe(true);
    expect(isReturnShortcut("#agente")).toBe(true);
  });

  it("una frase normal del operador NO devuelve el turno", () => {
    expect(isReturnToAgentPhrase("te dejo la dirección: Cra 22 #10-23")).toBe(false);
    expect(isReturnToAgentPhrase("ya sale tu pedido")).toBe(false);
    expect(isReturnToAgentPhrase("")).toBe(false);
    expect(isReturnToAgentPhrase(null)).toBe(false);
  });

  it("el atajo se distingue de la frase (uno no se le envía al cliente)", () => {
    expect(isReturnShortcut("#bot")).toBe(true);
    expect(isReturnShortcut("te dejo con el asistente")).toBe(false);
  });
});

describe("el cliente pide volver al menú", () => {
  it("el 0 reactiva", () => {
    expect(isResumeCommand("0")).toBe(true);
    expect(isResumeCommand(" 0 ")).toBe(true);
  });

  it("un 0 dentro de otra frase no cuenta", () => {
    expect(isResumeCommand("quiero 0 salsas")).toBe(false);
    expect(isResumeCommand("10")).toBe(false);
  });
});

describe("vuelta automática por silencio", () => {
  it("dos horas o más sin actividad → el agente retoma", () => {
    expect(shouldResumeByInactivity(hace(2.5))).toBe(true);
  });

  it("mientras el equipo atiende (minutos) NO interrumpe", () => {
    expect(shouldResumeByInactivity(hace(0.2))).toBe(false);
  });
});

describe("decisión sobre un mensaje entrante", () => {
  const base = { handoffAt: new Date(), text: "hola", lastMessageAt: hace(0.1) };

  it("sin handoff no hay nada que decidir", () => {
    expect(resumeReason({ ...base, handoffAt: null })).toBeNull();
  });

  it("el equipo está atendiendo → el agente calla", () => {
    expect(resumeReason(base)).toBeNull();
  });

  it("el cliente escribe 0 → vuelve el agente", () => {
    expect(resumeReason({ ...base, text: "0" })).toBe("comando");
  });

  it("nadie contestó en horas → vuelve el agente", () => {
    expect(resumeReason({ ...base, lastMessageAt: hace(5) })).toBe("inactividad");
  });
});
