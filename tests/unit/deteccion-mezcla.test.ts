import { describe, expect, it } from "vitest";

/**
 * `analizarContenidoConfigurable` — auditoría de fichas de configuración
 * (1-sep-2026): detecta cuando un campo de texto libre configurable por el
 * negocio (ej. `entrega.quienPagaElDomicilio`) mezcla contenido para el
 * cliente con una instrucción dirigida al agente, sin modificar ni corregir
 * nada — solo advertencia. Nace del incidente real de Lis, generalizado
 * (nunca hardcodea nombres de organizaciones ni de clientes).
 */

import {
  advertenciasDeFicha,
  analizarContenidoConfigurable,
} from "@/server/ai/generador/deteccion-mezcla";
import type { FichaDelNegocio } from "@/server/ai/generador/ficha";

describe("analizarContenidoConfigurable — debe detectar", () => {
  it("mezcla de dato + orden negativa (caso real generalizado, ej. Lis)", () => {
    const r = analizarContenidoConfigurable(
      "El domicilio lo paga el cliente. No inventes el valor."
    );
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
    expect(r.advertencias.some((a) => a.tipo === "mezcla_de_audiencia")).toBe(true);
  });

  it("rol del agente descrito en un campo de dato", () => {
    const r = analizarContenidoConfigurable("Tu trabajo es cerrar pedidos hablando poco.");
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
  });

  it("nota meta entre paréntesis", () => {
    const r = analizarContenidoConfigurable(
      "(Esta frase es la respuesta textual para quien pregunte por personalizadas.)"
    );
    expect(r.advertencias.some((a) => a.tipo === "nota_meta")).toBe(true);
  });

  it("sujeto explícito 'el agente debe'", () => {
    const r = analizarContenidoConfigurable("El agente debe confirmar el pago.");
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
  });

  it("orden condicionada ('antes de X, pregunta')", () => {
    const r = analizarContenidoConfigurable("Antes de cerrar el pedido, pregunta la dirección.");
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
  });

  it("'nunca prometas' (verbo específico, no 'nunca' aislado)", () => {
    const r = analizarContenidoConfigurable(
      "No ingresamos a apartamentos ni a centros comerciales. Nunca prometas que se entrega en la puerta del apartamento."
    );
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
    expect(r.advertencias.some((a) => a.tipo === "mezcla_de_audiencia")).toBe(true);
  });

  it("'informa al cliente' con verbo de habla + objeto explícito", () => {
    const r = analizarContenidoConfigurable(
      "El valor de los productos no incluye el domicilio. Informa al cliente que se confirma después."
    );
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
  });

  it("'no le pidas' (orden negativa con pronombre dativo)", () => {
    const r = analizarContenidoConfigurable(
      "Puedes pasar a recoger tu pedido. Si el cliente recoge, no le pidas dirección."
    );
    expect(r.advertencias.some((a) => a.tipo === "posible_instruccion_agente")).toBe(true);
  });

  it("nota entre corchetes dirigida al bot", () => {
    const r = analizarContenidoConfigurable("[IMPORTANTE PARA EL BOT] No repitas esto dos veces.");
    expect(r.advertencias.some((a) => a.tipo === "nota_meta")).toBe(true);
  });
});

describe("analizarContenidoConfigurable — NO debe detectar (falsos positivos evitados)", () => {
  it("restricción legítima sin instrucción", () => {
    const r = analizarContenidoConfigurable("No realizamos entregas dentro de apartamentos.");
    expect(r.advertencias).toEqual([]);
  });

  it("condición comercial con 'debe' pero sujeto correcto", () => {
    const r = analizarContenidoConfigurable("El pedido debe pagarse antes de las 5 PM.");
    expect(r.advertencias).toEqual([]);
  });

  it("'el cliente debe' no es 'el agente debe'", () => {
    const r = analizarContenidoConfigurable("El cliente debe presentar su comprobante.");
    expect(r.advertencias).toEqual([]);
  });

  it("dato simple sobre quién paga el domicilio", () => {
    const r = analizarContenidoConfigurable("El domicilio lo paga directamente el cliente.");
    expect(r.advertencias).toEqual([]);
  });

  it("'nunca' en 1ª persona plural (el negocio hablando de sí mismo) no es orden", () => {
    const r = analizarContenidoConfigurable("Nunca congelamos los productos.");
    expect(r.advertencias).toEqual([]);
  });

  it("política comercial normal, sin ninguna señal", () => {
    const r = analizarContenidoConfigurable(
      "Aceptamos transferencia y efectivo. Atendemos de lunes a sábado de 10am a 8pm."
    );
    expect(r.advertencias).toEqual([]);
  });

  it("texto vacío", () => {
    expect(analizarContenidoConfigurable("").advertencias).toEqual([]);
    expect(analizarContenidoConfigurable("   ").advertencias).toEqual([]);
  });

  it("null y undefined", () => {
    expect(analizarContenidoConfigurable(null).advertencias).toEqual([]);
    expect(analizarContenidoConfigurable(undefined).advertencias).toEqual([]);
  });
});

