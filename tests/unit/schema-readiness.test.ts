import { describe, expect, it } from "vitest";
import {
  claveDeColumna,
  columnasEsperadasPorElCodigo,
  columnasFaltantes,
} from "@/server/ops/schema-readiness";

/**
 * Fase 6I — el incidente real (8-sep-2026, doc 166): `migrate.mjs`
 * terminó con éxito sin que el esquema tuviera lo que el código
 * necesitaba. Estas pruebas cubren la lógica de comparación PURA
 * (`columnasFaltantes`) con datos inventados — la prueba de integración
 * real, contra Postgres real y el `migrate.mjs` completo, vive fuera de
 * este archivo (documentada en el doc 167, no repetida aquí con mocks que
 * no demostrarían nada sobre el migrador de verdad).
 */

describe("columnasFaltantes: comparación pura de esquema esperado vs real", () => {
  it("1: esquema correcto -> ninguna columna falta", () => {
    const esperadas = [
      { tabla: "agent_job", columna: "generation" },
      { tabla: "conversation_state", columna: "version" },
    ];
    const reales = new Set(esperadas.map(claveDeColumna));

    expect(columnasFaltantes(esperadas, reales)).toEqual([]);
  });

  it("4: tabla requerida ausente -> se reporta como faltante", () => {
    const esperadas = [
      { tabla: "appointment_booking_confirmation", columna: "id" },
      { tabla: "appointment_booking_confirmation", columna: "notify_status" },
    ];
    const reales = new Set<string>(); // la tabla no existe en absoluto

    const faltantes = columnasFaltantes(esperadas, reales);
    expect(faltantes).toHaveLength(2);
    expect(faltantes).toContainEqual({
      tabla: "appointment_booking_confirmation",
      columna: "id",
    });
  });

  it("5: columna requerida ausente en una tabla que sí existe -> se reporta esa sola", () => {
    const esperadas = [
      { tabla: "agent_job", columna: "id" },
      { tabla: "agent_job", columna: "generation" },
    ];
    // la tabla existe, pero le falta justo la columna nueva
    const reales = new Set(["agent_job.id", "agent_job.status"]);

    const faltantes = columnasFaltantes(esperadas, reales);
    expect(faltantes).toEqual([{ tabla: "agent_job", columna: "generation" }]);
  });

  it("6: código viejo con esquema ampliado (columnas de MÁS en la base) -> sigue pasando, no se reportan como error", () => {
    const esperadas = [{ tabla: "agent_job", columna: "id" }];
    // la base real tiene columnas que este código ni siquiera conoce todavía
    const reales = new Set(["agent_job.id", "agent_job.generation", "agent_job.status"]);

    expect(columnasFaltantes(esperadas, reales)).toEqual([]);
  });

  it("caso mixto: varias tablas, solo se reportan las columnas que de verdad faltan", () => {
    const esperadas = [
      { tabla: "agent_job", columna: "generation" },
      { tabla: "conversation_state", columna: "version" },
      { tabla: "appointment_booking_confirmation", columna: "id" },
    ];
    const reales = new Set([
      "agent_job.generation",
      // conversation_state.version falta
      "appointment_booking_confirmation.id",
    ]);

    expect(columnasFaltantes(esperadas, reales)).toEqual([
      { tabla: "conversation_state", columna: "version" },
    ]);
  });
});

describe("columnasEsperadasPorElCodigo: derivada del schema.ts real, no de una lista a mano", () => {
  it("incluye las 3 piezas del incidente real sin haberlas escrito a mano aquí", () => {
    const esperadas = columnasEsperadasPorElCodigo();
    const claves = new Set(esperadas.map(claveDeColumna));

    expect(claves.has("agent_job.generation")).toBe(true);
    expect(claves.has("conversation_state.version")).toBe(true);
    expect(claves.has("appointment_booking_confirmation.id")).toBe(true);
    expect(claves.has("appointment_booking_confirmation.notify_status")).toBe(true);
  });

  it("no está vacía y cubre bastantes más tablas que las del incidente (es introspección real, no una lista de 3 elementos)", () => {
    const esperadas = columnasEsperadasPorElCodigo();
    const tablas = new Set(esperadas.map((e) => e.tabla));

    expect(esperadas.length).toBeGreaterThan(100);
    expect(tablas.size).toBeGreaterThan(20);
  });
});
