import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 1 del plan de `docs/korexia/156`: la decisión de si un turno puede
 * confirmar un pedido salió de `pipeline.ts` a `orders/policy.ts`.
 *
 * Antes esta regla solo se podía probar montando el pipeline entero —modelo
 * simulado, historial, catálogo, estado— y por eso nunca se probó sola. Ahora
 * es una función pura sobre datos, y estas seis comprobaciones cubren los
 * cuatro caminos que tiene.
 *
 * El incidente que la trajo (5-sep-2026, Caso B): un mensaje del cliente
 * DESPUÉS de un cierre exitoso reabría la confirmación, y el equipo recibía el
 * mismo pedido dos veces.
 */

const ultimaConfirmacionDeMock = vi.fn();
vi.mock("@/server/ai/confirmacion-de-pedido", () => ({
  ultimaConfirmacionDe: (...a: unknown[]) => ultimaConfirmacionDeMock(...a),
  registrarConfirmacionDePedido: vi.fn(),
  borrarConfirmacionDePedido: vi.fn(),
  intentarNotificarPedido: vi.fn(),
}));

import { puedeConfirmarPedido } from "@/server/orders/policy";
import type { ProductoDelCatalogo } from "@/server/catalog/queries";

const CATALOGO: ProductoDelCatalogo[] = [
  {
    id: "p1",
    nombre: "Pavé Cremoso 8 oz",
    categoria: "Pavés",
    precioCents: 1000000,
    descripcion: null,
    grupos: [],
  },
];

const AYER = new Date("2026-09-08T10:00:00Z");
const HOY = new Date("2026-09-08T12:00:00Z");

const mensaje = (direction: "in" | "out", text: string | null, createdAt: Date) => ({
  direction,
  text,
  createdAt,
});

beforeEach(() => {
  ultimaConfirmacionDeMock.mockReset();
});

describe("puedeConfirmarPedido", () => {
  it("sin confirmación previa, cierra sin preguntar nada", async () => {
    ultimaConfirmacionDeMock.mockResolvedValue(null);
    const v = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: [mensaje("in", "quiero un pavé de 8 oz", HOY)],
    });
    expect(v.ok).toBe(true);
  });

  it("EL INCIDENTE: ya cerró y el cliente solo comenta — se rechaza", async () => {
    ultimaConfirmacionDeMock.mockResolvedValue({ id: "oc_1", createdAt: AYER });
    const v = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: [
        mensaje("in", "quiero un pavé de 8 oz", AYER),
        mensaje("in", "muchas gracias!", HOY),
        mensaje("in", "a qué hora llega?", HOY),
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.motivo).toContain("oc_1");
      expect(v.correccion).toMatch(/no vuelvas a usar la acción notify_order/i);
    }
  });

  it("ya cerró pero el cliente nombra un producto del catálogo — es un pedido NUEVO, pasa", async () => {
    ultimaConfirmacionDeMock.mockResolvedValue({ id: "oc_1", createdAt: AYER });
    const v = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: [
        mensaje("in", "quiero un pavé de 8 oz", AYER),
        mensaje("in", "oye, me mandas otro pavé cremoso de 8 oz?", HOY),
      ],
    });
    expect(v.ok).toBe(true);
  });

  it("un producto nombrado ANTES de la confirmación no cuenta como pedido nuevo", async () => {
    // La ventana es estrictamente posterior: si no, el propio mensaje que
    // originó el pedido cerrado lo desbloquearía siempre y el guardarraíl no
    // serviría para nada.
    ultimaConfirmacionDeMock.mockResolvedValue({ id: "oc_1", createdAt: HOY });
    const v = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: [mensaje("in", "quiero un pavé cremoso de 8 oz", AYER)],
    });
    expect(v.ok).toBe(false);
  });

  it("lo que escribe el NEGOCIO no desbloquea nada: solo cuenta el cliente", async () => {
    ultimaConfirmacionDeMock.mockResolvedValue({ id: "oc_1", createdAt: AYER });
    const v = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: CATALOGO,
      history: [mensaje("out", "¿te mando otro Pavé Cremoso 8 oz?", HOY)],
    });
    expect(v.ok).toBe(false);
  });

  it("sin catálogo en tabla no se bloquea nada, y ni siquiera se consulta la base", async () => {
    // Sin catálogo real contra qué verificar no hay forma de reconocer "pedido
    // nuevo" sin volver a comparar texto libre, que es lo que causó el
    // incidente. Se deja pasar a propósito — y se comprueba que no gasta una
    // consulta averiguándolo.
    const v = await puedeConfirmarPedido({
      conversationId: "cv_1",
      productosDelPedido: [],
      history: [mensaje("in", "gracias", HOY)],
    });
    expect(v.ok).toBe(true);
    expect(ultimaConfirmacionDeMock).not.toHaveBeenCalled();
  });
});
