import { describe, expect, it } from "vitest";
import {
  bloqueDeCifrasVerificadas,
  bloqueDeDomicilioPendiente,
} from "@/server/ai/anuncio-de-cierre";

/**
 * Fase 8D (19-sep-2026) — lo que de verdad LEE EL CLIENTE cuando el
 * domicilio está pendiente.
 *
 * El `summary` del cierre va al equipo (`pipeline.ts:470`); al cliente le
 * llega el `farewell`. Desde el doc 176 el backend adjunta sus propias
 * cifras a los dos, y ese bloque es lo que hace imposible la clase de
 * incidentes del 8 al 15-sep: el número que lee el cliente ya no lo escribe
 * el modelo.
 *
 * El hueco que cerró esta fase: `bloqueDeCifrasVerificadas` devolvía `null`
 * en cuanto el domicilio no tenía tarifa verificada. Para La Churra y Lis
 * ese es el caso NORMAL —lo cotiza Uber/Yango/DiDi—, así que justo donde
 * menos respaldo había, el backend no decía nada y el texto libre del
 * modelo quedaba como única cifra del cierre.
 *
 * No se bloquea ni se rehace ningún pedido por esto: el cierre sigue su
 * camino y lo que cambia es que termina con una cifra del backend.
 */

const SUBTOTAL = 2000000; // $20.000

describe("domicilio PENDIENTE: el backend sí escribe, y dice que está pendiente", () => {
  it("nombra el domicilio como pendiente en vez de callarse", () => {
    const bloque = bloqueDeDomicilioPendiente({
      subtotalCents: SUBTOTAL,
      entrega: { tipo: "domicilio", feeCents: null },
    });
    expect(bloque).not.toBeNull();
    expect(bloque).toContain("pendiente de cotización");
  });

  it("separa el subtotal de productos del domicilio, y NO afirma un total con domicilio", () => {
    const bloque = bloqueDeDomicilioPendiente({
      subtotalCents: SUBTOTAL,
      entrega: { tipo: "domicilio", feeCents: null },
    })!;
    expect(bloque).toContain("Subtotal de productos: $20.000");
    expect(bloque).toContain("pendiente de cotización");
    // Y NUNCA un total que incluya un domicilio que nadie conoce.
    expect(bloque).not.toMatch(/Total:/);
  });

  it("no inventa ninguna cifra de domicilio", () => {
    const bloque = bloqueDeDomicilioPendiente({
      subtotalCents: SUBTOTAL,
      entrega: { tipo: "domicilio", feeCents: null },
    })!;
    // Solo puede aparecer el subtotal. Ninguna otra cantidad.
    const cifras = [...bloque.matchAll(/\$[\d.,]+/g)].map((m) => m[0]);
    expect(new Set(cifras)).toEqual(new Set(["$20.000"]));
  });
});

/**
 * La mitad que importa tanto como la otra: nada de esto puede cambiar el
 * comportamiento de MALIA, que sí tiene tabla de zonas.
 */
describe("el desacoplamiento que protege a MALIA", () => {
  /**
   * Cazado por `cifras-las-escribe-el-backend.test.ts` durante la auditoría:
   * si la aclaración de "pendiente" saliera por `bloqueDeCifrasVerificadas`,
   * ese bloque pasaría a existir y `cifrasLasEscribeElBackend` se pondría en
   * `true` — apagando los chequeos de TEXTO del cierre. Para un negocio CON
   * tabla cuyo domicilio aún no resolvió (MALIA preguntando una zona), eso
   * sería perder la verificación justo donde hace falta.
   */
  it("bloqueDeCifrasVerificadas sigue devolviendo null con domicilio pendiente", () => {
    expect(
      bloqueDeCifrasVerificadas({
        subtotalCents: SUBTOTAL,
        entrega: { tipo: "domicilio", feeCents: null },
      })
    ).toBeNull();
  });

  it("y la aclaración va por su propia función, sin tocar ese interruptor", () => {
    expect(
      bloqueDeDomicilioPendiente({
        subtotalCents: SUBTOTAL,
        entrega: { tipo: "domicilio", feeCents: null },
      })
    ).not.toBeNull();
  });

  it("con tarifa verificada, la función de pendiente no dice nada (no duplica)", () => {
    expect(
      bloqueDeDomicilioPendiente({
        subtotalCents: SUBTOTAL,
        entrega: { tipo: "domicilio", feeCents: 800000 },
      })
    ).toBeNull();
  });

  it("en recogida tampoco dice nada", () => {
    expect(
      bloqueDeDomicilioPendiente({ subtotalCents: SUBTOTAL, entrega: { tipo: "recogida", feeCents: null } })
    ).toBeNull();
  });
});

describe("sin regresión: la tarifa verificada sigue funcionando igual", () => {
  it("con tarifa verificada escribe domicilio y total, como siempre", () => {
    const bloque = bloqueDeCifrasVerificadas({
      subtotalCents: SUBTOTAL,
      entrega: { tipo: "domicilio", feeCents: 800000 },
    })!;
    expect(bloque).toContain("Domicilio: $8.000");
    expect(bloque).toContain("Total: $28.000");
    expect(bloque).not.toContain("pendiente");
  });

  it("un domicilio de verdad GRATIS ($0) no es lo mismo que pendiente", () => {
    // `0` es una tarifa real (zona gratis); `null` es "no se sabe todavía".
    // Confundirlos sería regalar domicilios o cobrar los que no se cobran.
    const bloque = bloqueDeCifrasVerificadas({
      subtotalCents: SUBTOTAL,
      entrega: { tipo: "domicilio", feeCents: 0 },
    })!;
    expect(bloque).toContain("Domicilio: $0");
    expect(bloque).toContain("Total: $20.000");
    expect(bloque).not.toContain("pendiente");
  });

  it("recogida sigue diciendo que no hay domicilio", () => {
    const bloque = bloqueDeCifrasVerificadas({
      subtotalCents: SUBTOTAL,
      entrega: { tipo: "recogida", feeCents: null },
    })!;
    expect(bloque).toContain("Recoges en el local");
    expect(bloque).toContain("Total: $20.000");
  });

  it("sin subtotal calculado sigue sin escribir nada (no hay nada que afirmar)", () => {
    expect(
      bloqueDeCifrasVerificadas({ subtotalCents: undefined, entrega: { tipo: "domicilio", feeCents: null } })
    ).toBeNull();
  });

  it("sin modalidad resuelta, solo el total de productos — comportamiento previo intacto", () => {
    const bloque = bloqueDeCifrasVerificadas({ subtotalCents: SUBTOTAL, entrega: null })!;
    expect(bloque).toContain("Total: $20.000");
    expect(bloque).not.toContain("pendiente");
  });
});
