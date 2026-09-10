import { describe, expect, it } from "vitest";
import { comoTexto } from "@/server/orders/extraer";
import { estadoVacio, type EstadoDelPedido } from "@/server/orders/estado";

/**
 * Que el bloque "PEDIDO EN CURSO" cuente cómo se entrega el pedido.
 *
 * Hasta el 10-sep-2026 no decía nada de la entrega: ni modalidad, ni zona, ni
 * tarifa. El backend sí lo sabía —`estado.entrega`, y los guardarraíles del
 * cierre validan contra él— pero ese dato viajaba por una tubería que solo
 * persistía y validaba, nunca por la que informa al modelo.
 *
 * Consecuencia medida: tres pedidos perdidos en dos días (MALIA, 9 y
 * 10-sep-2026), los tres cerrando sin cobrar un domicilio que estaba
 * verificado, siempre después de que el cliente se saliera del guion —"déjame
 * el pedido así tal cual", "se equivocó de nombre", "cuánto es en total?"—.
 * Se le exigía al modelo un dato que no se le daba.
 *
 * Esto solo REPRESENTA lo que ya existe. Por eso la primera prueba, la que
 * fija que sin entrega el bloque sale idéntico, es la más importante: cuatro
 * de los cinco negocios y todo el vertical de citas caen ahí.
 */
const PAVE = { id: "p1", nombre: "Pavé Cremoso 8 oz" };

function pedido(entrega?: EstadoDelPedido["entrega"]): EstadoDelPedido {
  return {
    ...estadoVacio(),
    items: [
      {
        ofrecible: PAVE,
        cantidad: 2,
        seleccion: [],
        gruposDeclinados: [],
        totalCents: 2000000,
      },
    ],
    totalCents: 2000000,
    entrega,
  };
}

const VERIFICADO = {
  tipo: "domicilio" as const,
  zonaId: "dz_1",
  zonaNombre: "Villa del Sur",
  feeCents: 800000,
  verificadoEnMensajeId: "msg_1",
  verificadoEn: "2026-09-10T14:00:00.000Z",
};

describe("la entrega en el bloque PEDIDO EN CURSO", () => {
  it("SIN entrega, el bloque sale EXACTAMENTE como salía antes", () => {
    // El caso de los cuatro negocios en delivery_source='prompt' y de todo el
    // vertical de citas. Si esto cambia, el cambio dejó de ser aditivo.
    const texto = comoTexto(pedido(undefined));
    expect(texto).not.toMatch(/ENTREGA/);
    expect(comoTexto(pedido(null))).toBe(texto);
  });

  it("domicilio VERIFICADO: dice modalidad, zona y tarifa", () => {
    const texto = comoTexto(pedido(VERIFICADO));
    expect(texto).toContain("ENTREGA: domicilio a Villa del Sur");
    expect(texto).toContain("$8.000");
    expect(texto).toMatch(/la verific|úsala tal cual/i);
  });

  it("domicilio con tarifa PENDIENTE: lo dice, y no inventa ninguna cifra", () => {
    const texto = comoTexto(pedido({ ...VERIFICADO, zonaId: null, zonaNombre: null, feeCents: null }));
    expect(texto).toMatch(/PENDIENTE de verificar/);
    expect(texto).toMatch(/no la inventes/i);
    // Ni una tarifa: la única cifra en pesos del bloque es el total.
    expect(texto.match(/\$[\d.]+/g)).toEqual(["$20.000"]);
  });

  it("UNA ZONA GRATIS ($0) es una tarifa REAL, no una pendiente", () => {
    // `feeCents: 0` es una tarifa verificada de verdad; solo `null` es
    // pendiente (ver `EntregaVerificada`). Un `if (!feeCents)` los confundiría
    // y anunciaría como pendiente un domicilio ya resuelto.
    const texto = comoTexto(pedido({ ...VERIFICADO, feeCents: 0 }));
    expect(texto).toContain("tarifa $0");
    expect(texto).not.toMatch(/PENDIENTE/);
  });

  it("RECOGIDA: lo dice, y no menciona zona ni tarifa", () => {
    const texto = comoTexto(
      pedido({ ...VERIFICADO, tipo: "recogida", zonaId: null, zonaNombre: null, feeCents: null })
    );
    expect(texto).toContain("recoge en el local");
    expect(texto).not.toMatch(/Villa del Sur|tarifa|domicilio,/i);
  });

  it("CAMBIO DE DIRECCIÓN: refleja el estado actual, nunca el anterior", () => {
    // El backend sobrescribe `entrega` entera al reverificar. El bloque debe
    // enseñar solo lo último, sin rastro de la zona vieja.
    const despues = comoTexto(
      pedido({ ...VERIFICADO, zonaId: "dz_2", zonaNombre: "Ciudad Jardín", feeCents: 1000000 })
    );
    expect(despues).toContain("Ciudad Jardín");
    expect(despues).toContain("$10.000");
    expect(despues).not.toContain("Villa del Sur");
    expect(despues).not.toContain("$8.000");
  });

  it("DE DOMICILIO A RECOGIDA: la tarifa anterior desaparece del bloque", () => {
    const texto = comoTexto(
      pedido({ ...VERIFICADO, tipo: "recogida", zonaId: null, zonaNombre: null, feeCents: null })
    );
    expect(texto).not.toContain("$8.000");
    expect(texto).not.toContain("Villa del Sur");
  });

  it("VERTICAL DE CITAS: sin entrega no aparece nada de domicilio", () => {
    // `comoTexto` lo comparte el vertical de citas, donde `entrega` siempre es
    // nulo porque solo lo escribe el flujo de pedidos.
    const texto = comoTexto(pedido(undefined), [], [], "citas");
    expect(texto).toContain("CITA EN CURSO");
    expect(texto).not.toMatch(/ENTREGA|domicilio|recoge/i);
  });

  it("la línea de entrega va ANTES del total, y el total no cambia", () => {
    const texto = comoTexto(pedido(VERIFICADO));
    expect(texto.indexOf("ENTREGA:")).toBeLessThan(texto.indexOf("TOTAL"));
    // El total sigue siendo el de productos: este cambio no toca quién calcula.
    expect(texto).toContain("TOTAL (lo calculó el sistema, úsalo tal cual): $20.000");
  });
});
