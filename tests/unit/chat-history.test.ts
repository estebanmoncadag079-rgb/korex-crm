import { describe, expect, it } from "vitest";

/**
 * El agente ve sus propios turnos anteriores. De su respuesta solo guardamos el
 * texto que salió al cliente, así que si se los devolvemos en prosa deja de
 * responder con el envoltorio de acción a mitad de la conversación: contesta
 * bien pero el pipeline no puede leerlo, se agotan los reintentos y el pedido
 * termina derivado a una persona. Pasó en producción con un pedido real.
 */

import { toChatHistory } from "@/server/ai/pipeline";

describe("historial que ve el agente", () => {
  it("le devuelve sus respuestas con el envoltorio de acción", () => {
    const turno = toChatHistory([
      { direction: "out", text: "¡Hola Churr@! ¿Qué se te antoja?" },
    ])[0]!;
    expect(turno.role).toBe("assistant");
    expect(JSON.parse(turno.content)).toEqual({
      action: "reply",
      text: "¡Hola Churr@! ¿Qué se te antoja?",
    });
  });

  it("deja los mensajes del cliente como texto plano", () => {
    const turno = toChatHistory([{ direction: "in", text: "una besties" }])[0]!;
    expect(turno).toEqual({ role: "user", content: "una besties" });
  });

  it("conserva el orden de la conversación", () => {
    const turnos = toChatHistory([
      { direction: "in", text: "hola" },
      { direction: "out", text: "¡Hola Churr@!" },
      { direction: "in", text: "churrita" },
    ]);
    expect(turnos.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
  });

  it("descarta los mensajes sin texto (una imagen, un comprobante)", () => {
    expect(
      toChatHistory([
        { direction: "in", text: null },
        { direction: "in", text: "ahí va el comprobante" },
      ])
    ).toHaveLength(1);
  });

  it("no rompe el JSON con comillas ni saltos de línea del propio mensaje", () => {
    const texto = 'Dijo "sí" al pedido\ny confirmó la dirección';
    const turno = toChatHistory([{ direction: "out", text: texto }])[0]!;
    expect(JSON.parse(turno.content).text).toBe(texto);
  });
});
