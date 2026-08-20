import { describe, expect, it } from "vitest";
import { generarPerfil } from "@/server/ai/generador/generar";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

/**
 * Los canales externos: dónde MÁS se le puede pedir a un negocio.
 *
 * De una venta perdida el 20-ago-2026 — el agente contestó que no había app de
 * domicilios cuando sí la había — y de un agujero que apareció auditándolo: un
 * negocio que no reparte por su cuenta pero SÍ está en una app tenía escrito en
 * su propio prompt "**No hay domicilios**", un "no" declarado que el agente
 * diría con total seguridad.
 */
function ficha(extra: Partial<FichaDelNegocio>): FichaDelNegocio {
  return {
    nombre: "Negocio de prueba",
    queVende: "Vende cosas.",
    ubicacion: "Una dirección",
    horario: { abre: "09:00", cierra: "18:00", dias: [1, 2, 3, 4, 5] },
    vertical: "pedidos",
    catalogo: "Algo — $10.000",
    entrega: { haceDomicilios: false },
    pago: { formas: "efectivo", compruebaUnaPersona: false },
    tono: "cercano",
    saludoInicial: "Hola",
    reglasPropias: [],
    preguntasFrecuentes: [],
    escalarSiempre: [],
    nuncaPrometer: [],
    ...extra,
  } as FichaDelNegocio;
}

const UNA_APP = [{ nombre: "Una app de domicilios", enlace: "https://ejemplo.test/negocio" }];

describe("los canales externos en el prompt", () => {
  it("un negocio sin canales no nota que esto existe", () => {
    const p = generarPerfil(ficha({})).instructions;
    expect(p).not.toContain("También nos pueden pedir");
  });

  it("con canales, salen con su enlace tal cual", () => {
    const p = generarPerfil(ficha({ canales: UNA_APP })).instructions;
    expect(p).toContain("También nos pueden pedir");
    expect(p).toContain("Una app de domicilios");
    expect(p).toContain("https://ejemplo.test/negocio");
  });

  it("un canal sin enlace se menciona igual, sin inventarle uno", () => {
    const p = generarPerfil(ficha({ canales: [{ nombre: "Nuestra tienda web" }] })).instructions;
    expect(p).toContain("Nuestra tienda web");
    expect(p).not.toContain("undefined");
  });

  /**
   * 🔴 El agujero que cerró este cambio.
   *
   * Sin canales, "No hay domicilios" es correcto. CON canales, es un "no"
   * declarado y FALSO: el negocio no reparte, pero se le puede pedir igual.
   */
  it("si no reparte pero tiene canal, el prompt deja de negar el domicilio", () => {
    const sinCanales = generarPerfil(ficha({})).instructions;
    expect(sinCanales).toContain("**No hay domicilios.**");

    const conCanales = generarPerfil(ficha({ canales: UNA_APP })).instructions;
    expect(conCanales).not.toContain("**No hay domicilios.**");
    expect(conCanales).toContain("nunca digas que no hay domicilio a secas");
  });

  it("si reparte por su cuenta, el bloque de domicilio propio no cambia", () => {
    const p = generarPerfil(
      ficha({
        entrega: {
          haceDomicilios: true,
          como: "En moto",
          // Obligatorio para quien reparte: sin esto `generarPerfil` se niega.
          quienPagaElDomicilio: "El domicilio se paga aparte, al repartidor.",
        },
        canales: UNA_APP,
      })
    ).instructions;
    expect(p).toContain("**Domicilio.**");
    expect(p).toContain("En moto");
    expect(p).toContain("También nos pueden pedir");
  });

  /**
   * Vale para los dos verticales: un salón puede agendar por otra plataforma,
   * y ahí "entrega" no significa nada. Por eso el bloque va FUERA de `entrega`
   * y sin filtrar por vertical.
   */
  it("un negocio de citas también los muestra, aunque no tenga entregas", () => {
    const p = generarPerfil(
      ficha({ vertical: "citas", canales: [{ nombre: "Otra plataforma", enlace: "https://ejemplo.test/agenda" }] })
    ).instructions;
    expect(p).toContain("Otra plataforma");
    expect(p).toContain("https://ejemplo.test/agenda");
    // Y sigue sin hablarle de domicilios a un salón.
    expect(p).not.toContain("No hay domicilios");
  });

  it("no empuja al cliente fuera de WhatsApp si puede cerrar aquí", () => {
    const p = generarPerfil(ficha({ canales: UNA_APP })).instructions;
    expect(p).toContain("No lo ofrezcas por tu cuenta si puedes cerrar el pedido aquí mismo");
  });
});
