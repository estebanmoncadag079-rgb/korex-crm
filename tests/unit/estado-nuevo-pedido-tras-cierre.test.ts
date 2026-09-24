import { describe, expect, it } from "vitest";
import { estadoParaNuevoPedido, estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";

/**
 * Un SEGUNDO pedido en la misma conversación no puede apilarse sobre el primero.
 *
 * Incidente real (MALIA, 24-sep-2026, Ricardo Paz, conv cv_jt843j873soytzwh8pzf):
 * el cliente hizo y pagó un pedido; al pedir otro en la misma conversación, el
 * segundo se SUMÓ al primero — el estado quedó con 9 ítems y $120.000 mientras
 * el bot mostraba 4 ítems y $48.000. Al confirmar, el guardarraíl financiero vio
 * la inconsistencia y derivó a una persona. El pedido nunca se reiniciaba tras
 * cerrarse.
 *
 * `estadoParaNuevoPedido` deja el pedido limpio para empezar de cero, PERO
 * conserva quién es el cliente (sus datos y la procedencia del nombre): un
 * cliente recurrente no tiene que volver a dar su nombre y teléfono.
 */
const confirmado: EstadoDelPedido = {
  ...estadoVacio(),
  items: [
    { ofrecible: { id: "p1", nombre: "Pavé 16 oz" }, cantidad: 1, seleccion: [], gruposDeclinados: [], totalCents: 2000000 },
  ],
  datos: { nombre: "Ricardo Paz", telefono: "573192244836", direccion: "Cra 46 #9c 85" },
  procedenciaDelNombre: "cliente",
  modalidadDeEntrega: "domicilio",
  entrega: {
    tipo: "domicilio",
    zonaId: "dz_1",
    zonaNombre: "Los Cámbulos",
    feeCents: 800000,
    verificadoEn: "2026-09-24T20:10:59.333Z",
    verificadoEnMensajeId: "msg_x",
  },
  paraRegalo: true,
  totalCents: 2000000,
  paso: "confirmado",
  confirmado: true,
};

describe("estadoParaNuevoPedido: el pedido se reinicia, el cliente se conserva", () => {
  const nuevo = estadoParaNuevoPedido(confirmado);

  it("vacía los ítems del pedido anterior", () => {
    expect(nuevo.items).toEqual([]);
    expect(nuevo.totalCents).toBeNull();
  });

  it("desmarca confirmado y el regalo", () => {
    expect(nuevo.confirmado).toBe(false);
    expect(nuevo.paraRegalo).toBeUndefined();
  });

  it("suelta la modalidad y la entrega verificada del pedido anterior", () => {
    expect(nuevo.modalidadDeEntrega).toBeNull();
    expect(nuevo.entrega).toBeNull();
  });

  it("CONSERVA los datos del cliente y la procedencia del nombre", () => {
    expect(nuevo.datos).toEqual({ nombre: "Ricardo Paz", telefono: "573192244836", direccion: "Cra 46 #9c 85" });
    expect(nuevo.procedenciaDelNombre).toBe("cliente");
  });

  it("no arrastra la reserva ni deja el paso en 'confirmado'", () => {
    expect(nuevo.reserva).toBeNull();
    expect(nuevo.paso).not.toBe("confirmado");
  });
});
