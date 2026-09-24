import { describe, expect, it } from "vitest";
import { aplanar, estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";

/**
 * Que un cambio de modalidad se vea en el registro de cambios.
 *
 * `aplanar()` es lo que convierte el estado en las claves que el registro
 * compara turno a turno: así el log dice "cambió `datos.telefono`" en vez de
 * "el pedido es distinto". Exponía `entrega.tipo`, `entrega.zonaNombre` y
 * `entrega.feeCents` —lo VERIFICADO— pero no `modalidadDeEntrega` —lo que el
 * cliente ELIGIÓ—.
 *
 * Eso no es cosmético: el 23-sep-2026, diagnosticando por qué el agente de Lis
 * repreguntaba la modalidad, el registro de cambios no servía para saber si el
 * backend la había guardado. Hubo que abrir el JSON del estado a mano. Una
 * observabilidad que obliga a la inspección forense no es observabilidad.
 *
 * ⚠️ El log NO es fuente de verdad. La fuente sigue siendo el estado
 * persistido; esto solo lo hace legible.
 */
const conModalidad = (m: string | null): EstadoDelPedido => ({
  ...estadoVacio(),
  modalidadDeEntrega: m,
});

describe("aplanar: la modalidad elegida es observable", () => {
  it("expone modalidadDeEntrega", () => {
    expect(aplanar(conModalidad("domicilio"))).toMatchObject({
      modalidadDeEntrega: "domicilio",
    });
  });

  it("un cambio null → domicilio se ve comparando las dos claves", () => {
    const antes = aplanar(conModalidad(null));
    const despues = aplanar(conModalidad("domicilio"));
    expect(antes.modalidadDeEntrega).toBeNull();
    expect(despues.modalidadDeEntrega).toBe("domicilio");
    expect(antes.modalidadDeEntrega).not.toBe(despues.modalidadDeEntrega);
  });

  it("y un cambio domicilio → recogida también", () => {
    expect(aplanar(conModalidad("domicilio")).modalidadDeEntrega).not.toBe(
      aplanar(conModalidad("recogida")).modalidadDeEntrega
    );
  });

  it("ausente se aplana a null, no a undefined: una clave que falta no se compara", () => {
    expect(aplanar(estadoVacio())).toMatchObject({ modalidadDeEntrega: null });
  });

  it("REGRESIÓN: las claves de la entrega verificada siguen ahí, y son otras", () => {
    const plano = aplanar({
      ...estadoVacio(),
      modalidadDeEntrega: "domicilio",
      entrega: {
        tipo: "domicilio",
        zonaId: "dz_1",
        zonaNombre: "Villa del Sur",
        feeCents: 800000,
        verificadoEnMensajeId: "msg_1",
        verificadoEn: "2026-09-10T14:00:00.000Z",
      },
    });
    expect(plano).toMatchObject({
      modalidadDeEntrega: "domicilio",
      "entrega.tipo": "domicilio",
      "entrega.zonaNombre": "Villa del Sur",
      "entrega.feeCents": 800000,
    });
  });

  it("sin estado, no hay claves que comparar", () => {
    expect(aplanar(null)).toEqual({});
  });
});
