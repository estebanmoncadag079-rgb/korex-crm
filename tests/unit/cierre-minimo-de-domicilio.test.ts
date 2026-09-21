/**
 * El backend no deja cerrar un domicilio que no llega al pedido mínimo.
 *
 * El negocio (MALIA, 21-sep-2026) decidió que esta regla la debe hacer
 * cumplir el backend y no el prompt: *"no hacemos domicilios para un solo
 * pavé de 8 oz"*. Mientras vivía en `reglasPropias` la aplicaba el modelo,
 * y cada despiste suyo era un domiciliario enviado por $10.000.
 *
 * Aquí se fija el contrato en la Policy, que es la autoridad del cierre.
 * `faltaParaElMinimoDeDomicilio` (probado aparte) decide el *si*; esto
 * comprueba que la Policy lo *use* y que no rompa nada de lo que ya hacía.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/ai/confirmacion-de-pedido", () => ({
  ultimaConfirmacionDe: vi.fn(async () => null),
  registrarConfirmacionDePedido: vi.fn(),
  borrarConfirmacionDePedido: vi.fn(),
  intentarNotificarPedido: vi.fn(),
}));

import { puedeConfirmarPedido } from "@/server/orders/policy";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import { MODALIDAD_DOMICILIO, MODALIDAD_RECOGIDA } from "@/server/ai/generador/ficha";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

const PAVE_8: ProductoDelCatalogo = {
  id: "prod_8",
  nombre: "Pavé Cremoso 8 oz",
  categoria: "Pavés",
  precioCents: 1000000,
  descripcion: null,
  grupos: [],
};

/** Un estado cerrable: un ítem resuelto, total calculado, sin requisitos. */
function estadoCon(over: Partial<EstadoDelPedido> = {}): EstadoDelPedido {
  return {
    ...estadoVacio(),
    items: [
      {
        ofrecible: { id: "prod_8", nombre: "Pavé Cremoso 8 oz" },
        cantidad: 1,
        seleccion: [],
        totalCents: 1000000,
      },
    ],
    totalCents: 1000000,
    modalidadDeEntrega: MODALIDAD_DOMICILIO,
    confirmado: true,
    ...over,
  };
}

const juzgar = (estado: EstadoDelPedido | null, minimoDomicilioCents?: number) =>
  puedeConfirmarPedido({
    conversationId: "cv_test",
    productosDelPedido: [PAVE_8],
    history: [],
    estadoGuardado: estado,
    requisitos: [],
    minimoDomicilioCents,
  });

beforeEach(() => vi.clearAllMocks());

describe("puedeConfirmarPedido · pedido mínimo para domicilio", () => {
  it("RECHAZA un domicilio por debajo del mínimo, y dice cuánto falta", async () => {
    const v = await juzgar(estadoCon(), 1800000);
    if (v.ok) throw new Error("se esperaba un rechazo");
    expect(v.motivo).toContain("mínimo");
    // La corrección va al modelo: tiene que poder decírselo al cliente con
    // una cifra concreta, no con un "no se puede".
    expect(v.correccion).toContain("$8.000");
    expect(v.correccion).toContain("$18.000");
  });

  it("ACEPTA cuando el subtotal iguala el mínimo (un pavé de 16 oz)", async () => {
    const v = await juzgar(estadoCon({ totalCents: 1800000 }), 1800000);
    expect(v.ok).toBe(true);
  });

  it("ACEPTA cuando lo supera (dos de 8 oz)", async () => {
    const v = await juzgar(estadoCon({ totalCents: 2000000 }), 1800000);
    expect(v.ok).toBe(true);
  });

  it("NO se aplica a recogida: el mínimo es del domicilio", async () => {
    const v = await juzgar(estadoCon({ modalidadDeEntrega: MODALIDAD_RECOGIDA }), 1800000);
    expect(v.ok).toBe(true);
  });

  it("NO se aplica si el negocio no configuró mínimo", async () => {
    expect((await juzgar(estadoCon(), undefined)).ok).toBe(true);
    expect((await juzgar(estadoCon(), 0)).ok).toBe(true);
  });

  it("NO se aplica con `state_source='prompt'` — sin estado no hay subtotal que juzgar", async () => {
    // Es el caso de toda la flota salvo MALIA. Esta Policy no puede empezar a
    // exigir algo nuevo a quien no tiene estado en el backend.
    const v = await juzgar(null, 1800000);
    expect(v.ok).toBe(true);
  });

  it("el guardarraíl del total sin calcular sigue ganando al del mínimo", async () => {
    // Un pedido sin total no se rechaza por "no llega al mínimo" —sería un
    // diagnóstico falso— sino por lo que de verdad le pasa.
    const v = await juzgar(estadoCon({ totalCents: null }), 1800000);
    if (v.ok) throw new Error("se esperaba un rechazo");
    expect(v.motivo).toContain("total");
    expect(v.motivo).not.toContain("mínimo");
  });

  it("el guardarraíl de ítems vacíos sigue ganando al del mínimo", async () => {
    const v = await juzgar(estadoCon({ items: [], totalCents: null }), 1800000);
    if (v.ok) throw new Error("se esperaba un rechazo");
    expect(v.motivo).toContain("ítems");
  });
});
