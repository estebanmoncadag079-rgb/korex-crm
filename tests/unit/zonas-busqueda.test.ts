import { describe, expect, it } from "vitest";
import { coincideConLaBusqueda } from "@/lib/zonas-busqueda";
import { resolverZonaDeEntrega } from "@/server/delivery/zonas";

/**
 * El buscador de barrios de la pantalla de Domicilios.
 *
 * Nace del incidente del 8-sep-2026 (MALIA): una clienta de "barrio villa
 * nueva" no pudo cerrar su pedido porque ese barrio no estaba entre las 37
 * zonas cargadas. Lía lo agregó 14 minutos después, cuando ya había perdido
 * el pedido. Con un buscador, la respuesta a "¿tengo este barrio?" tarda dos
 * segundos y se arregla en el momento.
 *
 * Lo que estas pruebas protegen es que la pantalla conteste **lo mismo que va
 * a contestar el bot**: si dijera "no lo tienes" de una zona que el agente sí
 * encuentra, alguien la cargaría dos veces; si dijera "sí lo tienes" de una
 * que el agente no encuentra, el negocio se quedaría tranquilo mientras el bot
 * sigue sin poder cotizarla.
 */
describe("buscar un barrio entre las zonas cargadas", () => {
  it("encuentra sin importar tildes ni mayúsculas", () => {
    expect(coincideConLaBusqueda("Cañasgordas", "canasgordas")).toBe(true);
    expect(coincideConLaBusqueda("Villa Nueva", "VILLA NUEVA")).toBe(true);
    expect(coincideConLaBusqueda("Ciudad Jardín", "ciudad jardin")).toBe(true);
  });

  it("encuentra escribiendo solo una parte del nombre", () => {
    expect(coincideConLaBusqueda("Ciudad Meléndez", "melendez")).toBe(true);
    expect(coincideConLaBusqueda("Valle del Lili", "lili")).toBe(true);
  });

  it("encuentra pegando la dirección entera, como la manda el cliente", () => {
    // Es el caso que resolvió bien en producción ese mismo día:
    // zona="Cra 24R #85-69 Barrio Talanga" status=found
    expect(coincideConLaBusqueda("Talanga", "Cra 24R #85-69 Barrio Talanga")).toBe(true);
  });

  it("no inventa coincidencias", () => {
    expect(coincideConLaBusqueda("Talanga", "Villa Nueva")).toBe(false);
    expect(coincideConLaBusqueda("El Limonar", "Pance")).toBe(false);
  });

  it("sin escribir nada, la lista se ve entera", () => {
    expect(coincideConLaBusqueda("Talanga", "")).toBe(true);
    expect(coincideConLaBusqueda("Talanga", "   ")).toBe(true);
  });

  /**
   * La comprobación que de verdad importa: la pantalla y el agente tienen que
   * coincidir. Si alguien cambia uno de los dos matchers, esto lo caza.
   */
  it("contesta lo mismo que el agente sobre las zonas reales de MALIA", () => {
    const zonas = [
      { id: "z1", nombre: "Villa Nueva", feeCents: 800000 },
      { id: "z2", nombre: "Talanga", feeCents: 1000000 },
      { id: "z3", nombre: "Cañasgordas", feeCents: 1200000 },
      { id: "z4", nombre: "Ciudad Jardín", feeCents: 1000000 },
    ];
    const consultas = [
      "Calle 32A, 28I-34 barrio villa nueva",
      "Cra 24R #85-69 Barrio Talanga",
      "canasgordas",
      "ciudad jardin",
    ];

    for (const consulta of consultas) {
      const loEncuentraElAgente = resolverZonaDeEntrega(zonas, consulta).status === "found";
      const loEncuentraLaPantalla = zonas.some((z) => coincideConLaBusqueda(z.nombre, consulta));
      expect(
        loEncuentraLaPantalla,
        `la pantalla y el agente discrepan sobre "${consulta}"`
      ).toBe(loEncuentraElAgente);
    }
  });

  it("un barrio que no está: los dos dicen que no", () => {
    const zonas = [{ id: "z1", nombre: "Talanga", feeCents: 1000000 }];
    const consulta = "barrio villa nueva";
    expect(resolverZonaDeEntrega(zonas, consulta).status).toBe("not_found");
    expect(zonas.some((z) => coincideConLaBusqueda(z.nombre, consulta))).toBe(false);
  });
});