describe("analizarContenidoConfigurable — casos adicionales", () => {
  it("texto largo, limpio, con varias oraciones — sin advertencias", () => {
    const r = analizarContenidoConfigurable(
      "Hacemos domicilios por Yango, llegan en aproximadamente 1 hora. " +
        "El valor lo paga el cliente directamente al repartidor. " +
        "No ingresamos a apartamentos ni centros comerciales, la entrega es en portería. " +
        "Si el pedido es un regalo, el domicilio va incluido y quien lo recibe no paga nada."
    );
    expect(r.advertencias).toEqual([]);
  });

  it("múltiples advertencias distintas en un mismo texto", () => {
    const r = analizarContenidoConfigurable(
      "El domicilio lo paga el cliente. No inventes el valor. Tu trabajo es cerrar el pedido rápido."
    );
    const tipos = r.advertencias.map((a) => a.tipo);
    expect(tipos).toContain("posible_instruccion_agente");
    expect(tipos).toContain("mezcla_de_audiencia");
    // Dos instrucciones distintas detectadas (una por cada segmento problemático).
    expect(r.advertencias.filter((a) => a.tipo === "posible_instruccion_agente").length).toBe(2);
  });

  it("mezcla real dato + instrucción + nota (los tres tipos a la vez)", () => {
    const r = analizarContenidoConfigurable(
      "El domicilio lo paga el cliente directamente al repartidor. " +
        "No inventes el valor si no ha sido confirmado. " +
        "(Nota para el bot: revisa esto siempre antes de cerrar.)"
    );
    const tipos = new Set(r.advertencias.map((a) => a.tipo));
    expect(tipos.has("posible_instruccion_agente")).toBe(true);
    expect(tipos.has("nota_meta")).toBe(true);
    expect(tipos.has("mezcla_de_audiencia")).toBe(true);
  });

  it("no modifica el texto original — el llamante sigue recibiendo el mismo string", () => {
    const original = "No inventes el valor del domicilio.";
    analizarContenidoConfigurable(original);
    expect(original).toBe("No inventes el valor del domicilio.");
  });

  it("es determinista: misma entrada, mismo resultado", () => {
    const texto = "No inventes el valor. El domicilio lo paga el cliente.";
    const r1 = analizarContenidoConfigurable(texto);
    const r2 = analizarContenidoConfigurable(texto);
    expect(r1).toEqual(r2);
  });
});

/**
 * `advertenciasDeFicha` — la pieza que consume `/api/onboarding` (Fase 2C,
 * 1-sep-2026): analiza solo los dos campos con cita literal forzada
 * (`entrega.quienPagaElDomicilio`, `pago.datosDeCuenta`), cada advertencia
 * llega con el nombre del campo al que pertenece.
 */
