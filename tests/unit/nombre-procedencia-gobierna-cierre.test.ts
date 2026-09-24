import { describe, expect, it, vi } from "vitest";

// Corta la cadena de imports que valida el entorno al cargar la Policy — mismo
// mock que `cierre-minimo-de-domicilio.test.ts`.
vi.mock("@/server/ai/confirmacion-de-pedido", () => ({
  ultimaConfirmacionDe: vi.fn(async () => null),
  registrarConfirmacionDePedido: vi.fn(),
  borrarConfirmacionDePedido: vi.fn(),
  intentarNotificarPedido: vi.fn(),
}));

import { comoTexto, loQueFalta, requisitosPendientesDe } from "@/server/orders/extraer";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";
import { puedeConfirmarPedido } from "@/server/orders/policy";
import type { Requisito } from "@/server/ai/generador/ficha";

/**
 * Bloqueador 2 de la última auditoría: la procedencia del nombre tiene que
 * GOBERNAR el cierre, no solo la escritura.
 *
 * La Compuerta 4 impedía escribir un nombre sin procedencia — pero un estado
 * HEREDADO (guardado antes de que existiera `procedenciaDelNombre`) tenía
 * `datos.nombre` y ninguna procedencia, y todos los consumidores del requisito
 * lo daban por satisfecho: `requisitosPendientesDe`, `loQueFalta`, el bloque de
 * estado y el guardarraíl de cierre. Eso contradice el objetivo: un valor sin
 * procedencia NO está confirmado.
 *
 * La regla, en el flujo con estado en el backend (pedidos):
 *
 *   nombre confirmado  ⟺  datos.nombre existe  Y  procedenciaDelNombre === "cliente"
 *
 * En el resto (prompt, citas) no hay procedencia que exigir, así que la
 * comprobación se activa SOLO cuando el llamador la pide (`exigir = true`).
 */
const NOMBRE: Requisito = { id: "nombre", tipo: "texto", etiqueta: "el nombre de quien lo pide", obligatorio: true };
const TEL: Requisito = { id: "telefono", tipo: "telefono", etiqueta: "el celular", obligatorio: true };

const conNombre = (extra: Partial<EstadoDelPedido> = {}): EstadoDelPedido => ({
  ...estadoVacio(),
  items: [{ ofrecible: { id: "p1", nombre: "Cremoso 7 oz" }, cantidad: 1, seleccion: [], gruposDeclinados: [], totalCents: 1200000 }],
  totalCents: 1200000,
  datos: { nombre: "Juan Pérez", telefono: "3155551234" },
  ...extra,
});

/** Heredado: tiene el valor pero NINGUNA procedencia. */
const HEREDADO = conNombre();
/** Confirmado: valor + procedencia del cliente. */
const CONFIRMADO = conNombre({ procedenciaDelNombre: "cliente" });

describe("requisitosPendientesDe respeta la procedencia cuando se le exige", () => {
  it("nombre heredado SIN procedencia → sigue pendiente", () => {
    const pend = requisitosPendientesDe(HEREDADO, [NOMBRE, TEL], true);
    expect(pend?.map((r) => r.id)).toContain("nombre");
  });

  it("nombre CON procedencia → deja de estar pendiente", () => {
    const pend = requisitosPendientesDe(CONFIRMADO, [NOMBRE, TEL], true);
    expect(pend?.map((r) => r.id)).not.toContain("nombre");
  });

  it("sin exigir procedencia (prompt/citas), el valor basta: no se rompe el flujo viejo", () => {
    const pend = requisitosPendientesDe(HEREDADO, [NOMBRE, TEL]);
    expect(pend?.map((r) => r.id)).not.toContain("nombre");
  });

  it("otros requisitos no se ven afectados por la regla del nombre", () => {
    const pend = requisitosPendientesDe(HEREDADO, [NOMBRE, TEL], true);
    // El teléfono está en datos → satisfecho, con o sin procedencia.
    expect(pend?.map((r) => r.id)).not.toContain("telefono");
  });
});

describe("loQueFalta y el bloque de estado enseñan el nombre como pendiente sin procedencia", () => {
  it("loQueFalta incluye el nombre heredado cuando se exige procedencia", () => {
    const falta = loQueFalta(HEREDADO, [], [NOMBRE, TEL], "pedidos", true);
    expect(falta).toContain("el nombre de quien lo pide");
  });

  it("comoTexto lo pone en TE FALTA cuando se exige procedencia", () => {
    const texto = comoTexto(HEREDADO, [], [NOMBRE, TEL], "pedidos", undefined, true);
    const falta = texto.split("TE FALTA")[1] ?? "";
    expect(falta).toContain("el nombre de quien lo pide");
  });

  it("con procedencia, comoTexto ya no lo pide", () => {
    const texto = comoTexto(CONFIRMADO, [], [NOMBRE, TEL], "pedidos", undefined, true);
    const falta = texto.split("TE FALTA")[1] ?? "";
    expect(falta).not.toContain("el nombre de quien lo pide");
  });
});

describe("puedeConfirmarPedido no cierra con un nombre sin procedencia", () => {
  const base = {
    conversationId: "cv_1",
    productosDelPedido: [{ id: "p1", nombre: "Cremoso 7 oz", categoria: null, precioCents: 1200000, descripcion: null, grupos: [] }],
    history: [{ direction: "in", text: "confirmo", createdAt: new Date() }],
  };

  it("nombre heredado sin procedencia → rechaza el cierre, pidiéndolo", async () => {
    const v = await puedeConfirmarPedido({ ...base, estadoGuardado: HEREDADO, requisitos: [NOMBRE, TEL] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motivo).toMatch(/nombre/);
  });

  it("nombre con procedencia → ese requisito ya no bloquea", async () => {
    const v = await puedeConfirmarPedido({ ...base, estadoGuardado: CONFIRMADO, requisitos: [NOMBRE, TEL] });
    expect(v.ok).toBe(true);
  });

  it("EL DETECTOR DETECTA: mismo estado, la procedencia decide si cierra", async () => {
    const sin = await puedeConfirmarPedido({ ...base, estadoGuardado: HEREDADO, requisitos: [NOMBRE, TEL] });
    const con = await puedeConfirmarPedido({ ...base, estadoGuardado: CONFIRMADO, requisitos: [NOMBRE, TEL] });
    expect(sin.ok).toBe(false);
    expect(con.ok).toBe(true);
  });
});
