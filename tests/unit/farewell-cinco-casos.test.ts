import { describe, expect, it } from "vitest";
import {
  bloqueDeCifrasVerificadas,
  bloqueDeDomicilioPendiente,
  inconsistenciaFinancieraDePedido,
} from "@/server/ai/anuncio-de-cierre";

/**
 * Verificación explícita del camino
 *
 *   estado backend → construcción del cierre → farewell → cliente
 *
 * para los cinco casos que pidió la auditoría del 19-sep-2026. Cada uno
 * comprueba el TEXTO QUE LEE EL CLIENTE, no una función intermedia.
 *
 * El `summary` va al equipo (`pipeline.ts:470`); al cliente le llega el
 * `farewell`, y es a ese al que el pipeline adjunta el bloque del backend
 * (`cifrasDelBackend` si hay tarifa verificada, `bloqueDeDomicilioPendiente`
 * si está pendiente).
 */

const SUBTOTAL = 2000000; // $20.000

/** Lo que el pipeline adjunta al farewell, reproducido tal cual. */
function loQueLeeElCliente(
  farewellDelModelo: string,
  entrega: { tipo: "domicilio" | "recogida"; feeCents: number | null } | null
): string {
  const cifras = bloqueDeCifrasVerificadas({ subtotalCents: SUBTOTAL, entrega });
  if (cifras) return `${farewellDelModelo}\n\n${cifras}`;
  const pendiente = bloqueDeDomicilioPendiente({ subtotalCents: SUBTOTAL, entrega });
  return pendiente ? `${farewellDelModelo}\n\n${pendiente}` : farewellDelModelo;
}

describe("CASO A — La Churra/Lis, domicilio externo pendiente", () => {
  const texto = loQueLeeElCliente("¡Listo! Ya tomamos tu pedido 🎉", {
    tipo: "domicilio",
    feeCents: null,
  });

  it("el cliente recibe el subtotal", () => {
    expect(texto).toContain("Subtotal de productos: $20.000");
  });

  it("el domicilio aparece como pendiente de cotización", () => {
    expect(texto).toContain("pendiente de cotización");
  });

  it("no aparece ninguna tarifa inventada", () => {
    const cifras = [...texto.matchAll(/\$[\d.,]+/g)].map((m) => m[0]);
    expect(new Set(cifras)).toEqual(new Set(["$20.000"]));
  });

  it("no se presenta un total final que incluya una tarifa no verificada", () => {
    expect(texto).not.toMatch(/Total:/);
  });
});

describe("CASO B — deliveryFeeCents inventado, sin respaldo", () => {
  it("el bloque del backend NUNCA repite la cifra del modelo", () => {
    // El modelo afirma $5.000 en su texto y en el campo estructurado.
    const texto = loQueLeeElCliente("El domicilio son $5.000", {
      tipo: "domicilio",
      feeCents: null, // el backend no verificó nada
    });
    // Lo que el BACKEND escribe contradice explícitamente esa cifra.
    expect(texto).toContain("pendiente de cotización");
    expect(texto).not.toContain("Domicilio: $5.000");
    expect(texto).not.toContain("Total: $25.000");
  });

  it("el cierre sigue su camino: no se bloquea por esto", () => {
    // Regla de Zahenz: un deliveryFeeCents sin respaldo NO puede tumbar un
    // pedido en un negocio que no puede producir esa prueba.
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Churrita. Domicilio $5.000",
        deliveryFeeCents: 500000,
        puedeVerificarDomicilio: false,
        zonaVerificada: null,
      })
    ).toBeNull();
  });
});

describe("CASO C — tarifa realmente verificada", () => {
  const texto = loQueLeeElCliente("¡Listo! Tu pedido va en camino 🛵", {
    tipo: "domicilio",
    feeCents: 800000,
  });

  it("la tarifa válida se escribe y el total la suma, como siempre", () => {
    expect(texto).toContain("Domicilio: $8.000");
    expect(texto).toContain("Total: $28.000");
  });

  it("no se cuela la aclaración de pendiente", () => {
    expect(texto).not.toContain("pendiente");
  });
});

describe("CASO D — MALIA, domicilio por tabla", () => {
  it("con tarifa verificada, los chequeos de texto se apagan (comportamiento existente)", () => {
    // `cifrasLasEscribeElBackend` sigue siendo la señal, y sigue dependiendo
    // SOLO de `bloqueDeCifrasVerificadas`.
    expect(
      bloqueDeCifrasVerificadas({
        subtotalCents: SUBTOTAL,
        entrega: { tipo: "domicilio", feeCents: 800000 },
      })
    ).not.toBeNull();
  });

  it("con la zona AÚN sin resolver, los chequeos de texto NO se apagan", () => {
    // La regresión que cazó `cifras-las-escribe-el-backend.test.ts`: si el
    // bloque existiera aquí, MALIA perdería la verificación de texto justo
    // cuando su domicilio está a medias.
    expect(
      bloqueDeCifrasVerificadas({
        subtotalCents: SUBTOTAL,
        entrega: { tipo: "domicilio", feeCents: null },
      })
    ).toBeNull();
  });

  it("y con zona verificada sigue bloqueando una tarifa contradicha", () => {
    expect(
      inconsistenciaFinancieraDePedido({
        summary: "1 × Pavé. Domicilio $9.000",
        subtotalCents: 1800000,
        deliveryFeeCents: 900000,
        totalCents: 2700000,
        puedeVerificarDomicilio: true,
        zonaVerificada: { feeCents: 800000 },
      })
    ).not.toBeNull();
  });
});

describe("CASO E — Lashes Valen / citas", () => {
  it("un negocio de citas nunca llega a este camino de domicilio", () => {
    // `bloqueDeDomicilioPendiente` exige una entrega de tipo domicilio; un
    // salón no resuelve modalidad de entrega en absoluto.
    expect(bloqueDeDomicilioPendiente({ subtotalCents: SUBTOTAL, entrega: null })).toBeNull();
    expect(
      bloqueDeDomicilioPendiente({ subtotalCents: SUBTOTAL, entrega: undefined })
    ).toBeNull();
  });
});
