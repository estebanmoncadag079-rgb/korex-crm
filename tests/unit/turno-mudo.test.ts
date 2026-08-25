import { describe, expect, it } from "vitest";

/**
 * Caso real (Lis Pastelería, 24-ago-2026, 17:07 Colombia): la clienta dio
 * nombre, teléfono y dirección para su domicilio. El modelo emitió
 * `provide_requirement` (requisitoId "direccion") SIN `reply` — el campo es
 * opcional en el esquema. El ejecutor solo manda algo `if (action.reply)`,
 * así que el turno terminó sin una sola palabra al cliente: sin error, sin
 * handoff, sin fila de mensaje. La clienta quedó esperando 4 minutos hasta
 * que la dueña, viendo el chat sin responder, contestó a mano.
 *
 * Ver anuncio-de-cierre.ts (CORRECCION_DE_TURNO_MUDO) y pipeline.ts (el
 * chequeo con textosAlCliente(action).length === 0 vive ahí, junto al de
 * requisito faltante, porque no detecta texto: detecta su ausencia).
 */

import { textosAlCliente } from "@/server/ai/pipeline";

describe("textosAlCliente: el turno mudo (provide_requirement/update_lead sin reply)", () => {
  it("el caso real exacto: provide_requirement sin reply queda vacío", () => {
    expect(
      textosAlCliente({
        action: "provide_requirement",
        requisitoId: "direccion",
        valor: "Cra67a 33b 63, casa esquinera abajo hay un farmacenter",
      })
    ).toEqual([]);
  });

  it("update_lead sin reply también queda vacío", () => {
    expect(textosAlCliente({ action: "update_lead", note: "cliente interesada" })).toEqual([]);
  });

  it("con reply, ambas SÍ traen texto (no es el patrón del fallo)", () => {
    expect(
      textosAlCliente({
        action: "provide_requirement",
        requisitoId: "direccion",
        valor: "Cra67a 33b 63",
        reply: "¡Gracias! Ya tengo tu dirección. Serían $22.000, ¿la envío a esa dirección?",
      })
    ).toEqual(["¡Gracias! Ya tengo tu dirección. Serían $22.000, ¿la envío a esa dirección?"]);
  });
});
