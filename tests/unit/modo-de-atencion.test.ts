import { describe, expect, it } from "vitest";
import { modoDeAtencion } from "@/components/inbox/helpers";

/**
 * Quién atiende una conversación, tal como lo muestran la bandeja y la cabecera
 * del chat.
 *
 * ## El incidente que lo trajo
 *
 * MALIA, 8-sep-2026: una clienta escribió cinco veces en catorce minutos
 * mientras nadie le respondía. La conversación estaba en manos de una persona,
 * y desde la lista se veía **idéntica** a las que atendía la IA — no había
 * forma de saber que alguien tenía que entrar.
 *
 * ## El caso que nadie veía
 *
 * En esa misma conversación `handoff_at` estaba en **null** y `ai_enabled` en
 * **false**: el relevo se había limpiado con el botón de la bandeja, pero el
 * interruptor quedó abajo. La lista no mostraba nada, así que el equipo daba
 * por hecho que la IA seguía atendiendo mientras estaba muda. Es el tercer test
 * de abajo, y es el que de verdad importa.
 */
const conv = (aiEnabled: boolean, handoffAt: string | null) => ({ aiEnabled, handoffAt });

describe("modoDeAtencion", () => {
  it("IA encendida y sin relevo → la atiende la IA", () => {
    expect(modoDeAtencion(conv(true, null), true)).toBe("ia");
  });

  it("con relevo → la atiende una persona", () => {
    expect(modoDeAtencion(conv(true, "2026-09-08T23:43:25Z"), true)).toBe("humano");
  });

  it("EL CASO DE CAROL: sin relevo pero con la IA apagada → una persona", () => {
    // handoff_at en null + ai_enabled en false. Antes esto no se veía en la
    // lista y la conversación quedaba muda sin que nadie lo notara.
    expect(modoDeAtencion(conv(false, null), true)).toBe("humano");
  });

  it("con las dos cosas a la vez → una persona, sin ambigüedad", () => {
    expect(modoDeAtencion(conv(false, "2026-09-08T23:43:25Z"), true)).toBe("humano");
  });

  it("agente apagado para el negocio → 'apagado', gane lo que gane la conversación", () => {
    // Manda sobre todo lo demás: decir "IA" cuando el agente está apagado para
    // todo el negocio sería exactamente la mentira que este indicador existe
    // para evitar.
    expect(modoDeAtencion(conv(true, null), false)).toBe("apagado");
    expect(modoDeAtencion(conv(false, null), false)).toBe("apagado");
    expect(modoDeAtencion(conv(true, "2026-09-08T23:43:25Z"), false)).toBe("apagado");
  });
});
