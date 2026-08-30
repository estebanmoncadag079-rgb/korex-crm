import { describe, expect, it } from "vitest";
import { arquitecturaAprobadaPara } from "@/server/auth/arquitectura";

/**
 * La fuente central de verdad de con qué arquitectura nace un cliente nuevo
 * (docs de la corrección: Malía entró con `catalog_source='tabla'` pero
 * `state_source='prompt'` porque nadie encendió Fase 2 a mano). Estos
 * valores no son preferencia: están respaldados por clientes reales en
 * producción (Lis, La Churra, Lashes Valen) — ver `arquitectura.ts` para el
 * porqué de cada uno.
 */
describe("arquitecturaAprobadaPara: pedidos", () => {
  const config = arquitecturaAprobadaPara("pedidos");

  it("nace con el catálogo y el estado en tablas, no en el prompt", () => {
    expect(config.catalogSource).toBe("tabla");
    expect(config.stateSource).toBe("backend");
  });

  it("nace con pagos desde la ficha y consultas verificadas encendidas", () => {
    expect(config.paymentSource).toBe("ficha");
    expect(config.consultasVerificadasEnabled).toBe(true);
  });

  it("no contrata citas", () => {
    expect(config.appointmentsEnabled).toBe(false);
  });
});

describe("arquitecturaAprobadaPara: citas", () => {
  const config = arquitecturaAprobadaPara("citas");

  it("contrata citas y nace con el estado en tablas", () => {
    expect(config.appointmentsEnabled).toBe(true);
    expect(config.stateSource).toBe("backend");
  });

  it("NO fuerza mecanismos exclusivos de pedidos", () => {
    // Son conceptos que en citas no tienen ningún efecto (pipeline.ts los
    // guarda tras `!contrataCitas(vertical)`): deben quedar en su valor
    // neutro de siempre, nunca "encendidos" sin sentido.
    expect(config.catalogSource).toBe("prompt");
    expect(config.paymentSource).toBe("prompt");
    expect(config.consultasVerificadasEnabled).toBe(false);
  });
});
