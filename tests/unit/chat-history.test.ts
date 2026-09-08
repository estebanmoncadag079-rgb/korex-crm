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

/**
 * Lo que escribe una PERSONA del equipo desde la bandeja también sale como
 * `out`. Dárselo con el envoltorio de acción le hacía creer que lo había dicho
 * él: un compañero avisó "hoy abrimos a la 1pm" y el agente, coherente con unas
 * palabras que no eran suyas, le dijo al siguiente cliente que ya habían
 * cerrado — con el negocio abierto y a seis minutos de la apertura real.
 */
describe("mensajes que escribe una persona del equipo", () => {
  it("no se los atribuye al agente", () => {
    const turno = toChatHistory([
      { direction: "out", text: "El día de hoy abrimos a la 1pm", aiGenerated: false },
    ])[0]!;
    expect(turno.role).toBe("user");
    expect(turno.content).toContain("una persona del negocio");
    expect(turno.content).toContain("El día de hoy abrimos a la 1pm");
  });

  it("sigue tratando como suyas las respuestas que sí generó", () => {
    const turno = toChatHistory([
      { direction: "out", text: "¿Qué se te antoja?", aiGenerated: true },
    ])[0]!;
    expect(turno.role).toBe("assistant");
    expect(JSON.parse(turno.content).text).toBe("¿Qué se te antoja?");
  });

  it("sin el dato, asume que es suyo — no inventa un aviso del equipo", () => {
    const turno = toChatHistory([{ direction: "out", text: "hola" }])[0]!;
    expect(turno.role).toBe("assistant");
  });
});

/**
 * Fase 8I — incidente real (MALIA, 8-sep-2026, conv cv_d6dk9kjvzln94gm5qlv4):
 * una clienta mandó un STICKER. Los stickers no se transcriben y llegan con
 * `text = null`, así que el filtro de `toChatHistory` los descartaba enteros.
 * Como el sticker era el ÚLTIMO mensaje, lo que le llegaba al modelo
 * terminaba en su propia respuesta anterior — y Gemini rechaza eso:
 * `400 "Requests ending with a model turn are not supported"` → derivación.
 *
 * Misma familia que el incidente de Jorge (La Churra, 2-ago-2026), que ya
 * costó una venta por la otra puerta: historial terminando en turno del
 * agente.
 *
 * Medido antes del arreglo: 234 stickers, 27 videos y 15 audios en 30 días,
 * en ~114 conversaciones — todos invisibles para el agente.
 */
describe("Fase 8I: adjuntos entrantes sin texto (stickers, videos, audios sin transcribir)", () => {
  it("BUG REAL: un sticker al final ya NO deja el historial terminando en turno del modelo", () => {
    const turnos = toChatHistory([
      { direction: "in", text: "hola, quiero un pavé" },
      { direction: "out", text: "¡Claro! ¿De cuál sabor?", aiGenerated: true },
      { direction: "in", text: null, type: "sticker", mediaUrl: "https://x/y.webp" },
    ]);
    expect(turnos).toHaveLength(3);
    expect(turnos.at(-1)!.role).toBe("user");
    expect(turnos.at(-1)!.content).toContain("sticker");
  });

  it("describe cada tipo por lo que es, sin inventar contenido", () => {
    const tipo = (t: string) =>
      toChatHistory([{ direction: "in", text: null, type: t, mediaUrl: "https://x/y" }])[0]!.content;
    expect(tipo("sticker")).toContain("sticker");
    expect(tipo("video")).toContain("video");
    expect(tipo("audio")).toContain("nota de voz");
    expect(tipo("image")).toContain("imagen");
    expect(tipo("document")).toContain("documento");
    expect(tipo("cualquier_otro")).toContain("archivo");
  });

  it("no toca lo que SÍ trae texto: un audio transcrito entra con su transcripción", () => {
    const turno = toChatHistory([
      { direction: "in", text: "quiero dos pavés", type: "audio", mediaUrl: "https://x/y.ogg" },
    ])[0]!;
    expect(turno.role).toBe("user");
    expect(turno.content).toBe("quiero dos pavés");
  });

  it("un mensaje sin texto y SIN adjunto sigue descartándose (ya trae su marcador desde la ingesta)", () => {
    expect(toChatHistory([{ direction: "in", text: null, type: "unsupported" }])).toHaveLength(0);
  });

  it("un SALIENTE sin texto se sigue descartando: no puede romper el turno y tocarlo cambiaría lo que ve el modelo donde hoy funciona", () => {
    const turnos = toChatHistory([
      { direction: "in", text: "hola" },
      { direction: "out", text: null, type: "image", mediaUrl: "https://x/y.jpg" },
    ]);
    expect(turnos).toHaveLength(1);
    expect(turnos[0]!.role).toBe("user");
  });
});
