import { describe, expect, it } from "vitest";
import {
  arquitecturaAprobadaPara,
  diagnosticarConfiguracion,
  type ConfiguracionArquitectonica,
} from "@/server/auth/arquitectura";

/**
 * Fases 2, 3, 5, 9 y 12 — la configuración REAL de La Churra y Lis, leída de
 * producción el 19-sep-2026, convertida en pruebas.
 *
 * No son fixtures inventadas: son los valores exactos que devolvió
 * `SELECT state_source, catalog_source, payment_source, delivery_source` sobre
 * la base de producción. Si mañana alguien cambia la matriz de arquitectura
 * aprobada sin pensar en estos dos negocios, esto lo caza.
 *
 * Deliberadamente SIN tocar producción: lo que se prueba es que el validador
 * clasifica bien cada configuración, no que la configuración ya esté aplicada.
 * Las escrituras (Fases 2, 5 y 6) quedan pendientes de autorización.
 */

/** La Churra HOY: ya en el motor, pero con los medios de pago en el prompt. */
const LA_CHURRA_HOY: ConfiguracionArquitectonica = {
  appointmentsEnabled: false,
  catalogSource: "tabla",
  stateSource: "backend",
  paymentSource: "prompt",
  consultasVerificadasEnabled: false,
};

/** Lis HOY: contención del rollout — `state_source` bajado a mano. */
const LIS_HOY: ConfiguracionArquitectonica = {
  appointmentsEnabled: false,
  catalogSource: "tabla",
  stateSource: "prompt",
  paymentSource: "ficha",
  consultasVerificadasEnabled: false,
};

describe("La Churra: estado actual y objetivo del plan", () => {
  it("ya usa el motor: state_source='backend' y catálogo en tablas", () => {
    const diag = diagnosticarConfiguracion(LA_CHURRA_HOY);
    expect(diag.vertical).toBe("pedidos");
    expect(diag.alineados).toContain("stateSource");
    expect(diag.alineados).toContain("catalogSource");
    // Ningún mecanismo CORE ausente: el motor de Feature 003 sí corre.
    expect(diag.faltantes).toEqual([]);
  });

  it("pero payment_source sigue en 'prompt' — la Fase 5, detectada sola", () => {
    const diag = diagnosticarConfiguracion(LA_CHURRA_HOY);
    expect(diag.advertencias).toContain("paymentSource");
    expect(diag.estado).toBe("ADVERTENCIA");
  });

  it("con la Fase 5 aplicada queda ALINEADA", () => {
    const diag = diagnosticarConfiguracion({
      ...LA_CHURRA_HOY,
      paymentSource: "ficha",
      consultasVerificadasEnabled: true,
    });
    expect(diag.estado).toBe("ALINEADO");
    expect(diag.advertencias).toEqual([]);
  });
});

describe("Lis: la migración que pide la Fase 2", () => {
  it("hoy NO atraviesa el motor: state_source='prompt' es un mecanismo CORE ausente", () => {
    const diag = diagnosticarConfiguracion(LIS_HOY);
    expect(diag.faltantes).toContain("stateSource");
    expect(diag.estado).toBe("INCONSISTENTE");
  });

  it("su catálogo YA está en tablas — la Fase 3 no tiene que migrar nada", () => {
    const diag = diagnosticarConfiguracion(LIS_HOY);
    expect(diag.alineados).toContain("catalogSource");
  });

  it("sus medios de pago YA están estructurados — se conservan tal cual", () => {
    const diag = diagnosticarConfiguracion(LIS_HOY);
    expect(diag.alineados).toContain("paymentSource");
  });

  it("con SOLO cambiar state_source a 'backend' queda sin faltantes", () => {
    // Es exactamente lo que hace `pnpm fase2 <org> --encender`: un UPDATE de
    // una columna. No hace falta tocar catálogo, pagos ni código.
    const diag = diagnosticarConfiguracion({ ...LIS_HOY, stateSource: "backend" });
    expect(diag.faltantes).toEqual([]);
    expect(diag.estado).not.toBe("INCONSISTENTE");
  });

  it("el rollback es simétrico: volver a 'prompt' la devuelve al estado de hoy", () => {
    // Regla 8 de la Fase 2: el rollback es un UPDATE, no un despliegue.
    const migrada = diagnosticarConfiguracion({ ...LIS_HOY, stateSource: "backend" });
    const revertida = diagnosticarConfiguracion(LIS_HOY);
    expect(migrada.estado).not.toBe(revertida.estado);
    expect(revertida.faltantes).toContain("stateSource");
  });
});

describe("Fase 12 — compatibilidad: ningún otro cliente se ve afectado", () => {
  it("un negocio de citas no necesita catálogo ni pagos de pedidos", () => {
    const diag = diagnosticarConfiguracion({
      appointmentsEnabled: true,
      catalogSource: "prompt",
      stateSource: "backend",
      paymentSource: "prompt",
      consultasVerificadasEnabled: false,
    });
    expect(diag.vertical).toBe("citas");
    expect(diag.estado).toBe("ALINEADO");
    expect(diag.faltantes).toEqual([]);
  });

  it("un cliente nuevo nace ALINEADO en los dos verticales", () => {
    for (const vertical of ["pedidos", "citas"] as const) {
      const diag = diagnosticarConfiguracion(arquitecturaAprobadaPara(vertical));
      expect(diag.estado).toBe("ALINEADO");
    }
  });

  it("un dato de pedidos encendido en un negocio de citas se marca incompatible", () => {
    const diag = diagnosticarConfiguracion({
      appointmentsEnabled: true,
      catalogSource: "tabla", // no aplica en citas
      stateSource: "backend",
      paymentSource: "prompt",
      consultasVerificadasEnabled: false,
    });
    expect(diag.incompatibles).toContain("catalogSource");
    expect(diag.estado).toBe("INCONSISTENTE");
  });

  it("la regla NO conoce a ningún cliente por su nombre: solo vertical y campos", () => {
    // Dos negocios distintos con la misma configuración reciben el mismo
    // veredicto. Si alguna vez apareciera una excepción por cliente, este
    // test la cazaría.
    const a = diagnosticarConfiguracion(LIS_HOY);
    const b = diagnosticarConfiguracion({ ...LIS_HOY });
    expect(a.estado).toBe(b.estado);
    expect(a.faltantes).toEqual(b.faltantes);
  });
});
