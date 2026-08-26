import { describe, expect, it, vi } from "vitest";

/**
 * `traza.ts` (docs/korexia/145): el acumulador y la línea de log que
 * consolida, por turno, qué se verificó, qué guardarraíl actuó y cómo
 * terminó — para no reconstruir un incidente a mano cruzando logs sueltos.
 */

import {
  agregarGuardarrail,
  agregarHecho,
  crearTraza,
  registrarHandoff,
  registrarRecuperacion,
  registrarTrazaDelTurno,
} from "@/server/ai/traza";

function ultimaLinea(spy: ReturnType<typeof vi.spyOn>): string {
  const llamada = spy.mock.calls.at(-1);
  return String(llamada?.[0] ?? "");
}

describe("crearTraza", () => {
  it("resume el mensaje del cliente, nunca lo vuelca en claro", () => {
    const t = crearTraza({
      organizationId: "org_1",
      conversationId: "cv_1",
      mensajeId: "msg_1",
      mensajeTexto: "Mi dirección es Calle 10 #20-30, casa azul",
    });
    expect(t.mensajeResumen).not.toContain("Calle 10");
    expect(t.mensajeResumen).toMatch(/caracteres · huella/);
  });

  it("sin categorías al crear: es un turno 'normal' hasta que algo lo marque distinto", () => {
    const t = crearTraza({ organizationId: "org_1", conversationId: "cv_1", mensajeId: "msg_1", mensajeTexto: "hola" });
    expect(t.categorias.size).toBe(0);
  });
});

describe("registrarTrazaDelTurno — escenario 1: consulta factual exitosa", () => {
  it("registra fact_verified con origen backend, sin volcar el mensaje del cliente", () => {
    const t = crearTraza({
      organizationId: "org_1",
      conversationId: "cv_1",
      mensajeId: "msg_1",
      mensajeTexto: "¿Tienen torta de chocolate?",
    });
    t.deteccionFactual = "torta de chocolate";
    agregarHecho(t, {
      tipo: "producto",
      consulta: "torta de chocolate",
      resultado: "found",
      origen: "backend",
    });
    t.accionFinal = "reply";

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarTrazaDelTurno(t);
    const linea = ultimaLinea(spy);
    spy.mockRestore();

    expect(linea).toContain("categorias=fact_verified");
    expect(linea).toContain('hechos=producto:"torta de chocolate"=found@backend');
    expect(linea).toContain("deteccion_factual=\"torta de chocolate\"");
    expect(linea).toContain("accion=reply");
    expect(linea).toContain("handoff=no");
    expect(linea).not.toContain("Tienen torta de chocolate");
  });
});

describe("registrarTrazaDelTurno — escenario 2: consulta abierta", () => {
  it("sin detección factual y sin hechos, no marca falsamente fact_verified", () => {
    const t = crearTraza({
      organizationId: "org_1",
      conversationId: "cv_1",
      mensajeId: "msg_2",
      mensajeTexto: "¿Qué tienen de chocolate?",
    });
    // Nada llama a agregarHecho: el detector de consulta factual descartó
    // el mensaje por abierto, y el modelo respondió con el catálogo/CRM.
    t.accionFinal = "reply";

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    registrarTrazaDelTurno(t);
    const linea = ultimaLinea(spy);
    spy.mockRestore();

    expect(linea).toContain("categorias=normal");
    expect(linea).toContain("hechos=-");
    expect(linea).toContain("deteccion_factual=no");
    expect(linea).not.toContain("fact_verified");
  });
});

describe("registrarTrazaDelTurno — escenario 3: send_menu sin reply (Nivel 1)", () => {
  it("registra model_output_partial_recovered con éxito", () => {
    const t = crearTraza({ organizationId: "org_1", conversationId: "cv_1", mensajeId: "msg_3", mensajeTexto: "Hola" });
    registrarRecuperacion(t, 1, true);
    t.accionFinal = "send_menu";

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarTrazaDelTurno(t);
    const linea = ultimaLinea(spy);
    spy.mockRestore();

    expect(linea).toContain("categorias=model_output_partial_recovered");
    expect(linea).toContain("recuperacion=nivel1:exito");
    expect(linea).toContain("accion=send_menu");
  });
});

describe("registrarTrazaDelTurno — escenario 4: guardarraíl corrige una respuesta", () => {
  it("registra guardrail_corrected con el nombre del guardarraíl", () => {
    const t = crearTraza({ organizationId: "org_1", conversationId: "cv_1", mensajeId: "msg_4", mensajeTexto: "¿Tienen X?" });
    agregarHecho(t, { tipo: "producto", consulta: "X", resultado: "found", origen: "backend" });
    agregarGuardarrail(t, "producto_contradicho", true);
    t.accionFinal = "reply";

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarTrazaDelTurno(t);
    const linea = ultimaLinea(spy);
    spy.mockRestore();

    expect(linea).toContain("fact_verified");
    expect(linea).toContain("guardrail_corrected");
    expect(linea).toContain("guardarrailes=producto_contradicho:corrigio");
  });
});

describe("registrarTrazaDelTurno — escenario 5: handoff con causa específica", () => {
  it("registra la causa exacta, no un genérico 'error'", () => {
    const t = crearTraza({ organizationId: "org_1", conversationId: "cv_1", mensajeId: "msg_5", mensajeTexto: "hola" });
    registrarHandoff(t, "model_output_invalid");
    t.accionFinal = "handoff";

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registrarTrazaDelTurno(t);
    const linea = ultimaLinea(spy);
    spy.mockRestore();

    expect(linea).toContain("handoff=si");
    expect(linea).toContain("causa_handoff=model_output_invalid");
    expect(linea).toContain("model_output_invalid");
  });

  it("distintas causas quedan literalmente distinguibles en el log", () => {
    const causas = [
      "customer_requested_human",
      "missing_required_information",
      "model_output_invalid",
      "model_output_recovery_failed",
      "provider_error",
      "backend_error",
      "business_rule",
    ];
    for (const causa of causas) {
      const t = crearTraza({ organizationId: "org_1", conversationId: "cv_1", mensajeId: "m", mensajeTexto: "x" });
      registrarHandoff(t, causa);
      expect(t.handoffCausa).toBe(causa);
    }
  });
});

describe("registrarTrazaDelTurno nunca lanza", () => {
  it("con un objeto de traza corrupto, no propaga la excepción", () => {
    const t = crearTraza({ organizationId: "org_1", conversationId: "cv_1", mensajeId: "m", mensajeTexto: "x" });
    // Fuerza un valor que rompería un .join() ingenuo.
    (t as unknown as { categorias: unknown }).categorias = null;
    expect(() => registrarTrazaDelTurno(t)).not.toThrow();
  });
});