describe("advertenciasDeFicha", () => {
  function ficha(datos: Partial<FichaDelNegocio>): Partial<FichaDelNegocio> {
    return datos;
  }

  it("CASO A — contenido limpio: sin advertencias", () => {
    const r = advertenciasDeFicha(
      ficha({
        entrega: {
          haceDomicilios: true,
          quienPagaElDomicilio: "El domicilio lo paga el cliente directamente al repartidor.",
        },
        pago: { formas: "Transferencia", datosDeCuenta: "Bancolombia 12345 — Juan Pérez", compruebaUnaPersona: true },
      })
    );
    expect(r).toEqual([]);
  });

  it("CASO B — posible instrucción en quienPagaElDomicilio: advertencia con el campo correcto", () => {
    const r = advertenciasDeFicha(
      ficha({
        entrega: {
          haceDomicilios: true,
          quienPagaElDomicilio: "El domicilio lo paga el cliente. No inventes el valor.",
        },
      })
    );
    expect(r.some((a) => a.campo === "entrega.quienPagaElDomicilio" && a.tipo === "posible_instruccion_agente")).toBe(true);
  });

  it("CASO C — mezcla de audiencia: tipo correcto con el campo correcto", () => {
    const r = advertenciasDeFicha(
      ficha({
        entrega: {
          haceDomicilios: true,
          quienPagaElDomicilio: "El domicilio lo paga el cliente. No inventes el valor.",
        },
      })
    );
    expect(r.some((a) => a.campo === "entrega.quienPagaElDomicilio" && a.tipo === "mezcla_de_audiencia")).toBe(true);
  });

  it("CASO D — nota meta en datosDeCuenta: advertencia", () => {
    const r = advertenciasDeFicha(
      ficha({
        pago: {
          formas: "Transferencia",
          datosDeCuenta: "Bancolombia 12345 — Juan Pérez. (Nota para el bot: confirma siempre antes de dar esto.)",
          compruebaUnaPersona: true,
        },
      })
    );
    expect(r.some((a) => a.campo === "pago.datosDeCuenta" && a.tipo === "nota_meta")).toBe(true);
  });

  it("CASO E — una advertencia nunca es un rechazo: la función siempre retorna, nunca lanza", () => {
    // El contenido más "grave" posible (instrucción + nota + mezcla a la vez)
    // sigue produciendo un array normal — nunca una excepción, nunca un
    // valor que represente "guardado bloqueado".
    expect(() =>
      advertenciasDeFicha(
        ficha({
          entrega: {
            haceDomicilios: true,
            quienPagaElDomicilio:
              "El domicilio lo paga el cliente. No inventes el valor. (Nota para el bot: revisa esto siempre.)",
          },
        })
      )
    ).not.toThrow();
  });

  it("CASO F — no regresión: campos fuera de la lista analizada (ej. reglasPropias) no se tocan", () => {
    const r = advertenciasDeFicha(
      ficha({
        reglasPropias: ["No inventes precios. Nunca prometas descuentos."],
        entrega: { haceDomicilios: false },
      })
    );
    // reglasPropias es, por diseño, el lugar CORRECTO para instrucciones —
    // esta función no lo analiza, así que nunca genera advertencias sobre él.
    expect(r).toEqual([]);
  });

  it("ficha vacía o sin los campos de riesgo: sin advertencias, sin error", () => {
    expect(advertenciasDeFicha({})).toEqual([]);
  });

  it("aislamiento: dos fichas distintas analizadas en la misma ejecución no se mezclan", () => {
    const fichaConMezcla = ficha({
      entrega: { haceDomicilios: true, quienPagaElDomicilio: "No inventes el valor. El domicilio lo paga el cliente." },
    });
    const fichaLimpia = ficha({
      entrega: { haceDomicilios: true, quienPagaElDomicilio: "El domicilio lo paga el cliente." },
    });
    const r1 = advertenciasDeFicha(fichaConMezcla);
    const r2 = advertenciasDeFicha(fichaLimpia);
    expect(r1.length).toBeGreaterThan(0);
    expect(r2).toEqual([]);
    // Re-analizar la primera de nuevo da el mismo resultado — ningún estado
    // compartido entre llamadas (equivalente a "entre organizaciones").
    expect(advertenciasDeFicha(fichaConMezcla)).toEqual(r1);
  });

  it("dos campos con advertencia simultánea: la respuesta identifica correctamente a cada uno (Fase 2D)", () => {
    const r = advertenciasDeFicha(
      ficha({
        entrega: {
          haceDomicilios: true,
          quienPagaElDomicilio: "El domicilio lo paga el cliente. No inventes el valor.",
        },
        pago: {
          formas: "Transferencia",
          datosDeCuenta: "Bancolombia 12345. (Nota para el bot: confirma siempre antes de dar esto.)",
          compruebaUnaPersona: true,
        },
      })
    );
    const campos = new Set(r.map((a) => a.campo));
    expect(campos.has("entrega.quienPagaElDomicilio")).toBe(true);
    expect(campos.has("pago.datosDeCuenta")).toBe(true);
    // Ninguna advertencia de un campo se filtra hacia el otro: el de
    // domicilio nunca trae "nota_meta" (no la tiene) y el de la cuenta
    // nunca trae "posible_instruccion_agente" (no la tiene, solo nota).
    expect(
      r.filter((a) => a.campo === "entrega.quienPagaElDomicilio").every((a) => a.tipo !== "nota_meta")
    ).toBe(true);
    expect(
      r.filter((a) => a.campo === "pago.datosDeCuenta").every((a) => a.tipo !== "posible_instruccion_agente")
    ).toBe(true);
    expect(r.some((a) => a.campo === "pago.datosDeCuenta" && a.tipo === "nota_meta")).toBe(true);
  });
});
