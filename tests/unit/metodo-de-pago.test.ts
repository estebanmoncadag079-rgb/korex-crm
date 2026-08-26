import { describe, expect, it } from "vitest";

/**
 * `resolverMetodoDePago` es el hecho verificado que reemplaza la súplica de
 * texto del prompt para el caso real que lo originó (24-ago-2026, Lis): la
 * ficha solo declaraba "transferencia", el cliente preguntó por Nequi, y el
 * modelo respondió que no se aceptaba sin reconocer que Nequi ES transferir.
 */

import { resolverMetodoDePago } from "@/server/pagos/metodo";

describe("resolverMetodoDePago", () => {
  it("reconoce Nequi como transferencia cuando la ficha declara 'transferencia'", () => {
    const r = resolverMetodoDePago("Transferencia bancaria", "Nequi");
    expect(r).toEqual({ status: "recognized", method: "Nequi", allowed: true });
  });

  it("coincidencia literal: el negocio ya nombró exactamente ese método", () => {
    const r = resolverMetodoDePago("Efectivo o Nequi", "Nequi");
    expect(r).toEqual({ status: "recognized", method: "Nequi", allowed: true });
  });

  it("reconoce el método pero lo marca no permitido si el negocio no lo declaró", () => {
    const r = resolverMetodoDePago("Solo efectivo", "tarjeta de crédito");
    expect(r).toEqual({ status: "recognized", method: "tarjeta de crédito", allowed: false });
  });

  it("no reconoce un método fuera del diccionario de sinónimos", () => {
    expect(resolverMetodoDePago("Solo efectivo", "criptomonedas")).toEqual({ status: "unknown" });
  });

  it("con una mención vacía, es 'unknown'", () => {
    expect(resolverMetodoDePago("Transferencia", "   ")).toEqual({ status: "unknown" });
  });

  it("Daviplata también cae en la categoría transferencia", () => {
    const r = resolverMetodoDePago("Aceptamos transferencia", "Daviplata");
    expect(r).toEqual({ status: "recognized", method: "Daviplata", allowed: true });
  });
});
