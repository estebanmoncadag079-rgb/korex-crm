import { describe, expect, it } from "vitest";

/**
 * Un mensaje `type: "unsupported"` (reaccionar o responder a un Estado de
 * WhatsApp a veces llega así) se guardaba con `text: null` — y
 * `toChatHistory` descarta cualquier fila sin texto al armar lo que ve el
 * agente, así que el mensaje del cliente quedaba invisible para la IA aunque
 * sí se hubiera guardado. Verificado en vivo el 1-ago-2026 en Lis Pastelería:
 * dos conversaciones terminaron en handoff_reason='error' por esto.
 */

import { textoDeMensaje } from "@/server/inbox/ingest";

describe("textoDeMensaje (mensajes sin texto no deben desaparecer del historial)", () => {
  it("sin texto y sin adjunto: pone un marcador en vez de null", () => {
    expect(textoDeMensaje(null, null, "unsupported")).toBe(
      '[mensaje no compatible: tipo "unsupported", revisa WhatsApp directamente]'
    );
  });

  it("el marcador nombra el tipo real recibido", () => {
    expect(textoDeMensaje(null, undefined, "button")).toContain('tipo "button"');
  });

  it("con texto de verdad, lo deja tal cual (no lo pisa)", () => {
    expect(textoDeMensaje("hola", null, "text")).toBe("hola");
  });

  it("con adjunto pero sin texto (imagen/audio sin transcribir), deja null — no se inventa nada", () => {
    expect(textoDeMensaje(null, "https://media.example/x.jpg", "image")).toBeNull();
  });
});
